// Base data every installation needs: chart of accounts, a first branch and till.
import { seedChart } from './services/ledger.js';

export async function ensureBase(db) {
  await db.tx(async (q) => {
    await seedChart(q);
    const b = await q.one('SELECT COUNT(*)::int AS n FROM branches');
    if (!b.n) {
      await q("INSERT INTO branches (id, code, name, name_ar, address) VALUES ('br_main', 'MAIN', 'Main Showroom', 'المعرض الرئيسي', 'Salalah')");
      await q("INSERT INTO registers (id, branch_id, name) VALUES ('reg_main_1', 'br_main', 'Till 1')");
    }
  });
}
