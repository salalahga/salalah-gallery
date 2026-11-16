/**
 * Money corrections that must keep Accounts, invoices, receipts and stock in step.
 * Every function either does the whole correction or refuses with a reason (returned as a string),
 * so nothing is left half-reversed.
 */
import { store, nextNumber, today } from './store';
import { docTotals, invoiceBalance, returnAmount } from './calc';
import type { Advance, Cheque, CreditNote, Customer, Invoice, Receipt, Sale, SaleReturn, Txn } from './types';
import { uid } from './store';

const db = () => store.get();
const round = (n: number) => +n.toFixed(3);

/** Income/expense entries created by a document (receipts and sales post with ref = their number). */
const postedBy = (ref: string) => db().txns.filter((t) => t.ref === ref);

/**
 * Cancel a receipt: its income leaves Accounts, the invoice it paid goes back to owing, and an
 * advance that was credited to invoices is taken back off them.
 */
export function voidReceipt(r: Receipt, reason: string): string | null {
  if (r.voided) return 'This receipt is already void';
  const d = db();
  for (const t of postedBy(r.number)) store.remove('txns', t.id);
  if (r.kind === 'payment' && r.invoiceId) {
    const inv = d.invoices.find((i) => i.id === r.invoiceId);
    if (inv) store.upsert('invoices', { ...inv, paid: round(Math.max(0, (Number(inv.paid) || 0) - r.amount)) });
  }
  if (r.kind === 'advance') {
    let left = Number(r.applied) || 0;
    for (const inv of d.invoices) {
      const c = (inv.advanceCredits || []).filter((x) => x.receiptId === r.id);
      if (!c.length) continue;
      const amt = c.reduce((n, x) => n + x.amount, 0); left -= amt;
      store.upsert('invoices', { ...inv, paid: round(Math.max(0, (Number(inv.paid) || 0) - amt)), advanceCredits: inv.advanceCredits!.filter((x) => x.receiptId !== r.id) });
    }
    // older data without advanceCredits: the last invoice it was credited to
    if (left > 0.0005 && r.invoiceId) {
      const inv = store.get().invoices.find((i) => i.id === r.invoiceId);
      if (inv) store.upsert('invoices', { ...inv, paid: round(Math.max(0, (Number(inv.paid) || 0) - left)) });
    }
  }
  store.upsert('receipts', { ...r, voided: true, voidedAt: today(), voidReason: reason, applied: 0 });
  for (const c of d.cheques.filter((x) => x.receiptId === r.id && ['pending', 'deposited'].includes(x.status))) store.upsert('cheques', { ...c, status: 'cancelled', statusDate: today() });
  return null;
}

/** Why an invoice cannot be deleted yet, or null. */
export function invoiceDeleteBlock(inv: Invoice): string | null {
  const d = db();
  const pays = d.receipts.filter((r) => r.kind === 'payment' && r.invoiceId === inv.id && !r.voided);
  if (pays.length) return `Payments are recorded on this invoice (${pays.map((r) => r.number).join(', ')}). Void those receipts first in Receipts & Delivery.`;
  if (d.creditNotes.some((c) => c.invoiceId === inv.id)) return 'A credit note was issued against this invoice. It can no longer be deleted.';
  const credited = (inv.advanceCredits || []).reduce((n, c) => n + c.amount, 0);
  if ((Number(inv.paid) || 0) - credited > 0.0005 && !d.receipts.some((r) => r.invoiceId === inv.id)) return 'This invoice has an amount paid. Set the payment right with a receipt before deleting it.';
  return null;
}
/** Delete an invoice and give back what it used: advances become open again, additional work becomes un-invoiced. */
export function deleteInvoice(inv: Invoice): string | null {
  const block = invoiceDeleteBlock(inv); if (block) return block;
  const d = db();
  for (const c of inv.advanceCredits || []) {
    const r = d.receipts.find((x) => x.id === c.receiptId);
    if (r) store.upsert('receipts', { ...r, applied: round(Math.max(0, (Number(r.applied) || 0) - c.amount)), invoiceId: r.invoiceId === inv.id ? undefined : r.invoiceId });
  }
  if (!inv.advanceCredits) {
    // older data: advances that point at this invoice
    for (const r of d.receipts.filter((x) => x.kind === 'advance' && x.invoiceId === inv.id && !x.voided)) store.upsert('receipts', { ...r, applied: 0, invoiceId: undefined });
  }
  const job = d.jobs.find((j) => j.id === inv.jobId);
  if (job && inv.extraIds?.length) store.upsert('jobs', { ...job, extras: (job.extras || []).map((e) => (inv.extraIds!.includes(e.id) ? { ...e, invoiced: false } : e)) });
  store.remove('invoices', inv.id);
  return null;
}

/** Remove a salary advance and the expense it posted. A recovered advance belongs to a payslip and stays. */
export function deleteAdvance(a: Advance): string | null {
  if (a.recovered) return 'This advance was already recovered in a salary payment and cannot be deleted.';
  const name = db().staff.find((x) => x.id === a.staffId)?.name;
  const t = db().txns.find((x) => x.id === a.txnId) || db().txns.find((x) => x.kind === 'expense' && x.date === a.date && x.amount === a.amount && x.description === `Salary advance — ${name}`);
  if (t) store.remove('txns', t.id);
  store.remove('advances', a.id);
  return null;
}

/** If an Accounts entry was posted by a document, say where it must be corrected instead. */
export function txnSource(t: Txn): string | null {
  const d = db();
  if (t.chatId && d.expenseChat.some((m) => m.id === t.chatId && m.txnId === t.id)) return 'This expense came from the Expense chat. Open the project chat and press Undo on that bill.';
  if (t.ref) {
    const r = d.receipts.find((x) => x.number === t.ref && !x.voided);
    if (r) return `This entry comes from receipt ${r.number}. To cancel it, void the receipt in Receipts & Delivery — the invoice is corrected with it.`;
    const sale = d.sales.find((x) => x.number === t.ref);
    if (sale && t.kind === 'income') return `This entry comes from sale ${sale.number}. Use Return in Sales → History instead.`;
  }
  if (d.advances.some((a) => a.txnId === t.id && !a.recovered)) return 'This entry is a salary advance. Delete the advance in Payroll → Advances instead.';
  if (d.cheques.some((c) => c.txnId === t.id && ['pending', 'deposited'].includes(c.status))) return 'This payment was made by a cheque that is still being tracked. Mark the cheque bounced or cancelled in Receipts & Delivery → Cheques.';
  return null;
}

/** Records that still point at a customer (deleting the customer would orphan them). */
export function customerLinks(c: Customer) {
  const d = db(); const n = (xs: { customerId?: string }[]) => xs.filter((x) => x.customerId === c.id).length;
  const parts: [string, number][] = [['projects', n(d.jobs)], ['quotations', n(d.quotations)], ['invoices', n(d.invoices)], ['receipts', n(d.receipts)], ['sales', n(d.sales)], ['service calls', n(d.services)], ['site measurements', n(d.measurements)]];
  return parts.filter(([, k]) => k > 0).map(([w, k]) => `${k} ${w}`);
}

/**
 * Credit note: lowers what the customer owes. If it is more than the open balance, the difference
 * was already paid and is refunded (posted as a Refund expense).
 */
export function issueCreditNote(inv: Invoice, amount: number, reason: string, method = 'Cash'): CreditNote | string {
  const total = docTotals(inv).total; const already = Number(inv.credited) || 0;
  if (!(amount > 0)) return 'Enter the credit amount';
  if (amount > total - already + 0.0005) return `The most you can credit is ${round(total - already)}`;
  if (!reason.trim()) return 'Enter the reason for the credit note';
  const d = db(); const cust = d.customers.find((c) => c.id === inv.customerId);
  const balance = Math.max(0, invoiceBalance(inv));
  const refund = round(Math.max(0, amount - balance));
  const cn = store.upsert('creditNotes', { number: nextNumber('CN', d.creditNotes.map((x) => x.number)), date: today(), invoiceId: inv.id, customerId: inv.customerId, amount: round(amount), reason: reason.trim(), refund, method: refund ? method : undefined }) as CreditNote;
  store.upsert('invoices', { ...inv, credited: round(already + amount) });
  if (refund) store.upsert('txns', { date: today(), kind: 'expense', category: 'Refund', amount: refund, method, description: `Refund ${cn.number} on invoice ${inv.number} — ${cust?.name || 'Customer'}`, ref: cn.number, jobId: inv.jobId });
  return cn;
}

/** Return items from a POS sale: stock goes back and the refund is posted. */
export function returnSale(x: Sale, lines: { itemId: string; qty: number }[], method: string, reason?: string): string | null {
  const done = (id: string) => (x.returns || []).reduce((n, r) => n + (r.lines.find((l) => l.itemId === id)?.qty || 0), 0);
  const clean = lines.filter((l) => l.qty > 0);
  if (!clean.length) return 'Choose how many of each item come back';
  for (const l of clean) { const sold = x.lines.find((s) => s.itemId === l.itemId)?.qty || 0; if (l.qty > sold - done(l.itemId)) return 'You cannot return more than was sold'; }
  const amount = round(returnAmount(x, clean));
  for (const l of clean) { const it = db().items.find((i) => i.id === l.itemId); if (it) store.upsert('items', { ...it, qty: it.qty + l.qty }); }
  const ret: SaleReturn = { id: uid(), date: today(), lines: clean, amount, method, reason };
  store.upsert('sales', { ...x, returns: [...(x.returns || []), ret] });
  store.upsert('txns', { date: today(), kind: 'expense', category: 'Sales Return', amount, method, description: `Return on ${x.number}${reason ? ' — ' + reason : ''}`, ref: `${x.number}-R${(x.returns || []).length + 1}` });
  return null;
}

/** Move a cheque on. A bounced received cheque voids its receipt; a bounced issued cheque reverses the payment. */
export function setChequeStatus(c: Cheque, status: Cheque['status']): string | null {
  if (status === 'bounced' || status === 'cancelled') {
    const d = db();
    if (c.receiptId) { const r = d.receipts.find((x) => x.id === c.receiptId); if (r && !r.voided) voidReceipt(r, `Cheque ${c.chequeNo} ${status}`); }
    if (c.txnId) {
      const t = d.txns.find((x) => x.id === c.txnId); if (t) store.remove('txns', t.id);
      const p = d.purchases.find((x) => x.id === c.purchaseId);
      if (p) store.upsert('purchases', { ...p, paid: round(Math.max(0, (Number(p.paid) || 0) - c.amount)) });
    }
  }
  store.upsert('cheques', { ...store.get().cheques.find((x) => x.id === c.id)!, status, statusDate: today() });
  return null;
}

