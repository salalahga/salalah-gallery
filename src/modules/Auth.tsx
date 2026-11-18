import { useState, type FormEvent } from 'react';
import { LogIn, ShieldCheck, Loader2 } from 'lucide-react';
import { api } from '../core/api';
import { LangSwitch } from '../components/LangSwitch';
import { session } from '../core/session';
import { hasLocalData, localSnapshot, useSettings } from '../core/store';
import { seed } from '../core/seed';

const T = {
  en: { welcome: 'Welcome back', sub: 'Log in to your workshop', user: 'Username', pass: 'Password', login: 'Log in', expired: 'Your session expired. Please log in again.',
    setupTitle: 'Set up your workshop', setupSub: 'Create the owner account. You can add managers and staff logins later in Settings → Users.',
    name: 'Your name', confirm: 'Confirm password', start: 'Start with', mine: 'Data already on this device', demo: 'Demo data (to explore)', empty: 'Empty — I will add my own', create: 'Create owner account', mismatch: 'Passwords do not match', short: 'Password must be at least 6 characters' },
};

function Shell({ children }: { children: React.ReactNode }) {
  const s = useSettings();
  return (
    <div className="auth">
      <div className="auth-side">
        <div className="logo big has-img">{s.logoLight || s.logo ? <img src={s.logoLight || s.logo} alt="" /> : null}</div>
        <h1>{s.businessName}</h1>
        <p>Jobs · CNC · Staff · Payroll · Quotations · Accounts · Sales · Social · Website</p>
        <LangSwitch wide />
      </div>
      <div className="auth-main"><div className="auth-card">{children}</div></div>
    </div>
  );
}

export function Login({ expired }: { expired?: boolean }) {
  const t = T.en;
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState<{ code: string; password: string; done?: boolean } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (reset) { await api('/api/reset-owner', { method: 'POST', body: { code: reset.code, username: u, password: reset.password } }); setReset(null); setP(''); setErr(''); alert('Password changed — log in with the new password.'); }
      else await session.login(u, p);
    } catch (x) { setErr((x as Error).message || 'Could not reach the server'); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <h2>{t.welcome}</h2><p className="muted">{t.sub}</p>
      {expired && <div className="alert">{t.expired}</div>}
      <form onSubmit={submit} className="auth-form">
        <label className="field"><span>{t.user}</span><input autoFocus autoComplete="username" autoCapitalize="none" value={u} onChange={(e) => setU(e.target.value)} required /></label>
        {!reset && <label className="field"><span>{t.pass}</span><input type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></label>}
        {reset && <><label className="field"><span>Setup code (from whoever runs the server)</span><input autoComplete="off" value={reset.code} onChange={(e) => setReset({ ...reset, code: e.target.value.trim() })} required /></label>
          <label className="field"><span>New password (min 8)</span><input type="password" autoComplete="new-password" minLength={8} value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} required /></label></>}
        {err && <div className="alert error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />}{reset ? 'Set new owner password' : t.login}</button>
        <button type="button" className="btn ghost block" onClick={() => { setReset(reset ? null : { code: '', password: '' }); setErr(''); }}>{reset ? 'Back to login' : 'Forgot password?'}</button>
        {!reset && <p className="muted" style={{ fontSize: 12, margin: 0 }}>Staff and viewers: ask the owner to set a new password in Settings → Users.</p>}
      </form>
    </Shell>
  );
}

export function Setup({ needsCode }: { needsCode?: boolean }) {
  const t = T.en;
  const local = hasLocalData();
  const [f, setF] = useState({ name: '', username: 'owner', password: '', confirm: '', code: '', start: local ? 'mine' : 'empty' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (f.password.length < 6) return setErr(t.short);
    if (f.password !== f.confirm) return setErr(t.mismatch);
    setBusy(true);
    try {
      const data = f.start === 'mine' ? localSnapshot() : f.start === 'demo' ? seed() : undefined;
      await session.setup({ name: f.name, username: f.username, password: f.password, data, code: f.code || undefined });
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <h2><ShieldCheck size={22} style={{ verticalAlign: -3, color: 'var(--wood)' }} /> {t.setupTitle}</h2><p className="muted">{t.setupSub}</p>
      <form onSubmit={submit} className="auth-form">
        {needsCode && <label className="field"><span>Setup code (given to the owner)</span><input autoFocus autoComplete="off" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.trim() })} required /></label>}
        <label className="field"><span>{t.name}</span><input autoFocus={!needsCode} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        <label className="field"><span>{t.user}</span><input autoCapitalize="none" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required /></label>
        <label className="field"><span>{t.pass}</span><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></label>
        <label className="field"><span>{t.confirm}</span><input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></label>
        <div className="field"><span>{t.start}</span><div className="chips">
          {local && <button type="button" className={`chip ${f.start === 'mine' ? 'on' : ''}`} onClick={() => setF({ ...f, start: 'mine' })}>{t.mine}</button>}
          <button type="button" className={`chip ${f.start === 'demo' ? 'on' : ''}`} onClick={() => setF({ ...f, start: 'demo' })}>{t.demo}</button>
          <button type="button" className={`chip ${f.start === 'empty' ? 'on' : ''}`} onClick={() => setF({ ...f, start: 'empty' })}>{t.empty}</button>
        </div></div>
        {err && <div className="alert error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy && <Loader2 size={16} className="spin" />}{t.create}</button>
      </form>
    </Shell>
  );
}

export function Splash() {
  return <div className="splash"><Loader2 size={28} className="spin" /></div>;
}
