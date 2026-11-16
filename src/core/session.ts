import { useSyncExternalStore } from 'react';
import { api, ApiError } from './api';
import { store } from './store';
import type { DB } from './types';

export type Role = 'admin' | 'manager' | 'staff';
export interface User { id: string; name: string; username: string; role: Role; staffId?: string; active: boolean }
export type SessionState =
  | { status: 'loading' }
  | { status: 'local' } // no server: single-device mode
  | { status: 'setup'; needsCode?: boolean } // server running, no owner account yet
  | { status: 'login'; expired?: boolean }
  | { status: 'ready'; user: User };

let state: SessionState = { status: 'loading' };
const subs = new Set<() => void>();
const set = (s: SessionState) => { state = s; subs.forEach((f) => f()); };
const USER_KEY = 'ww-last-user';

export const session = {
  get: () => state,
  subscribe(f: () => void) { subs.add(f); return () => subs.delete(f); },

  async init() {
    let status: { server?: boolean; setupDone?: boolean; setupNeedsCode?: boolean } | undefined;
    try { status = await api('/api/status'); } catch (e) {
      // Offline but previously logged in: open with cached data, sync resumes when back online.
      const last = readLastUser();
      if (!(e instanceof ApiError) && last) return session.enter(last);
      return set({ status: 'local' });
    }
    if (!status?.server) return set({ status: 'local' });
    if (!status.setupDone) return set({ status: 'setup', needsCode: !!status.setupNeedsCode });
    try { const { user } = await api<{ user: User }>('/api/me'); await session.enter(user); }
    catch { set({ status: 'login' }); }
  },

  async enter(user: User) {
    try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* */ }
    set({ status: 'ready', user });
    await store.connect(user.id, () => { store.disconnect(); set({ status: 'login', expired: true }); });
  },

  async login(username: string, password: string) {
    const { user } = await api<{ user: User }>('/api/login', { method: 'POST', body: { username, password } });
    await session.enter(user);
  },

  async setup(p: { name: string; username: string; password: string; data?: DB; code?: string }) {
    const { user } = await api<{ user: User }>('/api/setup', { method: 'POST', body: p });
    await session.enter(user);
  },

  async logout() {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* offline: still log out locally */ }
    try { localStorage.removeItem(USER_KEY); } catch { /* */ }
    store.disconnect();
    set({ status: 'login' });
  },
};

function readLastUser(): User | null { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } }

export function useSession() { return useSyncExternalStore(session.subscribe, session.get); }

/** Current user's role; 'admin' in single-device mode. */
export function useRole(): Role { const s = useSession(); return s.status === 'ready' ? s.user.role : 'admin'; }
export function useUser(): User | null { const s = useSession(); return s.status === 'ready' ? s.user : null; }

/** Mirrors server/permissions.js so the UI hides actions a role cannot perform. */
export function useCanWrite() {
  const role = useRole();
  return (col: string) => role === 'admin' || (role === 'manager' && !['payslips', 'advances'].includes(col)) || (role === 'staff' && (col === 'tasks' || col === 'measurements' || col === 'services'));
}
