import { createContext, useContext } from 'react';
import { fmt, toMinor } from '../../shared/money.js';

export type Perms = Record<string, string[]>;
export type Me = {
  user: { id: string; name: string; username: string; role: string; branchId?: string; employeeId?: string; totpEnabled: boolean; mustChangePassword: boolean };
  app: string; mfaOk: boolean; mfaEnrolRequired: boolean; permissions: Perms; branchScope: string[] | null; seeCost: boolean;
  settings: { business: Record<string, string>; currency: string; tax: { defaultRateBp: number; pricesIncludeVat: boolean }; pos: { maxManualDiscountPct: number }; loyalty: { pointValueBaisa: number; enabled: boolean }; delivery: { defaultFee: number } };
};

export const SessionCtx = createContext<{ me: Me; refresh: () => void; logout: () => void } | null>(null);
export function useSession() {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('No session');
  const can = (module: string, level = 'view') => !!s.me.permissions[module]?.includes(level);
  return { ...s, can };
}

export const money = (minor: number | null | undefined, symbol = false) => fmt(minor ?? 0, 'OMR', { symbol });
export const parseMoney = (s: string) => { try { return toMinor(s || '0'); } catch { return NaN; } };
export const date = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const dateTime = (d?: string | null) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const today = () => new Date().toISOString().slice(0, 10);
export const monthStart = () => today().slice(0, 8) + '01';
export const variantName = (v: { brand?: string | null; name?: string; label?: string | null; size_ml?: number | null }) =>
  `${v.brand ? v.brand + ' ' : ''}${v.name || ''}${v.label ? ' ' + v.label : v.size_ml ? ` ${v.size_ml}ml` : ''}`.trim();
