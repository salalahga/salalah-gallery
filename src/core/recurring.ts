import { store, today } from './store';
import type { Recurring, Txn } from './types';

/** Months (YYYY-MM) a rule still has to post: after lastMonth (or from startMonth), once its day is reached. Same rule as the server. */
export function dueMonths(r: Recurring, date = today()): string[] {
  if (!r || r.active === false || !(Number(r.amount) > 0)) return [];
  const cur = date.slice(0, 7); const day = Number(date.slice(8, 10));
  const out: string[] = [];
  let y: number; let m: number;
  if (r.lastMonth) { [y, m] = r.lastMonth.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } } else [y, m] = String(r.startMonth || cur).split('-').map(Number);
  for (let i = 0; i < 24; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key > cur || (key === cur && day < Math.min(28, Number(r.day) || 1))) break;
    out.push(key); m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Post every due recurring expense. Ids are rec-<rule>-<month>, so the server and other devices never double-post. */
export function postDueRecurring(): number {
  const db = store.get(); let n = 0;
  for (const r of db.recurring) {
    const months = dueMonths(r); if (!months.length) continue;
    for (const m of months) {
      const id = `rec-${r.id}-${m}`;
      if (!db.txns.some((t) => t.id === id)) {
        store.upsert('txns', { id, date: `${m}-${String(Math.min(28, Number(r.day) || 1)).padStart(2, '0')}`, kind: 'expense', category: r.category, amount: Number(r.amount), method: r.method, description: r.description, ref: 'Recurring', recurringId: r.id, jobId: r.jobId } as Txn);
        n++;
      }
    }
    store.upsert('recurring', { ...r, lastMonth: months[months.length - 1] });
  }
  return n;
}
