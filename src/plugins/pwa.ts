import { useSyncExternalStore } from 'react';

// Captures the browser's "install app" prompt so the Plugins page can offer an Install button.
type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BIP | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIP; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; emit(); });
  // Service worker only in production builds (it would cache dev files otherwise).
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* not critical */ }); });
  }
}
export const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export function useInstallPrompt() {
  const canInstall = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => !!deferred);
  return { canInstall, install: async () => { if (!deferred) return false; await deferred.prompt(); const r = await deferred.userChoice; deferred = null; emit(); return r.outcome === 'accepted'; } };
}
