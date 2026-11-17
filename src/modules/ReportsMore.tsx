import { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, ShoppingCart, Truck, Scale, Hammer } from 'lucide-react';
import { useDB } from '../core/store';
import type { DB } from '../core/types';
import { docTotals, fmtDate, money, projectFinance, monthLabel } from '../core/calc';
import { salesBy, profitLoss } from '../core/gl';
import { poTotal, poDue, poReturned } from './Purchases';
import { periods, previous } from './Finance';
import { go } from '../core/router';
import { Stat, Empty, Badge, BarChart } from '../components/ui';
import { ExportButtons } from '../components/Export';

function useRange(def = 'tm') {
  const P = periods(); const p0 = P.find((p) => p.id === def) || P[0];
  const [r, setR] = useState({ id: p0.id, from: p0.from, to: p0.to });
  const bar = <div className="toolbar chips no-print">{P.map((p) => <button key={p.id} className={`chip ${r.id === p.id ? 'on' : ''}`} onClick={() => setR({ id: p.id, from: p.from, to: p.to })}>{p.label}</button>)}
    <input type="date" style={{ width: 'auto' }} value={r.from} onChange={(e) => setR({ ...r, id: '', from: e.target.value })} /> → <input type="date" style={{ width: 'auto' }} value={r.to} onChange={(e) => setR({ ...r, id: '', to: e.target.value })} /></div>;
  return { ...r, bar };
}
const change = (a: number, b: number) => (b ? `${a >= b ? '▲' : '▼'} ${Math.abs(Math.round(((a - b) / Math.abs(b)) * 100))}% vs previous` : 'no previous figures');

export function SalesReport() {
  const db = useDB(); const s = db.settings; const r = useRange('ty');
  const [by, setBy] = useState<'day' | 'month' | 'year'>('month');
  const rows = useMemo(() => salesBy(db, r.from, r.to, by), [db, r.from, r.to, by]);
  const prev = previous(r.from, r.to); const before = useMemo(() => salesBy(db, prev.from, prev.to, 'year'), [db, prev.from, prev.to]);
  const total = rows.reduce((n, x) => n + x.total, 0); const pt = before.reduce((n, x) => n + x.total, 0);
  const label = (p: string) => (by === 'month' ? monthLabel(p) : by === 'day' ? fmtDate(p) : p);
  return <>
    {r.bar}
    <div className="grid g3 mb">
      <Stat label="Sales" value={money(total, s)} icon={<ShoppingCart size={20} />} tone="wood" sub={change(total, pt)} />
      <Stat label="Invoices / shop sales" value={`${money(rows.reduce((n, x) => n + x.invoices, 0), s)} / ${money(rows.reduce((n, x) => n + x.shop, 0), s)}`} icon={<TrendingUp size={20} />} tone="blue" />
      <Stat label="Output VAT included" value={money(rows.reduce((n, x) => n + x.vat, 0), s)} icon={<Scale size={20} />} tone="gray" />
    </div>
    <div className="card">
      <div className="flex between wrap"><div className="chips">{(['day', 'month', 'year'] as const).map((k) => <button key={k} className={`chip ${by === k ? 'on' : ''}`} onClick={() => setBy(k)}>{k === 'day' ? 'Daily' : k === 'month' ? 'Monthly' : 'Yearly'}</button>)}</div>
        <ExportButtons name={`sales-${by}`} title={`${by === 'day' ? 'Daily' : by === 'month' ? 'Monthly' : 'Yearly'} sales`} sub={`${r.from} to ${r.to}`} head={['Period', 'Documents', 'Invoices', 'Shop sales', 'VAT', 'Total']} rows={rows.map((x) => [label(x.period), x.count, +x.invoices.toFixed(3), +x.shop.toFixed(3), +x.vat.toFixed(3), +x.total.toFixed(3)])} /></div>
      {by !== 'day' && rows.length > 1 && <BarChart data={rows.slice(-12).map((x) => ({ label: by === 'month' ? monthLabel(x.period).slice(0, 3) : x.period, a: x.total, b: 0 }))} />}
      {rows.length ? <div className="table-wrap"><table><thead><tr><th>Period</th><th className="num">Documents</th><th className="num">Invoices</th><th className="num">Shop sales</th><th className="num">VAT</th><th className="num">Total</th></tr></thead>
        <tbody>{rows.map((x) => <tr key={x.period}><td>{label(x.period)}</td><td className="num">{x.count}</td><td className="num">{money(x.invoices, s)}</td><td className="num">{money(x.shop, s)}</td><td className="num">{money(x.vat, s)}</td><td className="num"><b>{money(x.total, s)}</b></td></tr>)}
          <tr className="total-row"><td>Total</td><td /><td /><td /><td /><td className="num">{money(total, s)}</td></tr></tbody></table></div> : <Empty title="No sales in this period" />}
      <p className="muted" style={{ fontSize: 12 }}>Invoices (less credit notes) on their invoice date, plus shop sales (less returns). Previous period: {fmtDate(prev.from)} – {fmtDate(prev.to)}.</p>
    </div>
  </>;
}

export function ProjectPLReport() {
  const db = useDB(); const s = db.settings; const [st, setSt] = useState<'all' | 'open' | 'completed'>('all');
  const rows = db.jobs.filter((j) => j.status !== 'cancelled' && (st === 'all' || (st === 'completed' ? j.status === 'completed' : j.status !== 'completed'))).map((j) => ({ j, f: projectFinance(db, j) })).filter((x) => x.f.contract > 0 || x.f.expenses > 0).sort((a, b) => b.f.net - a.f.net);
  const T = (k: 'contract' | 'collected' | 'direct' | 'overhead' | 'net' | 'toCollect') => rows.reduce((n, x) => n + x.f[k], 0);
  return <>
    <div className="toolbar chips">{(['all', 'open', 'completed'] as const).map((k) => <button key={k} className={`chip ${st === k ? 'on' : ''}`} onClick={() => setSt(k)}>{k === 'all' ? 'All projects' : k === 'open' ? 'In progress' : 'Completed'}</button>)}</div>
    <div className="grid g4 mb">
      <Stat label="Project value" value={money(T('contract'), s)} icon={<Hammer size={20} />} tone="wood" sub={`${rows.length} projects`} />
      <Stat label="Costs" value={money(T('direct') + T('overhead'), s)} icon={<TrendingDown size={20} />} tone="red" />
      <Stat label="Net profit" value={<span className={T('net') >= 0 ? 'pos' : 'neg'}>{money(T('net'), s)}</span>} icon={<Scale size={20} />} tone="green" sub={T('contract') ? `${Math.round((T('net') / T('contract')) * 100)}% margin` : undefined} />
      <Stat label="Still to collect" value={money(T('toCollect'), s)} icon={<TrendingUp size={20} />} tone="amber" />
    </div>
    <div className="card">
      <div className="flex between"><h3>Project-wise profit & loss</h3><ExportButtons name="project-profit-loss" title="Project-wise profit & loss" head={['Code', 'Project', 'Status', 'Value', 'Collected', 'Direct cost', 'Overheads', 'Net profit', 'Margin %', 'Budget', 'To collect']} rows={rows.map(({ j, f }) => [j.code, j.title, j.status, +f.contract.toFixed(3), +f.collected.toFixed(3), +f.direct.toFixed(3), +f.overhead.toFixed(3), +f.net.toFixed(3), Math.round(f.margin * 100), f.budget || '', +f.toCollect.toFixed(3)])} /></div>
      {rows.length ? <div className="table-wrap"><table><thead><tr><th>Project</th><th className="num">Value</th><th className="num">Direct cost</th><th className="num">Overheads</th><th className="num">Net</th><th className="num">Margin</th><th className="num">To collect</th></tr></thead>
        <tbody>{rows.map(({ j, f }) => <tr key={j.id} className="click" onClick={() => go('jobs', { id: j.id })}><td><span className="code-tag">{j.code}</span> {j.title}{f.loss && <> <Badge tone="red">loss</Badge></>}{f.overBudget && <> <Badge tone="amber">over budget</Badge></>}</td>
          <td className="num">{money(f.contract, s)}</td><td className="num">{money(f.direct, s)}</td><td className="num">{money(f.overhead, s)}</td><td className={`num ${f.net < 0 ? 'neg' : 'pos'}`}><b>{money(f.net, s)}</b></td><td className="num">{Math.round(f.margin * 100)}%</td><td className="num">{money(f.toCollect, s)}</td></tr>)}</tbody></table></div> : <Empty title="No projects with figures yet" />}
    </div>
  </>;
}

export function PurchaseReport() {
  const db = useDB(); const s = db.settings; const r = useRange('tm');
  const list = db.purchases.filter((p) => p.status !== 'cancelled' && p.date >= r.from && p.date <= r.to).sort((a, b) => a.date.localeCompare(b.date));
  const sup = (id?: string) => db.suppliers.find((x) => x.id === id)?.name || '—';
  const bySup: Record<string, number> = {}; for (const p of list) bySup[sup(p.supplierId)] = (bySup[sup(p.supplierId)] || 0) + poTotal(p) - poReturned(p);
  const total = list.reduce((n, p) => n + poTotal(p) - poReturned(p), 0);
  return <>
    {r.bar}
    <div className="grid g3 mb">
      <Stat label="Purchases" value={money(total, s)} icon={<Truck size={20} />} tone="wood" sub={`${list.length} orders`} />
      <Stat label="For projects / workshop stock" value={`${money(list.filter((p) => p.jobId).reduce((n, p) => n + poTotal(p), 0), s)} / ${money(list.filter((p) => !p.jobId).reduce((n, p) => n + poTotal(p), 0), s)}`} icon={<Hammer size={20} />} tone="blue" />
      <Stat label="Still to pay (these orders)" value={money(list.reduce((n, p) => n + poDue(p), 0), s)} icon={<TrendingDown size={20} />} tone="red" />
    </div>
    <div className="card">
      <div className="flex between"><h3>Purchases by supplier</h3><ExportButtons name="purchases" title="Purchase report" sub={`${r.from} to ${r.to}`} head={['Date', 'PO', 'Bill no.', 'Supplier', 'For', 'Total', 'Returned', 'Paid', 'Due']} rows={list.map((p) => [p.date, p.number, p.billNo || '', sup(p.supplierId), db.jobs.find((j) => j.id === p.jobId)?.code || 'Workshop stock', +poTotal(p).toFixed(3), +poReturned(p).toFixed(3), +(Number(p.paid) || 0).toFixed(3), +poDue(p).toFixed(3)])} /></div>
      <div className="chips mb">{Object.entries(bySup).sort((a, b) => b[1] - a[1]).map(([k, v]) => <Badge key={k}>{k}: {money(v, s)}</Badge>)}</div>
      {list.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>PO</th><th>Supplier</th><th>For</th><th className="num">Total</th><th className="num">Due</th></tr></thead>
        <tbody>{list.map((p) => <tr key={p.id}><td>{fmtDate(p.date)}</td><td>{p.number}{p.billNo && <div className="muted">bill {p.billNo}</div>}</td><td>{sup(p.supplierId)}</td><td>{db.jobs.find((j) => j.id === p.jobId)?.code || 'Workshop stock'}</td><td className="num">{money(poTotal(p) - poReturned(p), s)}</td><td className="num">{money(poDue(p), s)}</td></tr>)}</tbody></table></div> : <Empty title="No purchases in this period" />}
    </div>
  </>;
}

export function ExpenseReport() {
  const db = useDB(); const s = db.settings; const r = useRange('tm');
  const tx = db.txns.filter((t) => t.kind === 'expense' && t.date >= r.from && t.date <= r.to).sort((a, b) => a.date.localeCompare(b.date));
  const prev = previous(r.from, r.to); const pt = db.txns.filter((t) => t.kind === 'expense' && t.date >= prev.from && t.date <= prev.to).reduce((n, t) => n + t.amount, 0);
  const byCat: Record<string, number> = {}; for (const t of tx) byCat[t.category] = (byCat[t.category] || 0) + t.amount;
  const total = tx.reduce((n, t) => n + t.amount, 0);
  return <>
    {r.bar}
    <div className="grid g3 mb">
      <Stat label="Expenses" value={money(total, s)} icon={<TrendingDown size={20} />} tone="red" sub={change(total, pt)} />
      <Stat label="On projects" value={money(tx.filter((t) => t.jobId).reduce((n, t) => n + t.amount, 0), s)} icon={<Hammer size={20} />} tone="wood" />
      <Stat label="Workshop overheads" value={money(tx.filter((t) => !t.jobId).reduce((n, t) => n + t.amount, 0), s)} icon={<Scale size={20} />} tone="blue" />
    </div>
    <div className="card">
      <div className="flex between"><h3>Expenses by category</h3><ExportButtons name="expenses" title="Expense report" sub={`${r.from} to ${r.to}`} head={['Date', 'Category', 'Description', 'Project', 'Method', 'Amount']} rows={tx.map((t) => [t.date, t.category, t.description, db.jobs.find((j) => j.id === t.jobId)?.code || '', t.method, +t.amount.toFixed(3)])} /></div>
      <div className="table-wrap"><table><thead><tr><th>Category</th><th className="num">Entries</th><th className="num">Amount</th><th className="num">Share</th></tr></thead>
        <tbody>{Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => <tr key={c}><td>{c}</td><td className="num">{tx.filter((t) => t.category === c).length}</td><td className="num">{money(v, s)}</td><td className="num">{total ? Math.round((v / total) * 100) : 0}%</td></tr>)}
          <tr className="total-row"><td>Total</td><td /><td className="num">{money(total, s)}</td><td /></tr></tbody></table></div>
    </div>
  </>;
}

/** Business performance: this period against the previous one, side by side. */
export function PerformanceReport() {
  const db = useDB(); const s = db.settings; const r = useRange('tm'); const prev = previous(r.from, r.to);
  const k = (from: string, to: string) => kpi(db, from, to);
  const a = useMemo(() => k(r.from, r.to), [db, r.from, r.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = useMemo(() => k(prev.from, prev.to), [db, prev.from, prev.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows: [string, number, number, boolean][] = [['Sales billed', a.sales, b.sales, true], ['Money received', a.income, b.income, true], ['Expenses paid', a.expense, b.expense, true], ['Net profit (cash)', a.net, b.net, true], ['Gross profit (P&L)', a.gross, b.gross, true],
    ['New projects', a.newJobs, b.newJobs, false], ['Projects completed', a.done, b.done, false], ['New enquiries', a.leads, b.leads, false], ['Quotations sent', a.quotes, b.quotes, false], ['Quotations won', a.won, b.won, false], ['Purchases', a.purchases, b.purchases, true]];
  return <>
    {r.bar}
    <div className="card">
      <div className="flex between"><h3>Business performance</h3><ExportButtons name="business-performance" title="Business performance" sub={`${r.from}–${r.to} vs ${prev.from}–${prev.to}`} head={['Measure', 'This period', 'Previous', 'Change %']} rows={rows.map(([l, x, y]) => [l, +x.toFixed(3), +y.toFixed(3), y ? Math.round(((x - y) / Math.abs(y)) * 100) : ''])} /></div>
      <div className="table-wrap"><table><thead><tr><th>Measure</th><th className="num">{fmtDate(r.from)} – {fmtDate(r.to)}</th><th className="num">{fmtDate(prev.from)} – {fmtDate(prev.to)}</th><th className="num">Change</th></tr></thead>
        <tbody>{rows.map(([l, x, y, m]) => <tr key={l}><td>{l}</td><td className="num"><b>{m ? money(x, s) : x}</b></td><td className="num muted">{m ? money(y, s) : y}</td><td className={`num ${x >= y ? 'pos' : 'neg'}`}>{y ? `${x >= y ? '▲' : '▼'} ${Math.abs(Math.round(((x - y) / Math.abs(y)) * 100))}%` : '—'}</td></tr>)}</tbody></table></div>
    </div>
  </>;
}
function kpi(db: DB, from: string, to: string) {
  const inR = (d?: string) => !!d && d >= from && d <= to;
  const tx = db.txns.filter((t) => inR(t.date)); const income = tx.filter((t) => t.kind === 'income').reduce((n, t) => n + t.amount, 0); const expense = tx.filter((t) => t.kind === 'expense').reduce((n, t) => n + t.amount, 0);
  const sales = db.invoices.filter((i) => inR(i.date)).reduce((n, i) => n + docTotals(i).total - (Number(i.credited) || 0), 0) + salesBy(db, from, to, 'year').reduce((n, x) => n + x.shop, 0);
  return { income, expense, net: income - expense, sales, gross: profitLoss(db, from, to).gross, newJobs: db.jobs.filter((j) => inR(String(j.createdAt).slice(0, 10))).length, done: db.jobs.filter((j) => inR(j.completedDate)).length,
    leads: db.customers.filter((c) => c.leadStatus && inR(String(c.createdAt).slice(0, 10))).length, quotes: db.quotations.filter((q) => inR(q.date)).length, won: db.quotations.filter((q) => inR(q.date) && q.status === 'accepted').length,
    purchases: db.purchases.filter((p) => p.status !== 'cancelled' && inR(p.date)).reduce((n, p) => n + poTotal(p), 0) };
}
