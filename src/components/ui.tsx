import { useEffect, useState, type ReactNode } from 'react';
import { X, Search, Inbox } from 'lucide-react';

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <header><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, children, span }: { label: string; children: ReactNode; span?: 1 | 2 | 3 }) {
  return <label className={`field span-${span || 1}`}><span>{label}</span>{children}</label>;
}

export function Stat({ label, value, icon, tone = 'wood', sub }: { label: string; value: ReactNode; icon?: ReactNode; tone?: string; sub?: ReactNode }) {
  return (
    <div className={`stat tone-${tone}`}>
      <div className="stat-icon">{icon}</div>
      <div><div className="stat-label">{label}</div><div className="stat-value">{value}</div>{sub && <div className="stat-sub">{sub}</div>}</div>
    </div>
  );
}

export const Badge = ({ children, color, tone }: { children: ReactNode; color?: string; tone?: string }) =>
  <span className={`badge ${tone ? 'tone-' + tone : ''}`} style={color ? { background: color + '1f', color, borderColor: color + '40' } : undefined}>{children}</span>;

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return <div className="empty"><Inbox size={36} strokeWidth={1.4} /><h4>{title}</h4>{hint && <p>{hint}</p>}{action}</div>;
}

export function SearchBox({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <div className="search"><Search size={16} /><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></div>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return <div className="page-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div className="page-actions">{actions}</div></div>;
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string; count?: number }[] }) {
  return <div className="tabs">{tabs.map((t) => <button key={t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>{t.label}{t.count !== undefined && <span>{t.count}</span>}</button>)}</div>;
}

export function Avatar({ name, color, size = 32 }: { name: string; color?: string; size?: number }) {
  const ini = name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return <span className="avatar" style={{ width: size, height: size, background: color || '#7c4a1e', fontSize: size * 0.38 }} title={name}>{ini}</span>;
}

export function Progress({ value, color }: { value: number; color?: string }) {
  return <div className="progress"><div style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} /></div>;
}

export function BarChart({ data, height = 180 }: { data: { label: string; a: number; b: number }[]; height?: number }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  return (
    <div className="barchart" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="bar-group">
          <div className="bars">
            <div className="bar a" style={{ height: `${(d.a / max) * 100}%` }} title={`Income ${d.a.toFixed(2)}`} />
            <div className="bar b" style={{ height: `${(d.b / max) * 100}%` }} title={`Expense ${d.b.toFixed(2)}`} />
          </div>
          <span>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Donut({ parts, size = 140 }: { parts: { label: string; value: number; color: string }[]; size?: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const r = 52; const c = 2 * Math.PI * r; let off = 0;
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--line)" strokeWidth="18" />
        {parts.map((p) => { const len = (p.value / total) * c; const el = <circle key={p.label} cx="70" cy="70" r={r} fill="none" stroke={p.color} strokeWidth="18" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />; off += len; return el; })}
        <text x="70" y="76" textAnchor="middle" className="donut-total">{parts.reduce((s, p) => s + p.value, 0)}</text>
      </svg>
      <ul>{parts.map((p) => <li key={p.label}><i style={{ background: p.color }} />{p.label}<b>{p.value}</b></li>)}</ul>
    </div>
  );
}

let toastFn: (m: string) => void = () => {};
export const toast = (m: string) => toastFn(m);
export function Toaster() {
  const [msgs, setMsgs] = useState<{ id: number; m: string }[]>([]);
  useEffect(() => { toastFn = (m) => { const id = Date.now() + Math.random(); setMsgs((x) => [...x, { id, m }]); setTimeout(() => setMsgs((x) => x.filter((y) => y.id !== id)), 2600); }; }, []);
  return <div className="toaster">{msgs.map((t) => <div key={t.id} className="toast">{t.m}</div>)}</div>;
}

export function confirmDelete(what = 'this record') { return window.confirm(`Delete ${what}? This cannot be undone.`); }
