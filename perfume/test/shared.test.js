import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMinor, fmt, lineTax, allocate } from '../shared/money.js';
import { priceCart } from '../shared/pricing.js';
import { parseCommand, matchVariants } from '../shared/voice.js';

test('money parsing and formatting in baisa', () => {
  assert.equal(toMinor('12.5'), 12500);
  assert.equal(toMinor('12.5004'), 12500);
  assert.equal(toMinor('12.5005'), 12501);
  assert.equal(toMinor('1,234.250'), 1234250);
  assert.equal(toMinor('١٢٫'.replace('٫', '.')), 12000);
  assert.equal(fmt(1234250), '1,234.250');
  assert.equal(fmt(-5), '-0.005');
  assert.throws(() => toMinor('abc'));
});

test('VAT inclusive and exclusive', () => {
  // 10.500 OMR inclusive of 5 % → VAT 0.500, net 10.000
  assert.deepEqual(lineTax(10500, 500, true), { net: 10000, vat: 500, total: 10500 });
  assert.deepEqual(lineTax(10000, 500, false), { net: 10000, vat: 500, total: 10500 });
  assert.deepEqual(lineTax(10000, 0, true), { net: 10000, vat: 0, total: 10000 });
});

test('allocate always sums exactly', () => {
  const parts = allocate(1000, [1, 1, 1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 1000);
  assert.deepEqual(allocate(7, [0, 0]), [7, 0]);
});

const P = (o) => ({ status: 'approved', channels: ['pos', 'web'], used_count: 0, product_ids: [], variant_ids: [], category_ids: [], brand_ids: [], customer_ids: [], audience: 'all', scope: 'items', stackable: false, min_purchase: 0, ...o });
const L = (o) => ({ variantId: 'v1', productId: 'p1', brandId: 'b1', categoryId: 'c1', qty: 1, unitPrice: 10000, vatRateBp: 500, ...o });

test('percent promotion and best-offer selection (no stacking)', () => {
  const promos = [P({ id: 'a', name: '10%', type: 'percent', value: 1000 }), P({ id: 'b', name: '20%', type: 'percent', value: 2000 })];
  const r = priceCart([L({ qty: 2 })], { promotions: promos, ctx: { channel: 'pos' } });
  assert.equal(r.subtotal, 20000);
  assert.equal(r.discount, 4000);
  assert.deepEqual(r.applied.map((a) => a.id), ['b']);
  assert.equal(r.total, 16000);
  assert.equal(r.vat, Math.round((16000 * 500) / 10500));
});

test('stackable promotion adds on top; manual discount blocked when promo applied', () => {
  const promos = [P({ id: 'a', type: 'percent', value: 1000 }), P({ id: 's', type: 'fixed', value: 1000, scope: 'order', stackable: true })];
  const r = priceCart([L({ qty: 1 })], { promotions: promos, ctx: { channel: 'pos' }, manualDiscount: { type: 'percent', value: 5 } });
  assert.equal(r.discount, 1000 + 1000);
  assert.equal(r.manualBlocked, true);
  const r2 = priceCart([L()], { promotions: promos, ctx: { channel: 'pos' }, manualDiscount: { type: 'percent', value: 5 }, allowManualWithPromo: true });
  assert.equal(r2.manualBlocked, false);
  assert.equal(r2.discount, 2000 + 400);
});

test('buy 2 get 1 free gives the cheapest unit free', () => {
  const promos = [P({ id: 'b2g1', type: 'buy_x_get_y', buy_qty: 2, get_qty: 1, value: 10000 })];
  const r = priceCart([L({ variantId: 'x', unitPrice: 30000 }), L({ variantId: 'y', unitPrice: 20000 }), L({ variantId: 'z', unitPrice: 10000 })], { promotions: promos, ctx: { channel: 'pos' } });
  assert.equal(r.discount, 10000);
  assert.equal(r.lines[2].discount, 10000);
});

test('channel, dates, coupon, audience, min purchase and cap', () => {
  const now = '2026-06-01T10:00:00Z';
  const base = { ctx: { channel: 'pos', now } };
  assert.equal(priceCart([L()], { ...base, promotions: [P({ id: 'w', type: 'percent', value: 1000, channels: ['web'] })] }).discount, 0);
  assert.equal(priceCart([L()], { ...base, promotions: [P({ id: 'e', type: 'percent', value: 1000, ends_at: '2026-05-01' })] }).discount, 0);
  assert.equal(priceCart([L()], { ...base, promotions: [P({ id: 'c', type: 'percent', value: 1000, coupon_code: 'OUD10' })] }).discount, 0);
  assert.equal(priceCart([L()], { ctx: { ...base.ctx, couponCode: 'oud10' }, promotions: [P({ id: 'c', type: 'percent', value: 1000, coupon_code: 'OUD10' })] }).discount, 1000);
  assert.equal(priceCart([L()], { ...base, promotions: [P({ id: 'v', type: 'percent', value: 1000, audience: 'vip' })] }).discount, 0);
  assert.equal(priceCart([L()], { ...base, promotions: [P({ id: 'm', type: 'percent', value: 1000, min_purchase: 50000 })] }).discount, 0);
  assert.equal(priceCart([L({ qty: 10 })], { ...base, promotions: [P({ id: 'cap', type: 'percent', value: 5000, max_discount: 7000 })] }).discount, 7000);
  assert.equal(priceCart([L()], { ...base, promotions: [P({ id: 'd', type: 'percent', value: 1000, status: 'draft' })] }).discount, 0);
});

test('voice commands — English', () => {
  assert.deepEqual(pick(parseCommand('Add Dior Sauvage 100ml')), { intent: 'add', qty: 1, query: 'dior sauvage', sizeMl: 100 });
  assert.deepEqual(pick(parseCommand('Add two bottles of Oud perfume')), { intent: 'add', qty: 2, query: 'oud', sizeMl: null });
  assert.equal(parseCommand('Apply a 10% discount').percent, 10);
  assert.equal(parseCommand('apply 15 percent discount').percent, 15);
  assert.equal(parseCommand('Check product availability of Bleu de Chanel').intent, 'availability');
  assert.equal(parseCommand("Show today's sales").intent, 'today_sales');
  assert.equal(parseCommand('Generate the invoice').intent, 'checkout');
  assert.deepEqual(pick(parseCommand('Search customer by phone number 9123 4567')), { intent: 'customer', phone: '91234567' });
});

test('voice commands — Arabic', () => {
  const a = parseCommand('أضف اثنين عطر عود ١٠٠ مل');
  assert.equal(a.intent, 'add'); assert.equal(a.qty, 2); assert.equal(a.sizeMl, 100); assert.equal(a.query, 'عود');
  assert.equal(parseCommand('خصم ١٠٪').percent, 10);
  assert.equal(parseCommand('مبيعات اليوم').intent, 'today_sales');
  assert.equal(parseCommand('اطبع الفاتورة').intent, 'checkout');
  assert.equal(parseCommand('هل يتوفر عود ملكي').intent, 'availability');
});

test('variant matching prefers the spoken size', () => {
  const vs = [
    { id: '1', brand: 'Dior', name: 'Sauvage', sizeMl: 60 },
    { id: '2', brand: 'Dior', name: 'Sauvage', sizeMl: 100 },
    { id: '3', brand: 'Chanel', name: 'Bleu de Chanel', sizeMl: 100 },
  ];
  assert.equal(matchVariants('dior sauvage', 100, vs)[0].id, '2');
  assert.equal(matchVariants('sauvage', null, vs).length, 2);
});

function pick(r) { const { raw: _raw, explicit: _e, ...rest } = r; return rest; }

import { ean13CheckDigit, isValidEan13, internalEan13, cleanScan } from '../shared/barcode.js';
test('EAN-13 barcodes', () => {
  assert.equal(ean13CheckDigit('629104150021'), '3'); // 6291041500213 is a valid EAN-13
  assert.equal(isValidEan13('6291041500213'), true);
  assert.equal(isValidEan13('6291041500214'), false);
  assert.equal(internalEan13(1), '2900000000018');
  assert.equal(isValidEan13(internalEan13(123456)), true);
  assert.equal(cleanScan('٦٢٩١٠٤١٥٠٠٢١٣\r\n'), '6291041500213');
});
