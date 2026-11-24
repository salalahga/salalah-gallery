// End-to-end tests over HTTP against a fresh in-memory database loaded with the demo (test) data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { setDataKey, totp } from '../server/security.js';

let server, base, db;
setDataKey(crypto.randomBytes(32).toString('hex'));

function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b = {}) => call('PUT', p, b) };
}
const owner = client();

before(async () => {
  db = await openDb({ dataDir: ':memory:' });
  const app = await createApp(db);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  const r = await owner.post('/auth/setup', { name: 'Owner', username: 'owner', password: 'Owner1234', demo: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});
after(async () => { server?.close(); await db?.close(); });

async function login(username, password = 'Demo1234', app = 'admin') {
  const c = client();
  const r = await c.post('/auth/login', { username, password, app });
  return { c, r };
}
const ledgerTotals = () => db.one('SELECT SUM(debit)::bigint AS d, SUM(credit)::bigint AS c FROM journal_lines');
const stockOf = async (variantId, branchId = 'br_main') => (await db.one('SELECT qty FROM stock_levels WHERE variant_id = $1 AND branch_id = $2', [variantId, branchId]))?.qty ?? 0;
const SAUVAGE_100 = 'var_demo_1_100';
const KHAMRAH = 'var_demo_10_100';

test('books balance after demo seeding; balance sheet balances; stock ledger matches stock levels', async () => {
  const t = await ledgerTotals();
  assert.equal(t.d, t.c);
  const bs = await owner.get('/reports/balance-sheet');
  assert.equal(bs.status, 200);
  assert.equal(bs.data.balanced, true, `assets ${bs.data.totalAssets} vs L+E ${bs.data.totalLiabilities + bs.data.totalEquity}`);
  const tb = await owner.get('/reports/trial-balance');
  assert.equal(tb.data.totalDebit, tb.data.totalCredit);
  const mism = await db.query('SELECT s.variant_id, s.branch_id, s.qty, COALESCE(m.q,0) AS moved FROM stock_levels s LEFT JOIN (SELECT branch_id, variant_id, SUM(qty) AS q FROM stock_movements GROUP BY 1,2) m ON m.branch_id = s.branch_id AND m.variant_id = s.variant_id WHERE s.qty <> COALESCE(m.q,0)');
  assert.deepEqual(mism, []);
  // inventory GL ≈ stock × average cost (moving-average rounding only)
  const gl = (await db.one("SELECT SUM(debit - credit)::bigint AS b FROM journal_lines WHERE account_id = 'acc_1200'")).b;
  const sub = (await db.one('SELECT SUM(s.qty * v.avg_cost)::bigint AS b FROM stock_levels s JOIN variants v ON v.id = s.variant_id')).b;
  assert.ok(Math.abs(gl - sub) < 100, `inventory GL ${gl} vs subledger ${sub}`);
  const n = await db.one('SELECT COUNT(*)::int AS n FROM sales WHERE NOT is_test');
  assert.equal(n.n, 0, 'demo sales are flagged as test data');
});

test('P&L separates revenue, gross profit and net profit', async () => {
  const from = '2000-01-01';
  const pl = (await owner.get(`/reports/pl?from=${from}`)).data;
  assert.equal(pl.grossProfit, pl.revenue - pl.cogs);
  assert.equal(pl.netProfit, pl.grossProfit + pl.otherIncome - pl.operatingExpenses);
  assert.ok(pl.revenue > 0 && pl.operatingExpenses > 0);
});

test('cashier POS sale: price is set by the server, stock deducted, change given, journal balanced', async () => {
  const { c, r } = await login('cashier');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const before = await stockOf(SAUVAGE_100);
  const q = await c.post('/pos/quote', { branchId: 'br_main', items: [{ variantId: SAUVAGE_100, qty: 2 }] });
  assert.equal(q.status, 200, JSON.stringify(q.data));
  assert.equal(q.data.total, 112000);
  assert.equal(q.data.vat, Math.round((112000 * 500) / 10500));
  assert.equal(q.data.lines[0].unitCost, undefined, 'cashier does not see cost');
  // unconfirmed checkout is refused
  assert.equal((await c.post('/pos/checkout', { branchId: 'br_main', items: [{ variantId: SAUVAGE_100, qty: 2 }], payments: [{ method: 'cash', amount: 120000 }] })).status, 400);
  const co = await c.post('/pos/checkout', { branchId: 'br_main', confirmed: true, items: [{ variantId: SAUVAGE_100, qty: 2, unitPrice: 56000 }], payments: [{ method: 'cash', amount: 120000 }], total: 1 });
  assert.equal(co.status, 200, JSON.stringify(co.data));
  assert.equal(co.data.change, 8000);
  assert.equal(await stockOf(SAUVAGE_100), before - 2);
  const t = await ledgerTotals(); assert.equal(t.d, t.c);
  const sale = (await owner.get(`/sales/${co.data.id}`)).data;
  assert.equal(sale.paid, 112000);
  assert.equal(sale.payments[0].amount, 112000);
  assert.ok(sale.cost > 0);
});

test('cashier cannot change prices or give manual discounts; card numbers are rejected', async () => {
  const { c } = await login('cashier');
  assert.equal((await c.post('/pos/quote', { branchId: 'br_main', items: [{ variantId: SAUVAGE_100, qty: 1, unitPrice: 1000 }] })).status, 403);
  assert.equal((await c.post('/pos/quote', { branchId: 'br_main', items: [{ variantId: SAUVAGE_100, qty: 1 }], manualDiscount: { type: 'percent', value: 10 } })).status, 403);
  const r = await c.post('/pos/checkout', { branchId: 'br_main', confirmed: true, items: [{ variantId: SAUVAGE_100, qty: 1 }], payments: [{ method: 'card', amount: 56000, reference: '4111 1111 1111 1111' }] });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /card numbers/);
  // cashier is limited to her branch
  assert.equal((await c.post('/pos/quote', { branchId: 'br_mct', items: [{ variantId: KHAMRAH, qty: 1 }] })).status, 403);
});

test('insufficient stock rolls back the whole sale', async () => {
  const before = await stockOf(SAUVAGE_100);
  const salesBefore = (await db.one('SELECT COUNT(*)::int AS n FROM sales')).n;
  const r = await owner.post('/pos/checkout', { branchId: 'br_main', confirmed: true, items: [{ variantId: KHAMRAH, qty: 1 }, { variantId: SAUVAGE_100, qty: 999 }], payments: [{ method: 'card', amount: 99999999 }] });
  assert.equal(r.status, 409);
  assert.equal(await stockOf(SAUVAGE_100), before);
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM sales')).n, salesBefore);
});

test('promotion applied automatically (buy 2 get 1); manual discount cannot be stacked without approval', async () => {
  const q = await owner.post('/pos/quote', { branchId: 'br_main', items: [{ variantId: KHAMRAH, qty: 3 }] });
  assert.equal(q.data.discount, 12000);
  assert.deepEqual(q.data.applied.map((a) => a.id), ['prm_demo_b2g1']);
  // a cashier the owner allowed to edit prices (but not approve) tries to add a manual discount
  await owner.post('/users', { name: 'Senior cashier', username: 'senior', password: 'Senior123', role: 'cashier', branchId: 'br_main' });
  const u = await db.one("SELECT id FROM users WHERE username = 'senior'");
  await db.query('UPDATE users SET must_change_password = false WHERE id = $1', [u.id]);
  assert.equal((await owner.put(`/users/${u.id}/permissions`, { grants: { pos: { levels: ['view', 'create', 'edit'] } } })).status, 200);
  const { c } = await login('senior', 'Senior123');
  const r = await c.post('/pos/quote', { branchId: 'br_main', items: [{ variantId: KHAMRAH, qty: 3 }], manualDiscount: { type: 'percent', value: 5 } });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'stacking_blocked');
  const ok = await c.post('/pos/quote', { branchId: 'br_main', items: [{ variantId: SAUVAGE_100, qty: 1 }], manualDiscount: { type: 'percent', value: 5 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.discount, 2800);
  assert.equal((await c.post('/pos/quote', { branchId: 'br_main', items: [{ variantId: SAUVAGE_100, qty: 1 }], manualDiscount: { type: 'percent', value: 30 } })).status, 403);
});

test('refund by a cashier waits for approval; approval restores stock and reverses the money', async () => {
  const { c } = await login('cashier');
  const co = await c.post('/pos/checkout', { branchId: 'br_main', confirmed: true, items: [{ variantId: SAUVAGE_100, qty: 1 }], payments: [{ method: 'card', amount: 56000, reference: 'APPR77' }] });
  assert.equal(co.status, 200, JSON.stringify(co.data));
  const stock = await stockOf(SAUVAGE_100);
  const sale = (await c.get(`/sales/${co.data.id}`)).data;
  const req = await c.post(`/sales/${co.data.id}/refund`, { reason: 'Wrong size', method: 'card', lines: [{ saleLineId: sale.lines[0].id, qty: 1 }] });
  assert.equal(req.data.status, 'pending_approval');
  assert.equal(await stockOf(SAUVAGE_100), stock, 'nothing happens before approval');
  const pending = (await owner.get('/approvals?status=pending')).data;
  const a = pending.find((x) => x.entity_id === co.data.id);
  const ap = await owner.post(`/approvals/${a.id}/approve`);
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  assert.equal(await stockOf(SAUVAGE_100), stock + 1);
  const after = (await owner.get(`/sales/${co.data.id}`)).data;
  assert.equal(after.status, 'refunded');
  assert.equal(after.refunded, 56000);
  const t = await ledgerTotals(); assert.equal(t.d, t.c);
  // cannot refund twice
  assert.equal((await owner.post(`/sales/${co.data.id}/refund`, { reason: 'again', all: true })).status, 409);
});

test('business manager: separate app, owner-controlled permissions, no restricted finance, audited', async () => {
  const wrongApp = await login('manager', 'Demo1234', 'admin');
  assert.equal(wrongApp.r.status, 403);
  const { c, r } = await login('manager', 'Demo1234', 'manager');
  assert.equal(r.status, 200);
  const dash = await c.get('/dashboard');
  assert.equal(dash.status, 200);
  assert.equal(dash.data.finance, undefined, 'no profit or bank figures by default');
  assert.equal((await c.get('/reports/pl')).status, 403);
  assert.equal((await c.get('/accounts')).status, 403);
  assert.equal((await c.put('/settings/business', { name: 'X' })).status, 403);
  assert.equal((await c.post('/users', { name: 'x', username: 'x', password: 'Abcdefg1', role: 'admin' })).status, 403);
  const mgr = await db.one("SELECT id FROM users WHERE username = 'manager'");
  assert.equal((await c.put(`/users/${mgr.id}/permissions`, { grants: { finance: { levels: ['view'] } } })).status, 403, 'manager cannot grant himself');
  const owner2 = (await db.one("SELECT id FROM users WHERE role = 'owner'")).id;
  assert.equal((await c.post(`/users/${owner2}/reset-password`, { password: 'Hacked123' })).status, 403);
  const ask = await c.post('/assistant', { question: 'What is my net profit this month?' });
  assert.equal(ask.data.denied, true);
  // owner grants finance view and promotions create
  assert.equal((await owner.put(`/users/${mgr.id}/permissions`, { grants: { finance: { levels: ['view'] }, promotions: { levels: ['view', 'create'] }, users: { levels: ['view', 'manage'] } } })).status, 200);
  assert.equal((await c.get('/reports/pl')).status, 200);
  assert.ok((await c.get('/dashboard')).data.finance);
  assert.equal((await c.get('/users')).status, 403, 'role ceiling: managers never get user management');
  const p = await c.post('/promotions', { name: 'Mgr offer', type: 'percent', value: 500 });
  assert.equal(p.status, 200);
  assert.equal((await c.post(`/promotions/${p.data.id}/approve`)).status, 403);
  const log = await owner.get('/audit?app=manager');
  assert.ok(log.data.some((x) => x.user_role === 'manager' && x.action.startsWith('POST /promotions')));
  assert.ok(log.data.some((x) => x.action === 'denied'));
});

test('purchase approval workflow, landed cost, supplier balance and payment', async () => {
  const { c } = await login('accountant');
  const po = await c.post('/purchase-orders', { supplierId: 'sup_demo_1', branchId: 'br_main', lines: [{ variantId: KHAMRAH, qty: 10, unitCost: 6000 }] });
  assert.equal(po.status, 200, JSON.stringify(po.data));
  assert.equal(po.data.total, 63000);
  await c.post(`/purchase-orders/${po.data.id}/submit`);
  assert.equal((await c.post(`/purchase-orders/${po.data.id}/approve`)).status, 403);
  const pol = (await owner.get(`/purchase-orders/${po.data.id}`)).data.lines[0];
  assert.equal((await owner.post(`/purchase-orders/${po.data.id}/receive`, { lines: [{ poLineId: pol.id, qty: 10 }] })).status, 409, 'not approved yet');
  assert.equal((await owner.post(`/purchase-orders/${po.data.id}/approve`)).status, 200);
  const stock = await stockOf(KHAMRAH);
  const rc = await owner.post(`/purchase-orders/${po.data.id}/receive`, { lines: [{ poLineId: pol.id, qty: 10, batchNo: 'KH-01' }], landedCost: 5000 });
  assert.equal(rc.status, 200, JSON.stringify(rc.data));
  assert.equal(await stockOf(KHAMRAH), stock + 10);
  assert.equal(rc.data.total, 63000);
  const sup = (await owner.get('/suppliers/sup_demo_1')).data;
  assert.equal(sup.balance, 63000);
  assert.equal((await owner.post('/supplier-payments', { supplierId: 'sup_demo_1', amount: 70000 })).status, 400, 'cannot overpay');
  assert.equal((await owner.post('/supplier-payments', { supplierId: 'sup_demo_1', amount: 63000, paidFrom: '1020' })).status, 200);
  assert.equal((await owner.get('/suppliers/sup_demo_1')).data.balance, 0);
  const t = await ledgerTotals(); assert.equal(t.d, t.c);
});

test('online order with coupon: pending → confirmed → paid → delivered', async () => {
  const o = await owner.post('/orders', { channel: 'web', branchId: 'br_main', couponCode: 'welcome10', items: [{ variantId: SAUVAGE_100, qty: 1 }], deliveryFee: 2000 });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  assert.equal(o.data.total, 56000 - 5600 + 2000);
  const stock = await stockOf(SAUVAGE_100);
  assert.equal((await owner.post(`/orders/${o.data.id}/confirm`)).status, 200);
  assert.equal(await stockOf(SAUVAGE_100), stock - 1);
  assert.equal((await owner.post(`/sales/${o.data.id}/payments`, { method: 'payment_link', amount: o.data.total, reference: 'L1' })).status, 200);
  assert.equal((await owner.post(`/orders/${o.data.id}/fulfil`, { status: 'delivered' })).status, 200);
  assert.equal((await owner.get(`/sales/${o.data.id}`)).data.status, 'completed');
  assert.equal((await owner.post('/pos/quote', { branchId: 'br_main', couponCode: 'NOPE', items: [{ variantId: SAUVAGE_100, qty: 1 }] })).status, 400);
});

test('till close books the cash variance', async () => {
  const regs = (await owner.get('/registers')).data;
  const main = regs.find((r) => r.id === 'reg_main_1');
  const sum = (await owner.get(`/register-sessions/${main.session_id}`)).data;
  const close = await owner.post(`/register-sessions/${main.session_id}/close`, { countedCash: sum.expectedCash - 500 });
  assert.equal(close.status, 200);
  assert.equal(close.data.variance, -500);
  const cash = await owner.post('/pos/checkout', { branchId: 'br_main', confirmed: true, items: [{ variantId: KHAMRAH, qty: 1 }], payments: [{ method: 'cash', amount: 12000 }] });
  assert.equal(cash.status, 409, 'cash needs an open till');
});

test('expenses post and reverse; financial records are never deleted', async () => {
  const e = await owner.post('/expenses', { account: '6200', amount: 25000, vat: 1250, paidFrom: '1000', description: 'Internet' });
  assert.equal(e.status, 200);
  assert.equal((await owner.post(`/expenses/${e.data.id}/reverse`, { reason: 'Duplicate' })).status, 200);
  assert.equal((await owner.post(`/expenses/${e.data.id}/reverse`, { reason: 'again' })).status, 409);
  const n = await db.one("SELECT COUNT(*)::int AS n FROM journal_entries WHERE source_type = 'expense' AND source_id = $1", [e.data.id]);
  assert.equal(n.n, 2);
});

test('assistant answers from live data and matches the reports', async () => {
  const a = await owner.post('/assistant', { question: 'What is my net profit this month?' });
  const pl = (await owner.get('/reports/pl')).data;
  assert.equal(a.data.data.netProfit, pl.netProfit);
  assert.match(a.data.answer, /Net profit/);
  const b = await owner.post('/assistant', { question: 'Which perfume sells the most?' });
  assert.ok(b.data.data.length > 0);
  const u = await owner.post('/assistant', { question: 'what is the weather' });
  assert.equal(u.data.unknown, true);
});

test('two-factor authentication', async () => {
  const { c } = await login('accountant');
  const begin = await c.post('/auth/2fa/begin');
  assert.equal((await c.post('/auth/2fa/enable', { code: '000000' })).status, 400);
  assert.equal((await c.post('/auth/2fa/enable', { code: totp(begin.data.secret) })).status, 200);
  const again = client();
  const r = await again.post('/auth/login', { username: 'accountant', password: 'Demo1234' });
  assert.equal(r.data.mfaRequired, true);
  assert.equal((await again.get('/dashboard')).status, 401);
  assert.equal((await again.post('/auth/mfa', { code: '123456' })).status, 401);
  assert.equal((await again.post('/auth/mfa', { code: totp(begin.data.secret) })).status, 200);
  assert.equal((await again.get('/dashboard')).status, 200);
  const enc = await db.one("SELECT totp_secret FROM users WHERE username = 'accountant'");
  assert.match(enc.totp_secret, /^enc:v1:/, 'secret encrypted at rest');
});

test('exports need export permission; staff self-service sees only own data', async () => {
  const csv = await owner.get('/export/sales?from=2000-01-01');
  assert.equal(csv.status, 200);
  assert.match(String(csv.data), /number,date,channel/);
  const { c } = await login('cashier');
  assert.equal((await c.get('/export/sales')).status, 403);
  const { c: s } = await login('staff', 'Demo1234', 'staff');
  assert.equal((await s.post('/me/check-in')).status, 200);
  assert.equal((await s.post('/me/leave', { fromDate: '2026-12-01', toDate: '2026-12-03', reason: 'Family' })).status, 200);
  const prof = (await s.get('/me/profile')).data;
  assert.equal(prof.employee.name, 'Yousuf Al-Harthy');
  assert.equal((await s.get('/employees')).status, 403);
  assert.equal((await s.get('/reports/pl')).status, 403);
});

test('login lockout after repeated wrong passwords', async () => {
  for (let i = 0; i < 5; i++) await client().post('/auth/login', { username: 'staff', password: 'wrong' });
  const r = await client().post('/auth/login', { username: 'staff', password: 'Demo1234' });
  assert.equal(r.status, 429);
});

test('new products get a scannable in-store barcode automatically', async () => {
  const r = await owner.post('/products', { name: 'Test Musk', variants: [{ sku: 'TST-MUSK-50', sizeMl: 50, retailPrice: 9000 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const v = await db.one('SELECT barcode FROM variants WHERE id = $1', [r.data.variants[0]]);
  assert.match(v.barcode, /^29\d{11}$/);
  const look = await owner.get('/barcodes/lookup?code=' + v.barcode);
  assert.equal(look.data.sku, 'TST-MUSK-50');
  const nx = await owner.post('/barcodes/next');
  assert.notEqual(nx.data.barcode, v.barcode);
});

test('barcodes: symbology checks, duplicates, auto SKU, and edit permission', async () => {
  // manual EAN-13 with a wrong check digit is refused; a valid manufacturer barcode is accepted
  const bad = await owner.post('/products', { name: 'Bad Code', variants: [{ sku: 'BAD-1', barcode: '6291041500214', symbology: 'ean13', retailPrice: 1000 }] });
  assert.equal(bad.status, 400); assert.match(bad.data.error, /check digit/);
  const ok = await owner.post('/products', { name: 'Musk Al Tahara', variants: [{ sizeMl: 30, barcode: '6291041500213', retailPrice: 3000 }, { sizeMl: 10, retailPrice: 1500 }, { sizeMl: 5, barcode: 'MUSK-5ML', symbology: 'code39', retailPrice: 900 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const vs = await db.query('SELECT id, sku, barcode, symbology, size_ml FROM variants WHERE product_id = $1 ORDER BY size_ml DESC', [ok.data.id]);
  assert.deepEqual(vs.map((v) => v.symbology), ['ean13', 'ean13', 'code39']);
  assert.equal(new Set(vs.map((v) => v.barcode)).size, 3, 'every size has its own barcode');
  assert.equal(new Set(vs.map((v) => v.sku)).size, 3, 'every size has its own SKU');
  assert.match(vs[0].sku, /^MUSKALTA-30/);
  // duplicate barcode refused
  const dup = await owner.post('/products', { name: 'Copy', variants: [{ sku: 'COPY-1', barcode: '6291041500213', retailPrice: 1000 }] });
  assert.equal(dup.status, 409); assert.match(dup.data.error, /already used/);
  // a manager allowed to edit products still cannot change an existing barcode
  const mgr = await db.one("SELECT id FROM users WHERE username = 'manager'");
  await owner.put(`/users/${mgr.id}/permissions`, { grants: { inventory: { levels: ['view', 'edit'] } } });
  const { c } = await login('manager', 'Demo1234', 'manager');
  const body = { name: 'Musk Al Tahara', variants: vs.map((v) => ({ id: v.id, sku: v.sku, barcode: v.barcode, sizeMl: v.size_ml, retailPrice: 3000 })) };
  assert.equal((await c.put(`/products/${ok.data.id}`, body)).status, 200, 'same barcodes: allowed');
  body.variants[0].barcode = '2999999999995';
  const denied = await c.put(`/products/${ok.data.id}`, body);
  assert.equal(denied.status, 403); assert.match(denied.data.error, /manage/);
  assert.equal((await owner.put(`/products/${ok.data.id}`, body)).status, 200, 'owner may change it');
});

test('barcodes: lookup, blocked stock cannot be sold, printers, templates and print history with reprint control', async () => {
  const look = await owner.get('/barcodes/lookup?code=' + (await db.one("SELECT barcode FROM variants WHERE id = 'var_demo_10_100'")).barcode);
  assert.equal(look.data.sku, 'LAT-KHAMRA-100');
  assert.ok(look.data.stock.length > 0);
  assert.equal(look.data.sellable, true);
  assert.equal((await owner.post('/variants/var_demo_10_100/block', { blocked: true })).status, 400, 'reason required');
  await owner.post('/variants/var_demo_10_100/block', { blocked: true, reason: 'Tester bottles' });
  const q = await owner.post('/pos/quote', { branchId: 'br_main', items: [{ variantId: 'var_demo_10_100', qty: 1 }] });
  assert.equal(q.status, 409); assert.equal(q.data.code, 'sale_blocked');
  await owner.post('/variants/var_demo_10_100/block', { blocked: false });

  // printers: only "manage" may configure; a new printer is never reported as connected
  const { c: cash } = await login('cashier');
  assert.equal((await cash.post('/printers', { name: 'X', connection: 'browser', language: 'driver' })).status, 403);
  assert.equal((await owner.post('/printers', { name: 'LAN', connection: 'network', language: 'driver', host: '192.168.1.50' })).status, 400);
  const pr = await owner.post('/printers', { name: 'Xprinter counter', model: 'Xprinter XP-365B', connection: 'network', language: 'tspl', host: '192.168.1.50', port: 9100, labelWidthMm: 38, labelHeightMm: 25 });
  assert.equal(pr.status, 200);
  let list = (await owner.get('/printers')).data;
  assert.equal(list[0].is_default, true, 'first printer becomes default');
  assert.equal(list[0].last_test_ok, null, 'not verified until tested');
  await owner.post(`/printers/${pr.data.id}/test-result`, { method: 'agent_probe', ok: true, detail: 'reachable' });
  assert.equal((await owner.get('/printers')).data[0].last_test_ok, true);
  await owner.put(`/printers/${pr.data.id}`, { name: 'Xprinter counter', connection: 'network', language: 'tspl', host: '192.168.1.60', port: 9100 });
  assert.equal((await owner.get('/printers')).data[0].last_test_ok, null, 'new address → must be tested again');

  // templates
  const tpls = (await owner.get('/label-templates')).data;
  assert.ok(tpls.some((t) => t.id === 'tpl_small') && tpls.some((t) => t.id === 'tpl_large'));
  const t = await owner.post('/label-templates', { ...tpls.find((x) => x.id === 'tpl_small'), name: 'Shelf price 40x30', widthMm: 40, heightMm: 30 });
  assert.equal(t.status, 200);
  assert.equal((await owner.put('/label-templates/tpl_small', { ...tpls[0], name: 'x' })).status, 400, 'built-ins are read-only');

  // print 50 labels for one perfume in one action, then reprint
  const cashierId = (await db.one("SELECT id FROM users WHERE username = 'cashier'")).id;
  assert.equal((await cash.post('/print-jobs', { items: [{ variantId: 'var_demo_10_100', copies: 1 }] })).status, 403, 'staff print only when authorised');
  await owner.put(`/users/${cashierId}/permissions`, { grants: { barcodes: { levels: ['view', 'create'] } } });
  const job = await cash.post('/print-jobs', { printerId: pr.data.id, templateId: 'tpl_small', source: 'product', items: [{ variantId: 'var_demo_10_100', copies: 50 }] });
  assert.equal(job.status, 200, JSON.stringify(job.data));
  await cash.post(`/print-jobs/${job.data.id}/result`, { status: 'sent', detail: 'agent confirmed 4096 bytes' });
  assert.equal((await cash.post(`/print-jobs/${job.data.id}/result`, { status: 'failed' })).status, 409, 'result recorded once');
  const hist = (await owner.get('/print-jobs?search=khamrah')).data;
  assert.equal(hist[0].labels, 50); assert.equal(hist[0].lines[0].sku, 'LAT-KHAMRA-100'); assert.equal(hist[0].user_name, 'Fatma (cashier, demo)'); assert.equal(hist[0].status, 'sent');
  assert.equal((await cash.post('/print-jobs', { reprintOf: job.data.id, reason: 'jammed', items: [{ variantId: 'var_demo_10_100', copies: 5 }] })).status, 403, 'cashier cannot reprint from history');
  assert.equal((await owner.post('/print-jobs', { reprintOf: job.data.id, items: [{ variantId: 'var_demo_10_100', copies: 5 }] })).status, 400, 'reason required');
  const re = await owner.post('/print-jobs', { reprintOf: job.data.id, reason: 'Labels jammed', source: 'reprint', items: [{ variantId: 'var_demo_10_100', copies: 5 }] });
  assert.equal(re.status, 200);
  assert.equal((await owner.get('/print-jobs')).data.find((j) => j.id === job.data.id).reprints, 1);
  assert.equal((await cash.get('/print-jobs')).status, 200, 'cashier sees history (view)');
});

test('Excel import: check-only writes nothing, then import creates products, groups sizes, reuses brands and is safe to repeat', async () => {
  const rows = [
    { _line: 2, name: 'Import Oud Royal', brand: 'Import House', category: 'Oud', gender: 'Men', concentration: 'Eau de Parfum', sizeMl: '100 ml', retailPrice: '25.500', openingQty: '4', unitCost: '12' },
    { _line: 3, name: 'Import Oud Royal', brand: 'Import House', sizeMl: '50', retailPrice: '15' },
    { _line: 4, name: 'Import Rose', brand: 'import house', sizeMl: '30', retailPrice: '9.750', webVisible: 'no' },
    { _line: 5, name: 'Broken Row', brand: 'Import House', sizeMl: '100', retailPrice: '' },
  ];
  const nBefore = (await db.one('SELECT COUNT(*)::int AS n FROM products')).n;
  const t0 = await ledgerTotals();
  const dry = await owner.post('/products/import', { rows, dryRun: true });
  assert.equal(dry.status, 200, JSON.stringify(dry.data));
  assert.deepEqual([dry.data.summary.created, dry.data.summary.errors], [2, 1]);
  assert.match(dry.data.results.find((r) => r.status === 'error').note, /Row 5: retail price is empty/);
  assert.equal((await db.one('SELECT COUNT(*)::int AS n FROM products')).n, nBefore, 'check-only must not save');
  assert.ok(!(await db.one("SELECT 1 AS x FROM brands WHERE name = 'Import House'")), 'check-only must not create brands');

  const real = await owner.post('/products/import', { rows });
  assert.equal(real.status, 200, JSON.stringify(real.data));
  assert.deepEqual([real.data.summary.created, real.data.summary.errors], [2, 1]);
  const oud = await db.one("SELECT p.id, p.gender, p.web_visible, b.name AS brand FROM products p JOIN brands b ON b.id = p.brand_id WHERE p.name = 'Import Oud Royal'");
  assert.deepEqual([oud.gender, oud.brand], ['men', 'Import House']);
  const sizes = await db.query('SELECT size_ml, retail_price, barcode FROM variants WHERE product_id = $1 ORDER BY size_ml', [oud.id]);
  assert.deepEqual(sizes.map((v) => [v.size_ml, v.retail_price]), [[50, 15000], [100, 25500]]);
  assert.ok(sizes.every((v) => /^\d{13}$/.test(v.barcode)), 'barcodes generated');
  assert.equal((await db.query("SELECT id FROM brands WHERE lower(name) = 'import house'")).length, 1, 'brand reused case-insensitively');
  assert.equal((await db.one("SELECT web_visible FROM products WHERE name = 'Import Rose'")).web_visible, false);
  const v100 = await db.one('SELECT id FROM variants WHERE product_id = $1 AND size_ml = 100', [oud.id]);
  assert.equal(await stockOf(v100.id), 4);
  const t1 = await ledgerTotals();
  assert.equal(t1.d, t1.c);
  assert.equal(t1.d - t0.d, 48000, 'opening stock booked at cost: 4 × 12.000');

  const again = await owner.post('/products/import', { rows: [...rows.slice(0, 3), { _line: 6, name: 'Import Rose', brand: 'Import House', sizeMl: '100', retailPrice: '19' }] });
  assert.deepEqual([again.data.summary.created, again.data.summary.added, again.data.summary.skipped], [0, 1, 1]);
  assert.equal((await db.query("SELECT v.id FROM variants v JOIN products p ON p.id = v.product_id WHERE p.name = 'Import Rose'")).length, 2);

  // photos: an uploaded file becomes the photo of a new product, and of an existing product that had none
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await owner.post('/files', { data: png });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const ph = await owner.post('/products/import', { rows: [
    { _line: 2, name: 'Import Musk', brand: 'Import House', sizeMl: '50', retailPrice: '7', imageUrl: up.data.url },
    { _line: 3, name: 'Import Rose', brand: 'Import House', sizeMl: '30', retailPrice: '9.750', imageUrl: up.data.url },
    { _line: 4, name: 'Import Bad Photo', brand: 'Import House', sizeMl: '30', retailPrice: '5', imageUrl: 'javascript:alert(1)' },
  ] });
  assert.equal(ph.status, 200, JSON.stringify(ph.data));
  assert.equal((await db.one("SELECT image_url FROM products WHERE name = 'Import Musk'")).image_url, up.data.url);
  assert.equal((await db.one("SELECT image_url FROM products WHERE name = 'Import Rose'")).image_url, up.data.url);
  assert.match(ph.data.results.find((r) => r.product.endsWith('Import Rose')).note, /photo added/);
  assert.ok(!(await db.one("SELECT image_url FROM products WHERE name = 'Import Bad Photo'")).image_url, 'unsafe photo links are dropped');

  const { c: cash } = await login('cashier');
  assert.equal((await cash.post('/products/import', { rows })).status, 403);
});

test('monthly stock register: opening + movements = closing; physical count saved as a draft, then posted', async () => {
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit' }).format(new Date());
  const r0 = await owner.get(`/inventory/register?month=${month}&branchId=br_main`);
  assert.equal(r0.status, 200, JSON.stringify(r0.data));
  for (const l of r0.data.lines) assert.equal(l.opening + l.received - l.sold + l.transfers + l.adjusted + l.count_adj, l.closing, `register adds up for ${l.sku}`);
  const k = r0.data.lines.find((l) => l.variant_id === KHAMRAH);
  assert.equal(k.closing, await stockOf(KHAMRAH));

  const start = await owner.post('/inventory/counts', { branchId: 'br_main', period: month });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const again = await owner.post('/inventory/counts', { branchId: 'br_main', period: month });
  assert.equal(again.data.id, start.data.id, 'one open count per month and branch');

  const sys = await stockOf(KHAMRAH);
  const save = await owner.put(`/inventory/counts/${start.data.id}/lines`, { counts: { [KHAMRAH]: String(sys - 1) } });
  assert.equal(save.status, 200, JSON.stringify(save.data));
  assert.equal((await owner.put(`/inventory/counts/${start.data.id}/lines`, { counts: { [KHAMRAH]: '-3' } })).status, 400);
  const r1 = await owner.get(`/inventory/register?month=${month}&branchId=br_main`);
  const k1 = r1.data.lines.find((l) => l.variant_id === KHAMRAH);
  assert.deepEqual([k1.counted_qty, k1.difference], [sys - 1, -1]);
  assert.equal(r1.data.count.status, 'open');
  const list = await owner.get('/inventory/counts');
  assert.ok(list.data.find((c) => c.id === start.data.id).counted >= 1);

  const { c: cash } = await login('cashier');
  assert.equal((await cash.put(`/inventory/counts/${start.data.id}/lines`, { counts: { [KHAMRAH]: '1' } })).status, 403);

  const t0 = await ledgerTotals();
  const p = await owner.post(`/inventory/counts/${start.data.id}/post`, { counts: {} });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(await stockOf(KHAMRAH), sys - 1);
  const t1 = await ledgerTotals(); assert.equal(t1.d, t1.c); assert.ok(t1.d > t0.d);
  const r2 = await owner.get(`/inventory/register?month=${month}&branchId=br_main`);
  const k2 = r2.data.lines.find((l) => l.variant_id === KHAMRAH);
  assert.deepEqual([k2.count_adj <= -1, k2.closing], [true, sys - 1]);
  assert.equal(r2.data.count.status, 'posted');
});

test('owner password recovery needs the server setup code', async () => {
  const code = 'RECOVER-CODE-123';
  const db2 = await openDb({ dataDir: ':memory:' });
  const app2 = await createApp(db2, { setupCode: code });
  const srv = await new Promise((r) => { const s = app2.listen(0, () => r(s)); });
  const b2 = `http://127.0.0.1:${srv.address().port}/api`;
  const post = async (p, body) => { const r = await fetch(b2 + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
  try {
    assert.equal((await post('/auth/setup', { name: 'Boss', username: 'boss', password: 'First1234', setupCode: code })).status, 200);
    assert.equal((await post('/auth/recover', { setupCode: 'wrong', password: 'Newpass123' })).status, 403);
    assert.equal((await post('/auth/recover', { setupCode: code, password: 'short' })).status, 400);
    const ok = await post('/auth/recover', { setupCode: code, password: 'Newpass123' });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.username, 'boss', 'tells the forgotten username');
    assert.equal((await post('/auth/login', { username: 'boss', password: 'First1234' })).status, 401);
    assert.equal((await post('/auth/login', { username: 'boss', password: 'Newpass123' })).status, 200);
  } finally { srv.close(); await db2.close(); }
  // without a setup code on the server, recovery is off
  assert.equal((await owner.post('/auth/recover', { setupCode: 'x', password: 'Newpass123' })).status, 404);
});
