import type { DB, Item, StockMove } from './types';
import { store, today } from './store';

/** Material groups used in a carpentry workshop (Inventory → category). */
export const STOCK_CATEGORIES = ['Timber', 'Plywood', 'MDF', 'Veneer', 'Laminates', 'Hardware', 'Handles', 'Hinges', 'Screws', 'Paints', 'Polish', 'Accessories', 'Boards & Sheets', 'Other'];
export const locations = (db: Pick<DB, 'settings'>) => (db.settings.stockLocations?.length ? db.settings.stockLocations : ['Main store']);
export const MOVE_LABEL: Record<StockMove['kind'], string> = { in: 'Stock in', out: 'Issued to project', transfer: 'Transfer', waste: 'Wastage', adjust: 'Stock count', return: 'Returned to supplier', sale: 'Shop sale', saleReturn: 'Sale returned' };

/** Quantity at each location; whatever is not assigned to a location sits in the first one. */
export function locQty(db: Pick<DB, 'settings'>, it: Item): Record<string, number> {
  const locs = locations(db); const m: Record<string, number> = {};
  for (const l of locs) m[l] = Number(it.locQty?.[l]) || 0;
  for (const [k, v] of Object.entries(it.locQty || {})) if (!(k in m)) m[k] = Number(v) || 0;
  const assigned = Object.values(m).reduce((n, v) => n + v, 0);
  m[locs[0]] += (Number(it.qty) || 0) - assigned;
  return m;
}

/**
 * Record a stock movement and update the item. Issuing to a project also adds the quantity to the
 * project's materials so it counts in the project cost (at the item's cost price).
 * Returns an error message instead of saving when there is not enough stock.
 */
export function moveStock(db: DB, m: Omit<StockMove, 'id' | 'createdAt'>, by?: string, opts: { skipJob?: boolean } = {}): string | null {
  const it = db.items.find((i) => i.id === m.itemId); if (!it) return 'Choose an item';
  const qty = Number(m.qty) || 0; if (qty <= 0 && m.kind !== 'adjust') return 'Enter a quantity';
  const locs = locations(db); const lq = locQty(db, it);
  const from = m.from || locs[0]; const to = m.to || locs[0];
  let total = Number(it.qty) || 0;
  if (m.kind === 'in' || m.kind === 'saleReturn') { lq[to] = (lq[to] || 0) + qty; total += qty; }
  else if (m.kind === 'out' || m.kind === 'waste' || m.kind === 'return' || m.kind === 'sale') {
    if ((lq[from] || 0) < qty - 1e-9) return `Only ${lq[from] || 0} ${it.unit} of ${it.name} at ${from}`;
    lq[from] -= qty; total -= qty;
  } else if (m.kind === 'transfer') {
    if (from === to) return 'Choose two different locations';
    if ((lq[from] || 0) < qty - 1e-9) return `Only ${lq[from] || 0} ${it.unit} at ${from}`;
    lq[from] -= qty; lq[to] = (lq[to] || 0) + qty;
  } else { // adjust = physical count at a location
    const diff = qty - (lq[from] || 0); lq[from] = qty; total += diff;
    m = { ...m, note: `${m.note ? m.note + ' · ' : ''}counted ${qty} (was ${qty - diff})` };
  }
  const cost = m.kind === 'in' && Number(m.cost) > 0 ? Number(m.cost) : it.cost;
  store.upsert('items', { ...it, qty: Math.max(0, +total.toFixed(4)), locQty: lq, cost });
  store.upsert('stockMoves', { ...m, qty, from: ['in', 'saleReturn'].includes(m.kind) ? undefined : from, to: ['in', 'transfer', 'saleReturn'].includes(m.kind) ? to : undefined, cost: Number(m.cost) || it.cost, date: m.date || today(), by });
  if (m.kind === 'out' && m.jobId && !opts.skipJob) {
    const job = db.jobs.find((j) => j.id === m.jobId);
    if (job) {
      const mats = [...(job.materials || [])]; const k = mats.findIndex((x) => x.itemId === it.id);
      if (k >= 0) mats[k] = { ...mats[k], issued: (Number(mats[k].issued) || 0) + qty, qty: Math.max(mats[k].qty, (Number(mats[k].issued) || 0) + qty) };
      else mats.push({ itemId: it.id, qty, issued: qty });
      store.upsert('jobs', { ...job, materials: mats });
    }
  }
  return null;
}

/** Stock value, usage per project and wastage, for reports. */
export function stockSummary(db: DB, from = '', to = '9999') {
  const inR = (d: string) => d >= from && d <= to;
  const value = db.items.reduce((n, i) => n + (Number(i.qty) || 0) * (Number(i.cost) || 0), 0);
  const byCat: Record<string, { qty: number; value: number; items: number }> = {};
  for (const i of db.items) { const c = byCat[i.category || 'Other'] ||= { qty: 0, value: 0, items: 0 }; c.items++; c.qty += Number(i.qty) || 0; c.value += (Number(i.qty) || 0) * (Number(i.cost) || 0); }
  const moves = db.stockMoves.filter((m) => inR(m.date));
  const usage: Record<string, number> = {};
  for (const m of moves.filter((x) => x.kind === 'out' && x.jobId)) usage[m.jobId!] = (usage[m.jobId!] || 0) + m.qty * (Number(m.cost) || 0);
  const waste = moves.filter((m) => m.kind === 'waste').reduce((n, m) => n + m.qty * (Number(m.cost) || 0), 0);
  const low = db.items.filter((i) => i.kind === 'material' && Number(i.reorder) > 0 && i.qty <= i.reorder);
  return { value, byCat, usage, waste, low, moves };
}
