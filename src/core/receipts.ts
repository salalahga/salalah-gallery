import { store, nextNumber, today } from './store';
import type { Receipt } from './types';

/**
 * Issue a receipt: saves it, posts the income to Accounts and, for an invoice payment, raises the
 * invoice's paid amount. Every money-in path goes through here so nothing is counted twice.
 */
export function issueReceipt(r: Omit<Receipt, 'id' | 'createdAt' | 'number'> & { number?: string }): Receipt {
  const db = store.get();
  const customer = db.customers.find((c) => c.id === r.customerId);
  const rec = store.upsert('receipts', { ...r, number: r.number || nextNumber('RV', db.receipts.map((x) => x.number)), date: r.date || today() }) as Receipt;
  if (r.kind === 'payment' && r.invoiceId) {
    const inv = db.invoices.find((i) => i.id === r.invoiceId);
    if (inv) store.upsert('invoices', { ...inv, paid: (Number(inv.paid) || 0) + Number(r.amount) });
  }
  const inv = db.invoices.find((i) => i.id === r.invoiceId);
  store.upsert('txns', {
    date: rec.date, kind: 'income', category: r.kind === 'advance' ? 'Advance' : 'Job Payment', amount: Number(r.amount), method: r.method,
    description: `${r.kind === 'advance' ? 'Advance' : 'Payment'} ${inv ? inv.number + ' ' : ''}— ${customer?.name || 'Customer'}`, ref: rec.number,
  });
  return rec;
}
