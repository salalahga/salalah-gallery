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
