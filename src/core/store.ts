import { useSyncExternalStore } from 'react';
import type { Base, Collection, DB, Settings } from './types';
import { seed } from './seed';

const KEY = 'woodworks-pro-db-v1';
const listeners = new Set<() => void>();

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DB>;
      const base = seed();
      // merge to support new collections/settings added in future versions
      return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings || {}) } } as DB;
    }
  } catch { /* ignore */ }
  return seed();
}

let db: DB = load();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked */ }
  listeners.forEach((l) => l());
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

export const store = {
  get: () => db,
  subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
  replace(next: DB) { db = next; persist(); },
  reset(empty = false) {
    const s = seed();
    if (empty) {
      db = { ...s, customers: [], jobs: [], tasks: [], staff: [], attendance: [], advances: [], payslips: [], quotations: [], invoices: [], txns: [], items: [], sales: [], socialAccounts: [], socialPosts: [] };
    } else db = s;
    persist();
  },
  upsert<K extends Collection>(col: K, rec: Partial<DB[K][number]> & { id?: string }): DB[K][number] {
    const list = db[col] as unknown as Base[];
    let saved: Base;
    if (rec.id && list.some((r) => r.id === rec.id)) {
      saved = { ...(list.find((r) => r.id === rec.id) as Base), ...(rec as Base), updatedAt: now() };
      db = { ...db, [col]: list.map((r) => (r.id === rec.id ? saved : r)) };
    } else {
      saved = { ...(rec as Base), id: rec.id || uid(), createdAt: now() };
      db = { ...db, [col]: [saved, ...list] };
    }
    persist();
    return saved as DB[K][number];
  },
  remove(col: Collection, id: string) {
    db = { ...db, [col]: (db[col] as Base[]).filter((r) => r.id !== id) };
    persist();
  },
  setSettings(patch: Partial<Settings>) { db = { ...db, settings: { ...db.settings, ...patch } }; persist(); },
};

export function useDB(): DB { return useSyncExternalStore(store.subscribe, store.get); }
export function useCol<K extends Collection>(col: K): DB[K] { const d = useDB(); return d[col]; }
export function useSettings(): Settings { return useDB().settings; }

export function nextNumber(prefix: string, existing: string[]): string {
  const year = new Date().getFullYear();
  const nums = existing.map((n) => parseInt(n.split('-').pop() || '0', 10)).filter((n) => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}-${year}-${String(next).padStart(4, '0')}`;
}

export function exportBackup() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `woodworks-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
