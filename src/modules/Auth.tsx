import { useState, type FormEvent } from 'react';
import { LogIn, ShieldCheck, Loader2 } from 'lucide-react';
import { session } from '../core/session';
import { hasLocalData, localSnapshot } from '../core/store';
import { seed } from '../core/seed';
import { useLang } from '../core/i18n';

const T = {
  en: { welcome: 'Welcome back', sub: 'Log in to your workshop', user: 'Username', pass: 'Password', login: 'Log in', expired: 'Your session expired. Please log in again.',
    setupTitle: 'Set up your workshop', setupSub: 'Create the owner account. You can add managers and staff logins later in Settings → Users.',
    name: 'Your name', confirm: 'Confirm password', start: 'Start with', mine: 'Data already on this device', demo: 'Demo data (to explore)', empty: 'Empty — I will add my own', create: 'Create owner account', mismatch: 'Passwords do not match', short: 'Password must be at least 6 characters' },
  ml: { welcome: 'സ്വാഗതം', sub: 'നിങ്ങളുടെ വർക്ക്ഷോപ്പിലേക്ക് ലോഗിൻ ചെയ്യുക', user: 'യൂസർനെയിം', pass: 'പാസ്‌വേഡ്', login: 'ലോഗിൻ', expired: 'സെഷൻ കഴിഞ്ഞു. വീണ്ടും ലോഗിൻ ചെയ്യുക.',
    setupTitle: 'വർക്ക്ഷോപ്പ് സെറ്റപ്പ്', setupSub: 'ഉടമയുടെ അക്കൗണ്ട് ഉണ്ടാക്കുക. മാനേജർ, സ്റ്റാഫ് ലോഗിനുകൾ പിന്നീട് Settings → Users-ൽ ചേർക്കാം.',
    name: 'നിങ്ങളുടെ പേര്', confirm: 'പാസ്‌വേഡ് വീണ്ടും', start: 'തുടങ്ങേണ്ടത്', mine: 'ഈ ഉപകരണത്തിലെ ഡാറ്റ', demo: 'ഡെമോ ഡാറ്റ', empty: 'ശൂന്യം — ഞാൻ ചേർക്കാം', create: 'അക്കൗണ്ട് ഉണ്ടാക്കുക', mismatch: 'പാസ്‌വേഡുകൾ ഒരുപോലെയല്ല', short: 'പാസ്‌വേഡ് കുറഞ്ഞത് 6 അക്ഷരം' },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-side">
        <div className="logo big"><svg viewBox="0 0 64 64"><path d="M14 44 L32 14 L50 44 Z" fill="none" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" /><path d="M22 44h20" stroke="#e0a458" strokeWidth="6" strokeLinecap="round" /></svg></div>
        <h1>WoodWorks Pro</h1>
        <p>Jobs · CNC · Staff · Payroll · Quotations · Accounts · Sales · Social · Website</p>
      </div>
      <div className="auth-main"><div className="auth-card">{children}</div></div>
    </div>
  );
}

export function Login({ expired }: { expired?: boolean }) {
  const t = T[useLang()];
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await session.login(u, p); } catch (x) { setErr((x as Error).message || 'Could not reach the server'); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <h2>{t.welcome}</h2><p className="muted">{t.sub}</p>
      {expired && <div className="alert">{t.expired}</div>}
      <form onSubmit={submit} className="auth-form">
        <label className="field"><span>{t.user}</span><input autoFocus autoComplete="username" autoCapitalize="none" value={u} onChange={(e) => setU(e.target.value)} required /></label>
        <label className="field"><span>{t.pass}</span><input type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></label>
        {err && <div className="alert error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />}{t.login}</button>
      </form>
    </Shell>
  );
}

export function Setup() {
  const t = T[useLang()];
  const local = hasLocalData();
  const [f, setF] = useState({ name: '', username: 'owner', password: '', confirm: '', start: local ? 'mine' : 'empty' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (f.password.length < 6) return setErr(t.short);
    if (f.password !== f.confirm) return setErr(t.mismatch);
    setBusy(true);
    try {
      const data = f.start === 'mine' ? localSnapshot() : f.start === 'demo' ? seed() : undefined;
      await session.setup({ name: f.name, username: f.username, password: f.password, data });
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <h2><ShieldCheck size={22} style={{ verticalAlign: -3, color: 'var(--wood)' }} /> {t.setupTitle}</h2><p className="muted">{t.setupSub}</p>
      <form onSubmit={submit} className="auth-form">
        <label className="field"><span>{t.name}</span><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
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
