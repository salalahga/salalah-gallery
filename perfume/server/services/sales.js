// Sales for every channel (POS, website, WhatsApp, Instagram …) in one table with one set of rules.
//   POS checkout: priced, paid, stock deducted and booked in ONE database transaction.
//   Remote orders: created pending → confirmed (stock + revenue) → paid → fulfilled / delivered.
// The server always re-prices the cart; totals sent by a client are ignored.
import { priceCart } from '../../shared/pricing.js';
import { lineTax, allocate } from '../../shared/money.js';
import { id, nextNumber, fail, must, posInt, money, str, today } from '../util.js';
import { post, METHOD_ACCOUNT, partyBalance } from './ledger.js';
import { moveStock } from './inventory.js';
import { getSettings } from './settings.js';
import { can } from '../rbac.js';
import { notify } from './notify.js';

export const CHANNELS = ['pos', 'web', 'whatsapp', 'instagram', 'snapchat', 'facebook', 'phone', 'wholesale'];
const PAY_METHODS = ['cash', 'card', 'bank_transfer', 'wallet', 'payment_link', 'loyalty'];

async function loadCustomer(q, customerId) {
  if (!customerId) return null;
  const c = await q.one('SELECT * FROM customers WHERE id = $1', [customerId]);
  must(c, 404, 'Customer not found');
  return c;
}

/** Price a cart exactly as checkout will. No writes. */
export async function quote(q, input, { user, perms }) {
  const settings = await getSettings(q);
  const channel = input.channel || 'pos';
  must(CHANNELS.includes(channel), 400, 'Unknown sales channel');
  const items = Array.isArray(input.items) ? input.items : [];
  must(items.length, 400, 'The cart is empty');
  must(items.length <= 200, 400, 'Too many lines');
  const ids = [...new Set(items.map((i) => i.variantId))];
  const vs = await q(`SELECT v.*, p.name, p.brand_id, p.category_id, b.name AS brand FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN brands b ON b.id = p.brand_id WHERE v.id = ANY($1)`, [ids]);
  const vmap = new Map(vs.map((v) => [v.id, v]));
  const customer = await loadCustomer(q, input.customerId);
  const lines = items.map((it) => {
    const v = vmap.get(it.variantId);
    must(v && v.active, 404, 'A product in the cart is not available');
    // restricted stock (testers, damaged, recalled batches) cannot be sold on any channel
    if (v.sale_blocked) fail(409, `${v.brand ? v.brand + ' ' : ''}${v.name}${v.label ? ' ' + v.label : ''} cannot be sold: ${v.block_reason || 'blocked'}`, { code: 'sale_blocked', variantId: v.id });
    const qty = posInt(it.qty, 'quantity');
    const list = channel === 'web' ? (v.web_price ?? v.retail_price) : channel === 'wholesale' ? (v.wholesale_price ?? v.retail_price) : v.retail_price;
    let unitPrice = list;
    let overridden = false;
    if (it.unitPrice != null && Number(it.unitPrice) !== list) {
      must(perms && can(perms, 'pos', 'edit'), 403, 'Changing a price needs the POS "edit" permission');
      unitPrice = money(it.unitPrice, 'price');
      must(unitPrice > 0, 400, 'Price must be greater than zero');
      overridden = true;
    }
    return { variantId: v.id, productId: v.product_id, brandId: v.brand_id, categoryId: v.category_id, qty, unitPrice, listPrice: list, overridden, vatRateBp: settings.tax.registered ? v.vat_rate_bp : 0, unitCost: v.avg_cost, name: `${v.brand ? v.brand + ' ' : ''}${v.name}${v.label ? ' ' + v.label : v.size_ml ? ` ${v.size_ml}ml` : ''}`, sku: v.sku };
  });
  const promotions = await q("SELECT * FROM promotions WHERE status = 'approved'");
  let manual = null;
  if (input.manualDiscount && Number(input.manualDiscount.value) > 0) {
    must(perms && can(perms, 'pos', 'edit'), 403, 'A manual discount needs the POS "edit" permission');
    const md = input.manualDiscount;
    must(['percent', 'fixed'].includes(md.type), 400, 'Discount type must be percent or fixed');
    if (md.type === 'percent') must(Number(md.value) <= 100, 400, 'Discount cannot exceed 100 %');
    if (md.type === 'percent' && Number(md.value) > settings.pos.maxManualDiscountPct) must(can(perms, 'pos', 'approve'), 403, `Discounts above ${settings.pos.maxManualDiscountPct}% need approval by a manager`);
    manual = md.type === 'fixed' ? { type: 'fixed', value: money(md.value, 'discount') } : { type: 'percent', value: Number(md.value) };
  }
  const priced = priceCart(lines, {
    promotions, inclusive: settings.tax.pricesIncludeVat, manualDiscount: manual, allowManualWithPromo: !!(perms && can(perms, 'pos', 'approve')),
    ctx: { channel, branchId: input.branchId, customer, couponCode: input.couponCode, isStaff: !!input.staffPurchase, isWholesale: channel === 'wholesale' },
  });
  if (priced.manualBlocked) fail(409, 'A promotion is already applied to this sale. Discounts cannot be combined without manager approval.', { code: 'stacking_blocked' });
  if (input.couponCode && !priced.applied.some((a) => a.couponCode && a.couponCode.toLowerCase() === String(input.couponCode).toLowerCase())) {
    const why = priced.skipped.find((s) => s.reason)?.reason;
    fail(400, `Coupon not valid for this order${why ? ` (${why})` : ''}`);
  }
  let delivery = { net: 0, vat: 0, total: 0 };
  if (input.deliveryFee) delivery = lineTax(money(input.deliveryFee, 'delivery fee'), settings.tax.registered ? settings.tax.defaultRateBp : 0, settings.tax.pricesIncludeVat);
  // stock check for the branch
  const stock = await q('SELECT variant_id, qty FROM stock_levels WHERE branch_id = $1 AND variant_id = ANY($2)', [input.branchId, ids]);
  const smap = new Map(stock.map((s) => [s.variant_id, s.qty]));
  const shortages = [];
  const need = new Map();
  for (const l of priced.lines) need.set(l.variantId, (need.get(l.variantId) || 0) + l.qty);
  for (const [vid, n] of need) if ((smap.get(vid) || 0) < n) shortages.push({ variantId: vid, available: smap.get(vid) || 0, needed: n });
  return { ...priced, delivery, total: priced.total + delivery.total, vat: priced.vat + delivery.vat, net: priced.net + delivery.net, customer, settings, shortages, channel };
}

function validatePayments(payments) {
  must(Array.isArray(payments), 400, 'Payments must be a list');
  return payments.filter((p) => Number(p.amount) > 0).map((p) => {
    must(PAY_METHODS.includes(p.method), 400, `Unknown payment method ${p.method}`);
    const ref = str(p.reference, 80);
    // PCI: never accept anything that looks like a card number
    if (ref && /\b\d{13,19}\b/.test(ref.replace(/[\s-]/g, ''))) fail(400, 'Do not enter card numbers. Record only the terminal approval code or the last 4 digits.');
    return { method: p.method, amount: money(p.amount, 'payment'), reference: ref, provider: str(p.provider, 40) };
  });
}

async function openSessionFor(q, branchId, userId) {
  return q.one(`SELECT rs.* FROM register_sessions rs WHERE rs.branch_id = $1 AND rs.status = 'open' ORDER BY (rs.opened_by = $2) DESC, rs.opened_at DESC LIMIT 1`, [branchId, userId]);
}

/** Stock out + revenue/VAT/COGS journal for a sale. `paidNow` are payments booked in the same entry. */
async function bookSale(q, sale, lines, { paidNow = [], deposits = 0, userId }) {
  let cost = 0;
  for (const l of lines) {
    const v = await q.one('SELECT avg_cost FROM variants WHERE id = $1', [l.variant_id]);
    await moveStock(q, { branchId: sale.branch_id, variantId: l.variant_id, qty: -l.qty, reason: 'sale', unitCost: v.avg_cost, refType: 'sale', refId: sale.id, userId });
    await q('UPDATE sale_lines SET unit_cost = $1 WHERE id = $2', [v.avg_cost, l.id]);
    cost += v.avg_cost * l.qty;
  }
  await q('UPDATE sales SET cost = $1 WHERE id = $2', [cost, sale.id]);
  const linesNet = lines.reduce((a, l) => a + l.net, 0);
  const linesVat = lines.reduce((a, l) => a + l.vat, 0);
  const delivNet = sale.net - linesNet;
  const delivVat = sale.vat - linesVat;
  const paid = paidNow.reduce((a, p) => a + p.amount, 0);
  const due = sale.total - paid - deposits;
  must(due >= 0, 500, 'Payments exceed the sale total');
  const byAcc = {};
  for (const p of paidNow) byAcc[METHOD_ACCOUNT[p.method]] = (byAcc[METHOD_ACCOUNT[p.method]] || 0) + p.amount;
  const party = sale.customer_id ? { partyType: 'customer', partyId: sale.customer_id } : {};
  return post(q, {
    date: today(), memo: `Sale ${sale.number} (${sale.channel})`, sourceType: 'sale', sourceId: sale.id, branchId: sale.branch_id, userId, isTest: sale.is_test,
    lines: [
      ...Object.entries(byAcc).map(([account, debit]) => ({ account, debit })),
      { account: '2200', debit: deposits, ...party },
      { account: '1100', debit: due, ...party },
      { account: '4000', credit: linesNet },
      { account: '4100', credit: delivNet },
      { account: '2100', credit: linesVat + delivVat },
      { account: '5000', debit: cost },
      { account: '1200', credit: cost },
    ],
  });
}

async function insertSale(q, { quoteResult: r, input, user, status, paymentStatus, fulfilment, sessionId, isTest }) {
  const saleId = id('sal_');
  const prefix = input.channel === 'pos' ? 'POS' : 'ORD';
  const number = await nextNumber(q, 'sale_' + prefix, prefix, 6);
  const couponCode = r.applied.find((a) => a.couponCode)?.couponCode || null;
  await q(`INSERT INTO sales (id, number, branch_id, channel, customer_id, cashier_id, salesperson_id, register_session_id, status, payment_status, fulfilment_status,
      currency, prices_include_vat, subtotal, discount, net, vat, total, promotion_ids, coupon_code, shipping_address, delivery_fee, external_ref, notes, is_test, created_by, completed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
  [saleId, number, input.branchId, input.channel, r.customer?.id || null, input.channel === 'pos' ? user.id : null, input.salespersonId || user.employee_id || null, sessionId || null,
    status, paymentStatus, fulfilment, r.settings.currency, r.settings.tax.pricesIncludeVat, r.subtotal + r.delivery.total, r.discount, r.net, r.vat, r.total,
    r.applied.map((a) => a.id), couponCode, str(input.shippingAddress, 500), r.delivery.total, str(input.externalRef, 120), str(input.notes, 500), isTest, user.id, status === 'completed' ? new Date() : null]);
  const lines = [];
  for (const l of r.lines) {
    const lid = id('sl_');
    await q(`INSERT INTO sale_lines (id, sale_id, variant_id, qty, unit_price, list_price, price_overridden, discount, vat_rate_bp, net, vat, total, unit_cost, promotion_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [lid, saleId, l.variantId, l.qty, l.unitPrice, l.listPrice, l.overridden, l.discount, l.vatRateBp, l.net, l.vat, l.total, l.unitCost, l.promotionId]);
    lines.push({ id: lid, variant_id: l.variantId, qty: l.qty, net: l.net, vat: l.vat });
  }
  return { saleId, number, lines };
}

async function afterCompletion(q, sale, { userId }) {
  const settings = await getSettings(q);
  for (const pid of sale.promotion_ids || []) await q('UPDATE promotions SET used_count = used_count + 1 WHERE id = $1', [pid]);
  if (sale.customer_id && settings.loyalty.enabled) {
    const paidCash = (await q.one("SELECT COALESCE(SUM(amount),0) AS a FROM payments WHERE sale_id = $1 AND direction = 'in' AND method <> 'loyalty' AND status = 'captured'", [sale.id])).a;
    const pts = Math.floor((paidCash / 1000) * settings.loyalty.pointsPerOmr);
    if (pts > 0) {
      await q('UPDATE customers SET loyalty_points = loyalty_points + $1, updated_at = now() WHERE id = $2', [pts, sale.customer_id]);
      await q("INSERT INTO loyalty_ledger (customer_id, points, reason, ref_type, ref_id) VALUES ($1,$2,'earned','sale',$3)", [sale.customer_id, pts, sale.id]);
      await q('UPDATE sales SET points_earned = $1 WHERE id = $2', [pts, sale.id]);
    }
    const spend = (await q.one("SELECT COALESCE(SUM(total - refunded),0) AS s FROM sales WHERE customer_id = $1 AND status IN ('completed','confirmed','partially_refunded')", [sale.customer_id])).s;
    if (spend >= settings.loyalty.vipThreshold) await q("UPDATE customers SET vip = true, segment = CASE WHEN segment = 'regular' THEN 'vip' ELSE segment END WHERE id = $1 AND vip = false", [sale.customer_id]);
  }
  // low-stock alerts
  const low = await q(`SELECT v.id, v.sku, p.name, s.qty, v.min_stock FROM sale_lines l JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
    JOIN stock_levels s ON s.variant_id = v.id AND s.branch_id = $2 WHERE l.sale_id = $1 AND s.qty <= v.min_stock`, [sale.id, sale.branch_id]);
  for (const r of low) await notify(q, { kind: 'low_stock', title: `Low stock: ${r.name} (${r.sku})`, body: `${r.qty} left (minimum ${r.min_stock})`, roles: ['owner', 'admin', 'manager'], branchId: sale.branch_id, entity: 'variant', entityId: r.id, dedupeDay: true });
}

async function insertPayment(q, { saleId, customerId, p, sessionId, userId, journalId, direction = 'in', status = 'captured' }) {
  const pid = id('pay_');
  await q(`INSERT INTO payments (id, sale_id, customer_id, direction, method, amount, status, provider, reference, account_id, register_session_id, journal_id, received_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [pid, saleId, customerId || null, direction, p.method, p.amount, status, p.provider || null, p.reference || null, 'acc_' + METHOD_ACCOUNT[p.method], sessionId || null, journalId || null, userId]);
  return pid;
}

/** Loyalty: points needed to pay `amount`, after checking the balance. */
async function redeemPoints(q, customer, amount, saleId) {
  const settings = await getSettings(q);
  must(customer, 400, 'Loyalty points need a customer');
  const pts = Math.ceil(amount / settings.loyalty.pointValueBaisa);
  const c = await q.one('UPDATE customers SET loyalty_points = loyalty_points - $1 WHERE id = $2 AND loyalty_points >= $1 RETURNING loyalty_points', [pts, customer.id]);
  must(c, 409, `Not enough loyalty points (needs ${pts})`);
  await q("INSERT INTO loyalty_ledger (customer_id, points, reason, ref_type, ref_id) VALUES ($1,$2,'redeemed','sale',$3)", [customer.id, -pts, saleId]);
  await q('UPDATE sales SET points_redeemed = points_redeemed + $1 WHERE id = $2', [pts, saleId]);
}

/** POS checkout: one transaction. Payment must be confirmed by the cashier in the UI before this is called. */
export async function checkout(q, input, ctx) {
  const { user } = ctx;
  must(input.confirmed === true, 400, 'The cashier must confirm the sale before payment is recorded');
  const channel = input.channel || 'pos';
  must(channel === 'pos' || channel === 'wholesale', 400, 'Use orders for remote channels');
  const r = await quote(q, { ...input, channel }, ctx);
  if (r.shortages.length && !r.settings.pos.allowNegativeStock) fail(409, 'Not enough stock for some items', { code: 'insufficient_stock', shortages: r.shortages });
  let payments = validatePayments(input.payments || []);
  const hasCash = payments.some((p) => p.method === 'cash');
  let session = null;
  if (hasCash || r.settings.pos.requireOpenTillForCash) {
    session = await openSessionFor(q, input.branchId, user.id);
    if (hasCash) must(session, 409, 'Open the till (register) before taking cash');
  }
  // change: only cash can be over-tendered
  const sum = payments.reduce((a, p) => a + p.amount, 0);
  let change = 0;
  if (sum > r.total) {
    const over = sum - r.total;
    const cash = payments.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0);
    must(over <= cash, 400, 'Card, bank and wallet payments cannot exceed the total');
    change = over;
    let left = over;
    payments = payments.map((p) => { if (p.method !== 'cash' || !left) return p; const cut = Math.min(left, p.amount); left -= cut; return { ...p, amount: p.amount - cut }; }).filter((p) => p.amount > 0);
  }
  const paid = Math.min(sum, r.total);
  const due = r.total - paid;
  if (due > 0) {
    must(r.customer, 400, 'The payment is not complete. Take the full amount, or select a customer with a credit account.');
    must(r.customer.credit_enabled, 400, `${r.customer.name} has no credit account. Take the full amount.`);
    const bal = await partyBalance(q, '1100', 'customer', r.customer.id);
    must(bal + due <= r.customer.credit_limit, 409, 'This sale would exceed the customer\'s credit limit');
  }
  const isTest = !!input.isTest;
  const { saleId, number, lines } = await insertSale(q, { quoteResult: r, input: { ...input, channel }, user, status: 'completed', paymentStatus: due ? (paid ? 'partial' : 'unpaid') : 'paid', fulfilment: 'fulfilled', sessionId: session?.id, isTest });
  await q('UPDATE sales SET paid = $1 WHERE id = $2', [paid, saleId]);
  for (const p of payments.filter((x) => x.method === 'loyalty')) await redeemPoints(q, r.customer, p.amount, saleId);
  const sale = await q.one('SELECT * FROM sales WHERE id = $1', [saleId]);
  const journalId = await bookSale(q, sale, lines, { paidNow: payments, userId: user.id });
  for (const p of payments) await insertPayment(q, { saleId, customerId: sale.customer_id, p, sessionId: session?.id, userId: user.id, journalId });
  await afterCompletion(q, sale, { userId: user.id });
  return { id: saleId, number, total: r.total, paid, due, change, applied: r.applied };
}

// ---------- remote orders (website, WhatsApp, Instagram, phone) ----------
export async function createOrder(q, input, ctx) {
  must(input.channel && input.channel !== 'pos', 400, 'Choose the order channel');
  const r = await quote(q, input, ctx);
  const { saleId, number } = await insertSale(q, { quoteResult: r, input, user: ctx.user, status: 'pending', paymentStatus: 'unpaid', fulfilment: 'unfulfilled', isTest: !!input.isTest });
  await notify(q, { kind: 'new_order', title: `New ${input.channel} order ${number}`, body: `${r.customer?.name || 'Guest'} — total ${(r.total / 1000).toFixed(3)} OMR`, roles: ['owner', 'admin', 'manager'], branchId: input.branchId, entity: 'sale', entityId: saleId });
  return { id: saleId, number, total: r.total, shortages: r.shortages };
}

export async function confirmOrder(q, saleId, { user }) {
  const sale = await q.one('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]);
  must(sale, 404, 'Order not found');
  must(sale.status === 'pending', 409, `Order is ${sale.status}`);
  const lines = await q('SELECT * FROM sale_lines WHERE sale_id = $1', [saleId]);
  const deposits = sale.paid;
  await q("UPDATE sales SET status = 'confirmed' WHERE id = $1", [saleId]);
  await bookSale(q, { ...sale, status: 'confirmed' }, lines, { deposits, userId: user.id });
  await afterCompletion(q, sale, { userId: user.id });
  if (sale.paid >= sale.total && sale.fulfilment_status === 'delivered') await q("UPDATE sales SET status = 'completed', completed_at = now() WHERE id = $1", [saleId]);
  return { ok: true };
}

/** Payment against an order or an outstanding POS balance (credit sale). */
export async function recordPayment(q, saleId, input, { user }) {
  const sale = await q.one('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]);
  must(sale, 404, 'Sale not found');
  must(!['cancelled', 'refunded'].includes(sale.status), 409, `Sale is ${sale.status}`);
  const [p] = validatePayments([input]);
  must(p, 400, 'Enter an amount');
  must(p.method !== 'loyalty' || sale.customer_id, 400, 'Loyalty needs a customer');
  const due = sale.total - sale.refunded - sale.paid;
  must(due > 0, 409, 'Nothing is owed on this sale');
  must(p.amount <= due, 400, `Amount is more than what is owed (${(due / 1000).toFixed(3)})`);
  let session = null;
  if (p.method === 'cash') { session = await openSessionFor(q, sale.branch_id, user.id); must(session, 409, 'Open the till before taking cash'); }
  if (p.method === 'loyalty') await redeemPoints(q, await loadCustomer(q, sale.customer_id), p.amount, saleId);
  const party = sale.customer_id ? { partyType: 'customer', partyId: sale.customer_id } : {};
  const status = input.status === 'pending' ? 'pending' : 'captured';
  let journalId = null;
  if (status === 'captured') {
    journalId = await post(q, {
      memo: `Payment for ${sale.number}`, sourceType: 'payment', sourceId: saleId, branchId: sale.branch_id, userId: user.id, isTest: sale.is_test,
      lines: [{ account: METHOD_ACCOUNT[p.method], debit: p.amount }, { account: sale.status === 'pending' ? '2200' : '1100', credit: p.amount, ...party }],
    });
    const paid = sale.paid + p.amount;
    const full = paid >= sale.total - sale.refunded;
    await q(`UPDATE sales SET paid = $1, payment_status = $2,
      status = CASE WHEN $3 AND status = 'confirmed' AND fulfilment_status IN ('delivered','fulfilled') THEN 'completed' ELSE status END,
      completed_at = CASE WHEN $3 AND status = 'confirmed' AND fulfilment_status IN ('delivered','fulfilled') THEN now() ELSE completed_at END WHERE id = $4`,
    [paid, full ? 'paid' : 'partial', full, saleId]);
  }
  const pid = await insertPayment(q, { saleId, customerId: sale.customer_id, p, sessionId: session?.id, userId: user.id, journalId, status });
  return { id: pid, status };
}

export async function setFulfilment(q, saleId, status, { user, tracking, courier }) {
  must(['packed', 'shipped', 'delivered', 'returned'].includes(status), 400, 'Unknown fulfilment status');
  const sale = await q.one('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]);
  must(sale, 404, 'Order not found');
  must(sale.status === 'confirmed' || (sale.status === 'completed' && status === 'returned'), 409, 'Confirm the order first');
  await q('UPDATE sales SET fulfilment_status = $1 WHERE id = $2', [status, saleId]);
  const d = await q.one('SELECT id FROM deliveries WHERE sale_id = $1', [saleId]);
  const dStatus = { packed: 'packed', shipped: 'out_for_delivery', delivered: 'delivered', returned: 'returned' }[status];
  if (d) await q('UPDATE deliveries SET status = $1, tracking_no = COALESCE($2, tracking_no), courier = COALESCE($3, courier), updated_at = now() WHERE id = $4', [dStatus, tracking || null, courier || null, d.id]);
  else await q('INSERT INTO deliveries (id, sale_id, address, status, tracking_no, courier) VALUES ($1,$2,$3,$4,$5,$6)', [id('dlv_'), saleId, sale.shipping_address, dStatus, tracking || null, courier || null]);
  if (status === 'delivered' && sale.paid >= sale.total - sale.refunded) await q("UPDATE sales SET status = 'completed', completed_at = now() WHERE id = $1", [saleId]);
  void user;
  return { ok: true };
}

// ---------- refunds, returns & cancellations ----------
/**
 * Refund some or all units. Needs POS "approve" (the route checks it, or runs it from an approved request).
 * Money first clears anything the customer still owes on the sale; the rest goes back by `method`.
 */
export async function refund(q, saleId, input, { user }) {
  const sale = await q.one('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]);
  must(sale, 404, 'Sale not found');
  must(['completed', 'confirmed', 'partially_refunded'].includes(sale.status), 409, `A ${sale.status} sale cannot be refunded`);
  const reason = str(input.reason, 300);
  must(reason, 400, 'Give a reason for the refund');
  const restock = input.restock !== false;
  const all = await q('SELECT * FROM sale_lines WHERE sale_id = $1 ORDER BY id', [saleId]);
  const req = input.all ? all.map((l) => ({ saleLineId: l.id, qty: l.qty - l.refunded_qty })).filter((x) => x.qty > 0) : (input.lines || []);
  must(req.length, 400, 'Choose what to refund');
  const parts = [];
  for (const r of req) {
    const l = all.find((x) => x.id === r.saleLineId);
    must(l, 404, 'Sale line not found');
    const qty = posInt(r.qty, 'quantity');
    must(qty <= l.qty - l.refunded_qty, 400, 'Cannot refund more than was sold');
    // last units take whatever is left so totals always tie out exactly
    const done = l.refunded_qty;
    const prevAmt = done ? Math.round((l.total * done) / l.qty) : 0;
    const prevVat = done ? Math.round((l.vat * done) / l.qty) : 0;
    const amount = qty === l.qty - done ? l.total - prevAmt : Math.round((l.total * (done + qty)) / l.qty) - prevAmt;
    const vat = qty === l.qty - done ? l.vat - prevVat : Math.round((l.vat * (done + qty)) / l.qty) - prevVat;
    parts.push({ l, qty, amount, vat });
  }
  const amount = parts.reduce((a, p) => a + p.amount, 0);
  const vat = parts.reduce((a, p) => a + p.vat, 0);
  const net = amount - vat;
  const owed = Math.max(0, sale.total - sale.refunded - sale.paid);
  const toAR = Math.min(owed, amount);
  const payout = amount - toAR;
  const method = payout ? input.method || 'cash' : 'credit';
  if (payout) must(['cash', 'card', 'bank_transfer', 'wallet', 'payment_link', 'loyalty'].includes(method), 400, 'Choose how the money is returned');
  let session = null;
  if (payout && method === 'cash') { session = await openSessionFor(q, sale.branch_id, user.id); must(session, 409, 'Open the till before giving cash back'); }
  const refundId = id('ref_');
  const number = await nextNumber(q, 'refund', 'RFD');
  let cost = 0;
  if (restock) for (const p of parts) {
    await moveStock(q, { branchId: sale.branch_id, variantId: p.l.variant_id, qty: p.qty, reason: 'sale_return', unitCost: p.l.unit_cost, refType: 'refund', refId: refundId, userId: user.id });
    cost += p.l.unit_cost * p.qty;
  }
  const party = sale.customer_id ? { partyType: 'customer', partyId: sale.customer_id } : {};
  const journalId = await post(q, {
    memo: `Refund ${number} for ${sale.number}: ${reason}`, sourceType: 'refund', sourceId: refundId, branchId: sale.branch_id, userId: user.id, isTest: sale.is_test,
    lines: [
      { account: '4000', debit: net }, { account: '2100', debit: vat },
      { account: '1100', credit: toAR, ...party },
      { account: METHOD_ACCOUNT[method] || '1000', credit: payout },
      { account: '1200', debit: cost }, { account: '5000', credit: cost },
    ],
  });
  await q(`INSERT INTO refunds (id, number, sale_id, reason, amount, vat, restock, method, approved_by, created_by, journal_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [refundId, number, saleId, reason, amount, vat, restock, method, input.approvedBy || user.id, input.requestedBy || user.id, journalId]);
  for (const p of parts) {
    await q('INSERT INTO refund_lines (refund_id, sale_line_id, qty, amount, vat) VALUES ($1,$2,$3,$4,$5)', [refundId, p.l.id, p.qty, p.amount, p.vat]);
    await q('UPDATE sale_lines SET refunded_qty = refunded_qty + $1 WHERE id = $2', [p.qty, p.l.id]);
  }
  if (payout) {
    if (method === 'loyalty' && sale.customer_id) {
      const s = await getSettings(q);
      const pts = Math.floor(payout / s.loyalty.pointValueBaisa);
      await q('UPDATE customers SET loyalty_points = loyalty_points + $1 WHERE id = $2', [pts, sale.customer_id]);
      await q("INSERT INTO loyalty_ledger (customer_id, points, reason, ref_type, ref_id) VALUES ($1,$2,'refund','refund',$3)", [sale.customer_id, pts, refundId]);
    }
    await insertPayment(q, { saleId, customerId: sale.customer_id, p: { method, amount: payout, reference: number }, sessionId: session?.id, userId: user.id, journalId, direction: 'out', status: 'refunded' });
  }
  // take back loyalty points earned on the refunded part
  if (sale.points_earned && sale.customer_id) {
    const back = Math.min(sale.points_earned, Math.floor((sale.points_earned * amount) / sale.total));
    if (back > 0) {
      await q('UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points - $1) WHERE id = $2', [back, sale.customer_id]);
      await q("INSERT INTO loyalty_ledger (customer_id, points, reason, ref_type, ref_id) VALUES ($1,$2,'refund','refund',$3)", [sale.customer_id, -back, refundId]);
    }
  }
  const refunded = sale.refunded + amount;
  const fully = refunded >= sale.total;
  const newStatus = input.cancel ? 'cancelled' : fully ? 'refunded' : 'partially_refunded';
  await q(`UPDATE sales SET refunded = $1, status = $2, payment_status = CASE WHEN $3 THEN 'refunded' ELSE payment_status END,
    paid = paid - $4 WHERE id = $5`, [refunded, newStatus, fully, Math.min(payout, sale.paid), saleId]);
  return { id: refundId, number, amount, vat, payout, toAR, method };
}

/** Cancel: a pending order is simply cancelled; a booked sale is fully refunded and marked cancelled. */
export async function cancelSale(q, saleId, input, ctx) {
  const sale = await q.one('SELECT * FROM sales WHERE id = $1', [saleId]);
  must(sale, 404, 'Sale not found');
  if (sale.status === 'pending') {
    must(sale.paid === 0, 409, 'This order has payments. Refund them first.');
    await q("UPDATE sales SET status = 'cancelled', notes = COALESCE(notes,'') || $1 WHERE id = $2", [`\nCancelled: ${str(input.reason, 200) || ''}`, saleId]);
    return { ok: true };
  }
  return refund(q, saleId, { ...input, all: true, cancel: true }, ctx);
}

// ---------- till / register ----------
export async function openRegister(q, { registerId, openingFloat, user }) {
  const reg = await q.one('SELECT * FROM registers WHERE id = $1 AND active', [registerId]);
  must(reg, 404, 'Register not found');
  const open = await q.one("SELECT id FROM register_sessions WHERE register_id = $1 AND status = 'open'", [registerId]);
  must(!open, 409, 'This register is already open');
  const sid = id('rs_');
  await q('INSERT INTO register_sessions (id, register_id, branch_id, opened_by, opening_float) VALUES ($1,$2,$3,$4,$5)', [sid, registerId, reg.branch_id, user.id, money(openingFloat || 0, 'opening float')]);
  return { id: sid };
}

export async function cashMovement(q, { sessionId, kind, amount, reason, account, user }) {
  const s = await q.one("SELECT * FROM register_sessions WHERE id = $1 AND status = 'open'", [sessionId]);
  must(s, 404, 'Open till session not found');
  must(['pay_in', 'pay_out'].includes(kind), 400, 'Choose pay in or pay out');
  const amt = money(amount);
  must(amt > 0, 400, 'Enter an amount');
  must(str(reason), 400, 'Give a reason');
  const other = account || (kind === 'pay_out' ? '6900' : '3000');
  const jid = await post(q, {
    memo: `Till ${kind.replace('_', ' ')}: ${reason}`, sourceType: 'cash_movement', sourceId: sessionId, branchId: s.branch_id, userId: user.id,
    lines: kind === 'pay_in' ? [{ account: '1000', debit: amt }, { account: other, credit: amt }] : [{ account: other, debit: amt }, { account: '1000', credit: amt }],
  });
  await q('INSERT INTO cash_movements (id, session_id, kind, amount, reason, account_id, journal_id, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id('cm_'), sessionId, kind, amt, str(reason), 'acc_' + other.replace('acc_', ''), jid, user.id]);
  return { ok: true };
}

export async function registerSummary(q, sessionId) {
  const s = await q.one('SELECT rs.*, r.name AS register FROM register_sessions rs JOIN registers r ON r.id = rs.register_id WHERE rs.id = $1', [sessionId]);
  must(s, 404, 'Till session not found');
  const pays = await q(`SELECT method, direction, COALESCE(SUM(amount),0) AS amount, COUNT(*)::int AS n FROM payments WHERE register_session_id = $1 AND status IN ('captured','refunded') GROUP BY method, direction`, [sessionId]);
  const moves = await q('SELECT kind, COALESCE(SUM(amount),0) AS amount FROM cash_movements WHERE session_id = $1 GROUP BY kind', [sessionId]);
  const get = (m, d) => pays.find((p) => p.method === m && p.direction === d)?.amount || 0;
  const mv = (k) => moves.find((m) => m.kind === k)?.amount || 0;
  const expected = s.opening_float + get('cash', 'in') - get('cash', 'out') + mv('pay_in') - mv('pay_out');
  const salesN = (await q.one("SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0) AS t FROM sales WHERE register_session_id = $1 AND status <> 'cancelled'", [sessionId]));
  return { session: s, byMethod: pays, payIn: mv('pay_in'), payOut: mv('pay_out'), expectedCash: expected, sales: salesN.n, salesTotal: salesN.t };
}

export async function closeRegister(q, { sessionId, countedCash, note, user }) {
  const sum = await registerSummary(q, sessionId);
  must(sum.session.status === 'open', 409, 'This till is already closed');
  const counted = money(countedCash, 'counted cash');
  const variance = counted - sum.expectedCash;
  if (variance) await post(q, {
    memo: `Till close variance (${sum.session.register})`, sourceType: 'till_close', sourceId: sessionId, branchId: sum.session.branch_id, userId: user.id,
    lines: variance > 0 ? [{ account: '1000', debit: variance }, { account: '5200', credit: variance }] : [{ account: '5200', debit: -variance }, { account: '1000', credit: -variance }],
  });
  await q(`UPDATE register_sessions SET status = 'closed', closed_by = $1, closed_at = now(), expected_cash = $2, counted_cash = $3, variance = $4, close_note = $5 WHERE id = $6`,
    [user.id, sum.expectedCash, counted, variance, str(note), sessionId]);
  if (Math.abs(variance) >= 1000) await notify(q, { kind: 'till_variance', title: `Till ${sum.session.register} closed ${variance > 0 ? 'over' : 'short'} by ${(Math.abs(variance) / 1000).toFixed(3)} OMR`, roles: ['owner', 'admin', 'manager'], branchId: sum.session.branch_id });
  return { ...sum, countedCash: counted, variance };
}

export const _test = { allocate };
