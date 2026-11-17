import { useState } from 'react';
import { Printer, MessageCircle } from 'lucide-react';
import type { Customer, DB } from '../core/types';
import { useDB, today } from '../core/store';
import { docTotals, fmtDate, invoiceBalance, money } from '../core/calc';
import { waLink } from '../core/helpers';
import { Modal } from './ui';
import { Letterhead, Bi } from './DocParts';

export interface StatementLine { date: string; ref: string; text: string; debit: number; credit: number; order: number }

/**
 * Customer ledger: invoices (debit) against receipts, advances and credit notes (credit).
 * A positive balance is what the customer owes; negative means they paid in advance.
 */
export function customerLedger(db: DB, customerId: string): StatementLine[] {
  const out: StatementLine[] = [];
  const cust = db.customers.find((c) => c.id === customerId); const ob = Number(cust?.openingBalance) || 0;
  if (ob) out.push({ date: cust?.openingDate || (cust?.createdAt || '').slice(0, 10) || '2000-01-01', ref: 'OPEN', text: 'Opening balance', debit: Math.max(0, ob), credit: Math.max(0, -ob), order: -1 });
  const invoices = db.invoices.filter((i) => i.customerId === customerId);
  const receipts = db.receipts.filter((r) => r.customerId === customerId && !r.voided);
  for (const i of invoices) {
    const tt = docTotals(i);
    out.push({ date: i.date, ref: i.number, text: `Invoice${i.title ? ' — ' + i.title : ''}${tt.discount ? ` (after discount ${tt.discount.toFixed(3)})` : ''}`, debit: tt.total, credit: 0, order: 0 });
    // payments typed straight onto an invoice by older versions (no receipt behind them)
    const viaReceipts = receipts.filter((r) => r.kind === 'payment' && r.invoiceId === i.id).reduce((n, r) => n + r.amount, 0);
    const viaAdvances = i.advanceCredits ? i.advanceCredits.reduce((n, c) => n + c.amount, 0)
      : receipts.filter((r) => r.kind === 'advance' && r.invoiceId === i.id).reduce((n, r) => n + (Number(r.applied) || r.amount), 0);
    const rest = (Number(i.paid) || 0) - viaReceipts - viaAdvances;
    if (rest > 0.0005) out.push({ date: i.date, ref: i.number, text: 'Payment recorded on invoice', debit: 0, credit: rest, order: 1 });
  }
  for (const r of receipts) out.push({ date: r.date, ref: r.number, text: `${r.kind === 'advance' ? 'Advance received' : 'Payment received'} · ${r.method}${r.chequeNo ? ' ' + r.chequeNo : ''}`, debit: 0, credit: r.amount, order: 1 });
  for (const c of db.creditNotes.filter((x) => x.customerId === customerId)) {
    out.push({ date: c.date, ref: c.number, text: `Credit note — ${c.reason}`, debit: 0, credit: c.amount, order: 2 });
    if (c.refund) out.push({ date: c.date, ref: c.number, text: `Refund paid · ${c.method || ''}`, debit: c.refund, credit: 0, order: 3 });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
}
export const ledgerBalance = (lines: StatementLine[]) => lines.reduce((n, l) => n + l.debit - l.credit, 0);

export function CustomerStatement({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const db = useDB(); const s = db.settings;
  const all = customerLedger(db, customer.id);
  const [from, setFrom] = useState(''); const [to, setTo] = useState(today());
  const opening = ledgerBalance(all.filter((l) => from && l.date < from));
  const lines = all.filter((l) => (!from || l.date >= from) && (!to || l.date <= to));
  const rows = lines.map((l, i) => ({ ...l, bal: opening + ledgerBalance(lines.slice(0, i + 1)) }));
  const closing = opening + ledgerBalance(lines);
  const open = db.invoices.filter((i) => i.customerId === customer.id && invoiceBalance(i) > 0.0005);
  const wa = `Dear ${customer.name},\nStatement of account from ${s.businessName} as of ${fmtDate(to || today())}:\n`
    + (open.length ? open.map((i) => `• Invoice ${i.number} (${fmtDate(i.date)}) — due ${money(invoiceBalance(i), s)}`).join('\n') + '\n' : '')
    + `${closing >= 0 ? 'Balance due' : 'Advance with us'}: ${money(Math.abs(closing), s)}\nThank you.`;
  return (
    <Modal open wide title={`Statement — ${customer.name}`} onClose={onClose} footer={<>
      {customer.phone && <a className="btn" target="_blank" rel="noreferrer" href={waLink(customer.phone, wa)}><MessageCircle size={15} />WhatsApp</a>}
      <span className="spacer" /><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print / Save PDF</button></>}>
      <div className="flex wrap no-print" style={{ marginBottom: 12 }}>
        <label className="flex">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
        <label className="flex">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} /></label>
        {from && <button className="btn sm ghost" onClick={() => setFrom('')}>From the start</button>}
      </div>
      <div className="print-area"><div className="doc">
        <Letterhead s={s} title="STATEMENT OF ACCOUNT" meta={<><div><Bi en="Date" inline />: {fmtDate(today())}</div><div>{from ? `${fmtDate(from)} – ` : 'Up to '}{fmtDate(to || today())}</div></>} />
        <div style={{ marginBottom: 14 }}><b>{customer.name}</b><div>{customer.address}</div><div>{customer.phone}</div></div>
        <table style={{ width: '100%' }} className="statement">
          <thead><tr><th>Date</th><th>Ref</th><th>Details</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
          <tbody>
            {from && <tr><td>{fmtDate(from)}</td><td /><td><i>Opening balance</i></td><td /><td /><td className="num">{money(opening, s)}</td></tr>}
            {rows.map((l, i) => <tr key={i}><td>{fmtDate(l.date)}</td><td>{l.ref}</td><td>{l.text}</td><td className="num">{l.debit ? money(l.debit, s) : ''}</td><td className="num">{l.credit ? money(l.credit, s) : ''}</td><td className="num">{money(l.bal, s)}</td></tr>)}
            {!rows.length && <tr><td colSpan={6} className="muted">No entries in this period.</td></tr>}
          </tbody>
        </table>
        <div className="totals" style={{ marginTop: 12 }}><div className="grand"><span>{closing >= 0 ? <Bi en="Balance due" inline /> : 'Advance held'}</span><span>{money(Math.abs(closing), s)}</span></div></div>
        {s.paymentInfo && closing > 0 && <div className="doc-terms" style={{ whiteSpace: 'pre-wrap' }}>{s.paymentInfo}</div>}
      </div></div>
    </Modal>
  );
}
