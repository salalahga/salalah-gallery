export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(status: number, message: string, data: Record<string, unknown>) { super(message); this.status = status; this.data = data; }
}

let onUnauthorised: ((code?: string) => void) | null = null;
export const setUnauthorisedHandler = (fn: (code?: string) => void) => { onUnauthorised = fn; };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api' + path, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const text = await r.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!r.ok) {
    if (r.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/mfa')) onUnauthorised?.(data.code as string);
    if (r.status === 403 && (data.code === 'mfa_enrol_required' || data.code === 'password_change_required')) onUnauthorised?.(data.code as string);
    throw new ApiError(r.status, String(data.error || r.statusText), data);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => call<T>('GET', p),
  post: <T = any>(p: string, b: unknown = {}) => call<T>('POST', p, b),
  put: <T = any>(p: string, b: unknown = {}) => call<T>('PUT', p, b),
  del: <T = any>(p: string) => call<T>('DELETE', p),
};

export const qs = (o: Record<string, unknown>) => {
  const s = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  return s ? '?' + s : '';
};
