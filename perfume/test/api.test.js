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
