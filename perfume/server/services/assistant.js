// Business assistant. It answers ONLY from live database queries: each answer is computed by a named query
// and states its period and source. When a question is not understood it says so and suggests questions —
// it never estimates or invents a figure. Financial answers require the Finance "view" permission.
import { fmt } from '../../shared/money.js';
import { normalise } from '../../shared/voice.js';
import { can, canSeeCost } from '../rbac.js';
import { profitLoss, moneyPosition } from './finance.js';
import { salesTotals } from './analytics.js';
import { supplierSummary } from './purchases.js';

const iso = (d) => d.toISOString().slice(0, 10);
function period(s, now = new Date()) {
  const t = iso(now);
  if (/yesterday|أمس|امس/.test(s)) { const y = iso(new Date(now.getTime() - 86400e3)); return { from: y, to: y, label: 'yesterday' }; }
  if (/last month|previous month|الشهر الماضي/.test(s)) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { from: iso(d), to: iso(e), label: 'last month' };
  }
  if (/this week|last 7 days|week|الأسبوع|الاسبوع/.test(s)) return { from: iso(new Date(now.getTime() - 6 * 86400e3)), to: t, label: 'the last 7 days' };
  if (/this year|year to date|ytd|السنة|هذا العام/.test(s)) return { from: t.slice(0, 4) + '-01-01', to: t, label: 'this year' };
  if (/today|اليوم/.test(s)) return { from: t, to: t, label: 'today' };
  return null;
}
const monthP = (now = new Date()) => ({ from: iso(now).slice(0, 8) + '01', to: iso(now), label: 'this month' });
const O = (n) => `${fmt(n)} OMR`;

const SUGGESTIONS = [
  'How much did my shop sell today?', 'What is my net profit this month?', 'Which perfume sells the most?', 'Which products are not selling?',
  'Which staff member generated the highest sales?', 'What is my total stock value?', 'Which suppliers have outstanding balances?',
  'How much did I spend this month?', 'Which offers generated the most revenue?', 'How can I improve my profit?',
];

export async function ask(q, question, { perms }) {
  const s = normalise(question);
  const fin = can(perms, 'finance', 'view');
  const needFin = () => ({ answer: 'That needs access to financial information. Ask the owner to grant you Finance "view" permission.', denied: true });

  if (/net profit|net income|صافي الربح/.test(s)) {
    if (!fin) return needFin();
    const p = period(s) || monthP();
    const pl = await profitLoss(q, p);
    return { answer: `Net profit for ${p.label} is ${O(pl.netProfit)}: revenue ${O(pl.revenue)} − cost of goods ${O(pl.cogs)} = gross profit ${O(pl.grossProfit)}, plus other income ${O(pl.otherIncome)}, minus operating expenses ${O(pl.operatingExpenses)}.`, data: pl, source: `Profit & loss from the general ledger, ${p.from} to ${p.to}` };
  }
  if (/gross profit|gross margin|margin|الربح الإجمالي|هامش/.test(s)) {
    if (!fin) return needFin();
    const p = period(s) || monthP();
    const pl = await profitLoss(q, p);
    return { answer: `Gross profit for ${p.label} is ${O(pl.grossProfit)} on revenue of ${O(pl.revenue)} (${pl.grossMarginPct}% margin). Gross profit is revenue minus the cost of the perfumes sold; it does not deduct rent, salaries or other expenses.`, data: pl, source: `General ledger, ${p.from} to ${p.to}` };
  }
  if (/improve|increase (my )?profit|grow|advice|suggest|كيف .*(أحسن|احسن|أزيد|ازيد)/.test(s)) {
    if (!fin) return needFin();
    return improve(q);
  }
  if (/spend|spent|expenses|costs|مصاريف|صرفت|المصروفات/.test(s)) {
    if (!fin) return needFin();
    const p = period(s) || monthP();
    const pl = await profitLoss(q, p);
    const purch = await q.one('SELECT COALESCE(SUM(goods + landed_cost),0) AS t FROM supplier_bills WHERE bill_date BETWEEN $1 AND $2', [p.from, p.to]);
    const top = pl.expense.filter((e) => e.subtype !== 'cogs').sort((a, b) => b.amount - a.amount).slice(0, 5);
    return { answer: `Operating expenses for ${p.label}: ${O(pl.operatingExpenses)}${top.length ? ` — largest: ${top.map((e) => `${e.name} ${O(e.amount)}`).join(', ')}` : ''}. Stock purchased in the same period: ${O(purch.t)} (stock purchases become cost of goods only when the perfume is sold).`, data: { expenses: top, purchases: purch.t }, source: `General ledger and supplier bills, ${p.from} to ${p.to}` };
  }
  if (/revenue|turnover|الإيرادات|الايرادات/.test(s) && fin) {
    const p = period(s) || monthP();
    const pl = await profitLoss(q, p);
    return { answer: `Revenue for ${p.label} is ${O(pl.revenue)} (excluding VAT, after discounts and refunds).`, data: { revenue: pl.revenue }, source: `General ledger account 4000, ${p.from} to ${p.to}` };
  }
  if (/(cash|bank) balance|how much (cash|money) do i have|الرصيد|النقد/.test(s)) {
    if (!fin) return needFin();
    const m = await moneyPosition(q);
    return { answer: `Cash on hand ${O(m.cash)}, bank ${O(m.bank)}, card/gateway settlements not yet in the bank ${O(m.clearing)}. Customers owe you ${O(m.receivable)}; you owe suppliers ${O(m.payable)}.`, data: m, source: 'General ledger balances now' };
  }
  if (/(staff|employee|cashier|salesperson|who).*(sale|sold|highest|best|top)|(highest|best|top).*(staff|employee|cashier)|أفضل موظف|افضل موظف/.test(s)) {
    if (!can(perms, 'sales', 'view') && !can(perms, 'staff', 'view')) return { answer: 'You do not have access to sales by staff.', denied: true };
    const p = period(s) || monthP();
    const rows = await q(`SELECT COALESCE(u.name,'Online / unassigned') AS name, COUNT(*)::int AS orders, SUM(s.total - s.refunded)::bigint AS total FROM sales s LEFT JOIN users u ON u.id = s.cashier_id
      WHERE s.status IN ('completed','confirmed','partially_refunded') AND s.created_at::date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY total DESC LIMIT 5`, [p.from, p.to]);
    if (!rows.length) return { answer: `No sales recorded ${p.label}.`, data: rows, source: 'Sales' };
    return { answer: `Top seller ${p.label}: ${rows[0].name} with ${O(rows[0].total)} from ${rows[0].orders} sales.${rows.length > 1 ? ' Next: ' + rows.slice(1).map((r) => `${r.name} ${O(r.total)}`).join(', ') + '.' : ''}`, data: rows, source: `Sales by cashier, ${p.from} to ${p.to}` };
  }
  if (/(not selling|slow|dead stock|no sales|لا تباع|راكد)/.test(s)) {
    const rows = await q(`SELECT p.name, b.name AS brand, v.label, v.size_ml, COALESCE(SUM(st.qty),0)::int AS qty, (COALESCE(SUM(st.qty),0) * v.avg_cost)::bigint AS value
      FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN stock_levels st ON st.variant_id = v.id
      WHERE v.active AND NOT EXISTS (SELECT 1 FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE l.variant_id = v.id AND s.created_at > now() - interval '60 days' AND s.status <> 'cancelled')
      GROUP BY v.id, p.name, b.name HAVING COALESCE(SUM(st.qty),0) > 0 ORDER BY value DESC LIMIT 10`);
    if (!rows.length) return { answer: 'Every product in stock has sold at least once in the last 60 days.', data: [], source: 'Sales and stock, last 60 days' };
    const cost = canSeeCost(perms);
    return { answer: `${rows.length} product(s) in stock have not sold in 60 days: ${rows.map((r) => `${r.brand ? r.brand + ' ' : ''}${r.name} ${r.label || (r.size_ml ? r.size_ml + 'ml' : '')} (${r.qty} pcs${cost ? `, ${O(r.value)} at cost` : ''})`).join('; ')}.`, data: cost ? rows : rows.map(({ value: _v, ...x }) => x), source: 'Sales and stock, last 60 days' };
  }
  if (/(best|top|most).*(sell|sold|popular)|(sells|selling) (the )?most|الأكثر مبيعا|الاكثر مبيعا/.test(s)) {
    const p = period(s) || monthP();
    const rows = await q(`SELECT p.name, b.name AS brand, v.label, v.size_ml, SUM(l.qty - l.refunded_qty)::int AS qty, SUM(l.total)::bigint AS total FROM sale_lines l JOIN sales s ON s.id = l.sale_id
      JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN brands b ON b.id = p.brand_id
      WHERE s.status IN ('completed','confirmed','partially_refunded') AND s.created_at::date BETWEEN $1 AND $2 GROUP BY v.id, p.name, b.name ORDER BY qty DESC LIMIT 5`, [p.from, p.to]);
    if (!rows.length) return { answer: `No sales recorded ${p.label}.`, data: [], source: 'Sales' };
    const n = (r) => `${r.brand ? r.brand + ' ' : ''}${r.name} ${r.label || (r.size_ml ? r.size_ml + 'ml' : '')}`.trim();
    return { answer: `Best seller ${p.label}: ${n(rows[0])} — ${rows[0].qty} sold for ${O(rows[0].total)}. Then: ${rows.slice(1).map((r) => `${n(r)} (${r.qty})`).join(', ') || '—'}.`, data: rows, source: `Sale lines, ${p.from} to ${p.to}` };
  }
  if (/stock value|inventory value|value of (my )?(stock|inventory)|قيمة المخزون/.test(s)) {
    const inv = await q.one('SELECT COALESCE(SUM(st.qty * v.avg_cost),0)::bigint AS cost, COALESCE(SUM(st.qty * v.retail_price),0)::bigint AS retail, COALESCE(SUM(st.qty),0)::int AS units FROM stock_levels st JOIN variants v ON v.id = st.variant_id WHERE st.qty > 0');
    if (!canSeeCost(perms)) return { answer: `You hold ${inv.units} units with a retail value of ${O(inv.retail)}.`, data: { units: inv.units, retail: inv.retail }, source: 'Stock levels × retail price' };
    return { answer: `Stock on hand: ${inv.units} units, worth ${O(inv.cost)} at average cost and ${O(inv.retail)} at retail price.`, data: inv, source: 'Stock levels × weighted-average cost' };
  }
  if (/low stock|running out|reorder|نفاد|ناقص/.test(s)) {
    const rows = await q(`SELECT p.name, b.name AS brand, v.label, v.size_ml, v.min_stock, COALESCE(SUM(st.qty),0)::int AS qty FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN stock_levels st ON st.variant_id = v.id WHERE v.active GROUP BY v.id, p.name, b.name HAVING COALESCE(SUM(st.qty),0) <= v.min_stock ORDER BY qty LIMIT 15`);
    return { answer: rows.length ? `${rows.length} product(s) at or below minimum stock: ${rows.map((r) => `${r.brand ? r.brand + ' ' : ''}${r.name} ${r.label || r.size_ml + 'ml'} (${r.qty}/${r.min_stock})`).join('; ')}.` : 'No product is below its minimum stock level.', data: rows, source: 'Stock levels vs minimum levels' };
  }
  if (/supplier|vendor|owe|payable|الموردين|المورد/.test(s)) {
    if (!can(perms, 'purchases', 'view') && !fin) return { answer: 'You do not have access to supplier information.', denied: true };
    const rows = (await supplierSummary(q)).filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance);
    if (!rows.length) return { answer: 'No supplier has an outstanding balance.', data: [], source: 'Accounts payable ledger' };
    const total = rows.reduce((a, r) => a + r.balance, 0);
    return { answer: `You owe ${rows.length} supplier(s) ${O(total)} in total: ${rows.map((r) => `${r.name} ${O(r.balance)}${r.overdue ? ` (${O(r.overdue)} overdue)` : ''}`).join('; ')}.`, data: rows, source: 'Accounts payable ledger by supplier' };
  }
  if (/offer|promotion|coupon|discount.*(revenue|best|work)|العروض|العرض/.test(s)) {
    const p = period(s) || { from: '2000-01-01', to: iso(new Date()), label: 'since they started' };
    const rows = await q(`SELECT pr.name, COUNT(DISTINCT s.id)::int AS orders, COALESCE(SUM(s.total - s.refunded),0)::bigint AS revenue, COALESCE(SUM(s.discount),0)::bigint AS discount
      FROM promotions pr JOIN sales s ON pr.id = ANY(s.promotion_ids) WHERE s.status IN ('completed','confirmed','partially_refunded') AND s.created_at::date BETWEEN $1 AND $2
      GROUP BY pr.id, pr.name ORDER BY revenue DESC LIMIT 5`, [p.from, p.to]);
    if (!rows.length) return { answer: `No sale used a promotion ${p.label}.`, data: [], source: 'Sales with promotions' };
    return { answer: `Top offer ${p.label}: "${rows[0].name}" — ${rows[0].orders} orders, ${O(rows[0].revenue)} in sales, ${O(rows[0].discount)} given in discounts.${rows.length > 1 ? ' Others: ' + rows.slice(1).map((r) => `"${r.name}" ${O(r.revenue)}`).join(', ') + '.' : ''}`, data: rows, source: `Sales carrying each promotion, ${p.from} to ${p.to}` };
  }
  if (/customer|client|عملاء|العملاء|زبائن/.test(s)) {
    const p = period(s) || monthP();
    const r = await q.one('SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE created_at::date BETWEEN $1 AND $2)::int AS new, COUNT(*) FILTER (WHERE vip)::int AS vip FROM customers', [p.from, p.to]);
    return { answer: `You have ${r.total} customers (${r.vip} VIP); ${r.new} joined ${p.label}.`, data: r, source: 'Customer records' };
  }
  if (/sell|sold|sales|مبيعات|بعت|باع/.test(s)) {
    if (!can(perms, 'sales', 'view') && !can(perms, 'dashboard', 'view') && !can(perms, 'pos', 'view')) return { answer: 'You do not have access to sales figures.', denied: true };
    const p = period(s) || { ...monthP(), label: 'this month' };
    const t = await salesTotals(q, p.from, p.to);
    return { answer: `Sales ${p.label}: ${O(t.gross)} from ${t.orders} order(s), including VAT and net of refunds${t.discount ? `; discounts given ${O(t.discount)}` : ''}.`, data: t, source: `Sales, all channels, ${p.from} to ${p.to}` };
  }
  return { answer: "I can only answer from your business data and I didn't recognise that question. Try one of these:", suggestions: SUGGESTIONS, unknown: true };
}

async function improve(q) {
  const now = new Date();
  const p = { from: iso(new Date(now.getTime() - 89 * 86400e3)), to: iso(now) };
  const pl = await profitLoss(q, p);
  const tips = [];
  const lowMargin = await q(`SELECT p.name, b.name AS brand, v.label, v.size_ml, v.retail_price, v.avg_cost, SUM(l.qty)::int AS sold FROM sale_lines l JOIN sales s ON s.id = l.sale_id JOIN variants v ON v.id = l.variant_id
    JOIN products p ON p.id = v.product_id LEFT JOIN brands b ON b.id = p.brand_id WHERE s.created_at::date >= $1 AND v.retail_price > 0 AND v.avg_cost > 0
    GROUP BY v.id, p.name, b.name HAVING (v.retail_price * 10000 / (10000 + v.vat_rate_bp) - v.avg_cost) * 100 < 25 * (v.retail_price * 10000 / (10000 + v.vat_rate_bp)) ORDER BY sold DESC LIMIT 5`, [p.from]);
  if (lowMargin.length) tips.push(`Low-margin best sellers (under 25% before VAT): ${lowMargin.map((r) => `${r.brand ? r.brand + ' ' : ''}${r.name} ${r.label || r.size_ml + 'ml'}`).join(', ')}. Review their price or negotiate supplier cost.`);
  const disc = await q.one("SELECT COALESCE(SUM(discount),0) AS d, COALESCE(SUM(subtotal),0) AS s FROM sales WHERE status <> 'cancelled' AND created_at::date >= $1", [p.from]);
  if (disc.s && disc.d / disc.s > 0.08) tips.push(`Discounts were ${((disc.d / disc.s) * 100).toFixed(1)}% of list-price sales (${O(disc.d)}). Check which offers actually bring extra sales before renewing them.`);
  const dead = await q.one(`SELECT COALESCE(SUM(st.qty * v.avg_cost),0)::bigint AS v, COUNT(DISTINCT v.id)::int AS n FROM variants v JOIN stock_levels st ON st.variant_id = v.id WHERE st.qty > 0
    AND NOT EXISTS (SELECT 1 FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE l.variant_id = v.id AND s.created_at > now() - interval '60 days')`);
  if (dead.v > 0) tips.push(`${dead.n} product(s) worth ${O(dead.v)} at cost have not sold in 60 days. A clearance bundle or moving them to a busier branch frees cash.`);
  const topExp = pl.expense.filter((e) => e.subtype !== 'cogs').sort((a, b) => b.amount - a.amount)[0];
  if (topExp && pl.revenue && topExp.amount / pl.revenue > 0.15) tips.push(`${topExp.name} is ${((topExp.amount / pl.revenue) * 100).toFixed(0)}% of revenue (${O(topExp.amount)} in 90 days) — your largest cost to review.`);
  const shrink = pl.expense.find((e) => e.code === '5100');
  if (shrink && shrink.amount > 0) tips.push(`Stock damage/loss cost ${O(shrink.amount)} in 90 days. Regular stock counts and tester control reduce this.`);
  if (!tips.length) tips.push('No clear problem stands out in the last 90 days of data. Keep recording expenses and stock counts so the analysis stays complete.');
  return {
    answer: `Last 90 days: revenue ${O(pl.revenue)}, gross profit ${O(pl.grossProfit)} (${pl.grossMarginPct}%), net profit ${O(pl.netProfit)}. Based on your data:`,
    tips, data: { pl: { revenue: pl.revenue, grossProfit: pl.grossProfit, netProfit: pl.netProfit } }, source: `Ledger, sales and stock, ${p.from} to ${p.to}`,
  };
}
