// Dashboard metrics — all read from live tables.
import { moneyPosition, profitLoss } from './finance.js';

const day = (d) => d.toISOString().slice(0, 10);
export function ranges(now = new Date()) {
  const t = day(now);
  const w = new Date(now); w.setUTCDate(w.getUTCDate() - 6);
  const m = t.slice(0, 8) + '01';
  const y = t.slice(0, 5) + '01-01';
  return { today: [t, t], week: [day(w), t], month: [m, t], year: [y, t] };
}

const LIVE = "s.status IN ('completed','confirmed','partially_refunded','refunded')";

export async function salesTotals(q, from, to, branchIds) {
  const p = [from, to]; let br = '';
  if (branchIds) { p.push(branchIds); br = `AND s.branch_id = ANY($${p.length})`; }
  return q.one(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(s.total - s.refunded),0) AS gross, COALESCE(SUM(s.net),0) AS net_before_refunds, COALESCE(SUM(s.discount),0) AS discount
    FROM sales s WHERE ${LIVE} AND s.created_at::date BETWEEN $1 AND $2 ${br}`, p);
}

export async function dashboard(q, { branchIds, showMoney }) {
  const r = ranges();
  const p = []; let br = '';
  if (branchIds) { p.push(branchIds); br = `AND s.branch_id = ANY($${p.length})`; }
  const [today, week, month, year] = await Promise.all(Object.values(r).map(([a, b]) => salesTotals(q, a, b, branchIds)));
  const byChannel = await q(`SELECT s.channel, COUNT(*)::int AS orders, COALESCE(SUM(s.total - s.refunded),0) AS total FROM sales s WHERE ${LIVE} AND s.created_at::date >= $${p.length + 1} ${br} GROUP BY s.channel ORDER BY total DESC`, [...p, r.month[0]]);
  const byStaff = await q(`SELECT COALESCE(u.name, 'Online / unassigned') AS name, COUNT(*)::int AS orders, COALESCE(SUM(s.total - s.refunded),0) AS total FROM sales s LEFT JOIN users u ON u.id = s.cashier_id
    WHERE ${LIVE} AND s.created_at::date >= $${p.length + 1} ${br} GROUP BY u.name ORDER BY total DESC LIMIT 10`, [...p, r.month[0]]);
  const daily = await q(`SELECT s.created_at::date::text AS day, COALESCE(SUM(s.total - s.refunded),0) AS total, COUNT(*)::int AS orders FROM sales s WHERE ${LIVE} AND s.created_at::date >= $${p.length + 1} ${br} GROUP BY 1 ORDER BY 1`,
    [...p, day(new Date(Date.now() - 29 * 86400e3))]);
  const best = await q(`SELECT v.id, p.name, b.name AS brand, v.label, v.size_ml, SUM(l.qty - l.refunded_qty)::int AS qty, SUM(l.total)::bigint AS total FROM sale_lines l JOIN sales s ON s.id = l.sale_id
    JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN brands b ON b.id = p.brand_id
    WHERE ${LIVE} AND s.created_at::date >= $${p.length + 1} ${br} GROUP BY v.id, p.name, b.name ORDER BY qty DESC LIMIT 8`, [...p, r.month[0]]);
  const slow = await q(`SELECT v.id, p.name, b.name AS brand, v.label, v.size_ml, COALESCE(SUM(st.qty),0)::int AS qty, (COALESCE(SUM(st.qty),0) * v.avg_cost)::bigint AS value,
      (SELECT MAX(s.created_at) FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE l.variant_id = v.id) AS last_sold
    FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN stock_levels st ON st.variant_id = v.id
    WHERE v.active GROUP BY v.id, p.name, b.name HAVING COALESCE(SUM(st.qty),0) > 0 AND NOT EXISTS (SELECT 1 FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE l.variant_id = v.id AND s.created_at > now() - interval '60 days')
    ORDER BY value DESC LIMIT 8`);
  const low = await q(`SELECT v.id, p.name, b.name AS brand, v.label, v.size_ml, v.min_stock, COALESCE(SUM(st.qty),0)::int AS qty FROM variants v JOIN products p ON p.id = v.product_id
    LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN stock_levels st ON st.variant_id = v.id WHERE v.active GROUP BY v.id, p.name, b.name HAVING COALESCE(SUM(st.qty),0) <= v.min_stock ORDER BY qty LIMIT 12`);
  const inv = await q.one('SELECT COALESCE(SUM(st.qty * v.avg_cost),0)::bigint AS cost, COALESCE(SUM(st.qty * v.retail_price),0)::bigint AS retail, COALESCE(SUM(st.qty),0)::int AS units FROM stock_levels st JOIN variants v ON v.id = st.variant_id WHERE st.qty > 0');
  const customers = await q(`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*)::int AS n FROM customers WHERE created_at > now() - interval '6 months' GROUP BY 1 ORDER BY 1`);
  const totalCustomers = (await q.one('SELECT COUNT(*)::int AS n FROM customers')).n;
  const pending = await q(`SELECT s.id, s.number, s.channel, s.total, s.status, s.payment_status, s.fulfilment_status, s.created_at, c.name AS customer FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    WHERE (s.status = 'pending' OR (s.status = 'confirmed' AND s.fulfilment_status NOT IN ('delivered','fulfilled'))) ${br} ORDER BY s.created_at LIMIT 20`, p);
  const offers = await q(`SELECT id, name, type, value, channels, ends_at, used_count, coupon_code FROM promotions WHERE status = 'approved' AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at >= now()) ORDER BY ends_at NULLS LAST LIMIT 10`);
  const purchases = await q.one("SELECT COALESCE(SUM(goods + landed_cost),0) AS total FROM supplier_bills WHERE bill_date >= $1", [r.month[0]]);
  const out = {
    ranges: r, today, week, month, year, byChannel, byStaff, daily, best, slow, low, customers, totalCustomers, pending, offers,
    inventory: { units: inv.units, retailValue: inv.retail }, purchasesMonth: purchases.total,
  };
  if (showMoney) {
    const pl = await profitLoss(q, { from: r.month[0], to: r.month[1] });
    const plToday = await profitLoss(q, { from: r.today[0], to: r.today[1] });
    out.finance = {
      month: { revenue: pl.revenue, grossProfit: pl.grossProfit, netProfit: pl.netProfit, expenses: pl.operatingExpenses, cogs: pl.cogs, margin: pl.grossMarginPct },
      today: { revenue: plToday.revenue, grossProfit: plToday.grossProfit, netProfit: plToday.netProfit },
      position: await moneyPosition(q),
    };
    out.inventory.costValue = inv.cost;
  }
  return out;
}
