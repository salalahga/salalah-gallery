// Inventory: stock per branch, every change recorded as a signed movement, moving weighted-average cost.
import { id, nextNumber, fail, must, posInt, int, str, today } from '../util.js';
import { post } from './ledger.js';

/**
 * Change stock by `qty` (negative = out). Stock can never go below zero unless allowNegative:
 * the conditional UPDATE is atomic, so two tills selling the last bottle cannot both succeed.
 */
export async function moveStock(q, { branchId, variantId, qty, reason, unitCost = 0, refType, refId, userId, batchId, note, allowNegative = false }) {
  if (!qty) return;
  await q('INSERT INTO stock_levels (branch_id, variant_id, qty) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [branchId, variantId]);
  const rows = qty < 0 && !allowNegative
    ? await q('UPDATE stock_levels SET qty = qty + $1 WHERE branch_id = $2 AND variant_id = $3 AND qty + $1 >= 0 RETURNING qty', [qty, branchId, variantId])
    : await q('UPDATE stock_levels SET qty = qty + $1 WHERE branch_id = $2 AND variant_id = $3 RETURNING qty', [qty, branchId, variantId]);
  if (!rows.length) {
    const v = await q.one(`SELECT v.sku, p.name, v.label, COALESCE(s.qty,0) AS qty FROM variants v JOIN products p ON p.id = v.product_id
      LEFT JOIN stock_levels s ON s.variant_id = v.id AND s.branch_id = $2 WHERE v.id = $1`, [variantId, branchId]);
    fail(409, `Not enough stock for ${v?.name || variantId} ${v?.label || ''} (available ${v?.qty ?? 0}, needed ${-qty})`, { code: 'insufficient_stock', variantId, available: v?.qty ?? 0 });
  }
  await q(`INSERT INTO stock_movements (branch_id, variant_id, batch_id, qty, unit_cost, reason, ref_type, ref_id, note, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [branchId, variantId, batchId || null, qty, unitCost, reason, refType || null, refId || null, note || null, userId || null]);
  return rows[0].qty;
}

/** Receive goods at a landed unit cost and update the moving weighted average cost (across all branches). */
export async function receiveIntoStock(q, { branchId, variantId, qty, unitCost, reason = 'purchase', refType, refId, userId, batchNo, expiryDate }) {
  const v = await q.one('SELECT avg_cost FROM variants WHERE id = $1 FOR UPDATE', [variantId]);
  if (!v) fail(404, 'Product variant not found');
  const onHand = (await q.one('SELECT COALESCE(SUM(qty),0) AS n FROM stock_levels WHERE variant_id = $1', [variantId])).n;
  const base = Math.max(0, onHand);
  const newAvg = base + qty > 0 ? Math.round((base * v.avg_cost + qty * unitCost) / (base + qty)) : unitCost;
  await q('UPDATE variants SET avg_cost = $1 WHERE id = $2', [newAvg, variantId]);
  let batchId = null;
  if (batchNo) {
    batchId = id('bat_');
    const b = await q.one(`INSERT INTO batches (id, variant_id, batch_no, expiry_date, unit_cost) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (variant_id, batch_no) DO UPDATE SET unit_cost = excluded.unit_cost RETURNING id`, [batchId, variantId, batchNo, expiryDate || null, unitCost]);
    batchId = b.id;
  }
  await moveStock(q, { branchId, variantId, qty, reason, unitCost, refType, refId, userId, batchId });
  return { avgCost: newAvg, batchId };
}

const WRITE_OFF = new Set(['damage', 'loss', 'expired']);

/** Manual adjustment / damage / loss with the matching accounting entry at average cost. */
export async function adjust(q, { branchId, variantId, qty, reason, note, userId, isTest = false }) {
  must(['adjustment', 'damage', 'loss', 'expired', 'opening'].includes(reason), 400, 'Unknown adjustment reason');
  qty = int(qty, 'quantity');
  must(qty !== 0, 400, 'Quantity cannot be zero');
  if (WRITE_OFF.has(reason)) must(qty < 0, 400, 'Damaged, lost or expired stock is a negative quantity');
  const v = await q.one('SELECT avg_cost FROM variants WHERE id = $1', [variantId]);
  must(v, 404, 'Product variant not found');
  const refId = id('adj_');
  await moveStock(q, { branchId, variantId, qty, reason, unitCost: v.avg_cost, refType: 'adjustment', refId, userId, note });
  const value = Math.abs(qty) * v.avg_cost;
  const other = reason === 'opening' ? '3000' : '5100';
  await post(q, {
    memo: `Stock ${reason}: ${note || ''}`.trim(), sourceType: 'stock_adjustment', sourceId: refId, branchId, userId, isTest,
    lines: qty > 0 ? [{ account: '1200', debit: value }, { account: other, credit: value }] : [{ account: other, debit: value }, { account: '1200', credit: value }],
  });
  return { id: refId, value };
}

export async function transfer(q, { fromBranch, toBranch, lines, note, userId }) {
  must(fromBranch && toBranch && fromBranch !== toBranch, 400, 'Choose two different branches');
  must(Array.isArray(lines) && lines.length, 400, 'Add at least one product');
  const tid = id('trf_');
  const number = await nextNumber(q, 'transfer', 'TRF');
  await q('INSERT INTO stock_transfers (id, number, from_branch, to_branch, note, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [tid, number, fromBranch, toBranch, str(note), userId]);
  for (const l of lines) {
    const qty = posInt(l.qty, 'quantity');
    const v = await q.one('SELECT avg_cost FROM variants WHERE id = $1', [l.variantId]);
    must(v, 404, 'Product variant not found');
    await q('INSERT INTO stock_transfer_lines (transfer_id, variant_id, qty) VALUES ($1,$2,$3)', [tid, l.variantId, qty]);
    await moveStock(q, { branchId: fromBranch, variantId: l.variantId, qty: -qty, reason: 'transfer_out', unitCost: v.avg_cost, refType: 'transfer', refId: tid, userId });
    await moveStock(q, { branchId: toBranch, variantId: l.variantId, qty, reason: 'transfer_in', unitCost: v.avg_cost, refType: 'transfer', refId: tid, userId });
  }
  return { id: tid, number };
}

/** Stock-take: snapshot system quantities, staff enter counts, posting books the differences. */
export async function startCount(q, { branchId, note, userId, variantIds }) {
  const cid = id('cnt_');
  const number = await nextNumber(q, 'count', 'CNT');
  await q('INSERT INTO stock_counts (id, number, branch_id, note, created_by) VALUES ($1,$2,$3,$4,$5)', [cid, number, branchId, str(note), userId]);
  const rows = await q(`SELECT v.id, COALESCE(s.qty,0) AS qty FROM variants v LEFT JOIN stock_levels s ON s.variant_id = v.id AND s.branch_id = $1
    WHERE v.active ${variantIds?.length ? 'AND v.id = ANY($2)' : ''}`, variantIds?.length ? [branchId, variantIds] : [branchId]);
  for (const r of rows) await q('INSERT INTO stock_count_lines (count_id, variant_id, system_qty) VALUES ($1,$2,$3)', [cid, r.id, r.qty]);
  return { id: cid, number, lines: rows.length };
}

export async function postCount(q, { countId, counts, userId, isTest = false }) {
  const c = await q.one('SELECT * FROM stock_counts WHERE id = $1 FOR UPDATE', [countId]);
  must(c, 404, 'Stock count not found');
  must(c.status === 'open', 409, 'This count is already posted');
  for (const [variantId, n] of Object.entries(counts || {})) {
    if (n === '' || n == null) continue;
    await q('UPDATE stock_count_lines SET counted_qty = $1 WHERE count_id = $2 AND variant_id = $3', [int(n, 'count'), countId, variantId]);
  }
  const lines = await q(`SELECT l.*, v.avg_cost, COALESCE(s.qty,0) AS now_qty FROM stock_count_lines l JOIN variants v ON v.id = l.variant_id
    LEFT JOIN stock_levels s ON s.variant_id = l.variant_id AND s.branch_id = $2 WHERE l.count_id = $1 AND l.counted_qty IS NOT NULL`, [countId, c.branch_id]);
  let gain = 0, lossV = 0, changed = 0;
  for (const l of lines) {
    // the count is compared with the snapshot taken when counting started; sales made since then are
    // already deducted from stock, so only the counting difference is booked
    const delta = l.counted_qty - l.system_qty;
    if (!delta) continue;
    changed++;
    await moveStock(q, { branchId: c.branch_id, variantId: l.variant_id, qty: delta, reason: 'count', unitCost: l.avg_cost, refType: 'count', refId: countId, userId, allowNegative: true });
    if (delta > 0) gain += delta * l.avg_cost; else lossV += -delta * l.avg_cost;
  }
  if (gain || lossV) {
    await post(q, {
      memo: `Stock count ${c.number}`, sourceType: 'stock_count', sourceId: countId, branchId: c.branch_id, userId, isTest,
      lines: [{ account: '1200', debit: gain }, { account: '5100', credit: gain }, { account: '5100', debit: lossV }, { account: '1200', credit: lossV }],
    });
  }
  await q("UPDATE stock_counts SET status = 'posted', posted_by = $1, posted_at = now() WHERE id = $2", [userId, countId]);
  return { changed, gain, loss: lossV, date: today() };
}

/** Catalogue rows with stock for a branch (or all branches). */
export async function stockList(q, { branchId, search, lowOnly, includeInactive } = {}) {
  const p = []; const where = [];
  if (!includeInactive) where.push('v.active AND p.active');
  if (search) { p.push('%' + search.toLowerCase() + '%'); where.push(`(lower(p.name) LIKE $${p.length} OR lower(COALESCE(b.name,'')) LIKE $${p.length} OR lower(v.sku) LIKE $${p.length} OR v.barcode = $${p.length + 1} OR lower(COALESCE(p.name_ar,'')) LIKE $${p.length})`); p.push(search); }
  const branchJoin = branchId ? (p.push(branchId), `AND s.branch_id = $${p.length}`) : '';
  const rows = await q(`SELECT v.id, v.sku, v.barcode, v.size_ml, v.label, v.retail_price, v.wholesale_price, v.web_price, v.avg_cost, v.vat_rate_bp, v.min_stock, v.active,
      p.id AS product_id, p.name, p.name_ar, p.image_url, p.gender, p.concentration, p.web_visible, p.is_test, b.id AS brand_id, b.name AS brand, c.id AS category_id, c.name AS category,
      COALESCE(SUM(s.qty),0)::int AS qty
    FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN stock_levels s ON s.variant_id = v.id ${branchJoin}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY v.id, p.id, b.id, c.id ORDER BY b.name NULLS LAST, p.name, v.size_ml`, p);
  return lowOnly ? rows.filter((r) => r.qty <= r.min_stock) : rows;
}
