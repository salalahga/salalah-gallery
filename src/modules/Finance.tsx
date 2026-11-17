import { Fragment, useMemo, useState } from 'react';
import { Plus, Trash2, Scale, TrendingUp, Landmark, BookOpen } from 'lucide-react';
import { store, useDB, today, nextNumber } from '../core/store';
import type { Journal, JournalLine } from '../core/types';
import { money, fmtDate } from '../core/calc';
import { chart, postings, trialBalance, profitLoss, balanceSheet, cashFlow } from '../core/gl';
import { useRole, useUser } from '../core/session';
import { PageHeader, Tabs, Stat, Empty, Modal, Field, Badge, toast, confirmDelete } from '../components/ui';
import { ExportButtons } from '../components/Export';

type Tab = 'pl' | 'bs' | 'cf' | 'tb' | 'gl' | 'je';
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function periods() {
  const n = new Date(); const y = n.getFullYear(); const m = n.getMonth(); const q = Math.floor(m / 3);
  return [
    { id: 'tm', label: 'This month', from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) },
    { id: 'lm', label: 'Last month', from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) },
    { id: 'tq', label: 'This quarter', from: ymd(new Date(y, q * 3, 1)), to: ymd(new Date(y, q * 3 + 3, 0)) },
    { id: 'ty', label: 'This year', from: `${y}-01-01`, to: `${y}-12-31` },
    { id: 'ly', label: 'Last year', from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ];
}
/** The same-length period just before (for comparison). */
export function previous(from: string, to: string) {
  const a = new Date(from + 'T00:00:00'); const b = new Date(to + 'T00:00:00');
  const sameMonths = a.getDate() === 1 && new Date(b.getFullYear(), b.getMonth() + 1, 0).getDate() === b.getDate();
  if (sameMonths) { const months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1; return { from: ymd(new Date(a.getFullYear(), a.getMonth() - months, 1)), to: ymd(new Date(a.getFullYear(), a.getMonth(), 0)) }; }
  const days = Math.round((b.getTime() - a.getTime()) / 864e5) + 1; const pb = new Date(a.getTime() - 864e5); const pa = new Date(pb.getTime() - (days - 1) * 864e5);
  return { from: ymd(pa), to: ymd(pb) };
}
const pct = (a: number, b: number) => (b ? `${a >= b ? '▲' : '▼'} ${Math.abs(Math.round(((a - b) / Math.abs(b)) * 100))}%` : '');

export default function Finance() {
  const db = useDB(); const s = db.settings; const role = useRole(); const user = useUser();
  const [tab, setTab] = useState<Tab>('pl');
  const P = periods(); const [pid, setPid] = useState('tm'); const [from, setFrom] = useState(P[0].from); const [to, setTo] = useState(P[0].to);
  const pick = (id: string) => { const p = P.find((x) => x.id === id); setPid(id); if (p) { setFrom(p.from); setTo(p.to); } };
  const prev = previous(from, to);
  const pl = useMemo(() => profitLoss(db, from, to), [db, from, to]);
  const plPrev = useMemo(() => profitLoss(db, prev.from, prev.to), [db, prev.from, prev.to]);
  const bs = useMemo(() => balanceSheet(db, to), [db, to]);
  const cf = useMemo(() => cashFlow(db, from, to), [db, from, to]);
  const tb = useMemo(() => trialBalance(db, to), [db, to]);
  const accounts = chart(s);
  const [acc, setAcc] = useState('Cash');
  const gl = useMemo(() => postings(db).filter((p) => p.account === acc && p.date <= to), [db, acc, to]);
  const [je, setJe] = useState<Partial<Journal> | null>(null);
  const owner = role === 'admin';

  const saveJe = () => {
    if (!je) return;
    const lines = (je.lines || []).filter((l) => l.account && (Number(l.debit) || Number(l.credit)));
    const d = lines.reduce((n, l) => n + (Number(l.debit) || 0), 0); const c = lines.reduce((n, l) => n + (Number(l.credit) || 0), 0);
    if (lines.length < 2) return toast('A journal needs at least two lines');
    if (Math.abs(d - c) > 0.0005) return toast(`Debits ${d.toFixed(3)} and credits ${c.toFixed(3)} must be equal`);
    if (!je.memo?.trim()) return toast('Write what the journal is for');
    store.upsert('journals', { ...je, lines, by: je.by || user?.name } as Journal); setJe(null); toast('Journal posted');
  };
  const setLine = (i: number, p: Partial<JournalLine>) => je && setJe({ ...je, lines: je.lines!.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  const Row = ({ label, a, b, bold }: { label: string; a: number; b?: number; bold?: boolean }) => <tr className={bold ? 'total-row' : ''}><td>{label}</td><td className="num">{money(a, s)}</td>{b !== undefined && <td className="num muted">{money(b, s)}</td>}{b !== undefined && <td className="num muted" style={{ fontSize: 11 }}>{pct(a, b)}</td>}</tr>;
  const plRows: (string | number)[][] = [
    ...Object.entries(pl.inc).map(([k, v]) => ['Income', k, +v.toFixed(3)]), ['Total income', '', +pl.income.toFixed(3)],
    ...Object.entries(pl.direct).map(([k, v]) => ['Direct cost', k, +v.toFixed(3)]), ['Gross profit', '', +pl.gross.toFixed(3)],
    ...Object.entries(pl.ovh).map(([k, v]) => ['Overhead', k, +v.toFixed(3)]), ['Net profit', '', +pl.net.toFixed(3)]];

  return (
    <>
      <PageHeader title="Finance" sub="Profit & loss, balance sheet, cash flow, trial balance, general ledger and journal entries — built from every entry in the books." />
      <div className="toolbar chips">{P.map((p) => <button key={p.id} className={`chip ${pid === p.id ? 'on' : ''}`} onClick={() => pick(p.id)}>{p.label}</button>)}
        <input type="date" style={{ width: 'auto' }} value={from} onChange={(e) => { setPid(''); setFrom(e.target.value); }} /> → <input type="date" style={{ width: 'auto' }} value={to} onChange={(e) => { setPid(''); setTo(e.target.value); }} /></div>
      <div className="grid g4 mb">
        <Stat label="Income" value={money(pl.income, s)} icon={<TrendingUp size={20} />} tone="green" sub={pct(pl.income, plPrev.income) && `${pct(pl.income, plPrev.income)} vs previous`} />
        <Stat label={pl.net >= 0 ? 'Net profit' : 'Net loss'} value={<span className={pl.net >= 0 ? 'pos' : 'neg'}>{money(pl.net, s)}</span>} icon={<Scale size={20} />} tone="wood" sub={pl.income ? `${Math.round((pl.net / pl.income) * 100)}% margin` : undefined} />
        <Stat label="Cash + bank (end)" value={money(cf.closing, s)} icon={<Landmark size={20} />} tone="blue" sub={`${cf.net >= 0 ? '+' : ''}${money(cf.net, s)} in period`} />
        <Stat label="Trial balance" value={Math.abs(tb.debit - tb.credit) < 0.01 ? 'Balanced' : 'Out by ' + money(tb.debit - tb.credit, s)} icon={<BookOpen size={20} />} tone={Math.abs(tb.debit - tb.credit) < 0.01 ? 'green' : 'red'} />
      </div>
      <div className="toolbar"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'pl', label: 'Profit & loss' }, { id: 'bs', label: 'Balance sheet' }, { id: 'cf', label: 'Cash flow' }, { id: 'tb', label: 'Trial balance' }, { id: 'gl', label: 'General ledger' }, { id: 'je', label: 'Journal entries', count: db.journals.length }]} /></div>

      {tab === 'pl' && <div className="card">
        <div className="flex between"><h3>Profit & loss · {fmtDate(from)} – {fmtDate(to)}</h3><ExportButtons name="profit-and-loss" title="Profit & loss" sub={`${from} to ${to}`} head={['Section', 'Account', s.currency]} rows={plRows} /></div>
        <div className="table-wrap"><table className="pl-table"><thead><tr><th /><th className="num">This period</th><th className="num">Previous</th><th /></tr></thead><tbody>
          <tr className="section"><td colSpan={4}><b>Income</b></td></tr>
          {Object.entries(pl.inc).map(([k, v]) => <Row key={k} label={k} a={v} b={plPrev.inc[k] || 0} />)}
          <Row label="Total income" a={pl.income} b={plPrev.income} bold />
          <tr className="section"><td colSpan={4}><b>Direct project costs</b></td></tr>
          {Object.entries(pl.direct).map(([k, v]) => <Row key={k} label={k} a={v} b={plPrev.direct[k] || 0} />)}
          <Row label="Gross profit" a={pl.gross} b={plPrev.gross} bold />
          <tr className="section"><td colSpan={4}><b>Overheads</b></td></tr>
          {Object.entries(pl.ovh).map(([k, v]) => <Row key={k} label={k} a={v} b={plPrev.ovh[k] || 0} />)}
          <Row label="Net profit" a={pl.net} b={plPrev.net} bold />
        </tbody></table></div>
        <p className="muted" style={{ fontSize: 12 }}>Cash basis: income when money is received, costs when paid. Previous = {fmtDate(prev.from)} – {fmtDate(prev.to)}.</p>
      </div>}

      {tab === 'bs' && <div className="card">
        <div className="flex between"><h3>Balance sheet as of {fmtDate(to)}</h3><ExportButtons name="balance-sheet" title="Balance sheet" sub={`as of ${to}`} head={['Section', 'Account', s.currency]} rows={[...bs.assets.map((a) => ['Assets', a.name, +a.amount.toFixed(3)]), ['Total assets', '', +bs.totalAssets.toFixed(3)], ...bs.liabilities.map((a) => ['Liabilities', a.name, +a.amount.toFixed(3)]), ...bs.equity.map((a) => ['Equity', a.name, +a.amount.toFixed(3)]), ['Total liabilities + equity', '', +(bs.totalLiabilities + bs.totalEquity).toFixed(3)]]} /></div>
        <div className="grid g2">
          <table className="pl-table"><tbody><tr className="section"><td colSpan={2}><b>Assets</b></td></tr>{bs.assets.map((a) => <tr key={a.name}><td>{a.name}</td><td className="num">{money(a.amount, s)}</td></tr>)}<tr className="total-row"><td>Total assets</td><td className="num">{money(bs.totalAssets, s)}</td></tr></tbody></table>
          <table className="pl-table"><tbody><tr className="section"><td colSpan={2}><b>Liabilities</b></td></tr>{bs.liabilities.map((a) => <tr key={a.name}><td>{a.name}</td><td className="num">{money(a.amount, s)}</td></tr>)}
            <tr className="section"><td colSpan={2}><b>Equity</b></td></tr>{bs.equity.map((a) => <tr key={a.name}><td>{a.name}</td><td className="num">{money(a.amount, s)}</td></tr>)}
            <tr className="total-row"><td>Total liabilities + equity</td><td className="num">{money(bs.totalLiabilities + bs.totalEquity, s)}</td></tr></tbody></table>
        </div>
        {!bs.balanced && <div className="alert error" style={{ marginTop: 10 }}>The balance sheet does not balance — check the journal entries.</div>}
      </div>}

      {tab === 'cf' && <div className="card">
        <div className="flex between"><h3>Cash flow · {fmtDate(from)} – {fmtDate(to)}</h3><ExportButtons name="cash-flow" title="Cash flow statement" sub={`${from} to ${to}`} head={['Activity', 'Account', s.currency]} rows={[['Opening cash + bank', '', +cf.opening.toFixed(3)], ...Object.entries(cf.operating).map(([k, v]) => ['Operating', k, +v.toFixed(3)]), ...Object.entries(cf.investing).map(([k, v]) => ['Investing', k, +v.toFixed(3)]), ...Object.entries(cf.financing).map(([k, v]) => ['Financing', k, +v.toFixed(3)]), ['Closing cash + bank', '', +cf.closing.toFixed(3)]]} /></div>
        <table className="pl-table" style={{ width: '100%' }}><tbody>
          <tr className="total-row"><td>Opening cash + bank</td><td className="num">{money(cf.opening, s)}</td></tr>
          {([['Operating activities', cf.operating, cf.op], ['Investing activities', cf.investing, cf.inv], ['Financing activities', cf.financing, cf.fin]] as const).map(([label, m, t]) => <Fragment key={label}>
            <tr key={label} className="section"><td colSpan={2}><b>{label}</b></td></tr>
            {Object.entries(m).sort((a, b) => a[1] - b[1]).map(([k, v]) => <tr key={label + k}><td>{k}</td><td className={`num ${v < 0 ? 'neg' : 'pos'}`}>{money(v, s)}</td></tr>)}
            <tr key={label + 't'}><td><i>Net {label.toLowerCase()}</i></td><td className="num"><b>{money(t, s)}</b></td></tr></Fragment>)}
          <tr className="total-row"><td>Closing cash + bank</td><td className="num">{money(cf.closing, s)}</td></tr>
        </tbody></table>
      </div>}

      {tab === 'tb' && <div className="card">
        <div className="flex between"><h3>Trial balance as of {fmtDate(to)}</h3><ExportButtons name="trial-balance" title="Trial balance" sub={`as of ${to}`} head={['Account', 'Type', 'Debit', 'Credit']} rows={tb.rows.map((r) => [r.account, r.type, r.balance > 0 ? +r.balance.toFixed(3) : '', r.balance < 0 ? +(-r.balance).toFixed(3) : ''])} /></div>
        <div className="table-wrap"><table><thead><tr><th>Account</th><th>Type</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{tb.rows.map((r) => <tr key={r.account} className="click" onClick={() => { setAcc(r.account); setTab('gl'); }}><td>{r.account}</td><td><Badge>{r.type}</Badge></td><td className="num">{r.balance > 0.0005 ? money(r.balance, s) : ''}</td><td className="num">{r.balance < -0.0005 ? money(-r.balance, s) : ''}</td></tr>)}
            <tr className="total-row"><td>Total</td><td /><td className="num">{money(tb.debit, s)}</td><td className="num">{money(tb.credit, s)}</td></tr></tbody></table></div>
      </div>}

      {tab === 'gl' && <div className="card">
        <div className="flex between wrap"><div className="flex"><h3 style={{ margin: 0 }}>General ledger</h3><select style={{ width: 'auto' }} value={acc} onChange={(e) => setAcc(e.target.value)}>{[...new Set([...accounts.map((a) => a.name), ...tb.rows.map((r) => r.account)])].map((a) => <option key={a}>{a}</option>)}</select></div>
          <ExportButtons name={`ledger-${acc}`} title={`General ledger — ${acc}`} head={['Date', 'Ref', 'Details', 'Debit', 'Credit']} rows={gl.map((p) => [p.date, p.ref, p.text, p.debit || '', p.credit || ''])} /></div>
        {gl.length ? <div className="table-wrap"><table className="statement"><thead><tr><th>Date</th><th>Ref</th><th>Details</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
          <tbody>{(() => { let run = 0; return gl.map((p, i) => { run += p.debit - p.credit; return <tr key={i}><td>{fmtDate(p.date)}</td><td>{p.ref}</td><td>{p.text}{p.src === 'journal' && <> <Badge>journal</Badge></>}</td><td className="num">{p.debit ? money(p.debit, s) : ''}</td><td className="num">{p.credit ? money(p.credit, s) : ''}</td><td className="num"><b>{money(run, s)}</b></td></tr>; }); })()}</tbody></table></div>
          : <Empty title={`No entries on ${acc}`} />}
      </div>}

      {tab === 'je' && <div className="card">
        <div className="flex between"><h3>Journal entries</h3>{owner && <button className="btn primary sm" onClick={() => setJe({ number: nextNumber('JV', db.journals.map((j) => j.number)), date: today(), memo: '', lines: [{ account: '', debit: 0, credit: 0 }, { account: '', debit: 0, credit: 0 }] })}><Plus size={14} />New journal</button>}</div>
        <p className="muted" style={{ fontSize: 12 }}>For opening balances, owner capital, loans, fixed assets, depreciation and corrections. Day-to-day income and expenses go in Accounts. Only the owner can post journals.</p>
        {db.journals.length ? <div className="table-wrap"><table><thead><tr><th>No.</th><th>Date</th><th>Memo</th><th>Lines</th><th className="num">Amount</th></tr></thead>
          <tbody>{[...db.journals].sort((a, b) => b.date.localeCompare(a.date)).map((j) => <tr key={j.id} className={owner ? 'click' : ''} onClick={() => owner && setJe(structuredClone(j))}><td><b>{j.number}</b></td><td>{fmtDate(j.date)}</td><td>{j.memo}<div className="muted">{j.by}</div></td>
            <td className="muted" style={{ fontSize: 12 }}>{j.lines.map((l) => `${l.debit ? 'Dr' : 'Cr'} ${l.account}`).join(' · ')}</td><td className="num">{money(j.lines.reduce((n, l) => n + (Number(l.debit) || 0), 0), s)}</td></tr>)}</tbody></table></div>
          : <Empty title="No journal entries" />}
      </div>}

      {je && <Modal open wide title={db.journals.some((j) => j.id === je.id) ? `Journal ${je.number}` : 'New journal entry'} onClose={() => setJe(null)} footer={<>
        {je.id && <button className="btn danger ghost" onClick={() => { if (confirmDelete(je.number)) { store.remove('journals', je.id!); setJe(null); } }}><Trash2 size={15} />Delete</button>}
        <span className="spacer" /><button className="btn" onClick={() => setJe(null)}>Cancel</button><button className="btn primary" onClick={saveJe}>Post journal</button></>}>
        <div className="form two">
          <Field label="Number"><input value={je.number || ''} onChange={(e) => setJe({ ...je, number: e.target.value })} /></Field>
          <Field label="Date"><input type="date" value={je.date} onChange={(e) => setJe({ ...je, date: e.target.value })} /></Field>
          <Field label="Memo" span={3}><input value={je.memo || ''} onChange={(e) => setJe({ ...je, memo: e.target.value })} placeholder="Owner invested capital / Depreciation Nov…" /></Field>
        </div>
        <datalist id="acc-list">{accounts.map((a) => <option key={a.name} value={a.name}>{a.type}</option>)}</datalist>
        <div className="table-wrap"><table className="lines"><thead><tr><th>Account</th><th style={{ width: 120 }}>Debit</th><th style={{ width: 120 }}>Credit</th><th>Project</th><th /></tr></thead>
          <tbody>{(je.lines || []).map((l, i) => <tr key={i}>
            <td><input list="acc-list" value={l.account} onChange={(e) => setLine(i, { account: e.target.value })} /></td>
            <td><input type="number" value={l.debit || ''} onChange={(e) => setLine(i, { debit: +e.target.value, credit: 0 })} /></td>
            <td><input type="number" value={l.credit || ''} onChange={(e) => setLine(i, { credit: +e.target.value, debit: 0 })} /></td>
            <td><select value={l.jobId || ''} onChange={(e) => setLine(i, { jobId: e.target.value || undefined })}><option value="">—</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code}</option>)}</select></td>
            <td><button className="icon-btn" onClick={() => setJe({ ...je, lines: je.lines!.filter((_, k) => k !== i) })}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>
        <div className="flex between" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => setJe({ ...je, lines: [...(je.lines || []), { account: '', debit: 0, credit: 0 }] })}><Plus size={14} />Add line</button>
          {(() => { const d = (je.lines || []).reduce((n, l) => n + (Number(l.debit) || 0), 0); const c = (je.lines || []).reduce((n, l) => n + (Number(l.credit) || 0), 0); return <b className={Math.abs(d - c) > 0.0005 ? 'neg' : 'pos'}>Dr {money(d, s)} · Cr {money(c, s)}</b>; })()}</div>
      </Modal>}
    </>
  );
}
