import { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Scale, ShoppingCart, Hammer, CheckCircle2, Hourglass, Receipt, Truck, Banknote, Landmark } from 'lucide-react';
import type { DB } from '../core/types';
import { useDB, today } from '../core/store';
import { go } from '../core/router';
import { balances, docTotals, fmtDate, invoiceBalance, money, projectFinance, saleTotals } from '../core/calc';
import { lookup, daysFrom } from '../core/helpers';
import { projectTrack } from '../core/stages';
import { poDue } from '../modules/Purchases';
import { Stat, Badge, Empty } from './ui';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function range(p: string, from: string, to: string): [string, string] {
  const n = new Date(); const y = n.getFullYear(); const m = n.getMonth();
  switch (p) {
    case 'month': return [ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))];
    case 'last': return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))];
    case 'year': return [`${y}-01-01`, `${y}-12-31`];
    case '12m': { const a = new Date(n); a.setFullYear(y - 1); return [ymd(a), ymd(n)]; }
    case 'custom': return [from || '0000-01-01', to || '9999-12-31'];
    default: return ['0000-01-01', '9999-12-31'];
  }
}

/** Executive summary with a date and project filter. */
export function BusinessOverview() {
  const db = useDB(); const s = db.settings; const L = lookup(db);
  const [p, setP] = useState('month'); const [from, setFrom] = useState(''); const [to, setTo] = useState(today()); const [job, setJob] = useState('');
  const [a, b] = range(p, from, to);
  const k = useMemo(() => kpis(db, a, b, job), [db, a, b, job]);
  const active = db.jobs.filter((j) => ['production', 'finishing', 'installation'].includes(j.status));
  const pending = db.jobs.filter((j) => ['enquiry', 'design'].includes(j.status));
  const completed = db.jobs.filter((j) => j.status === 'completed' && (!j.completedDate || (j.completedDate >= a && j.completedDate <= b)));
  const bal = balances(db);
  const payables = db.purchases.reduce((n, x) => n + poDue(x), 0);
  const outstanding = db.invoices.reduce((n, i) => n + Math.max(0, invoiceBalance(i)), 0);
  const open = db.jobs.filter((j) => !['completed', 'cancelled'].includes(j.status));
  const upcoming = open.filter((j) => j.dueDate && (daysFrom(j.dueDate) ?? -1) >= 0 && (daysFrom(j.dueDate) ?? 99) <= 14).sort((x, y) => x.dueDate!.localeCompare(y.dueDate!));
  const delayed = open.filter((j) => j.dueDate && (daysFrom(j.dueDate) ?? 0) < 0).sort((x, y) => x.dueDate!.localeCompare(y.dueDate!));
  const dues = db.invoices.filter((i) => invoiceBalance(i) > 0.0005).sort((x, y) => (x.dueDate || x.date).localeCompare(y.dueDate || y.date));
  const profit = db.jobs.filter((j) => j.status !== 'cancelled' && (!job || j.id === job)).map((j) => ({ j, f: projectFinance(db, j) })).filter((r) => r.f.contract > 0).sort((x, y) => y.f.net - x.f.net);

  return (
    <div className="overview mb">
      <div className="toolbar chips">
        {[['month', 'This month'], ['last', 'Last month'], ['year', 'This year'], ['12m', 'Last 12 months'], ['all', 'All time'], ['custom', 'Dates…']].map(([id, label]) => <button key={id} className={`chip ${p === id ? 'on' : ''}`} onClick={() => setP(id)}>{label}</button>)}
        {p === 'custom' && <><input type="date" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} /> → <input type="date" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} /></>}
        <select style={{ width: 'auto' }} value={job} onChange={(e) => setJob(e.target.value)}><option value="">All projects</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select>
      </div>
      <div className="grid g4 mb kpi-grid">
        <Stat label="Revenue received" value={money(k.revenue, s)} icon={<TrendingUp size={20} />} tone="green" sub={job ? 'this project' : 'payments, advances, sales'} />
        <Stat label="Expenses" value={money(k.expenses, s)} icon={<TrendingDown size={20} />} tone="red" />
        <Stat label={k.net >= 0 ? 'Net profit' : 'Net loss'} value={<span className={k.net >= 0 ? 'pos' : 'neg'}>{money(k.net, s)}</span>} icon={<Scale size={20} />} tone="wood" sub={k.revenue ? `${Math.round((k.net / k.revenue) * 100)}% of revenue` : undefined} />
        <Stat label="Total sales (billed)" value={money(k.sales, s)} icon={<ShoppingCart size={20} />} tone="blue" sub={`${k.invoices} invoices · ${k.pos} shop sales`} />
        <Stat label="Active projects" value={active.length} icon={<Hammer size={20} />} tone="amber" sub="in production, finishing or installing" />
        <Stat label="Completed projects" value={completed.length} icon={<CheckCircle2 size={20} />} tone="green" sub={p === 'all' ? 'all time' : 'in this period'} />
        <Stat label="Pending projects" value={pending.length} icon={<Hourglass size={20} />} tone="gray" sub="enquiry / design, not started" />
        <Stat label="Customers owe" value={money(outstanding, s)} icon={<Receipt size={20} />} tone="red" sub={`${dues.length} open invoices`} />
        <Stat label="We owe suppliers" value={money(payables, s)} icon={<Truck size={20} />} tone="wood" />
        <Stat label="Cash in hand" value={money(bal.cash, s)} icon={<Banknote size={20} />} tone="green" />
        <Stat label="Bank balance" value={money(bal.bank, s)} icon={<Landmark size={20} />} tone="blue" sub={bal.pendingIn ? `+ ${money(bal.pendingIn, s)} cheques to clear` : undefined} />
        <Stat label="Delayed projects" value={<span className={delayed.length ? 'neg' : ''}>{delayed.length}</span>} icon={<Hourglass size={20} />} tone="red" sub={`${upcoming.length} due in the next 14 days`} />
      </div>

      <div className="grid g2 mb">
        <div className="card">
          <h3>Project profitability <a className="link" href="#/jobs">Projects</a></h3>
          {profit.length ? <div className="table-wrap"><table><thead><tr><th>Project</th><th className="num">Value</th><th className="num">Cost</th><th className="num">Net</th><th className="num">Margin</th></tr></thead>
            <tbody>{profit.slice(0, 8).map(({ j, f }) => <tr key={j.id} className="click" onClick={() => go('jobs', { id: j.id })}><td><span className="code-tag">{j.code}</span> {j.title}{f.loss && <> <Badge tone="red">loss</Badge></>}{f.overBudget && <> <Badge tone="amber">over budget</Badge></>}</td>
              <td className="num">{money(f.contract, s)}</td><td className="num">{money(f.direct + f.overhead, s)}</td><td className={`num ${f.net < 0 ? 'neg' : 'pos'}`}><b>{money(f.net, s)}</b></td><td className="num">{Math.round(f.margin * 100)}%</td></tr>)}</tbody></table></div>
            : <Empty title="No priced projects yet" />}
        </div>
        <div className="card">
          <h3>Pending customer payments <a className="link" href="#/reports">Balances</a></h3>
          {dues.length ? <ul className="list">{dues.slice(0, 7).map((i) => { const d = daysFrom(i.dueDate || i.date) ?? 0; return <li key={i.id} style={{ cursor: 'pointer' }} onClick={() => go('invoices', { id: i.id })}>
            <div className="grow"><div className="title">{L.customer(i.customerId)?.name || '—'} · {i.number}</div><div className="muted">{i.title}</div></div>
            <Badge tone={d < 0 ? 'red' : 'gray'}>{d < 0 ? `${-d}d late` : `due ${fmtDate(i.dueDate)}`}</Badge><b className="neg">{money(invoiceBalance(i), s)}</b></li>; })}</ul> : <Empty title="Nothing outstanding 🎉" />}
        </div>
      </div>
      <div className="grid g2 mb">
        <div className="card">
          <h3>Upcoming deliveries (14 days)</h3>
          {upcoming.length ? <ul className="list">{upcoming.map((j) => { const t = projectTrack(db, j); return <li key={j.id} style={{ cursor: 'pointer' }} onClick={() => go('jobs', { id: j.id })}><span className="code-tag">{j.code}</span><div className="grow"><div className="title">{j.title}</div><div className="muted">{L.customer(j.customerId)?.name || '—'} · {t.next}</div></div><Badge tone="amber">{fmtDate(j.dueDate)}</Badge></li>; })}</ul> : <Empty title="Nothing due in the next two weeks" />}
        </div>
        <div className="card">
          <h3><span className={delayed.length ? 'neg' : ''}>Delayed projects</span></h3>
          {delayed.length ? <ul className="list">{delayed.map((j) => <li key={j.id} style={{ cursor: 'pointer' }} onClick={() => go('jobs', { id: j.id })}><span className="code-tag">{j.code}</span><div className="grow"><div className="title">{j.title}</div><div className="muted">{L.customer(j.customerId)?.name || '—'} · {j.progress || 0}% done</div></div><Badge tone="red">{-(daysFrom(j.dueDate) ?? 0)}d late</Badge></li>)}</ul> : <Empty title="No delayed projects" />}
        </div>
      </div>
    </div>
  );
}

function kpis(db: DB, a: string, b: string, job: string) {
  const inR = (d: string) => d >= a && d <= b;
  const tx = db.txns.filter((t) => inR(t.date) && (!job || t.jobId === job));
  const revenue = tx.filter((t) => t.kind === 'income').reduce((n, t) => n + t.amount, 0);
  const expenses = tx.filter((t) => t.kind === 'expense').reduce((n, t) => n + t.amount, 0);
  const inv = db.invoices.filter((i) => inR(i.date) && (!job || i.jobId === job));
  const pos = job ? [] : db.sales.filter((x) => inR(x.date));
  const sales = inv.reduce((n, i) => n + docTotals(i).total - (Number(i.credited) || 0), 0) + pos.reduce((n, x) => n + saleTotals(x).net, 0);
  return { revenue, expenses, net: revenue - expenses, sales, invoices: inv.length, pos: pos.length };
}
