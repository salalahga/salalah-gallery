import { useState } from 'react';
import { ChevronLeft, ChevronRight, Calculator, CheckCircle2, Printer, Plus, Trash2 } from 'lucide-react';
import { store, useDB, today } from '../core/store';
import type { Payslip, Advance } from '../core/types';
import { money, monthLabel, payrollCalc, fmtDate } from '../core/calc';
import { lookup } from '../core/helpers';
import { deleteAdvance } from '../core/ledger';
import { PageHeader, Badge, Empty, Modal, Field, Stat, Tabs, toast, confirmDelete } from '../components/ui';
import { Wallet, Users, HandCoins } from 'lucide-react';
import { useT } from '../core/i18n';

export default function Payroll() {
  const db = useDB(); const s = db.settings; const L = lookup(db); const t = useT();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [tab, setTab] = useState<'run' | 'advances'>('run');
  const [slip, setSlip] = useState<Payslip | null>(null);
  const [adv, setAdv] = useState<Partial<Advance> | null>(null);
  const [payMethod, setPayMethod] = useState('Bank');
  const shift = (n: number) => { const d = new Date(month + '-01T00:00:00'); d.setMonth(d.getMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  const slips = db.payslips.filter((p) => p.month === month);
  const staff = db.staff.filter((x) => x.active);

  const generate = () => {
    staff.forEach((p) => {
      const ex = slips.find((x) => x.staffId === p.id); if (ex?.paid) return;
      const c = payrollCalc(db, p.id, month);
      const bonus = ex?.bonus || 0; const deductions = ex?.deductions || 0;
      const net = c.basic + c.overtimePay + c.allowance + bonus - deductions - c.advance;
      store.upsert('payslips', { ...(ex || {}), month, staffId: p.id, ...c, bonus, deductions, net: Math.max(0, net), paid: false } as Payslip);
    });
    toast('Payroll calculated from attendance');
  };
  const recalc = (p: Payslip, patch: Partial<Payslip>) => { const n = { ...p, ...patch }; n.net = Math.max(0, n.basic + n.overtimePay + n.allowance + (n.bonus || 0) - (n.deductions || 0) - n.advance); store.upsert('payslips', n); };
  const pay = (p: Payslip) => {
    const st = L.staff(p.staffId);
    if (!(p.net > 0) && !window.confirm(`Net pay for ${st?.name} is ${money(p.net, s)}. Mark as paid anyway?`)) return;
    store.upsert('payslips', { ...p, paid: true, paidDate: today() });
    if (p.net > 0) store.upsert('txns', { date: today(), kind: 'expense', category: 'Salary', amount: p.net, method: payMethod, description: `Salary ${monthLabel(month)} — ${st?.name}`, ref: `PAY-${month}` });
    // only the advances that were deducted on this payslip (given up to the end of its month)
    db.advances.filter((a) => a.staffId === p.staffId && !a.recovered && a.date <= `${month}-31`).forEach((a) => store.upsert('advances', { ...a, recovered: true }));
    toast(`Paid ${st?.name} · recorded in accounts`);
  };
  const saveAdv = () => {
    if (!adv?.staffId || !adv.amount) return toast('Choose staff and amount');
    if (!(adv.amount > 0)) return toast('Enter a positive amount');
    const t = store.upsert('txns', { date: adv.date || today(), kind: 'expense', category: 'Salary', amount: adv.amount, method: 'Cash', description: `Salary advance — ${L.staff(adv.staffId)?.name}` });
    store.upsert('advances', { ...adv, recovered: false, txnId: t.id } as Advance);
    setAdv(null); toast('Advance recorded');
  };
  const total = slips.reduce((n, p) => n + p.net, 0);
  const paid = slips.filter((p) => p.paid).reduce((n, p) => n + p.net, 0);
  const outstandingAdv = db.advances.filter((a) => !a.recovered).reduce((n, a) => n + a.amount, 0);

  return (
    <>
      <PageHeader title={t('Payroll')} sub="Salaries are calculated from attendance, overtime, allowances and advances."
        actions={<><div className="flex"><button className="icon-btn" onClick={() => shift(-1)}><ChevronLeft size={18} /></button><b style={{ minWidth: 90, textAlign: 'center' }}>{monthLabel(month)}</b><button className="icon-btn" onClick={() => shift(1)}><ChevronRight size={18} /></button></div>
          <select style={{ width: 'auto' }} value={payMethod} onChange={(e) => setPayMethod(e.target.value)} title="Salaries are paid by">{['Bank', 'Cash'].map((m) => <option key={m}>{m}</option>)}</select>
          <button className="btn primary" onClick={generate}><Calculator size={16} />{slips.length ? 'Recalculate' : 'Run payroll'}</button></>} />
      <div className="grid g3 mb">
        <Stat label={`Net payroll · ${monthLabel(month)}`} value={money(total, s)} icon={<Wallet size={20} />} tone="wood" />
        <Stat label="Paid" value={money(paid, s)} icon={<Users size={20} />} tone="green" sub={`${slips.filter((p) => p.paid).length}/${slips.length} staff`} />
        <Stat label="Outstanding advances" value={money(outstandingAdv, s)} icon={<HandCoins size={20} />} tone="red" />
      </div>
      <div className="toolbar"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'run', label: 'Payroll run' }, { id: 'advances', label: 'Advances', count: db.advances.filter((a) => !a.recovered).length }]} /></div>

      {tab === 'run' ? <div className="card">
        {slips.length ? <div className="table-wrap"><table>
          <thead><tr><th>Staff</th><th className="num">Days</th><th className="num">Basic</th><th className="num">OT</th><th className="num">Allow.</th><th className="num">Bonus</th><th className="num">Deduct.</th><th className="num">Advance</th><th className="num">Net pay</th><th /></tr></thead>
          <tbody>{slips.map((p) => { const st = L.staff(p.staffId); return (
            <tr key={p.id}>
              <td><b>{st?.name}</b><div className="muted">{st?.role} · {st?.salaryType}</div></td>
              <td className="num">{p.daysPresent}</td><td className="num">{money(p.basic, s)}</td><td className="num">{money(p.overtimePay, s)}<div className="muted">{p.overtimeHours}h</div></td>
              <td className="num">{money(p.allowance, s)}</td>
              <td className="num"><input type="number" disabled={p.paid} style={{ width: 80 }} value={p.bonus} onChange={(e) => recalc(p, { bonus: +e.target.value })} /></td>
              <td className="num"><input type="number" disabled={p.paid} style={{ width: 80 }} value={p.deductions} onChange={(e) => recalc(p, { deductions: +e.target.value })} /></td>
              <td className="num neg">{p.advance ? '−' + money(p.advance, s) : '—'}</td>
              <td className="num"><b>{money(p.net, s)}</b></td>
              <td><div className="row-actions">
                <button className="icon-btn" title="Payslip" onClick={() => setSlip(p)}><Printer size={16} /></button>
                {p.paid ? <Badge tone="green">Paid {fmtDate(p.paidDate)}</Badge> : <button className="btn sm" onClick={() => pay(p)}><CheckCircle2 size={14} />Pay</button>}
              </div></td>
            </tr>); })}</tbody></table></div>
          : <Empty title={`No payroll for ${monthLabel(month)}`} hint="Mark attendance, then run payroll." action={<button className="btn primary" onClick={generate}>Run payroll</button>} />}
      </div> : <div className="card">
        <h3>Salary advances <button className="btn sm primary" onClick={() => setAdv({ date: today(), staffId: staff[0]?.id })}><Plus size={14} />New advance</button></h3>
        {db.advances.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Staff</th><th>Note</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
          <tbody>{db.advances.map((a) => <tr key={a.id}><td>{fmtDate(a.date)}</td><td>{L.staff(a.staffId)?.name}</td><td>{a.note}</td><td className="num">{money(a.amount, s)}</td><td>{a.recovered ? <Badge tone="green">Recovered</Badge> : <Badge tone="amber">Pending</Badge>}</td>
            <td>{!a.recovered && <button className="icon-btn" onClick={() => { if (!confirmDelete('this advance')) return; const err = deleteAdvance(a); toast(err || 'Advance deleted — its expense was removed from Accounts'); }}><Trash2 size={15} /></button>}</td></tr>)}</tbody></table></div> : <Empty title="No advances" />}
      </div>}

      {adv && <Modal open title="Salary advance" onClose={() => setAdv(null)} footer={<><button className="btn" onClick={() => setAdv(null)}>Cancel</button><button className="btn primary" onClick={saveAdv}>Save</button></>}>
        <div className="form two">
          <Field label="Staff"><select value={adv.staffId} onChange={(e) => setAdv({ ...adv, staffId: e.target.value })}>{staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Date"><input type="date" value={adv.date} onChange={(e) => setAdv({ ...adv, date: e.target.value })} /></Field>
          <Field label={`Amount (${s.currency})`}><input type="number" value={adv.amount || ''} onChange={(e) => setAdv({ ...adv, amount: +e.target.value })} /></Field>
          <Field label="Note"><input value={adv.note || ''} onChange={(e) => setAdv({ ...adv, note: e.target.value })} /></Field>
        </div>
      </Modal>}

      {slip && (() => { const st = L.staff(slip.staffId); return (
        <Modal open title="Payslip" onClose={() => setSlip(null)} footer={<><button className="btn" onClick={() => setSlip(null)}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print</button></>}>
          <div className="print-area"><div className="doc">
            <div className="doc-head"><div><h2>{s.businessName}</h2><div>{s.address}, {s.city}</div><div>{s.phone}</div></div><div className="right"><h2>PAYSLIP</h2><div>{monthLabel(slip.month)}</div></div></div>
            <p><b>{st?.name}</b> — {st?.role}<br />ID: {st?.idNumber || '—'} · Bank: {st?.bank || '—'}</p>
            <table style={{ width: '100%' }}><tbody>
              <tr><td>Days worked</td><td className="num">{slip.daysPresent}</td></tr>
              <tr><td>Basic salary</td><td className="num">{money(slip.basic, s)}</td></tr>
              <tr><td>Overtime ({slip.overtimeHours} h)</td><td className="num">{money(slip.overtimePay, s)}</td></tr>
              <tr><td>Allowance</td><td className="num">{money(slip.allowance, s)}</td></tr>
              <tr><td>Bonus</td><td className="num">{money(slip.bonus, s)}</td></tr>
              <tr><td>Deductions</td><td className="num">−{money(slip.deductions, s)}</td></tr>
              <tr><td>Advance recovered</td><td className="num">−{money(slip.advance, s)}</td></tr>
            </tbody></table>
            <div className="totals" style={{ marginTop: 10 }}><div className="grand"><span>Net pay</span><span>{money(slip.net, s)}</span></div></div>
            <div className="doc-sign"><div>Employer</div><div>Employee signature</div></div>
          </div></div>
        </Modal>); })()}
    </>
  );
}
