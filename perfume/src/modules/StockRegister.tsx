import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../core/api';
import { money, useSession, variantName, date, dateTime } from '../core/session';
import { ScanBox, useScanner, beep } from '../core/scanner';
import { Card, Empty, Loading, Modal, Status, toastError, useAction, useData } from '../components/ui';

const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit' }).format(new Date());
const monthName = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function csv(rows: (string | number | null | undefined)[][]) {
  return rows.map((r) => r.map((c) => { const s = c == null ? '' : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
}

/** Monthly stock register: opening, received, sold, transfers, adjustments, closing — next to the physical count for the month. */
export function StockRegister() {
  const { can, me } = useSession();
  const { data: branches } = useData<any[]>('/branches');
  const [month, setMonth] = useState(thisMonth());
  const [branchId, setBranchId] = useState<string>(me.user.branchId || '');
  const br = branchId || branches?.[0]?.id || '';
  const { data, reload } = useData<any>(br ? '/inventory/register' + qs({ month, branchId: br }) : null, [month, br]);
  const [search, setSearch] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const { busy, run } = useAction();
  const future = month > thisMonth();

  const startCount = () => run(() => api.post('/inventory/counts', { branchId: br, period: month }), '').then((r) => { if (r) setSheet(r.id); });
  const q = search.trim().toLowerCase();
  const lines = (data?.lines || []).filter((l: any) => (!q || `${l.brand} ${l.name} ${l.sku} ${l.barcode}`.toLowerCase().includes(q)) && (!onlyDiff || l.difference));
  const seeCost = !!data?.seeCost;
  const branchName = branches?.find((b) => b.id === br)?.name || '';

  const exportCsv = () => {
    const head = ['Brand', 'Product', 'SKU', 'Barcode', 'Opening', 'Received', 'Sold', 'Transfers', 'Adjustments', 'Count adj.', 'Closing (system)', 'Physical', 'Difference', ...(seeCost ? ['Avg cost', 'Difference value', 'Closing value'] : [])];
    const body = data.lines.map((l: any) => [l.brand, variantName(l).replace(`${l.brand} `, ''), l.sku, l.barcode, l.opening, l.received, l.sold, l.transfers, l.adjusted, l.count_adj, l.closing, l.counted_qty ?? '', l.difference ?? '',
      ...(seeCost ? [(l.avg_cost / 1000).toFixed(3), l.difference_value == null ? '' : (l.difference_value / 1000).toFixed(3), (l.closing_value / 1000).toFixed(3)] : [])]);
    const blob = new Blob(['﻿' + csv([head, ...body])], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `stock-register-${month}-${branchName.replace(/\W+/g, '-')}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const c = data?.count;
  const t = data?.totals;
  return (
    <>
      <div className="card row no-print" style={{ marginBottom: 12, alignItems: 'flex-end' }}>
        <label className="col" style={{ gap: 4 }}><span className="small muted">Month</span><input type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ width: 'auto' }} /></label>
        {!me.branchScope && (branches?.length || 0) > 1 && <label className="col" style={{ gap: 4 }}><span className="small muted">Branch</span><select value={br} onChange={(e) => setBranchId(e.target.value)} style={{ width: 'auto' }}>{branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        <input placeholder="Search product, SKU or barcode" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <label className="check"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Differences only</label>
        <div className="grow" />
        {data && <button className="btn" onClick={exportCsv}>Excel / CSV</button>}
        {data && <button className="btn" onClick={() => window.print()}>Print</button>}
      </div>

      <Card title={`Physical stock — ${monthName(month)}${branchName ? ' · ' + branchName : ''}`} className="no-print-border">
        {!data ? <Loading /> : (
          <div className="row" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {!c && <div className="grow">No physical count entered for this month yet. Count every bottle on the shelf and enter the numbers — they are saved as you type, and nothing changes in stock until it is posted.</div>}
            {c?.status === 'open' && <div className="grow">Count <b>{c.number}</b> in progress — <b>{t.counted}</b> of {data.lines.length} items counted, {t.differences} with a difference so far. Started {dateTime(c.created_at)}.</div>}
            {c?.status === 'posted' && <div className="grow"><span className="badge ok">Posted</span> Count <b>{c.number}</b> posted {date(c.posted_at)} — {t.differences} item{t.differences === 1 ? '' : 's'} with a difference{seeCost && t.difference_value ? `, value ${money(t.difference_value)}` : ''}.</div>}
            {can('inventory', 'edit') && !future && c?.status !== 'posted' && <button className="btn primary no-print" disabled={busy} onClick={c ? () => setSheet(c.id) : startCount}>{c ? 'Continue entering physical stock' : `Enter physical stock for ${monthName(month)}`}</button>}
            {c?.status === 'posted' && <button className="btn no-print" onClick={() => setSheet(c.id)}>View count</button>}
          </div>
        )}
      </Card>

      {data && (
        <div className="grid g4 no-print" style={{ margin: '12px 0' }}>
          {[['Opening', t.opening], ['Received', t.received], ['Sold', t.sold], ['Closing (system)', t.closing]].map(([k, v]) => (
            <div key={k as string} className="card"><div className="small muted">{k}</div><div style={{ fontSize: 24, fontWeight: 600 }}>{v}</div><div className="small muted">units</div></div>
          ))}
        </div>
      )}

      <div className="card tablewrap">
        <div className="print-only" style={{ marginBottom: 8 }}><b>Stock register — {monthName(month)} — {branchName}</b></div>
        {!data ? <Loading /> : !lines.length ? <Empty>{onlyDiff ? 'No differences' : 'No products'}</Empty> : (
          <table className="t">
            <thead><tr><th>Product</th><th className="num">Opening</th><th className="num">Received</th><th className="num">Sold</th><th className="num" title="In minus out between branches">Transfers</th><th className="num" title="Damage, loss, expired, corrections">Adjust.</th><th className="num" title="Changes posted from the stock count">Count adj.</th><th className="num">Closing</th><th className="num">Physical</th><th className="num">Diff.</th>{seeCost && <th className="num">Diff. value</th>}</tr></thead>
            <tbody>{lines.map((l: any) => (
              <tr key={l.variant_id}>
                <td style={{ minWidth: 200 }}><b>{variantName(l)}</b><div className="small muted">{l.sku}</div></td>
                <td className="num">{l.opening}</td>
                <td className="num">{l.received || ''}</td>
                <td className="num">{l.sold || ''}</td>
                <td className="num">{l.transfers || ''}</td>
                <td className="num">{l.adjusted || ''}</td>
                <td className="num">{l.count_adj || ''}</td>
                <td className="num"><b>{l.closing}</b></td>
                <td className="num">{l.counted_qty ?? <span className="muted">—</span>}</td>
                <td className={'num ' + (l.difference ? (l.difference < 0 ? 'bad' : 'ok') : '')}>{l.difference ? (l.difference > 0 ? '+' : '') + l.difference : l.difference === 0 ? '✓' : ''}</td>
                {seeCost && <td className={'num ' + (l.difference_value < 0 ? 'bad' : '')}>{l.difference_value ? money(l.difference_value) : ''}</td>}
              </tr>
            ))}</tbody>
            <tfoot><tr><td>Total ({lines.length})</td>
              {['opening', 'received', 'sold', 'transfers', 'adjusted', 'count_adj', 'closing'].map((k) => <td key={k} className="num">{lines.reduce((a: number, l: any) => a + (l[k] || 0), 0)}</td>)}
              <td className="num">{lines.reduce((a: number, l: any) => a + (l.counted_qty ?? 0), 0)}</td>
              <td className="num">{lines.reduce((a: number, l: any) => a + (l.difference || 0), 0)}</td>
              {seeCost && <td className="num">{money(lines.reduce((a: number, l: any) => a + (l.difference_value || 0), 0))}</td>}</tr></tfoot>
          </table>
        )}
        <div className="small muted" style={{ marginTop: 6 }}>Closing = Opening + Received − Sold ± Transfers ± Adjustments ± Count adjustments. Difference = physical count − system stock at the moment counting started.</div>
      </div>
      {sheet && <CountSheet id={sheet} onClose={() => { setSheet(null); reload(); }} />}
    </>
  );
}

/** Enter physical stock: saved automatically while typing (or scanning); posting books the differences. */
export function CountSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useSession();
  const { data } = useData<any>(`/inventory/counts/${id}`);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  const [search, setSearch] = useState('');
  const [todo, setTodo] = useState(false);
  const { busy, run } = useAction();
  const [scanMsg, setScanMsg] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const open = data?.status === 'open';
  const value = (l: any) => counts[l.variant_id] ?? (l.counted_qty == null ? '' : String(l.counted_qty));

  const setCount = (vid: string, v: string) => { setCounts((c) => ({ ...c, [vid]: v })); setDirty((d) => ({ ...d, [vid]: v })); };
  const save = async (d = dirty) => {
    if (!Object.keys(d).length) return true;
    setSaveState('saving');
    try { await api.put(`/inventory/counts/${id}/lines`, { counts: d }); setDirty((cur) => Object.fromEntries(Object.entries(cur).filter(([k, v]) => d[k] !== v))); setSaveState('saved'); return true; }
    catch (e) { setSaveState('error'); toastError(e); return false; }
  };
  useEffect(() => {
    if (!open || !Object.keys(dirty).length) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(dirty), 1200);
    return () => window.clearTimeout(timer.current);
  }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScan = (code: string) => {
    const l = data?.lines.find((x: any) => x.barcode === code || x.sku.toLowerCase() === code.toLowerCase());
    if (!l || !open) { beep(false); return setScanMsg(l ? 'This count is already posted' : `${code}: not part of this count`); }
    const n = Number(value(l) || 0) + 1;
    beep(true); setScanMsg(`${variantName(l)}: counted ${n}`); setCount(l.variant_id, String(n));
  };
  useScanner(onScan, !!data);
  const close = async () => { if (open) await save(); onClose(); };
  if (!data) return <Modal title="Stock count" onClose={onClose}><Loading /></Modal>;

  const q = search.trim().toLowerCase();
  const counted = data.lines.filter((l: any) => value(l) !== '').length;
  const lines = data.lines.filter((l: any) => (!q || `${l.brand} ${l.name} ${l.sku} ${l.barcode}`.toLowerCase().includes(q)) && (!todo || value(l) === ''));
  const diffs = data.lines.filter((l: any) => value(l) !== '' && Number(value(l)) !== l.system_qty).length;

  return (
    <Modal wide title={`Physical stock ${data.number}${data.period ? ' — ' + monthName(data.period) : ''}`} onClose={close} footer={
      <>
        {open && can('inventory', 'manage') && <button className="btn ghost" disabled={busy} onClick={() => confirm('Cancel this count? The numbers entered are discarded and stock is not changed.') && run(() => api.post(`/inventory/counts/${id}/cancel`), 'Count cancelled').then((r) => r && onClose())}>Cancel count</button>}
        <div className="grow" />
        <button className="btn" onClick={() => window.print()}>Print sheet</button>
        {open && <button className="btn" disabled={busy || saveState === 'saving'} onClick={close}>Save & close</button>}
        {open && can('inventory', 'manage') && <button className="btn primary" disabled={busy || !counted} onClick={async () => {
          const uncounted = data.lines.length - counted;
          if (!confirm(`Post this count?\n\n${counted} items counted, ${diffs} with a difference.${uncounted ? `\n${uncounted} items not counted are left unchanged.` : ''}\n\nStock is corrected to the counted numbers and the value difference is booked in the accounts.`)) return;
          if (!(await save())) return;
          const r = await run(() => api.post(`/inventory/counts/${id}/post`, { counts: {} }), 'Count posted — stock updated');
          if (r) onClose();
        }}>Post count</button>}
      </>
    }>
      <div className="print-only" style={{ marginBottom: 8 }}><b>Physical stock count {data.number}{data.period ? ' — ' + monthName(data.period) : ''}</b> · Counted by: ____________ · Date: ________</div>
      <div className="row no-print" style={{ marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="badge">{counted} / {data.lines.length} counted</span>
        {diffs > 0 && <span className="badge warn">{diffs} differences</span>}
        <Status s={data.status} />
        {open && <span className="small muted">{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'All changes saved ✓' : saveState === 'error' ? <span className="bad">Not saved — check the connection</span> : 'Saved automatically as you type'}</span>}
      </div>
      {open && <div className="no-print" style={{ marginBottom: 10 }}><ScanBox onScan={onScan} placeholder="Scan every bottle on the shelf — each scan counts one" />{scanMsg && <div className="small muted">{scanMsg}</div>}</div>}
      <div className="row no-print" style={{ marginBottom: 8 }}>
        <input placeholder="Search product, SKU or barcode" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1 }} />
        <label className="check"><input type="checkbox" checked={todo} onChange={(e) => setTodo(e.target.checked)} /> Not counted only</label>
      </div>
      {!lines.length ? <Empty>{todo ? 'Everything is counted' : 'Nothing found'}</Empty> : (
        <table className="t">
          <thead><tr><th>Product</th><th>SKU</th><th className="num">System</th><th>Physical</th><th className="num">Difference</th></tr></thead>
          <tbody>{lines.map((l: any) => { const c = value(l); const d = c === '' ? null : Number(c) - l.system_qty; return (
            <tr key={l.variant_id}>
              <td>{variantName(l)}</td><td className="small">{l.sku}<div className="muted">{l.barcode}</div></td>
              <td className="num">{l.system_qty}</td>
              <td>{open ? <input value={c} onChange={(e) => setCount(l.variant_id, e.target.value.replace(/[^\d]/g, ''))} style={{ width: 90 }} inputMode="numeric" aria-label={`Physical stock of ${variantName(l)}`} /> : (l.counted_qty ?? '—')}</td>
              <td className={'num ' + (d ? (d < 0 ? 'bad' : 'ok') : '')}>{d == null ? '' : d === 0 ? '✓' : (d > 0 ? '+' : '') + d}</td>
            </tr>
          ); })}</tbody>
        </table>
      )}
    </Modal>
  );
}
