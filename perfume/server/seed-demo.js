// Realistic SAMPLE data for development, training and testing. Every record is flagged is_test = true
// (products, customers, suppliers, sales, journal entries …) so it can be told apart from real business.
// Created only when the owner ticks "load demo data" at first setup, or via `npm run seed:demo`.
import { hashPassword } from './security.js';
import { effectivePermissions } from './rbac.js';
import { post } from './services/ledger.js';
import * as inv from './services/inventory.js';
import * as sales from './services/sales.js';
import * as pur from './services/purchases.js';
import { createExpense } from './services/finance.js';
import { ean13CheckDigit } from '../shared/barcode.js';

// demo barcodes: 629 (GS1 Oman range style) + product no + size, with a correct EAN-13 check digit
const demoEan = (n, size) => { const d = String(629000000000 + n * 1000 + (size || 999)); return d + ean13CheckDigit(d); };

const CATALOG = [
  // brand, product, category, gender, concentration, [[size, retail OMR, cost OMR, min, qtyMain, qtyMct]]
  ['Dior', 'Sauvage', 'Men', 'men', 'Eau de Toilette', [[60, 42, 30, 3, 8, 4], [100, 56, 40, 4, 12, 6], [200, 78, 56, 2, 3, 2]]],
  ['Chanel', 'Bleu de Chanel', 'Men', 'men', 'Eau de Parfum', [[50, 48, 35, 2, 5, 3], [100, 66, 48, 3, 7, 4]]],
  ['Chanel', 'Coco Mademoiselle', 'Women', 'women', 'Eau de Parfum', [[50, 52, 37, 2, 4, 3], [100, 72, 52, 3, 6, 2]]],
  ['Tom Ford', 'Oud Wood', 'Unisex', 'unisex', 'Eau de Parfum', [[50, 95, 70, 1, 3, 1], [100, 135, 98, 1, 2, 1]]],
  ['Amouage', 'Interlude Man', 'Men', 'men', 'Eau de Parfum', [[100, 120, 85, 1, 3, 2]]],
  ['Amouage', 'Reflection Woman', 'Women', 'women', 'Eau de Parfum', [[100, 115, 82, 1, 2, 2]]],
  ['Arabian Oud', 'Royal Oud', 'Oud & Bakhoor', 'unisex', 'Eau de Parfum', [[100, 38, 22, 3, 10, 6]]],
  ['Ajmal', 'Dahn Al Oudh Attar', 'Attar oils', 'unisex', 'Perfume oil', [[3, 25, 14, 2, 6, 0]]],
  ['Rasasi', 'Hawas', 'Men', 'men', 'Eau de Parfum', [[100, 18, 9, 4, 15, 10]]],
  ['Lattafa', 'Khamrah', 'Unisex', 'unisex', 'Eau de Parfum', [[100, 12, 6, 5, 20, 12]]],
  ['Salalah Gallery', 'Dhofari Luban Attar', 'Attar oils', 'unisex', 'Perfume oil', [[12, 8, 3, 5, 25, 10]]],
  ['Salalah Gallery', 'Dhofari Bakhoor 50g', 'Oud & Bakhoor', 'unisex', 'Bakhoor', [[null, 6, 2, 5, 30, 15]]],
  ['Salalah Gallery', 'Oud Discovery Gift Set', 'Gift sets', 'unisex', 'Gift set', [[null, 30, 16, 2, 6, 2]]],
];

const O = (omr) => Math.round(omr * 1000);

export async function seedDemo(db, ownerId) {
  const started = new Date();
  const owner = await db.one('SELECT * FROM users WHERE id = $1', [ownerId]);
  const ctx = { user: owner, perms: effectivePermissions(owner, []) };
  const ids = { brands: {}, cats: {}, variants: [] };
  await db.tx(async (q) => {
    await q("INSERT INTO branches (id, code, name, name_ar, address) VALUES ('br_mct', 'MCT', 'Muscat Mall Kiosk (demo)', 'كشك مسقط مول', 'Muscat') ON CONFLICT DO NOTHING");
    await q("INSERT INTO registers (id, branch_id, name) VALUES ('reg_mct_1', 'br_mct', 'Kiosk till') ON CONFLICT DO NOTHING");
    // opening capital in the bank
    await post(q, { memo: 'Opening bank balance (demo)', sourceType: 'opening', userId: ownerId, isTest: true, lines: [{ account: '1020', debit: O(15000) }, { account: '3000', credit: O(15000) }] });
    let n = 0;
    for (const [brand, name, cat, gender, conc, sizes] of CATALOG) {
      if (!ids.brands[brand]) { ids.brands[brand] = 'brd_' + brand.toLowerCase().replace(/\W+/g, ''); await q('INSERT INTO brands (id, name, country) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [ids.brands[brand], brand, brand === 'Amouage' || brand === 'Salalah Gallery' ? 'Oman' : null]); }
      if (!ids.cats[cat]) { ids.cats[cat] = 'cat_' + cat.toLowerCase().replace(/\W+/g, ''); await q('INSERT INTO categories (id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ids.cats[cat], cat]); }
      const pid = 'prd_demo_' + (++n);
      await q(`INSERT INTO products (id, brand_id, category_id, name, gender, concentration, description, is_test) VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
        [pid, ids.brands[brand], ids.cats[cat], name, gender, conc, `${brand} ${name} — sample product for testing.`]);
      for (const [size, price, cost, min, qMain, qMct] of sizes) {
        const vid = `var_demo_${n}_${size || 'x'}`;
        const sku = `${brand.slice(0, 3).toUpperCase()}-${name.replace(/\W+/g, '').slice(0, 6).toUpperCase()}-${size || 'STD'}`;
        await q(`INSERT INTO variants (id, product_id, size_ml, label, sku, barcode, retail_price, web_price, wholesale_price, min_stock) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [vid, pid, size, size ? `${size}ml` : null, sku, demoEan(n, size), O(price), O(price), O(price * 0.85), min]);
        for (const [br, qty] of [['br_main', qMain], ['br_mct', qMct]]) {
          if (!qty) continue;
          await inv.receiveIntoStock(q, { branchId: br, variantId: vid, qty, unitCost: O(cost), reason: 'opening', refType: 'opening', userId: ownerId });
          await post(q, { memo: `Opening stock ${sku}`, sourceType: 'opening', sourceId: vid, branchId: br, userId: ownerId, isTest: true, lines: [{ account: '1200', debit: qty * O(cost) }, { account: '3000', credit: qty * O(cost) }] });
        }
        ids.variants.push({ vid, price: O(price), brand, name, cat });
      }
    }
    // suppliers
    await q(`INSERT INTO suppliers (id, code, name, contact_person, phone, country, currency, payment_terms_days, is_test) VALUES
      ('sup_demo_1','S-0001','Gulf Fragrance Trading LLC (demo)','Ahmed','+968 2400 0000','Oman','OMR',30,true),
      ('sup_demo_2','S-0002','Paris Luxe Distribution (demo)','Claire','+33 1 00 00 00 00','France','EUR',45,true),
      ('sup_demo_3','S-0003','Dubai Oud House (demo)','Rashid','+971 4 000 0000','UAE','AED',30,true)`);
    // customers
    const people = [['Salim Al-Hinai', '91234567', true], ['Aisha Al-Balushi', '92345678', false], ['Khalid Al-Mashani', '93456789', false], ['Maryam Al-Kathiri', '94567890', true], ['Hamed Al-Shanfari', '95678901', false], ['Noor Al-Rawas', '96789012', false]];
    let c = 0;
    for (const [nm, ph, vip] of people) {
      c++;
      await q(`INSERT INTO customers (id, code, name, phone, vip, segment, birthday, city, credit_enabled, credit_limit, marketing_opt_in, is_test, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'Salalah',$8,$9,true,true, now() - ($10 || ' days')::interval)`,
      ['cus_demo_' + c, 'C-D' + c, nm, ph, vip, vip ? 'vip' : 'regular', `199${c}-${String((c % 12) + 1).padStart(2, '0')}-1${c}`, c === 1, c === 1 ? O(200) : 0, String(c * 25)]);
    }
    // staff
    await q(`INSERT INTO employees (id, code, name, job_title, department, branch_id, joining_date, basic_salary, housing_allowance, transport_allowance, sales_target, status, is_test) VALUES
      ('emp_demo_1','EMP-D1','Fatma Al-Amri','Sales associate','Retail','br_main','2024-03-01',${O(350)},${O(75)},${O(40)},${O(6000)},'active',true),
      ('emp_demo_2','EMP-D2','Yousuf Al-Harthy','Kiosk supervisor','Retail','br_mct','2023-09-15',${O(450)},${O(90)},${O(50)},${O(8000)},'active',true),
      ('emp_demo_3','EMP-D3','Layla Al-Siyabi','Accountant','Finance','br_main','2022-01-10',${O(700)},${O(120)},${O(60)},0,'active',true)`);
    const pw = hashPassword('Demo1234');
    await q(`INSERT INTO users (id, name, username, hash, role, branch_id, employee_id) VALUES
      ('usr_demo_cashier','Fatma (cashier, demo)','cashier',$1,'cashier','br_main','emp_demo_1'),
      ('usr_demo_manager','Business Manager (demo)','manager',$1,'manager',NULL,NULL),
      ('usr_demo_accountant','Layla (accountant, demo)','accountant',$1,'accountant','br_main','emp_demo_3'),
      ('usr_demo_staff','Yousuf (staff, demo)','staff',$1,'staff','br_mct','emp_demo_2')`, [pw]);
    // promotions
    const now = Date.now();
    await q(`INSERT INTO promotions (id, name, type, value, category_ids, channels, status, starts_at, ends_at, approved_by, created_by) VALUES
      ('prm_demo_oud','Oud Week — 15% off oud & bakhoor','percent',1500,$1,'{pos,web,whatsapp,instagram}','approved',$2,$3,$4,$4)`, [[ids.cats['Oud & Bakhoor']], new Date(now - 3 * 86400e3), new Date(now + 4 * 86400e3), ownerId]);
    await q(`INSERT INTO promotions (id, name, type, value, buy_qty, get_qty, brand_ids, channels, status, approved_by, created_by) VALUES
      ('prm_demo_b2g1','Buy 2 get 1 free — Lattafa & Rasasi','buy_x_get_y',10000,2,1,$1,'{pos,web}','approved',$2,$2)`, [[ids.brands.Lattafa, ids.brands.Rasasi], ownerId]);
    await q(`INSERT INTO promotions (id, name, type, value, scope, coupon_code, min_purchase, max_discount, channels, status, approved_by, created_by) VALUES
      ('prm_demo_welcome','WELCOME10 — 10% off first online order','percent',1000,'order','WELCOME10',${O(20)},${O(15)},'{web,whatsapp,instagram}','approved',$1,$1)`, [ownerId]);
    await q(`INSERT INTO promotions (id, name, type, value, audience, channels, status, created_by) VALUES
      ('prm_demo_staff','Staff discount 25%','percent',2500,'staff','{pos}','draft',$1)`, [ownerId]);
    await q("UPDATE products SET image_url = NULL WHERE is_test");
  });

  // till sessions, sales spread over the last 3 weeks
  const regMain = await db.tx((q) => sales.openRegister(q, { registerId: 'reg_main_1', openingFloat: O(50), user: owner }));
  const cashier = await db.one("SELECT * FROM users WHERE id = 'usr_demo_cashier'");
  const cashCtx = { user: cashier, perms: effectivePermissions(cashier, []) };
  const pick = (k) => ids.variants[k % ids.variants.length];
  const methods = ['cash', 'card', 'card', 'cash', 'bank_transfer', 'wallet'];
  for (let i = 0; i < 26; i++) {
    const daysAgo = 20 - Math.floor(i * 0.8);
    const items = [{ variantId: pick(i * 3).vid, qty: 1 }];
    if (i % 3 === 0) items.push({ variantId: pick(i * 5 + 7).vid, qty: 1 + (i % 2) });
    if (i % 7 === 0) items.push({ variantId: ids.variants.find((v) => v.brand === 'Lattafa').vid, qty: 3 });
    const customerId = i % 2 ? 'cus_demo_' + ((i % 6) + 1) : null;
    const branchId = i % 5 === 4 ? 'br_mct' : 'br_main';
    try {
      const qt = await sales.quote(db.query, { branchId, channel: 'pos', items, customerId }, i % 2 ? ctx : cashCtx);
      if (qt.shortages.length) continue;
      if (branchId === 'br_mct' && !(await db.one("SELECT id FROM register_sessions WHERE register_id = 'reg_mct_1' AND status = 'open'"))) await db.tx((q) => sales.openRegister(q, { registerId: 'reg_mct_1', openingFloat: O(30), user: owner }));
      const method = methods[i % methods.length];
      const r = await db.tx((q) => sales.checkout(q, { branchId, channel: 'pos', items, customerId, confirmed: true, isTest: true, payments: [{ method, amount: qt.total, reference: method === 'card' ? 'APPR' + (100000 + i) : undefined }] }, i % 2 ? ctx : cashCtx));
      const at = new Date(Date.now() - daysAgo * 86400e3 - (i % 8) * 3600e3);
      await db.query('UPDATE sales SET created_at = $1, completed_at = $1 WHERE id = $2', [at, r.id]);
      await db.query("UPDATE journal_entries SET date = $1 WHERE source_type = 'sale' AND source_id = $2", [at.toISOString().slice(0, 10), r.id]);
      await db.query('UPDATE payments SET at = $1 WHERE sale_id = $2', [at, r.id]);
    } catch (e) { if (e.status !== 409) throw e; }
  }
  void regMain;

  // a purchase order from the EUR supplier, approved, received with landed cost, part paid
  const dior100 = ids.variants.find((v) => v.name === 'Sauvage' && v.price === O(56));
  const po = await db.tx((q) => pur.savePO(q, { supplierId: 'sup_demo_2', branchId: 'br_main', currency: 'EUR', fxRate: 0.42, isTest: true, lines: [{ variantId: dior100.vid, qty: 10, unitCost: 9300 }] }, ctx));
  await db.query("UPDATE purchase_orders SET status = 'approved', approved_by = $1, approved_at = now(), is_test = true WHERE id = $2", [ownerId, po.id]);
  const pol = await db.one('SELECT id FROM po_lines WHERE po_id = $1', [po.id]);
  const bill = await db.tx((q) => pur.receivePO(q, po.id, { lines: [{ poLineId: pol.id, qty: 10, batchNo: 'SVG-2611' }], landedCost: O(18), supplierRef: 'PLD-88412' }, ctx));
  await db.tx((q) => pur.paySupplier(q, { supplierId: 'sup_demo_2', billId: bill.billId, amount: O(200), paidFrom: '1020', method: 'bank_transfer', reference: 'TT-5521' }, ctx));
  // a draft PO waiting for approval
  const royal = ids.variants.find((v) => v.name === 'Royal Oud');
  const po2 = await db.tx((q) => pur.savePO(q, { supplierId: 'sup_demo_3', branchId: 'br_main', currency: 'OMR', isTest: true, lines: [{ variantId: royal.vid, qty: 24, unitCost: O(21.5) }] }, ctx));
  await db.query("UPDATE purchase_orders SET status = 'pending_approval', created_by = 'usr_demo_accountant' WHERE id = $1", [po2.id]);

  // operating expenses
  const month = new Date().toISOString().slice(0, 8) + '01';
  for (const [account, amount, desc, from] of [['6100', 450, 'Shop rent (demo)', '1020'], ['6200', 85, 'Electricity & water (demo)', '1020'], ['6300', 120, 'Instagram ads (demo)', '1020'], ['6000', 1500, 'Salaries (demo)', '1020'], ['6600', 35, 'Gift bags & boxes (demo)', '1000']]) {
    await db.tx((q) => createExpense(q, { account, amount: O(amount), description: desc, paidFrom: from, date: month, branchId: 'br_main', isTest: true }, ctx));
  }
  // remote orders: website pending, WhatsApp confirmed and paid by link
  await db.tx((q) => sales.createOrder(q, { channel: 'web', branchId: 'br_main', customerId: 'cus_demo_2', couponCode: 'WELCOME10', items: [{ variantId: ids.variants.find((v) => v.name === 'Coco Mademoiselle').vid, qty: 1 }], deliveryFee: 2000, shippingAddress: 'Al Saada, Salalah', isTest: true }, ctx));
  const wa = await db.tx((q) => sales.createOrder(q, { channel: 'whatsapp', branchId: 'br_main', customerId: 'cus_demo_4', items: [{ variantId: royal.vid, qty: 2 }], deliveryFee: 2000, shippingAddress: 'Dahariz, Salalah', isTest: true }, ctx));
  await db.tx((q) => sales.recordPayment(q, wa.id, { method: 'payment_link', amount: wa.total, reference: 'LINK-DEMO-1', provider: 'manual' }, ctx));
  await db.tx((q) => sales.confirmOrder(q, wa.id, ctx));
  await db.query("INSERT INTO announcements (id, title, body, created_by) VALUES ('ann_demo','Welcome to the new system (demo)','All sales, stock and attendance now go through this app. Ask your manager if you need a login.', $1)", [ownerId]);
  // entries posted by the seeding itself (e.g. supplier payment) are demo data too
  await db.query('UPDATE journal_entries SET is_test = true WHERE created_at >= $1', [started]);
}

// CLI: npm run seed:demo  (adds demo data to an installation whose owner already exists)
if (process.argv[1] && process.argv[1].endsWith('seed-demo.js')) {
  const { openDb } = await import('./db.js');
  const { setDataKey } = await import('./security.js');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const dataDir = process.env.DATA_DIR || path.resolve('data');
  const kf = path.join(dataDir, '.data-key');
  setDataKey(process.env.DATA_KEY || (fs.existsSync(kf) ? fs.readFileSync(kf, 'utf8').trim() : '0'.repeat(64)));
  const db = await openDb({ dataDir: process.env.DATABASE_URL ? undefined : path.join(dataDir, 'pglite') });
  const { ensureBase } = await import('./seed.js');
  await ensureBase(db);
  const o = await db.one("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
  if (!o) { console.error('Create the owner account first (open the app)'); process.exit(1); }
  await seedDemo(db, o.id);
  console.log('Demo data added (all marked as test data).');
  await db.close();
}
