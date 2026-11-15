import { useSyncExternalStore } from 'react';
import type { Base, Collection, DB, Settings } from './types';
import { seed, emptyDB, defaultSettings } from './seed';
import { api, ApiError } from './api';
import { toast } from '../components/ui';

/**
 * Data store.
 *  - "local" mode: everything lives in this browser (used when no server is running).
 *  - "server" mode: the online database is the source of truth. Changes apply instantly on
 *    screen, are queued in an outbox (so the app keeps working offline) and are pushed to the
 *    server; changes from other devices are pulled every few seconds.
 */
const LOCAL_KEY = 'woodworks-pro-db-v1';
const listeners = new Set<() => void>();
type Op = { kind: 'put'; col: Collection; id: string; data: unknown } | { kind: 'del'; col: Collection; id: string } | { kind: 'settings'; data: Settings };

let mode: 'local' | 'server' = 'local';
let cacheKey = LOCAL_KEY;
let outbox: Op[] = [];
let lastSync = 0;
let syncTimer: ReturnType<typeof setInterval> | undefined;
let flushing = false;
export const syncState = { online: true, pending: 0, lastSync: 0 };

function merge(parsed: Partial<DB>, base: DB): DB {
  // merge so collections/settings added in future versions always exist
  return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings || {}) } } as DB;
}
function loadLocal(): DB {
  try { const raw = localStorage.getItem(LOCAL_KEY); if (raw) return merge(JSON.parse(raw), seed()); } catch { /* ignore */ }
  return seed();
}
export function hasLocalData() { try { return !!localStorage.getItem(LOCAL_KEY); } catch { return false; } }
export function localSnapshot(): DB { return loadLocal(); }

let db: DB = loadLocal();

let syncSnap = { ...syncState };
function emit() { syncState.pending = outbox.length; syncSnap = { ...syncState }; listeners.forEach((l) => l()); }
function persist() {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(db));
    if (mode === 'server') localStorage.setItem(cacheKey + ':outbox', JSON.stringify(outbox));
  } catch { /* storage full or blocked */ }
  emit();
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

function queue(op: Op) {
  if (mode !== 'server') return;
  // collapse repeated edits to the same record
  outbox = outbox.filter((o) => !(op.kind === 'settings' ? o.kind === 'settings' : o.kind !== 'settings' && o.col === op.col && o.id === op.id));
  outbox.push(op);
  void flush();
}

async function flush() {
  if (flushing || mode !== 'server') return;
  flushing = true;
  try {
    while (outbox.length) {
      const op = outbox[0];
      try {
        if (op.kind === 'put') await api(`/api/r/${op.col}/${encodeURIComponent(op.id)}`, { method: 'PUT', body: op.data });
        else if (op.kind === 'del') await api(`/api/r/${op.col}/${encodeURIComponent(op.id)}`, { method: 'DELETE' });
        else await api('/api/settings', { method: 'PUT', body: op.data });
        syncState.online = true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) { onSessionExpired(); return; }
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          toast(e.message); outbox.shift(); persist(); await pullAll(); continue; // rejected: drop and restore server copy
        }
        syncState.online = false; emit(); return; // offline: keep the queue and retry later
      }
      outbox.shift(); persist();
    }
  } finally { flushing = false; }
}

function pendingFor(col: string, id: string) { return outbox.some((o) => o.kind !== 'settings' && o.col === col && o.id === id); }

async function pullAll() {
  const r = await api<{ db: Partial<DB>; settings: Settings | null; serverTime: number }>('/api/db');
  const fresh = merge({ ...r.db, settings: r.settings || undefined }, { ...emptyDB(), settings: structuredClone(defaultSettings) });
  // re-apply local edits that have not reached the server yet
  for (const op of outbox) {
    if (op.kind === 'settings') fresh.settings = op.data;
    else if (op.kind === 'put') { const list = (fresh[op.col] as Base[]).filter((x) => x.id !== op.id); fresh[op.col] = [op.data as Base, ...list] as never; }
    else fresh[op.col] = (fresh[op.col] as Base[]).filter((x) => x.id !== op.id) as never;
  }
  db = fresh; lastSync = r.serverTime; syncState.lastSync = Date.now(); syncState.online = true; persist();
}

async function pullChanges() {
  if (mode !== 'server') return;
  try {
    await flush();
    // small overlap so a write that committed during the previous poll is never missed
    const r = await api<{ changes: { col: Collection; id: string; deleted: boolean; data?: Base }[]; settings?: Settings; serverTime: number }>(`/api/changes?since=${Math.max(0, lastSync - 3000)}`);
    let next = db; let changed = false;
    for (const c of r.changes) {
      if (pendingFor(c.col, c.id) || !(c.col in next)) continue;
      const list = next[c.col] as Base[];
      const exists = list.some((x) => x.id === c.id);
      if (c.deleted) { if (exists) { next = { ...next, [c.col]: list.filter((x) => x.id !== c.id) }; changed = true; } continue; }
      const cur = list.find((x) => x.id === c.id);
      if (cur && JSON.stringify(cur) === JSON.stringify(c.data)) continue;
      next = { ...next, [c.col]: exists ? list.map((x) => (x.id === c.id ? c.data! : x)) : [c.data!, ...list] }; changed = true;
    }
    if (r.settings && !outbox.some((o) => o.kind === 'settings') && JSON.stringify(r.settings) !== JSON.stringify(db.settings)) { next = { ...next, settings: { ...defaultSettings, ...r.settings } }; changed = true; }
    lastSync = r.serverTime; syncState.lastSync = Date.now(); syncState.online = true;
    if (changed) { db = next; persist(); } else emit();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) onSessionExpired();
    else { syncState.online = false; emit(); }
  }
}

let onSessionExpired: () => void = () => {};

export const store = {
  get: () => db,
  subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
  get mode() { return mode; },

  /** Switch to the online database for a logged-in user. Shows cached data immediately. */
  async connect(userId: string, expired: () => void) {
    mode = 'server'; cacheKey = `woodworks-cache-${userId}`; onSessionExpired = expired;
    try {
      const cached = localStorage.getItem(cacheKey);
      db = cached ? merge(JSON.parse(cached), { ...emptyDB(), settings: structuredClone(defaultSettings) }) : { ...emptyDB(), settings: structuredClone(defaultSettings) };
      outbox = JSON.parse(localStorage.getItem(cacheKey + ':outbox') || '[]');
    } catch { outbox = []; }
    emit();
    try { await flush(); await pullAll(); } catch { syncState.online = false; emit(); }
    clearInterval(syncTimer);
    syncTimer = setInterval(pullChanges, 8000);
    window.addEventListener('focus', pullChanges);
    window.addEventListener('online', pullChanges);
  },
  disconnect() {
    clearInterval(syncTimer);
    window.removeEventListener('focus', pullChanges);
    window.removeEventListener('online', pullChanges);
    mode = 'local'; cacheKey = LOCAL_KEY; outbox = []; db = loadLocal(); emit();
  },
  syncNow: pullChanges,

  async replace(next: DB) {
    if (mode === 'server') { await api('/api/import', { method: 'POST', body: next }); outbox = []; await pullAll(); return; }
    db = next; persist();
  },
  async reset(empty = false) {
    const next = empty ? { ...emptyDB(), settings: db.settings } : seed();
    await store.replace(next);
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
    queue({ kind: 'put', col, id: saved.id, data: saved });
    persist();
    return saved as DB[K][number];
  },
  remove(col: Collection, id: string) {
    db = { ...db, [col]: (db[col] as Base[]).filter((r) => r.id !== id) };
    queue({ kind: 'del', col, id });
    persist();
  },
  setSettings(patch: Partial<Settings>) {
    db = { ...db, settings: { ...db.settings, ...patch } };
    queue({ kind: 'settings', data: db.settings });
    persist();
  },
};

export function useSync() { return useSyncExternalStore(store.subscribe, () => syncSnap); }
export function useDB(): DB { return useSyncExternalStore(store.subscribe, store.get); }
export function useCol<K extends Collection>(col: K): DB[K] { const d = useDB(); return d[col]; }
export function useSettings(): Settings { return useDB().settings; }

export function nextNumber(prefix: string, existing: string[]): string {
  const year = new Date().getFullYear();
  const nums = existing.map((n) => parseInt(n.split('-').pop() || '0', 10)).filter((n) => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}-${year}-${String(next).padStart(4, '0')}`;
}

/** Next invoice number. Plain numbering (1212, 1213…) when the prefix is empty, else PREFIX-YEAR-0001. */
export function nextInvoiceNumber(): string {
  const s = db.settings; const nums = db.invoices.map((i) => i.number);
  if (s.invoicePrefix === undefined || s.invoicePrefix) return nextNumber(s.invoicePrefix || 'INV', nums);
  const n = nums.map((x) => parseInt(String(x).replace(/\D/g, ''), 10)).filter((x) => !isNaN(x) && x < 1e7);
  return String(Math.max((s.invoiceStart || 1) - 1, ...n) + 1);
}

export function exportBackup() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `woodworks-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
