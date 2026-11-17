// Client for the local print agent (agent/print-agent.js) running on this shop computer.
// Settings are per computer (stored in this browser), because each computer has its own agent.
const KEY = 'pf-print-agent';
type AgentCfg = { url: string; token: string };
export function agentConfig(): AgentCfg {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return { url: v.url || 'http://127.0.0.1:9333', token: v.token || '' }; } catch { return { url: 'http://127.0.0.1:9333', token: '' }; }
}
export function saveAgentConfig(c: AgentCfg) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ } }

async function call<T = any>(path: string, body?: unknown, timeoutMs = 8000): Promise<T> {
  const { url, token } = agentConfig();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-agent-token': token }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal, targetAddressSpace: 'local' } as RequestInit);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Print agent error ${r.status}`);
    return data as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('The print agent did not answer. Is it running on this computer?');
    if (e instanceof TypeError) throw new Error('Cannot reach the print agent on this computer. Start it (see Barcodes & labels → Setup) and allow the browser to connect to local devices.');
    throw e;
  } finally { clearTimeout(t); }
}

export const agent = {
  hello: () => call<{ agent: string; version: string; platform: string }>('/hello', undefined, 3000),
  status: () => call<{ version: string; hostname: string; platform: string; printers: { name: string; share?: string | null; driver?: string }[] | { error: string } }>('/status'),
  probe: (p: { connection: string; host?: string; port?: number; queue?: string; language?: string }) => call<{ reachable: boolean; detected?: string | null; error?: string; note?: string; printers?: string[] }>('/probe', p),
  print: (p: { connection: string; host?: string; port?: number; queue?: string }, data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    return call<{ ok: boolean; bytes: number }>('/print', { ...p, dataBase64: btoa(bin) }, 30000);
  },
};
