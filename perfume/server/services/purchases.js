// Purchasing: purchase order → approval → goods receipt (stock + supplier bill) → payment; returns to supplier.
import { allocate, decimalsOf, roundHalf } from '../../shared/money.js';
import { id, nextNumber, fail, must, posInt, money, str, isoDate, today } from '../util.js';
import { post, partyBalance } from './ledger.js';
import { receiveIntoStock, moveStock } from './inventory.js';
import { getSettings } from './settings.js';
import { notify } from './notify.js';

/** Convert an amount in a foreign currency's minor units to baisa at `fx` (OMR per 1 unit). */
export function toBase(amountMinor, currency, fx) {
  if (!currency || currency === 'OMR') return amountMinor;
  return roundHalf((amountMinor / 10 ** decimalsOf(currency)) * Number(fx) * 1000);
}

function totals(lines) {
  let subtotal = 0, vat = 0;
  for (const l of lines) { const s = l.qty * l.unit_cost; subtotal += s; vat += Math.round((s * l.vat_rate_bp) / 10000); }
  return { subtotal, vat, total: subtotal + vat };
}

export async function savePO(q, input, { user }) {
  const supplier = await q.one('SELECT * FROM suppliers WHERE id = $1 AND active', [input.supplierId]);
  must(supplier, 404, 'Supplier not found');
  must(Array.isArray(input.lines) && input.lines.length, 400, 'Add at least one product');
  const currency = input.currency || supplier.currency || 'OMR';
  const settings = await getSettings(q);
  const fx = currency === 'OMR' ? 1 : Number(input.fxRate || settings.fx[currency]);
  must(fx > 0, 400, `Enter the exchange rate for ${currency}`);
  let po = input.id ? await q.one('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [input.id]) : null;
  if (po) must(po.status === 'draft', 409, 'Only a draft purchase order can be changed');
  const lines = input.lines.map((l) => ({ variant_id: l.variantId, qty: posInt(l.qty, 'quantity'), unit_cost: money(l.unitCost, 'unit cost'), vat_rate_bp: l.vatRateBp == null ? settings.tax.defaultRateBp : posIntOrZero(l.vatRateBp) }));
  const t = totals(lines);
  if (!po) {
    const poId = id('po_');
    const number = await nextNumber(q, 'po', 'PO');
    await q(`INSERT INTO purchase_orders (id, number, supplier_id, branch_id, expected_date, currency, fx_rate, subtotal, vat, total, notes, created_by, is_test)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [poId, number, supplier.id, input.branchId, isoDate(input.expectedDate), currency, fx, t.subtotal, t.vat, t.total, str(input.notes), user.id, !!input.isTest]);
    po = { id: poId, number };
  } else {
    await q('DELETE FROM po_lines WHERE po_id = $1', [po.id]); // draft lines only — no stock or money attached yet
    await q('UPDATE purchase_orders SET supplier_id=$1, branch_id=$2, expected_date=$3, currency=$4, fx_rate=$5, subtotal=$6, vat=$7, total=$8, notes=$9 WHERE id=$10',
      [supplier.id, input.branchId, isoDate(input.expectedDate), currency, fx, t.subtotal, t.vat, t.total, str(input.notes), po.id]);
  }
  for (const l of lines) await q('INSERT INTO po_lines (id, po_id, variant_id, qty, unit_cost, vat_rate_bp) VALUES ($1,$2,$3,$4,$5,$6)', [id('pol_'), po.id, l.variant_id, l.qty, l.unit_cost, l.vat_rate_bp]);
  return { id: po.id, number: po.number, ...t };
}
const posIntOrZero = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 0) fail(400, 'VAT rate must be a whole number of basis points'); return n; };

export async function submitPO(q, poId, { user, perms }) {
  const po = await q.one('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [poId]);
  must(po, 404, 'Purchase order not found');
  must(po.status === 'draft', 409, `Purchase order is ${po.status}`);
  const s = await getSettings(q);
  const auto = s.purchases.autoApproveBelow > 0 && toBase(po.total, po.currency, po.fx_rate) < s.purchases.autoApproveBelow && perms.purchases?.has('approve');
  await q(`UPDATE purchase_orders SET status = $1, approved_by = $2, approved_at = $3 WHERE id = $4`, [auto ? 'approved' : 'pending_approval', auto ? user.id : null, auto ? new Date() : null, poId]);
  if (!auto) await notify(q, { kind: 'po_approval', title: `Purchase order ${po.number} needs approval`, roles: ['owner', 'admin'], entity: 'purchase_order', entityId: poId });
  return { status: auto ? 'approved' : 'pending_approval' };
}

export async function decidePO(q, poId, { approve, reason, user }) {
  const po = await q.one('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [poId]);
  must(po, 404, 'Purchase order not found');
  must(po.status === 'pending_approval', 409, `Purchase order is ${po.status}`);
  const s = await getSettings(q);
  if (s.purchases.approverMustDiffer && user.role !== 'owner') must(po.created_by !== user.id, 403, 'Someone other than the creator must approve this purchase order');
  await q('UPDATE purchase_orders SET status = $1, approved_by = $2, approved_at = now(), notes = COALESCE(notes, \'\') || $3 WHERE id = $4',
    [approve ? 'approved' : 'draft', user.id, approve ? '' : `\nReturned for changes: ${str(reason) || ''}`, poId]);
  return { status: approve ? 'approved' : 'draft' };
}

export async function cancelPO(q, poId, { reason }) {
  const po = await q.one('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [poId]);
  must(po, 404, 'Purchase order not found');
  must(['draft', 'pending_approval', 'approved'].includes(po.status), 409, 'Goods were already received; use a purchase return instead');
  await q("UPDATE purchase_orders SET status = 'cancelled', notes = COALESCE(notes,'') || $1 WHERE id = $2", [`\nCancelled: ${str(reason) || ''}`, poId]);
  return { ok: true };
}

/**
 * Receive goods against an approved PO. Landed costs (freight, customs, clearing) are spread over the received
 * lines by value and included in the stock cost. Creates the supplier bill and its journal entry.
 */
export async function receivePO(q, poId, input, { user }) {
  const po = await q.one('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [poId]);
  must(po, 404, 'Purchase order not found');
  must(['approved', 'partially_received'].includes(po.status), 409, po.status === 'pending_approval' ? 'This purchase order is waiting for approval' : `Purchase order is ${po.status}`);
  const poLines = await q('SELECT * FROM po_lines WHERE po_id = $1', [poId]);
  const recv = (input.lines || []).filter((l) => Number(l.qty) > 0).map((l) => {
    const pl = poLines.find((x) => x.id === l.poLineId);
    must(pl, 404, 'Purchase order line not found');
    const qty = posInt(l.qty, 'quantity');
    must(pl.received_qty + qty <= pl.qty, 400, 'Cannot receive more than was ordered');
    return { pl, qty, batchNo: str(l.batchNo, 60), expiryDate: isoDate(l.expiryDate, 'expiry date') };
  });
  must(recv.length, 400, 'Enter the quantities received');
  const landed = money(input.landedCost || 0, 'landed cost');
  const goodsBase = recv.map((r) => toBase(r.qty * r.pl.unit_cost, po.currency, po.fx_rate));
  const vatBase = recv.map((r, i) => Math.round((goodsBase[i] * r.pl.vat_rate_bp) / 10000));
  const landedParts = allocate(landed, goodsBase);
  const billId = id('bill_');
  const number = await nextNumber(q, 'bill', 'BILL');
  const goods = goodsBase.reduce((a, b) => a + b, 0);
  const vat = vatBase.reduce((a, b) => a + b, 0);
  const s = await q.one('SELECT payment_terms_days FROM suppliers WHERE id = $1', [po.supplier_id]);
  const billDate = isoDate(input.billDate) || today();
  const due = new Date(Date.parse(billDate) + s.payment_terms_days * 86400e3).toISOString().slice(0, 10);
  await q(`INSERT INTO supplier_bills (id, number, supplier_id, po_id, branch_id, supplier_ref, bill_date, due_date, goods, landed_cost, vat, total, created_by, is_test)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [billId, number, po.supplier_id, poId, po.branch_id, str(input.supplierRef, 80), billDate, due, goods, landed, vat, goods + vat, user.id, po.is_test]);
  for (let i = 0; i < recv.length; i++) {
    const r = recv[i];
    const lineValue = goodsBase[i] + landedParts[i];
    const unit = Math.round(lineValue / r.qty);
    const { batchId } = await receiveIntoStock(q, { branchId: po.branch_id, variantId: r.pl.variant_id, qty: r.qty, unitCost: unit, refType: 'supplier_bill', refId: billId, userId: user.id, batchNo: r.batchNo, expiryDate: r.expiryDate });
    await q('INSERT INTO supplier_bill_lines (bill_id, variant_id, batch_id, qty, unit_cost, landed_unit_cost, vat) VALUES ($1,$2,$3,$4,$5,$6,$7)', [billId, r.pl.variant_id, batchId, r.qty, Math.round(goodsBase[i] / r.qty), unit, vatBase[i]]);
    await q('UPDATE po_lines SET received_qty = received_qty + $1 WHERE id = $2', [r.qty, r.pl.id]);
  }
  const jid = await post(q, {
    date: billDate, memo: `Goods received ${po.number} — bill ${number}`, sourceType: 'supplier_bill', sourceId: billId, branchId: po.branch_id, userId: user.id, isTest: po.is_test,
    currency: po.currency, fxRate: po.fx_rate,
    lines: [
      { account: '1200', debit: goods + landed }, { account: '1300', debit: vat },
      { account: '2000', credit: goods + vat, partyType: 'supplier', partyId: po.supplier_id },
      { account: '2150', credit: landed },
    ],
  });
  await q('UPDATE supplier_bills SET journal_id = $1 WHERE id = $2', [jid, billId]);
  const left = await q.one('SELECT COALESCE(SUM(qty - received_qty),0) AS n FROM po_lines WHERE po_id = $1', [poId]);
  await q('UPDATE purchase_orders SET status = $1 WHERE id = $2', [left.n > 0 ? 'partially_received' : 'received', poId]);
  return { billId, number, goods, landed, vat, total: goods + vat };
}

export async function paySupplier(q, input, { user }) {
  const supplier = await q.one('SELECT * FROM suppliers WHERE id = $1', [input.supplierId]);
  must(supplier, 404, 'Supplier not found');
  const amount = money(input.amount);
  must(amount > 0, 400, 'Enter an amount');
  const from = String(input.paidFrom || '1020');
  const acct = await q.one("SELECT * FROM accounts WHERE id = $1 AND subtype IN ('cash','bank')", ['acc_' + from.replace('acc_', '')]);
  must(acct, 400, 'Pay from a cash or bank account');
  let bill = null;
  if (input.billId) {
    bill = await q.one('SELECT * FROM supplier_bills WHERE id = $1 FOR UPDATE', [input.billId]);
    must(bill && bill.supplier_id === supplier.id, 404, 'Bill not found for this supplier');
    must(amount <= bill.total - bill.paid - bill.returned, 400, 'Amount is more than what is owed on this bill');
  } else {
    const owed = -(await partyBalance(q, '2000', 'supplier', supplier.id));
    must(amount <= owed, 400, 'Amount is more than what is owed to this supplier');
  }
  const pid = id('spay_');
  const number = await nextNumber(q, 'spay', 'PV');
  const date = isoDate(input.date) || today();
  const jid = await post(q, {
    date, memo: `Payment ${number} to ${supplier.name}`, sourceType: 'supplier_payment', sourceId: pid, userId: user.id,
    lines: [{ account: '2000', debit: amount, partyType: 'supplier', partyId: supplier.id }, { account: acct.id, credit: amount }],
  });
  await q('INSERT INTO supplier_payments (id, number, supplier_id, bill_id, amount, paid_from, method, reference, date, journal_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [pid, number, supplier.id, bill?.id || null, amount, acct.id, str(input.method, 30), str(input.reference, 80), date, jid, user.id]);
  // apply to the given bill, else oldest open bills first
  let left = amount;
  const bills = bill ? [bill] : await q("SELECT * FROM supplier_bills WHERE supplier_id = $1 AND status IN ('open','partially_paid') ORDER BY due_date, created_at", [supplier.id]);
  for (const b of bills) {
    if (!left) break;
    const open = b.total - b.paid - b.returned;
    const take = Math.min(open, left);
    if (take <= 0) continue;
    left -= take;
    await q("UPDATE supplier_bills SET paid = paid + $1, status = CASE WHEN paid + $1 + returned >= total THEN 'paid' ELSE 'partially_paid' END WHERE id = $2", [take, b.id]);
  }
  return { id: pid, number };
}

export async function returnToSupplier(q, input, { user }) {
  const supplier = await q.one('SELECT * FROM suppliers WHERE id = $1', [input.supplierId]);
  must(supplier, 404, 'Supplier not found');
  must(Array.isArray(input.lines) && input.lines.length, 400, 'Add the products being returned');
  const settings = await getSettings(q);
  const rid = id('pret_');
  const number = await nextNumber(q, 'pret', 'PRN');
  let amount = 0, vat = 0;
  await q('INSERT INTO purchase_returns (id, number, supplier_id, bill_id, branch_id, amount, vat, reason, created_by) VALUES ($1,$2,$3,$4,$5,0,0,$6,$7)', [rid, number, supplier.id, input.billId || null, input.branchId, str(input.reason), user.id]);
  for (const l of input.lines) {
    const qty = posInt(l.qty, 'quantity');
    const v = await q.one('SELECT avg_cost, vat_rate_bp FROM variants WHERE id = $1', [l.variantId]);
    must(v, 404, 'Product not found');
    const unit = l.unitCost != null ? money(l.unitCost) : v.avg_cost;
    await moveStock(q, { branchId: input.branchId, variantId: l.variantId, qty: -qty, reason: 'purchase_return', unitCost: unit, refType: 'purchase_return', refId: rid, userId: user.id });
    await q('INSERT INTO purchase_return_lines (return_id, variant_id, qty, unit_cost) VALUES ($1,$2,$3,$4)', [rid, l.variantId, qty, unit]);
    amount += qty * unit;
    vat += Math.round((qty * unit * (settings.tax.registered ? settings.tax.defaultRateBp : 0)) / 10000);
  }
  const jid = await post(q, {
    memo: `Return ${number} to ${supplier.name}`, sourceType: 'purchase_return', sourceId: rid, branchId: input.branchId, userId: user.id,
    lines: [{ account: '2000', debit: amount + vat, partyType: 'supplier', partyId: supplier.id }, { account: '1200', credit: amount }, { account: '1300', credit: vat }],
  });
  await q('UPDATE purchase_returns SET amount = $1, vat = $2, journal_id = $3 WHERE id = $4', [amount, vat, jid, rid]);
  if (input.billId) await q("UPDATE supplier_bills SET returned = returned + $1, status = CASE WHEN paid + returned + $1 >= total THEN 'paid' ELSE status END WHERE id = $2", [amount + vat, input.billId]);
  return { id: rid, number, amount, vat };
}

export async function supplierSummary(q) {
  return q(`SELECT s.id, s.code, s.name, s.phone, s.email, s.country, s.currency, s.payment_terms_days, s.active, s.is_test,
      COALESCE((SELECT SUM(credit - debit) FROM journal_lines WHERE account_id = 'acc_2000' AND party_type = 'supplier' AND party_id = s.id),0) AS balance,
      COALESCE((SELECT SUM(total - paid - returned) FROM supplier_bills b WHERE b.supplier_id = s.id AND b.status IN ('open','partially_paid') AND b.due_date < CURRENT_DATE),0) AS overdue,
      (SELECT COUNT(*)::int FROM purchase_orders p WHERE p.supplier_id = s.id AND p.status <> 'cancelled') AS orders,
      COALESCE((SELECT SUM(goods + landed_cost) FROM supplier_bills b WHERE b.supplier_id = s.id),0) AS purchased,
      COALESCE((SELECT SUM(amount) FROM purchase_returns r WHERE r.supplier_id = s.id),0) AS returned,
      (SELECT ROUND(100.0 * AVG(CASE WHEN b.bill_date <= COALESCE(p.expected_date, b.bill_date) THEN 1 ELSE 0 END)) FROM supplier_bills b JOIN purchase_orders p ON p.id = b.po_id WHERE b.supplier_id = s.id) AS on_time_pct
    FROM suppliers s ORDER BY s.name`);
}
