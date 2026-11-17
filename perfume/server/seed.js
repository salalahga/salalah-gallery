// Base data every installation needs: chart of accounts, a first branch and till.
import { seedChart } from './services/ledger.js';
import { isValidEan13, ean13CheckDigit } from '../shared/barcode.js';

export async function ensureBase(db) {
  // older demo data had 13-digit barcodes with a wrong check digit; repair TEST products only
  const bad = (await db.query(`SELECT v.id, v.barcode FROM variants v JOIN products p ON p.id = v.product_id WHERE p.is_test AND v.barcode ~ '^[0-9]{13}$'`)).filter((r) => !isValidEan13(r.barcode));
  for (const r of bad) {
    const fixed = r.barcode.slice(0, 12) + ean13CheckDigit(r.barcode.slice(0, 12));
    if (!(await db.one('SELECT 1 AS x FROM variants WHERE barcode = $1', [fixed]))) await db.query("UPDATE variants SET barcode = $1, symbology = 'ean13' WHERE id = $2", [fixed, r.id]);
  }
  await db.tx(async (q) => {
    await seedChart(q);
    const b = await q.one('SELECT COUNT(*)::int AS n FROM branches');
    if (!b.n) {
      await q("INSERT INTO branches (id, code, name, name_ar, address) VALUES ('br_main', 'MAIN', 'Main Showroom', 'المعرض الرئيسي', 'Salalah')");
      await q("INSERT INTO registers (id, branch_id, name) VALUES ('reg_main_1', 'br_main', 'Till 1')");
    }
  });
}
