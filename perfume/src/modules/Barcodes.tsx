// Barcodes & label printing: printers, label designer, bulk printing, history, scan verification, setup.
import { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../core/api';
import { agent, agentConfig, saveAgentConfig } from '../core/agent';
import { useSession, money, dateTime, variantName, monthStart, today } from '../core/session';
import { go } from '../core/router';
import { useScanner, ScanBox, beep } from '../core/scanner';
import { Bottle, Card, Empty, Field, Loading, Modal, PageHead, Tabs, toast, toastError, useAction, useData } from '../components/ui';
import { LabelPrinter, labelHtml, sendLabels, agentProbe, type LabelItem, type Printer } from '../components/Labels';
import { FIELDS, BUILTIN_TEMPLATES, testLabel, type Template, type Field as TField } from '../../shared/labels.js';
import { SYMBOLOGIES } from '../../shared/barcode.js';

type Tab = 'print' | 'printers' | 'templates' | 'history' | 'verify' | 'setup';
const toItem = (v: any, copies = 1): LabelItem => ({ id: v.id, barcode: v.barcode, symbology: v.symbology, sku: v.sku, name: v.name, brand: v.brand, label: v.label, size_ml: v.size_ml, retail_price: v.retail_price, original_price: v.original_price ?? v.compare_price, copies });

export default function Barcodes({ params }: { params: string[] }) {
  const { can } = useSession();
  const tabs: [Tab, string][] = [];
  if (can('barcodes', 'create')) tabs.push(['print', 'Print labels']);
  tabs.push(['verify', 'Scan & verify']);
  if (can('barcodes', 'view')) tabs.push(['printers', 'Printers'], ['templates', 'Label designer'], ['history', 'Printing history']);
  tabs.push(['setup', 'Setup guide']);
  const tab = (tabs.find((t) => t[0] === params[0])?.[0] || tabs[0][0]) as Tab;
  return (
    <>
      <PageHead title="Barcodes & labels" sub="Every perfume size has its own barcode. Print labels, set up label printers and see who printed what." />
      <Tabs tabs={tabs} value={tab} onChange={(t) => go('/barcodes/' + t)} />
      {tab === 'print' && <BulkPrint />}
      {tab === 'verify' && <Verify />}
      {tab === 'printers' && <Printers />}
      {tab === 'templates' && <Designer />}
      {tab === 'history' && <History />}
      {tab === 'setup' && <Setup />}
    </>
  );
}

// ---------------- bulk printing ----------------
function BulkPrint() {
  const { data: stock } = useData<any[]>('/inventory');
  const [list, setList] = useState<LabelItem[]>([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const addV = (v: any, n = 1) => setList((l) => (l.some((x) => x.id === v.id) ? l.map((x) => (x.id === v.id ? { ...x, copies: x.copies + n } : x)) : [...l, toItem(v, n)]));
  const onScan = (code: string) => {
    const v = (stock || []).find((x) => x.barcode === code || x.sku.toLowerCase() === code.toLowerCase());
    if (v) { addV(v); beep(true); setMsg({ ok: true, text: `Added ${variantName(v)}` }); } else { beep(false); setMsg({ ok: false, text: `Barcode ${code} is not in the system` }); }
  };
  useScanner(onScan);
  const found = search ? (stock || []).filter((v) => variantName(v).toLowerCase().includes(search.toLowerCase()) || v.sku.toLowerCase().includes(search.toLowerCase())).slice(0, 8) : [];
  const total = list.reduce((a, x) => a + x.copies, 0);
  return (
    <div className="grid g2">
      <Card title="Add products">
        <div className="col">
          <ScanBox onScan={onScan} placeholder="Scan a bottle (each scan adds one label) or type a barcode" />
          {msg && <div className={'small ' + (msg.ok ? 'ok' : 'bad')}>{msg.text}</div>}
          <input placeholder="…or search by name / SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
          {found.map((v) => <div key={v.id} className="row" style={{ padding: '4px 0' }}><Bottle name={v.brand} url={v.image_url} /><span className="grow">{variantName(v)}<div className="small muted">{v.sku} · {v.qty} in stock</div></span><button className="btn sm" onClick={() => { addV(v, Math.max(1, v.qty)); setSearch(''); }}>+ {Math.max(1, v.qty)} (stock)</button><button className="btn sm" onClick={() => { addV(v); setSearch(''); }}>+1</button></div>)}
          <div className="row">
            <button className="btn sm" disabled={!stock} onClick={() => setList((stock || []).filter((v) => v.qty > 0).map((v) => toItem(v, v.qty)))}>All products in stock (1 label per bottle)</button>
            <button className="btn sm" disabled={!stock} onClick={() => setList((stock || []).map((v) => toItem(v, 1)))}>One of every product</button>
          </div>
        </div>
      </Card>
      <Card title={`To print — ${total} label${total === 1 ? '' : 's'}`} actions={list.length > 0 && <><button className="btn sm ghost" onClick={() => setList([])}>Clear</button><button className="btn gold sm" disabled={!total} onClick={() => setOpen(true)}>Print…</button></>}>
        {!list.length ? <Empty>Scan or search products to add them</Empty> : (
          <table className="t"><tbody>{list.map((it, i) => <tr key={it.id}><td>{variantName(it)}<div className="small muted">{it.barcode}</div></td>
            <td><input type="number" min={0} value={it.copies} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, copies: Math.max(0, Number(e.target.value) || 0) } : x)))} style={{ width: 80 }} aria-label="Copies" /></td>
            <td><button className="btn ghost sm" aria-label="Remove" onClick={() => setList(list.filter((_, j) => j !== i))}>✕</button></td></tr>)}</tbody></table>
        )}
      </Card>
      {open && <LabelPrinter items={list.filter((x) => x.copies > 0)} source="bulk" onClose={() => setOpen(false)} />}
    </div>
  );
}

// ---------------- scan & verify ----------------
function Verify() {
  const { can } = useSession();
  const [hit, setHit] = useState<any>(null);
  const [miss, setMiss] = useState<string | null>(null);
  const [print, setPrint] = useState(false);
  const [log, setLog] = useState<{ code: string; ok: boolean; name?: string; at: string }[]>([]);
  const { busy, run } = useAction();
  const lookup = async (code: string) => {
    const r = await api.get<any>('/barcodes/lookup' + qs({ code })).catch((e) => { toastError(e); return null; });
    setLog((l) => [{ code, ok: !!r, name: r ? variantName(r) : undefined, at: new Date().toLocaleTimeString() }, ...l].slice(0, 30));
    if (r) { beep(r.sellable); setHit(r); setMiss(null); } else { beep(false); setHit(null); setMiss(code); }
  };
  useScanner(lookup, !print);
  const block = (blocked: boolean) => {
    const reason = blocked ? prompt('Why can this product not be sold? (e.g. tester, damaged, recalled batch)') : '';
    if (blocked && !reason) return;
    run(() => api.post(`/variants/${hit.id}/block`, { blocked, reason }), blocked ? 'Blocked from sale' : 'Can be sold again').then(() => lookup(hit.barcode));
  };
  return (
    <div className="grid g2">
      <div className="col">
        <ScanBox onScan={lookup} placeholder="Scan any bottle to check its product, price, stock and status" />
        {miss && <div className="scanhit bad"><div className="grow"><div className="big">Not found</div>Barcode <b>{miss}</b> is not in the system.</div>{can('inventory', 'create') && <button className="btn sm" onClick={() => go('/inventory')}>Create product</button>}</div>}
        {hit && (
          <Card>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ width: 90 }}><Bottle name={hit.brand || hit.name} url={hit.image_url} /></div>
              <div className="grow">
                <div className="big" style={{ fontFamily: 'var(--serif)', fontSize: '1.5rem' }}>{variantName(hit)}</div>
                <div className="muted small">SKU {hit.sku} · {SYMBOLOGIES[hit.symbology as 'ean13'] || hit.symbology} {hit.barcode}</div>
                <div style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', marginTop: 4 }}>OMR {money(hit.retail_price)} {hit.compare_price > hit.retail_price && <span className="muted small" style={{ textDecoration: 'line-through' }}>{money(hit.compare_price)}</span>}</div>
                <div style={{ marginTop: 6 }}>{hit.sellable ? <span className="badge ok">Can be sold</span> : <span className="badge bad">Cannot be sold{hit.block_reason ? `: ${hit.block_reason}` : !hit.active || !hit.product_active ? ': inactive' : ''}</span>}</div>
              </div>
            </div>
            <hr className="sep" />
            <table className="t"><thead><tr><th>Branch</th><th className="num">In stock</th></tr></thead><tbody>{hit.stock.map((s: any) => <tr key={s.branch_id}><td>{s.branch}</td><td className={'num ' + (s.qty <= 0 ? 'bad' : '')}>{s.qty}</td></tr>)}{!hit.stock.length && <tr><td colSpan={2} className="muted">No stock recorded</td></tr>}</tbody></table>
            {hit.batches.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>Batches: {hit.batches.map((b: any) => `${b.batch_no}${b.expiry_date ? ` (exp ${b.expiry_date.slice(0, 10)})` : ''}`).join(', ')}</div>}
            <div className="small muted">Labels printed so far: {hit.printed.n}{hit.printed.last ? ` · last ${dateTime(hit.printed.last)}` : ''}</div>
            <div className="row" style={{ marginTop: 10 }}>
              {can('barcodes', 'create') && <button className="btn sm gold" onClick={() => setPrint(true)}>Print labels</button>}
              {can('inventory', 'manage') && (hit.sale_blocked ? <button className="btn sm" disabled={busy} onClick={() => block(false)}>Allow sale again</button> : <button className="btn sm danger" disabled={busy} onClick={() => block(true)}>Block from sale (damaged / tester)</button>)}
              {can('inventory', 'manage') && <button className="btn sm" onClick={() => go('/inventory')}>Adjust stock</button>}
            </div>
          </Card>
        )}
      </div>
      <Card title="Scanned in this session">{!log.length ? <Empty>Nothing scanned yet</Empty> : <table className="t"><tbody>{log.map((l, i) => <tr key={i}><td className="small">{l.at}</td><td>{l.code}</td><td>{l.ok ? l.name : <span className="bad">not found</span>}</td></tr>)}</tbody></table>}</Card>
      {print && hit && <LabelPrinter items={[toItem(hit, 1)]} source="inventory" onClose={() => setPrint(false)} />}
    </div>
  );
}

// ---------------- printers ----------------
const MODELS: [string, Printer['language'], number][] = [
  ['Zebra ZD220 / ZD230 / ZD421', 'zpl', 203], ['Zebra GK420t / GX420t', 'zpl', 203], ['Zebra ZT230 / ZT410 (industrial)', 'zpl', 203],
  ['TSC TE200 / TE210 / TE244', 'tspl', 203], ['TSC DA210 / DA220', 'tspl', 203], ['Xprinter XP-365B / XP-360B', 'tspl', 203], ['Xprinter XP-420B / XP-470B / XP-DT426B', 'tspl', 203],
  ['Gprinter GP-1324D / GP-3120TU', 'tspl', 203], ['HPRT HT300 / SL42', 'tspl', 203], ['Rongta RP410 / RP420', 'tspl', 203],
  ['Epson TM-T20 / TM-T82 (receipt)', 'escpos', 203], ['Xprinter XP-58 / XP-80 (receipt)', 'escpos', 203],
  ['Brother QL-800 / QL-820NWB', 'driver', 300], ['Godex G500 / DT4x', 'driver', 203], ['DYMO LabelWriter', 'driver', 300], ['Other / not listed', 'driver', 203],
];
const LANG: Record<string, string> = { driver: 'Printer driver (browser print)', zpl: 'ZPL (Zebra)', tspl: 'TSPL (TSC, Xprinter, Gprinter…)', escpos: 'ESC/POS (receipt printers)' };
const CONN: Record<string, string> = { browser: 'Installed on this computer — print through browser', usb: 'USB — raw via print agent', network: 'Network / LAN (IP address) — via print agent', bluetooth: 'Bluetooth (paired in Windows/Mac) — via print agent' };

function testBadge(p: Printer) {
  if (p.last_test_ok === true) return <span className="badge ok" title={p.last_test_detail || ''}>Verified {p.last_test_method === 'user_confirmed' ? '(test label confirmed)' : '(agent reached it)'} · {dateTime(p.last_test_at)}</span>;
  if (p.last_test_ok === false) return <span className="badge bad" title={p.last_test_detail || ''}>Last test failed · {dateTime(p.last_test_at)}</span>;
  return <span className="badge warn">Not tested yet — not confirmed as connected</span>;
}

function Printers() {
  const { can } = useSession();
  const { data, reload } = useData<Printer[]>('/printers');
  const { data: templates } = useData<Template[]>('/label-templates');
  const [edit, setEdit] = useState<Partial<Printer> | null>(null);
  const [confirm, setConfirm] = useState<Printer | null>(null);
  const { busy, run } = useAction();
  const manage = can('barcodes', 'manage');
  const shop = useSession().me.settings.business.name;
  const tplOf = (p: Printer) => (templates || []).find((t) => t.id === p.template_id) || (templates || []).find((t) => Math.abs(t.widthMm - Number(p.label_width_mm)) < 0.5 && Math.abs(t.heightMm - Number(p.label_height_mm)) < 0.5) || BUILTIN_TEMPLATES[0];
  const test = (p: Printer) => run(async () => {
    if (p.language === 'driver' || p.connection === 'browser') { toast('Browser printing cannot be checked automatically — print a test label instead.'); return; }
    const r = await agentProbe(p);
    const detail = r.reachable ? `Reached ${p.connection === 'network' ? `${p.host}:${p.port || 9100}` : p.queue}${r.detected ? `; answered as ${r.detected.toUpperCase()}` : ''}${r.note ? ` (${r.note})` : ''}` : r.error || 'Not reachable';
    await api.post(`/printers/${p.id}/test-result`, { method: 'agent_probe', ok: r.reachable, detail });
    if (r.reachable) toast(detail); else toastError(detail + (r.printers ? ` — printers on this computer: ${r.printers.join(', ')}` : ''));
    if (r.reachable && p.language !== 'zpl' && r.detected === null && p.connection === 'network') toast('Connected. TSPL/ESC-POS printers do not identify themselves — print a test label to confirm the language.');
    reload();
  });
  const testPrint = (p: Printer) => run(async () => {
    const job = await api.post('/print-jobs', { printerId: p.id, source: 'test', templateId: tplOf(p).id, templateName: tplOf(p).name, items: [{ copies: 1, barcode: '2900000000018' }] });
    try {
      const r = await sendLabels(p, tplOf(p), [testLabel()], shop);
      await api.post(`/print-jobs/${job.id}/result`, r);
      if (r.status === 'sent') await api.post(`/printers/${p.id}/test-result`, { method: 'agent_print', ok: true, detail: r.detail });
      setConfirm(p);
    } catch (e: any) {
      await api.post(`/print-jobs/${job.id}/result`, { status: 'failed', detail: e.message });
      await api.post(`/printers/${p.id}/test-result`, { method: 'agent_print', ok: false, detail: e.message });
      reload(); throw e;
    }
  });
  return (
    <div className="col">
      <AgentPanel />
      <div className="row"><div className="grow muted small">The default printer is pre-selected when printing. A printer counts as connected only after a successful test.</div>{manage && <button className="btn primary" onClick={() => setEdit({ connection: 'browser', language: 'driver', dpi: 203, density: 8, speed: 4, orientation: 0, label_width_mm: 38, label_height_mm: 25, gap_mm: 2, cols: 1, col_gap_mm: 2, offset_x_mm: 0, offset_y_mm: 0, port: 9100 })}>+ Add printer</button>}</div>
      {!data ? <Loading /> : !data.length ? <Card><Empty>No barcode printer yet. Until you add one, labels print through the browser.</Empty></Card> : data.map((p) => (
        <Card key={p.id} title={<>{p.name} {p.is_default && <span className="badge gold">default</span>} {!p.active && <span className="badge">switched off</span>}</>} actions={<>
          {manage && p.language !== 'driver' && <button className="btn sm" disabled={busy} onClick={() => test(p)}>Test connection</button>}
          {can('barcodes', 'create') && <button className="btn sm" disabled={busy} onClick={() => testPrint(p)}>Print test label</button>}
          {manage && !p.is_default && p.active && <button className="btn sm" disabled={busy} onClick={() => run(() => api.post(`/printers/${p.id}/default`), 'Default printer set').then(reload)}>Make default</button>}
          {manage && <button className="btn sm ghost" onClick={() => setEdit(p)}>Edit</button>}
        </>}>
          <div className="row small" style={{ gap: 18 }}>
            <span>{p.model || 'Model not set'}</span><span>{CONN[p.connection]}</span><span>{LANG[p.language]}</span>
            {p.connection === 'network' && <span>{p.host}:{p.port}</span>}{p.queue && <span>Printer name: {p.queue}</span>}
            <span>{p.label_width_mm} × {p.label_height_mm} mm{p.cols > 1 ? `, ${p.cols} across` : ''} · {p.dpi} dpi{p.language !== 'driver' ? ` · density ${p.density} · speed ${p.speed}` : ''}{p.orientation === 180 ? ' · rotated 180°' : ''}</span>
            {p.branch && <span>{p.branch}</span>}
          </div>
          <div style={{ marginTop: 8 }}>{testBadge(p)}{p.last_test_detail && <div className="small muted">{p.last_test_detail}</div>}</div>
        </Card>
      ))}
      {edit && <PrinterForm p={edit} templates={templates || []} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      {confirm && <Modal title="Did the test label print correctly?" onClose={() => { setConfirm(null); reload(); }} footer={<>
        <button className="btn danger" onClick={() => run(() => api.post(`/printers/${confirm.id}/test-result`, { method: 'user_failed', detail: 'Test label did not print correctly' }), 'Recorded as failed — check the setup guide').then(() => { setConfirm(null); reload(); })}>No — blank, cut off or on A4</button>
        <button className="btn gold" onClick={() => run(() => api.post(`/printers/${confirm.id}/test-result`, { method: 'user_confirmed', ok: true, detail: 'Test label confirmed by user' }), 'Printer verified').then(() => { setConfirm(null); reload(); })}>Yes — one clean label</button>
      </>}>
        <p>Check the label that came out of <b>{confirm.name}</b>: one label only, nothing cut off, barcode sharp. Scan it with your barcode scanner — it should read <b>2900000000018</b>.</p>
        <p className="small muted">The app cannot see the printer itself, so only your answer (or the print agent reaching the printer) marks it as verified.</p>
      </Modal>}
    </div>
  );
}

function AgentPanel() {
  const [cfg, setCfg] = useState(agentConfig());
  const [st, setSt] = useState<{ ok: boolean; text: string; printers?: string[] } | null>(null);
  const check = async () => {
    saveAgentConfig(cfg);
    try {
      const h = await agent.hello();
      if (!cfg.token) return setSt({ ok: false, text: `Print agent ${h.version} found — enter the pairing code it shows.` });
      const s = await agent.status();
      setSt({ ok: true, text: `Paired with the print agent on ${s.hostname} (${s.platform}, v${s.version}).`, printers: Array.isArray(s.printers) ? s.printers.map((p) => p.share ? `${p.name} (share: ${p.share})` : p.name) : [`Could not list printers: ${(s.printers as any).error}`] });
    } catch (e: any) { setSt({ ok: false, text: e.message }); }
  };
  useEffect(() => { if (cfg.token) check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card title="Print agent on this computer" actions={<a className="btn sm ghost" href="#/barcodes/setup">How to install</a>}>
      <div className="small muted" style={{ marginBottom: 8 }}>Needed for ZPL / TSPL / ESC-POS printing (USB, network and Bluetooth printers). Not needed for “browser print” printers. These settings are saved on this computer only.</div>
      <div className="row">
        <Field label="Agent address"><input value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} style={{ width: 220 }} /></Field>
        <Field label="Pairing code"><input value={cfg.token} onChange={(e) => setCfg({ ...cfg, token: e.target.value.trim().toUpperCase() })} style={{ width: 140 }} autoComplete="off" /></Field>
        <button className="btn" style={{ marginTop: 18 }} onClick={check}>Pair / check</button>
      </div>
      {st && <div className={'alert ' + (st.ok ? 'ok' : 'bad')} style={{ marginTop: 10 }}>{st.text}{st.printers && <div className="small" style={{ marginTop: 4 }}>Printers on this computer: {st.printers.join(' · ') || 'none found'}</div>}</div>}
    </Card>
  );
}

function PrinterForm({ p, templates, onClose, onDone }: { p: Partial<Printer>; templates: Template[]; onClose: () => void; onDone: () => void }) {
  const { data: branches } = useData<any[]>('/branches');
  const [f, setF] = useState<any>({ ...p, templateId: p.template_id || '', branchId: p.branch_id || '', labelWidthMm: p.label_width_mm, labelHeightMm: p.label_height_mm, gapMm: p.gap_mm, colGapMm: p.col_gap_mm, offsetXMm: p.offset_x_mm, offsetYMm: p.offset_y_mm });
  const { busy, run } = useAction();
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const pickModel = (m: string) => { const hit = MODELS.find((x) => x[0] === m); set('model', m); if (hit) setF((x: any) => ({ ...x, model: m, language: hit[1], dpi: hit[2], connection: hit[1] === 'driver' ? 'browser' : x.connection === 'browser' ? 'usb' : x.connection })); };
  const num = (k: string, label: string, hint?: string) => <Field label={label} hint={hint}><input inputMode="decimal" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></Field>;
  const raw = f.language !== 'driver';
  return (
    <Modal wide title={p.id ? `Edit ${p.name}` : 'Add a barcode printer'} onClose={onClose} footer={<>
      {p.id && <button className="btn danger" disabled={busy} onClick={() => run(() => api.del(`/printers/${p.id}`), 'Removed').then((r) => r && onDone())}>Remove</button>}
      <button className="btn primary" disabled={busy} onClick={() => run(() => (p.id ? api.put(`/printers/${p.id}`, f) : api.post('/printers', f)), 'Printer saved — now test it').then((r) => r && onDone())}>Save</button>
    </>}>
      <div className="grid g3">
        <Field label="Name"><input value={f.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Counter label printer" /></Field>
        <Field label="Printer model"><select value={f.model || ''} onChange={(e) => pickModel(e.target.value)}><option value="">Choose…</option>{MODELS.map((m) => <option key={m[0]}>{m[0]}</option>)}</select></Field>
        <Field label="Branch"><select value={f.branchId} onChange={(e) => set('branchId', e.target.value)}><option value="">Any</option>{branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Connection"><select value={f.connection} onChange={(e) => setF((x: any) => ({ ...x, connection: e.target.value, language: e.target.value === 'browser' ? 'driver' : x.language === 'driver' ? 'tspl' : x.language }))}>{Object.entries(CONN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Printer language" hint="Set by the model; check the printer manual if unsure. Not every printer speaks every language."><select value={f.language} onChange={(e) => set('language', e.target.value)} disabled={f.connection === 'browser'}>{Object.entries(LANG).filter(([k]) => f.connection === 'browser' ? k === 'driver' : true).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Resolution"><select value={f.dpi} onChange={(e) => set('dpi', Number(e.target.value))}><option value={203}>203 dpi (8 dots/mm)</option><option value={300}>300 dpi (12 dots/mm)</option><option value={600}>600 dpi</option></select></Field>
        {f.connection === 'network' && <>{num('host', 'IP address', 'Printed on the printer’s network self-test page')}{num('port', 'Port', 'Raw printing port, usually 9100')}</>}
        {raw && ['usb', 'bluetooth'].includes(f.connection) && <Field label="Printer name on this computer" hint="Windows: the printer’s share name. Mac/Linux: the CUPS queue name. Use “Pair / check” to list them."><input value={f.queue || ''} onChange={(e) => set('queue', e.target.value)} /></Field>}
        {num('labelWidthMm', 'Label width (mm)')}{num('labelHeightMm', 'Label height (mm)')}{num('gapMm', 'Gap between labels (mm)')}
        <Field label="Labels across the roll"><select value={f.cols} onChange={(e) => set('cols', Number(e.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></Field>
        {f.cols > 1 && num('colGapMm', 'Gap between columns (mm)')}
        {raw && <><Field label={`Print density (darkness): ${f.density}`}><input type="range" min={0} max={15} value={f.density} onChange={(e) => set('density', Number(e.target.value))} /></Field>
          <Field label={`Print speed: ${f.speed}`}><input type="range" min={1} max={f.language === 'zpl' ? 14 : 6} value={f.speed} onChange={(e) => set('speed', Number(e.target.value))} /></Field></>}
        <Field label="Orientation"><select value={f.orientation} onChange={(e) => set('orientation', Number(e.target.value))}><option value={0}>Normal</option><option value={180}>Rotated 180°</option></select></Field>
        {num('offsetXMm', 'Margin left / move right (mm)')}{num('offsetYMm', 'Margin top / move down (mm)')}
        <Field label="Default label template"><select value={f.templateId} onChange={(e) => set('templateId', e.target.value)}><option value="">Match the label size</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        {p.id && <label className="check" style={{ marginTop: 18 }}><input type="checkbox" checked={f.active !== false} onChange={(e) => set('active', e.target.checked)} /> Active</label>}
      </div>
    </Modal>
  );
}

// ---------------- label designer ----------------
function Designer() {
  const { can, me } = useSession();
  const { data: templates, reload } = useData<Template[]>('/label-templates');
  const { data: stock } = useData<any[]>('/inventory');
  const [sel, setSel] = useState<string>('tpl_small');
  const [t, setT] = useState<Template | null>(null);
  const [sample, setSample] = useState<string>('');
  const [html, setHtml] = useState('');
  const { busy, run } = useAction();
  const manage = can('barcodes', 'manage');
  useEffect(() => { const x = templates?.find((y) => y.id === sel); if (x) setT(structuredClone(x)); }, [sel, templates]);
  const item = useMemo(() => { const v = (stock || []).find((x) => x.id === sample) || stock?.[0]; return v ? { ...toItem(v), batch_no: 'B2611', original_price: v.original_price || Math.round(v.retail_price * 1.15) } : testLabel(); }, [stock, sample]);
  useEffect(() => { if (t) labelHtml(t, [item, item], me.settings.business.name, { cols: 1, colGapMm: 0, offsetXMm: 0, offsetYMm: 0 }, true).then(setHtml); }, [t, item, me.settings.business.name]);
  if (!templates || !t) return <Loading />;
  const setField = (i: number, patch: Partial<TField>) => setT({ ...t, fields: t.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const move = (i: number, d: number) => { const f = [...t.fields]; const j = i + d; if (j < 0 || j >= f.length) return; [f[i], f[j]] = [f[j], f[i]]; setT({ ...t, fields: f }); };
  const ro = !manage || !!t.builtin;
  const save = (copy: boolean) => run(async () => {
    const body = { ...t, name: copy ? `${t.name} (copy)` : t.name };
    if (copy || t.builtin) { const r = await api.post('/label-templates', body); await reload(); setSel(r.id); return r; }
    return api.put(`/label-templates/${t.id}`, body).then(reload);
  }, 'Template saved');
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))', alignItems: 'start' }}>
      <Card title="Templates">
        {templates.map((x) => <button key={x.id} className={'btn ' + (x.id === sel ? 'primary' : 'ghost')} style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 4 }} onClick={() => setSel(x.id)}>{x.name}{x.builtin ? ' · built-in' : ''}</button>)}
        <div className="small muted" style={{ marginTop: 8 }}>Built-in templates (small, medium, large) can be copied and changed.</div>
      </Card>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', alignItems: 'start', minWidth: 0 }}>
        <Card title={ro ? `${t.name} (read-only${t.builtin ? ' — save a copy to change it' : ''})` : 'Edit template'} actions={manage && <>{!t.builtin && <button className="btn sm danger" disabled={busy} onClick={() => run(() => api.del(`/label-templates/${t.id}`), 'Deleted').then(() => { setSel('tpl_small'); reload(); })}>Delete</button>}<button className="btn sm" disabled={busy} onClick={() => save(true)}>Save as copy</button>{!t.builtin && <button className="btn sm primary" disabled={busy} onClick={() => save(false)}>Save</button>}</>}>
          <fieldset disabled={ro && !manage} style={{ border: 0, padding: 0, margin: 0 }} className="col">
            <Field label="Name"><input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></Field>
            <div className="grid g3" style={{ gap: 8 }}>
              <Field label="Width (mm)"><input inputMode="decimal" value={t.widthMm} onChange={(e) => setT({ ...t, widthMm: Number(e.target.value) || 0 })} /></Field>
              <Field label="Height (mm)"><input inputMode="decimal" value={t.heightMm} onChange={(e) => setT({ ...t, heightMm: Number(e.target.value) || 0 })} /></Field>
              <Field label="Margin (mm)"><input inputMode="decimal" value={t.marginMm} onChange={(e) => setT({ ...t, marginMm: Number(e.target.value) || 0 })} /></Field>
              <Field label="Barcode type"><select value={t.symbology} onChange={(e) => setT({ ...t, symbology: e.target.value })}><option value="auto">Automatic (product’s own)</option>{Object.entries(SYMBOLOGIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Barcode height (mm)"><input inputMode="decimal" value={t.barcodeHeightMm} onChange={(e) => setT({ ...t, barcodeHeightMm: Number(e.target.value) || 0 })} /></Field>
              <Field label="Bar thickness"><select value={t.module} onChange={(e) => setT({ ...t, module: Number(e.target.value) })}><option value={1}>1 — thin</option><option value={2}>2 — normal</option><option value={3}>3 — thick</option><option value={4}>4 — extra</option></select></Field>
            </div>
            <div className="tablewrap"><table className="t"><thead><tr><th>Field</th><th>Show</th><th>Size (pt)</th><th>Align</th><th>Bold</th><th /></tr></thead>
              <tbody>{t.fields.map((x, i) => <tr key={x.key}><td>{FIELDS[x.key]}</td><td><input type="checkbox" checked={x.on} onChange={(e) => setField(i, { on: e.target.checked })} aria-label={`Show ${FIELDS[x.key]}`} /></td>
                <td>{['barcode', 'qr'].includes(x.key) ? <span className="muted small">—</span> : <input inputMode="decimal" value={x.size} onChange={(e) => setField(i, { size: Number(e.target.value) || 0 })} style={{ width: 60 }} aria-label="Font size" />}</td>
                <td>{['barcode', 'qr', 'logo'].includes(x.key) ? null : <select value={x.align} onChange={(e) => setField(i, { align: e.target.value as 'center' })} style={{ width: 90 }} aria-label="Alignment"><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select>}</td>
                <td>{['barcode', 'qr', 'logo'].includes(x.key) ? null : <input type="checkbox" checked={x.bold} onChange={(e) => setField(i, { bold: e.target.checked })} aria-label="Bold" />}</td>
                <td style={{ whiteSpace: 'nowrap' }}><button type="button" className="btn ghost sm" onClick={() => move(i, -1)} aria-label="Move up">↑</button><button type="button" className="btn ghost sm" onClick={() => move(i, 1)} aria-label="Move down">↓</button></td></tr>)}</tbody></table></div>
            {t.fields.find((x) => x.key === 'qr')?.on && <div className="row"><Field label="QR code contains"><select value={t.qrData} onChange={(e) => setT({ ...t, qrData: e.target.value as 'barcode' })}><option value="barcode">The barcode number</option><option value="sku">The SKU</option><option value="text">Fixed text / link</option></select></Field>{t.qrData === 'text' && <Field label="Text or link"><input value={t.qrText} onChange={(e) => setT({ ...t, qrText: e.target.value })} placeholder="https://belleameoman.com" /></Field>}</div>}
          </fieldset>
        </Card>
        <Card title="Preview">
          <Field label="Sample product"><select value={sample} onChange={(e) => setSample(e.target.value)}>{(stock || []).map((v) => <option key={v.id} value={v.id}>{variantName(v)}</option>)}</select></Field>
          <iframe title="Template preview" srcDoc={html} style={{ width: '100%', height: 260, border: '1px solid var(--line)', borderRadius: 14, marginTop: 10, background: '#efe8dc' }} />
          <div className="small muted">Fonts and the barcode shrink automatically if the chosen fields do not fit. The logo prints only through browser/driver printers.</div>
        </Card>
      </div>
    </div>
  );
}

// ---------------- printing history ----------------
function History() {
  const { can } = useSession();
  const [f, setF] = useState({ from: monthStart(), to: today(), search: '' });
  const { data, reload } = useData<any[]>('/print-jobs' + qs(f), [JSON.stringify(f)]);
  const [re, setRe] = useState<{ job: any; reason: string; items: LabelItem[] } | null>(null);
  const [ask, setAsk] = useState<any>(null);
  const [reason, setReason] = useState('');
  const startReprint = async (job: any) => {
    const ids = job.lines.map((l: any) => l.variant_id).filter(Boolean);
    const rows = ids.length ? await api.post<any[]>('/labels/data', { variantIds: ids }) : [];
    const items = job.lines.filter((l: any) => l.variant_id).map((l: any) => { const v = rows.find((r) => r.id === l.variant_id); return v ? { ...toItem(v, l.copies), batch_no: l.batch_no } : null; }).filter(Boolean);
    if (!items.length) return toastError('Nothing to reprint (test labels only).');
    setRe({ job, reason, items }); setAsk(null);
  };
  const st: Record<string, [string, string]> = { sent: ['ok', 'sent to printer'], dialog_opened: ['info', 'print window opened'], failed: ['bad', 'failed'], pending: ['warn', 'not finished'] };
  return (
    <>
      <div className="card row" style={{ marginBottom: 10 }}>
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={{ width: 'auto' }} /><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={{ width: 'auto' }} />
        <input placeholder="Product, SKU or barcode" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} style={{ width: 240 }} />
        <div className="grow" /><b>{(data || []).reduce((a, j) => a + j.labels, 0)} labels</b>
      </div>
      <div className="card tablewrap">{!data ? <Loading /> : !data.length ? <Empty>No labels printed in this period</Empty> : (
        <table className="t"><thead><tr><th>Job</th><th>When</th><th>Who</th><th>Printer</th><th>Products</th><th className="num">Labels</th><th>Result</th><th /></tr></thead>
          <tbody>{data.map((j) => <tr key={j.id}>
            <td>{j.number}<div className="small muted">{j.source}{j.reprint_of ? ' · reprint' : ''}{j.reprints ? ` · reprinted ${j.reprints}×` : ''}</div>{j.reason && <div className="small muted">“{j.reason}”</div>}</td>
            <td className="small">{dateTime(j.created_at)}</td><td>{j.user_name}</td><td className="small">{j.printer_name}<div className="muted">{j.template_name}</div></td>
            <td className="small">{(j.lines || []).map((l: any) => <div key={l.sku + l.barcode}>{l.copies} × {l.product_name} <span className="muted">{l.sku} · {l.barcode}{l.batch_no ? ` · ${l.batch_no}` : ''}</span></div>)}</td>
            <td className="num">{j.labels}</td>
            <td><span className={'badge ' + (st[j.status]?.[0] || '')} title={j.detail || ''}>{st[j.status]?.[1] || j.status}</span></td>
            <td>{can('barcodes', 'approve') && j.source !== 'test' && <button className="btn sm" onClick={() => { setReason(''); setAsk(j); }}>Reprint</button>}</td>
          </tr>)}</tbody></table>
      )}</div>
      {!can('barcodes', 'approve') && <div className="small muted" style={{ marginTop: 8 }}>Reprinting from history needs authorisation (Barcodes → approve).</div>}
      {ask && <Modal title={`Reprint ${ask.number}`} onClose={() => setAsk(null)} footer={<button className="btn primary" disabled={!reason.trim()} onClick={() => startReprint(ask)}>Continue</button>}>
        <Field label="Reason for reprinting (recorded)"><input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. labels jammed, wrong roll" /></Field>
      </Modal>}
      {re && <LabelPrinter items={re.items} source="reprint" reprintOf={re.job.id} reason={re.reason} onClose={() => { setRe(null); reload(); }} />}
    </>
  );
}

// ---------------- setup guide ----------------
function Setup() {
  const [show, setShow] = useState<string | null>(null);
  return (
    <div className="grid g2">
      <Card title="1. Choose how the printer is connected">
        <table className="t"><tbody>
          <tr><td><b>Browser print</b> (any printer with its Windows/Mac driver)</td><td className="small">Easiest. Install the printer’s driver, add the printer here as “Installed on this computer”, set the paper size in the driver to the label size. A print window opens each time. Supports Arabic text and the logo.</td></tr>
          <tr><td><b>USB / Bluetooth — raw</b></td><td className="small">Fastest, no print window. Needs the print agent on the shop computer and a printer language (ZPL/TSPL/ESC-POS). Pair Bluetooth printers in Windows/Mac first; they then appear as a printer on the computer.</td></tr>
          <tr><td><b>Network / LAN</b></td><td className="small">Printer with an Ethernet/Wi-Fi port and an IP address (print its self-test page to see it). Needs the print agent; uses port 9100.</td></tr>
        </tbody></table>
      </Card>
      <Card title="2. Install the print agent (once per computer)" actions={<button className="btn sm" onClick={() => setShow(show ? null : 'agent')}>{show ? 'Hide' : 'Show steps'}</button>}>
        <ol className="small" style={{ paddingInlineStart: 18, margin: 0 }}>
          <li>Install <b>Node.js</b> (LTS) from nodejs.org on the shop computer.</li>
          <li>Ask your administrator for the file <code>agent/print-agent.js</code> from the app’s code and save it in a folder, e.g. <code>C:\BelleAme</code>.</li>
          <li>Open Command Prompt in that folder and run: <code>node print-agent.js</code></li>
          <li>It shows a <b>pairing code</b>. Enter it in <a href="#/barcodes/printers">Printers → Print agent on this computer</a> and click “Pair / check”.</li>
          <li>Chrome / Edge may ask to allow this site to access <b>devices on your local network</b> — click Allow.</li>
          <li>Windows + USB/Bluetooth: open the printer’s properties → Sharing → share it with a short name (e.g. <code>LABEL</code>) and use that name in the printer settings.</li>
          <li>Optional: start it automatically — put a shortcut to <code>node print-agent.js</code> in the Windows Startup folder.</li>
        </ol>
        {show && <div className="alert info small" style={{ marginTop: 10 }}>The agent only listens on this computer (127.0.0.1), only accepts this app’s web address, and every request needs the pairing code. It never stores label data.</div>}
      </Card>
      <Card title="3. Printer languages by model">
        <table className="t"><tbody>{MODELS.map(([m, l]) => <tr key={m}><td>{m}</td><td>{LANG[l]}</td></tr>)}</tbody></table>
        <div className="small muted" style={{ marginTop: 6 }}>Not sure? Use “Browser print” — it works with every printer that has a driver. For raw printing, “Test connection” proves the agent reached the printer (Zebra printers also identify as ZPL); “Print test label” proves the language and size are right.</div>
      </Card>
      <Card title="4. If labels come out wrong">
        <ul className="small" style={{ paddingInlineStart: 18, margin: 0 }}>
          <li><b>Full A4 page / long blank feed:</b> set the label size in the driver (Printing preferences → Paper/Stock), media type “Labels with gaps”, and run the printer’s calibration (hold FEED until 2–3 labels come out).</li>
          <li><b>Shifted print:</b> adjust “move right / move down” in the printer settings 1 mm at a time.</li>
          <li><b>Too light or smudged:</b> raise or lower the density, lower the speed.</li>
          <li><b>Raw printing prints garbage text:</b> the printer does not speak that language — change the language or use Browser print.</li>
          <li><b>Scanner does not read it:</b> make the barcode taller or the bars thicker in the label designer, and keep a blank margin at both ends.</li>
        </ul>
      </Card>
    </div>
  );
}
