import { useMemo, useState } from 'react';
import { Printer, Percent, Users, Truck, IdCard, ScrollText } from 'lucide-react';
import { useDB, today } from '../core/store';
import type { Customer, DB } from '../core/types';
import { docTotals, fmtDate, invoiceBalance, money, saleTotals, staffEntitlements } from '../core/calc';
import { poTotal, poDue } from './Purchases';
import { daysFrom } from '../core/helpers';
import { PageHeader, Tabs, Stat, Empty, Badge } from '../components/ui';
import { CustomerStatement, customerLedger, ledgerBalance } from '../components/Statement';
import { useRole } from '../core/session';
import { SalesReport, ProjectPLReport, PurchaseReport, ExpenseReport, PerformanceReport } from './ReportsMore';
import { ExportButtons } from '../components/Export';
import { go } from '../core/router';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function presets() {
  const n = new Date(); const y = n.getFullYear(); const m = n.getMonth(); const q = Math.floor(m / 3);
  return [
    { id: 'tm', label: 'This month', from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) },
    { id: 'lm', label: 'Last month', from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) },
    { id: 'tq', label: 'This quarter', from: ymd(new Date(y, q * 3, 1)), to: ymd(new Date(y, q * 3 + 3, 0)) },
    { id: 'lq', label: 'Last quarter', from: ymd(new Date(y, q * 3 - 3, 1)), to: ymd(new Date(y, q * 3, 0)) },
    { id: 'ty', label: 'This year', from: `${y}-01-01`, to: `${y}-12-31` },
  ];
}

type VatRow = { date: string; doc: string; party: string; kind: 'Sales' | 'Purchases'; net: number; vat: number };
/** VAT return lines: output VAT on invoices and POS sales (less credit notes/returns), input VAT on purchases. */
export function vatRows(db: DB, from: string, to: string): VatRow[] {
  const inR = (d: string) => d >= from && d <= to; const out: VatRow[] = [];
  const cust = (id?: string) => db.customers.find((c) => c.id === id)?.name || '—';
  for (const i of db.invoices.filter((x) => inR(x.date))) { const t = docTotals(i); out.push({ date: i.date, doc: `Invoice ${i.number}`, party: cust(i.customerId), kind: 'Sales', net: t.taxable, vat: t.vat }); }
  for (const c of db.creditNotes.filter((x) => inR(x.date))) {
    const inv = db.invoices.find((i) => i.id === c.invoiceId); const r = Number(inv?.vat) || 0; const vat = c.amount * r / (100 + r);
    out.push({ date: c.date, doc: `Credit note ${c.number}`, party: cust(c.customerId), kind: 'Sales', net: -(c.amount - vat), vat: -vat });
  }
  for (const x of db.sales) {
    const st = saleTotals(x); const r = Number(x.vat) || 0;
    if (inR(x.date)) out.push({ date: x.date, doc: `Sale ${x.number}`, party: cust(x.customerId) === '—' ? 'Walk-in' : cust(x.customerId), kind: 'Sales', net: st.total / (1 + r / 100), vat: st.total - st.total / (1 + r / 100) });
    for (const ret of (x.returns || []).filter((y) => inR(y.date))) { const vat = ret.amount * r / (100 + r); out.push({ date: ret.date, doc: `Return on ${x.number}`, party: 'Walk-in', kind: 'Sales', net: -(ret.amount - vat), vat: -vat }); }
  }
  for (const t of db.txns.filter((x) => x.kind === 'expense' && Number(x.vat) > 0 && inR(x.date))) out.push({ date: t.date, doc: `Expense ${t.billNo ? 'bill ' + t.billNo : t.ref || ''}`.trim(), party: t.vendor || t.description, kind: 'Purchases', net: t.amount - Number(t.vat), vat: Number(t.vat) });
  for (const p of db.purchases.filter((x) => x.status !== 'cancelled')) for (const ret of (p.returns || []).filter((y) => inR(y.date))) { const r = Number(p.vat) || 0; const vat = ret.amount * r / (100 + r); out.push({ date: ret.date, doc: `Return on ${p.number}`, party: db.suppliers.find((x) => x.id === p.supplierId)?.name || '—', kind: 'Purchases', net: -(ret.amount - vat), vat: -vat }); }
  for (const p of db.purchases.filter((x) => x.status !== 'cancelled' && inR(x.date))) {
    const total = poTotal(p); const r = Number(p.vat) || 0;
    out.push({ date: p.date, doc: `${p.number}${p.billNo ? ' · bill ' + p.billNo : ''}`, party: db.suppliers.find((x) => x.id === p.supplierId)?.name || '—', kind: 'Purchases', net: total / (1 + r / 100), vat: total - total / (1 + r / 100) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export default function Reports() {
  const role = useRole();
  const [tab, setTab] = useState<'perf' | 'sales' | 'projects' | 'purchases' | 'expenses' | 'vat' | 'receivable' | 'payable' | 'staff'>('perf');
  return (
    <>
      <PageHeader title="Reports" sub="Every report can be filtered by date, compared with the previous period and downloaded as Excel or PDF." actions={<><button className="btn sm" onClick={() => go('finance')}>P&L · Balance sheet · Cash flow →</button><button className="btn sm" onClick={() => go('inventory')}>Inventory reports →</button><button className="btn sm" onClick={() => go('staff')}>Staff reports →</button></>} />
      <div className="toolbar"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'perf', label: 'Business performance' }, { id: 'sales', label: 'Sales' }, { id: 'projects', label: 'Project P&L' }, { id: 'purchases', label: 'Purchases' }, { id: 'expenses', label: 'Expenses' }, { id: 'vat', label: 'VAT return' }, { id: 'receivable', label: 'Customer balances' }, { id: 'payable', label: 'Supplier balances' }, ...(role === 'admin' || role === 'manager' ? [{ id: 'staff' as const, label: 'Gratuity & leave' }] : [])]} /></div>
      {tab === 'perf' && <PerformanceReport />}
      {tab === 'sales' && <SalesReport />}
      {tab === 'projects' && <ProjectPLReport />}
      {tab === 'purchases' && <PurchaseReport />}
      {tab === 'expenses' && <ExpenseReport />}
      {tab === 'vat' && <VatReport />}
      {tab === 'receivable' && <Receivables />}
      {tab === 'payable' && <Payables />}
      {tab === 'staff' && <StaffReport />}
    </>
  );
}

function VatReport() {
  const db = useDB(); const s = db.settings; const ps = presets();
  const [range, setRange] = useState({ from: ps[2].from, to: ps[2].to });
  const rows = useMemo(() => vatRows(db, range.from, range.to), [db, range]);
  const sum = (k: VatRow['kind'], f: 'net' | 'vat') => rows.filter((r) => r.kind === k).reduce((n, r) => n + r[f], 0);
  const out = sum('Sales', 'vat'); const inp = sum('Purchases', 'vat'); const net = out - inp;
  return (
    <>
      <div className="toolbar chips no-print">
        {ps.map((p) => <button key={p.id} className={`chip ${range.from === p.from && range.to === p.to ? 'on' : ''}`} onClick={() => setRange({ from: p.from, to: p.to })}>{p.label}</button>)}
        <input type="date" style={{ width: 'auto' }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /> → <input type="date" style={{ width: 'auto' }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        <ExportButtons name={`vat-${range.from}-${range.to}`} title="VAT return" sub={`${range.from} to ${range.to} · VAT no. ${s.vatNumber || '—'}`} head={['Date', 'Document', 'Party', 'Type', 'Net', 'VAT']} rows={[...rows.map((r) => [r.date, r.doc, r.party, r.kind, +r.net.toFixed(3), +r.vat.toFixed(3)]), ['', 'Output VAT', '', '', '', +out.toFixed(3)], ['', 'Input VAT', '', '', '', +inp.toFixed(3)], ['', net >= 0 ? 'VAT payable' : 'VAT refundable', '', '', '', +Math.abs(net).toFixed(3)]]} />
        <button className="btn sm" onClick={() => window.print()}><Printer size={14} />Print</button>
      </div>
      {!s.vatNumber && <div className="alert">Add your VAT registration number in Settings → Business so it prints on invoices.</div>}
      <div className="print-area"><div className="grid g3 mb">
        <Stat label="Output VAT (sales)" value={money(out, s)} icon={<Percent size={20} />} tone="wood" sub={`on sales of ${money(sum('Sales', 'net'), s)}`} />
        <Stat label="Input VAT (purchases)" value={money(inp, s)} icon={<Percent size={20} />} tone="blue" sub={`on purchases of ${money(sum('Purchases', 'net'), s)}`} />
        <Stat label={net >= 0 ? 'VAT payable' : 'VAT refundable'} value={<span className={net >= 0 ? 'neg' : 'pos'}>{money(Math.abs(net), s)}</span>} icon={<Percent size={20} />} tone={net >= 0 ? 'red' : 'green'} sub={`${fmtDate(range.from)} – ${fmtDate(range.to)}`} />
      </div>
      <div className="card">{rows.length ? <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Document</th><th>Customer / supplier</th><th>Type</th><th className="num">Net</th><th className="num">VAT</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{fmtDate(r.date)}</td><td>{r.doc}</td><td>{r.party}</td><td><Badge tone={r.kind === 'Sales' ? 'green' : 'blue'}>{r.kind}</Badge></td><td className="num">{money(r.net, s)}</td><td className="num"><b>{money(r.vat, s)}</b></td></tr>)}</tbody>
      </table></div> : <Empty title="No sales or purchases in this period" />}
      <p className="muted" style={{ marginTop: 10 }}>Invoices count on their invoice date, purchases on the order date. Expenses typed straight into Accounts carry no VAT — record supplier bills as purchases to claim input VAT.</p></div></div>
    </>
  );
}

const BUCKETS = ['Not due', '1–30 days', '31–60 days', '61–90 days', '90+ days'] as const;
const bucket = (due?: string) => { const late = -(daysFrom(due) ?? 0); return late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4; };

function Receivables() {
  const db = useDB(); const s = db.settings; const [stmt, setStmt] = useState<Customer | null>(null);
  const rows = db.customers.map((c) => {
    const b = [0, 0, 0, 0, 0];
    for (const i of db.invoices.filter((x) => x.customerId === c.id && invoiceBalance(x) > 0.0005)) b[bucket(i.dueDate || i.date)] += invoiceBalance(i);
    const ledger = ledgerBalance(customerLedger(db, c.id));
    return { c, b, owed: b.reduce((n, x) => n + x, 0), ledger };
  }).filter((r) => r.owed > 0.0005 || r.ledger < -0.0005).sort((a, b) => b.owed - a.owed);
  const tot = BUCKETS.map((_, k) => rows.reduce((n, r) => n + r.b[k], 0));
  const advance = rows.filter((r) => r.ledger < 0).reduce((n, r) => n - r.ledger, 0);
  return (
    <>
      <div className="grid g3 mb">
        <Stat label="Customers owe you" value={money(tot.reduce((n, x) => n + x, 0), s)} icon={<Users size={20} />} tone="wood" sub={`${rows.filter((r) => r.owed > 0).length} customers`} />
        <Stat label="Over 60 days late" value={money(tot[3] + tot[4], s)} icon={<Users size={20} />} tone="red" />
        <Stat label="Advances held for customers" value={money(advance, s)} icon={<Users size={20} />} tone="green" sub="paid before invoicing" />
      </div>
      <div className="card"><div className="flex between"><h3>Customer outstanding (ageing)</h3><ExportButtons name="customer-outstanding" title="Customer outstanding" head={['Customer', 'Phone', ...BUCKETS, 'Total due']} rows={rows.map((r) => [r.c.name, r.c.phone || '', ...r.b.map((v) => +v.toFixed(3)), +r.owed.toFixed(3)])} /></div>{rows.length ? <div className="table-wrap"><table className="aging">
        <thead><tr><th>Customer</th>{BUCKETS.map((b) => <th key={b} className="num">{b}</th>)}<th className="num">Total due</th><th /></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.c.id} className="click" onClick={() => setStmt(r.c)}><td><b>{r.c.name}</b><div className="muted">{r.c.phone}{r.ledger < -0.0005 ? ` · advance ${money(-r.ledger, s)}` : ''}</div></td>
          {r.b.map((v, k) => <td key={k} className={`num ${v > 0 && k >= 3 ? 'neg' : ''}`}>{v ? money(v, s) : '—'}</td>)}<td className="num"><b>{money(r.owed, s)}</b></td><td><ScrollText size={15} /></td></tr>)}
          <tr className="total-row"><td>Total</td>{tot.map((v, k) => <td key={k} className="num">{money(v, s)}</td>)}<td className="num">{money(tot.reduce((n, x) => n + x, 0), s)}</td><td /></tr></tbody>
      </table></div> : <Empty title="Nobody owes you anything 🎉" />}<p className="muted" style={{ marginTop: 10 }}>Late = days past the invoice due date. Click a customer for the full statement.</p></div>
      {stmt && <CustomerStatement customer={stmt} onClose={() => setStmt(null)} />}
    </>
  );
}

function Payables() {
  const db = useDB(); const s = db.settings;
  const due = (p: DB['purchases'][number]) => poDue(p);
  const rows = db.suppliers.map((x) => {
    const b = [0, 0, 0, 0, 0];
    for (const p of db.purchases.filter((y) => y.supplierId === x.id && due(y) > 0.0005)) b[bucket(p.dueDate || p.date)] += due(p);
    return { x, b, owed: b.reduce((n, v) => n + v, 0) };
  }).filter((r) => r.owed > 0.0005).sort((a, b) => b.owed - a.owed);
  const tot = BUCKETS.map((_, k) => rows.reduce((n, r) => n + r.b[k], 0));
  const issued = db.cheques.filter((c) => c.direction === 'issued' && ['pending', 'deposited'].includes(c.status));
  return (
    <>
      <div className="grid g3 mb">
        <Stat label="You owe suppliers" value={money(tot.reduce((n, x) => n + x, 0), s)} icon={<Truck size={20} />} tone="red" sub={`${rows.length} suppliers`} />
        <Stat label="Overdue" value={money(tot.slice(1).reduce((n, x) => n + x, 0), s)} icon={<Truck size={20} />} tone="wood" />
        <Stat label="Cheques you issued, not cleared" value={money(issued.reduce((n, c) => n + c.amount, 0), s)} icon={<Truck size={20} />} tone="blue" sub={`${issued.length} cheques`} />
      </div>
      <div className="card"><div className="flex between"><h3>Supplier outstanding (ageing)</h3><ExportButtons name="supplier-outstanding" title="Supplier outstanding" head={['Supplier', ...BUCKETS, 'Total due']} rows={rows.map((r) => [r.x.name, ...r.b.map((v) => +v.toFixed(3)), +r.owed.toFixed(3)])} /></div>{rows.length ? <div className="table-wrap"><table className="aging">
        <thead><tr><th>Supplier</th>{BUCKETS.map((b) => <th key={b} className="num">{b}</th>)}<th className="num">Total due</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.x.id}><td><b>{r.x.name}</b><div className="muted">{r.x.phone}</div></td>{r.b.map((v, k) => <td key={k} className="num">{v ? money(v, s) : '—'}</td>)}<td className="num"><b>{money(r.owed, s)}</b></td></tr>)}
          <tr className="total-row"><td>Total</td>{tot.map((v, k) => <td key={k} className="num">{money(v, s)}</td>)}<td className="num">{money(tot.reduce((n, x) => n + x, 0), s)}</td></tr></tbody>
      </table></div> : <Empty title="No supplier bills due" />}</div>
    </>
  );
}

function StaffReport() {
  const db = useDB(); const s = db.settings;
  const rows = db.staff.filter((x) => x.active).map((st) => ({ st, e: staffEntitlements(db, st) }));
  const total = rows.reduce((n, r) => n + r.e.gratuity, 0);
  return (
    <>
      <div className="grid g3 mb">
        <Stat label="Gratuity owed if all left today" value={money(total, s)} icon={<IdCard size={20} />} tone="wood" sub={`${s.gratuityDaysPerYear ?? 30} days of basic wage per year of service`} />
        <Stat label="Leave days owed" value={rows.reduce((n, r) => n + Math.max(0, r.e.leaveBalance), 0).toFixed(1)} icon={<IdCard size={20} />} tone="blue" sub={`${s.annualLeaveDays ?? 30} days per year`} />
        <Stat label="As of" value={fmtDate(today())} icon={<IdCard size={20} />} tone="green" />
      </div>
      <div className="card">{rows.length ? <div className="table-wrap"><table>
        <thead><tr><th>Staff</th><th>Joined</th><th className="num">Service</th><th className="num">Basic / month</th><th className="num">Gratuity</th><th className="num">Leave earned</th><th className="num">Taken</th><th className="num">Balance</th></tr></thead>
        <tbody>{rows.map(({ st, e }) => <tr key={st.id}><td><b>{st.name}</b><div className="muted">{st.role} · {st.nationality || '—'}</div></td><td>{st.joinDate ? fmtDate(st.joinDate) : <Badge tone="amber">add join date</Badge>}</td>
          <td className="num">{e.years.toFixed(1)} y</td><td className="num">{money(e.basic, s)}</td><td className="num"><b>{e.omani ? 'PASI' : money(e.gratuity, s)}</b></td>
          <td className="num">{e.leaveAccrued.toFixed(1)}</td><td className="num">{e.leaveTaken}</td><td className={`num ${e.leaveBalance < 0 ? 'neg' : ''}`}><b>{e.leaveBalance.toFixed(1)}</b></td></tr>)}</tbody>
      </table></div> : <Empty title="No active staff" />}
      <p className="muted" style={{ marginTop: 10 }}>An estimate to plan for. Leave taken = days marked L in Attendance. If leave was taken before you started using the app, set “Leave counted from” and the balance on that date in each staff profile. Check the final amount against the labour law and each contract before paying.</p></div>
    </>
  );
}
