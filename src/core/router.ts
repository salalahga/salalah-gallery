import { useSyncExternalStore } from 'react';

function parse() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, q] = h.split('?');
  return { page: path || 'dashboard', params: Object.fromEntries(new URLSearchParams(q || '')) as Record<string, string> };
}
let cur = parse();
const subs = new Set<() => void>();
window.addEventListener('hashchange', () => { cur = parse(); subs.forEach((s) => s()); });

export function useRoute() { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => cur); }
export function go(page: string, params?: Record<string, string>) {
  const q = params ? '?' + new URLSearchParams(params).toString() : '';
  window.location.hash = `/${page}${q}`;
}
