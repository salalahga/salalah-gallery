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
  <div className="row pagehead" style={{ marginBottom: 20, alignItems: 'flex-end' }}>
    <div className="grow"><h1 style={{ marginBottom: 2 }}>{title}</h1>{sub && <div className="muted">{sub}</div>}<span className="orn" /></div>
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
export const Loading = () => <div className="skel" role="status" aria-label="Loading"><i /><i /><i /></div>;

const STATUS_TONE: Record<string, string> = {
  completed: 'ok', paid: 'ok', approved: 'ok', active: 'ok', received: 'ok', delivered: 'ok', fulfilled: 'ok', executed: 'ok', posted: 'ok', present: 'ok', open: 'info',
  pending: 'warn', pending_approval: 'warn', partial: 'warn', partially_received: 'warn', partially_paid: 'warn', partially_refunded: 'warn', draft: '', confirmed: 'info', scheduled: 'info', unfulfilled: 'warn', shipped: 'info', packed: 'info',
  cancelled: 'bad', refunded: 'bad', rejected: 'bad', unpaid: 'bad', disabled: 'bad', expired: 'bad', failed: 'bad', void: 'bad', reversed: 'bad', absent: 'bad', closed: '',
};
export const Status = ({ s }: { s?: string | null }) => (s ? <span className={'badge ' + (STATUS_TONE[s] ?? '')}>{s.replace(/_/g, ' ')}</span> : null);
export const TestBadge = ({ on }: { on?: boolean }) => (on ? <span className="badge test" title="Sample data for testing — not a real transaction">TEST</span> : null);

const LIQUIDS: [string, string][] = [['#f6a6c1', '#e2127a'], ['#c8d6c4', '#7f9a7b'], ['#f2d29a', '#b98f50'], ['#f7b6c8', '#e2264f'], ['#efe0c2', '#c19a5b'], ['#d9c2e8', '#8e5fb0']];
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Perfume-bottle illustration; colour is fixed per brand so every brand keeps its own look. */
export function BottleArt({ name, size = 46 }: { name?: string | null; size?: number | string }) {
  const key = name || '?';
  const [a, b] = LIQUIDS[hash(key) % LIQUIDS.length];
  const id = 'b' + (hash(key) % 100000);
  const initials = key.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <svg width={size} height={size} viewBox="0 0 100 120" aria-hidden="true">
      <defs>
        <linearGradient id={id + 'l'} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>
        <linearGradient id={id + 'c'} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#a87a3c" /><stop offset=".5" stopColor="#f0d79e" /><stop offset="1" stopColor="#a87a3c" /></linearGradient>
      </defs>
      <ellipse cx="50" cy="112" rx="30" ry="4" fill="#000" opacity=".08" />
      <rect x="38" y="6" width="24" height="20" rx="4" fill={`url(#${id}c)`} />
      <rect x="43" y="24" width="14" height="10" fill="#e9dcc5" />
      <rect x="18" y="32" width="64" height="78" rx="16" fill={`url(#${id}l)`} />
      <rect x="18" y="32" width="64" height="78" rx="16" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="2" />
      <path d="M27 42 q-3 22 0 52" stroke="#fff" strokeOpacity=".55" strokeWidth="4" fill="none" strokeLinecap="round" />
      <rect x="32" y="60" width="36" height="24" rx="4" fill="#fffaf2" opacity=".92" />
      <text x="50" y="77" textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontWeight="700" fontSize="14" fill="#5a4630">{initials}</text>
    </svg>
  );
}
export function Bottle({ name, url }: { name?: string | null; url?: string | null }) {
  return <div className="bottle">{url ? <img src={url} alt="" /> : <BottleArt name={name} size="80%" />}</div>;
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
