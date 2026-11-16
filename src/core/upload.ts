import { store } from './store';
import { api } from './api';

/**
 * Keep a photo on the server (file storage) and return its URL. Without a server, or when the
 * upload fails (offline), the compressed image stays inline so nothing is lost.
 */
export async function storePhoto(dataUrl: string): Promise<string> {
  if (store.mode !== 'server') return dataUrl;
  try { return (await api<{ url: string }>('/api/files', { method: 'POST', body: { data: dataUrl } })).url; }
  catch { return dataUrl; }
}

/**
 * Bring an image from the internet into the app: the server downloads it (browsers cannot, because
 * of cross-site rules), the browser shrinks it, and it is stored like a photo. Without a server the
 * link itself is kept.
 */
export async function importImageUrl(url: string, max = 1200): Promise<string> {
  if (store.mode !== 'server') return url;
  const r = await fetch('/api/fetch/image', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Download failed (${r.status})`);
  const { compressImage } = await import('../components/Photos');
  return storePhoto(await compressImage(await r.blob(), max, 0.8));
}

/** Random hex id for share links (cannot be guessed). */
export function randomToken(bytes = 16) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
