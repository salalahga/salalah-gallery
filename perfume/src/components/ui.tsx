import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { api, ApiError } from '../core/api';

// ---------- toasts ----------
type Toast = { id: number; text: string; err?: boolean };
let toasts: Toast[] = [];
const tsubs = new Set<() => void>();
export function toast(text: string, err = false) {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, text, err }];
  tsubs.forEach((f) => f());
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== id); tsubs.forEach((f) => f()); }, err ? 6000 : 3200);
}
export const toastError = (e: unknown) => toast(e instanceof ApiError || e instanceof Error ? e.message : String(e), true);
export function Toasts() {
  const list = useSyncExternalStore((f) => { tsubs.add(f); return () => tsubs.delete(f); }, () => toasts);
  return <div className="toasts" role="status">{list.map((x) => <div key={x.id} className={'toast' + (x.err ? ' err' : '')}>{x.text}</div>)}</div>;
}

// ---------- data loading ----------
export function useData<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api.get<T>(path).then((d) => { if (live) { setData(d); setError(null); } }).catch((e) => live && setError(e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, n, ...deps]);
  return { data, error, reload: () => setN((x) => x + 1), setData };
}

/** Run an action with busy state and error toast. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toastError(e); return undefined; } finally { setBusy(false); }
  };
  return { busy, run };
}

// ---------- layout ----------
export const Card = ({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={'card ' + className}>
    {(title || actions) && <div className="row" style={{ marginBottom: 10 }}>{title && <h3 className="grow" style={{ margin: 0 }}>{title}</h3>}{actions}</div>}
    {children}
  </section>
);
export const Stat = ({ label, value, sub, dark }: { label: ReactNode; value: ReactNode; sub?: ReactNode; dark?: boolean }) => (
  <div className={'card stat' + (dark ? ' dark' : '')}><div className="label">{label}</div><div className="value">{value}</div>{sub && <div className="sub">{sub}</div>}</div>
);
export const PageHead = ({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) => (
  <div className="row" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
    <div className="grow"><h1 style={{ marginBottom: 0 }}>{title}</h1>{sub && <div className="muted">{sub}</div>}</div>
    {actions && <div className="row no-print">{actions}</div>}
  </div>
);
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (v: T) => void }) {
  return <div className="tabs no-print">{tabs.map(([k, l]) => <button key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
export function Modal({ title, children, footer, onClose, wide }: { title: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <header><h3>{title}</h3><button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button></header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}
export const Field = ({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) => (
  <label className="f"><span>{label}</span>{children}{hint && <span className="small muted">{hint}</span>}</label>
);
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Loading = () => <div className="empty">Loading…</div>;

const STATUS_TONE: Record<string, string> = {
  completed: 'ok', paid: 'ok', approved: 'ok', active: 'ok', received: 'ok', delivered: 'ok', fulfilled: 'ok', executed: 'ok', posted: 'ok', present: 'ok', open: 'info',
  pending: 'warn', pending_approval: 'warn', partial: 'warn', partially_received: 'warn', partially_paid: 'warn', partially_refunded: 'warn', draft: '', confirmed: 'info', scheduled: 'info', unfulfilled: 'warn', shipped: 'info', packed: 'info',
  cancelled: 'bad', refunded: 'bad', rejected: 'bad', unpaid: 'bad', disabled: 'bad', expired: 'bad', failed: 'bad', void: 'bad', reversed: 'bad', absent: 'bad', closed: '',
};
export const Status = ({ s }: { s?: string | null }) => (s ? <span className={'badge ' + (STATUS_TONE[s] ?? '')}>{s.replace(/_/g, ' ')}</span> : null);
export const TestBadge = ({ on }: { on?: boolean }) => (on ? <span className="badge test" title="Sample data for testing — not a real transaction">TEST</span> : null);

export function Bottle({ name, url }: { name?: string | null; url?: string | null }) {
  return <div className="bottle">{url ? <img src={url} alt="" /> : (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</div>;
}

// ---------- charts (SVG, no library) ----------
export function LineChart({ points, height = 180, format = (n: number) => String(n) }: { points: { x: string; y: number }[]; height?: number; format?: (n: number) => string }) {
  if (!points.length) return <Empty>No data yet</Empty>;
  const W = 720, H = height, P = 28;
  const max = Math.max(1, ...points.map((p) => p.y));
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Trend chart">
      <defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#c9a24b" stopOpacity=".35" /><stop offset="1" stopColor="#c9a24b" stopOpacity="0" /></linearGradient></defs>
      {[0, .5, 1].map((f) => <g key={f}><line x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} stroke="#eee8da" /><text x={P} y={y(max * f) - 4} fontSize="10" fill="#8f897b">{format(max * f)}</text></g>)}
      <path d={`${d} L${x(points.length - 1)},${H - P} L${x(0)},${H - P} Z`} fill="url(#lg)" />
      <path d={d} fill="none" stroke="#b98f35" strokeWidth="2.5" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.y)} r="3" fill="#0b0b0c"><title>{`${p.x}: ${format(p.y)}`}</title></circle>)}
      {points.map((p, i) => (i % Math.ceil(points.length / 8) === 0 ? <text key={'t' + i} x={x(i)} y={H - 8} fontSize="10" fill="#8f897b" textAnchor="middle">{p.x.slice(5)}</text> : null))}
    </svg>
  );
}
export function Bars({ items, format = (n: number) => String(n) }: { items: { label: ReactNode; value: number }[]; format?: (n: number) => string }) {
  if (!items.length) return <Empty>No data yet</Empty>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return <div className="bars">{items.map((it, k) => <div className="bar" key={k}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span><div className="track"><div className="fill" style={{ width: `${(it.value / max) * 100}%` }} /></div><span className="num">{format(it.value)}</span></div>)}</div>;
}

export function Confirm({ text, onYes, onClose, yes = 'Confirm', danger }: { text: ReactNode; onYes: () => void; onClose: () => void; yes?: string; danger?: boolean }) {
  return <Modal title="Please confirm" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { onYes(); onClose(); }}>{yes}</button></>}>{text}</Modal>;
}

export function download(path: string) {
  const a = document.createElement('a');
  a.href = '/api' + path; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}
