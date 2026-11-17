import { useSyncExternalStore } from 'react';

const subscribe = (f: () => void) => { window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); };
const read = () => window.location.hash.replace(/^#/, '') || '/';
export function useRoute() {
  const path = useSyncExternalStore(subscribe, read);
  const [route, ...rest] = path.replace(/^\//, '').split('/');
  return { path, route: route || '', params: rest };
}
export const go = (p: string) => { window.location.hash = p; };
