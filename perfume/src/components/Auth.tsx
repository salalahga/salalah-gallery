import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, setUnauthorisedHandler } from '../core/api';
import { LANGS, setLang, t, useLang } from '../core/i18n';
import { SessionCtx, type Me } from '../core/session';
import { Field, toastError, Toasts } from './ui';

type Status = { setupDone: boolean; setupNeedsCode: boolean; business: { name: string; nameAr: string } };

function LangPick() {
  const lang = useLang();
  return <select value={lang} onChange={(e) => setLang(e.target.value as 'en')} style={{ width: 'auto' }} aria-label={t('Language')}>{LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>;
}

/** Wraps an application: first-run setup, login, 2FA, forced password change, then the app. */
export function AuthGate({ app, title, children }: { app: 'admin' | 'manager' | 'staff'; title: string; children: ReactNode }) {
  useLang();
  const [status, setStatus] = useState<Status | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [stage, setStage] = useState<'loading' | 'setup' | 'login' | 'mfa' | 'enrol' | 'password' | 'in'>('loading');
  const load = async () => {
    try {
      const s = await api.get<Status>('/status');
      setStatus(s);
      if (!s.setupDone) return setStage(app === 'admin' ? 'setup' : 'login');
      const m = await api.get<Me>('/auth/me');
      setMe(m);
      if (!m.mfaOk) return setStage('mfa');
      if (m.user.mustChangePassword) return setStage('password');
      if (m.mfaEnrolRequired) return setStage('enrol');
      setStage('in');
    } catch (e: any) {
      if (e?.data?.code === 'mfa_required') return setStage('mfa');
      setStage('login');
    }
  };
  useEffect(() => { setUnauthorisedHandler(() => load()); load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const logout = async () => { await api.post('/auth/logout').catch(() => {}); setMe(null); setStage('login'); };
  const name = status?.business.name || 'Belle Âme';

  if (stage === 'in' && me) return <SessionCtx.Provider value={{ me, refresh: load, logout }}>{children}<Toasts /></SessionCtx.Provider>;
  return (
    <div className="login">
      <div className="box">
        <div className="row" style={{ justifyContent: 'flex-end' }}><LangPick /></div>
        <div style={{ textAlign: 'center', marginBottom: 16 }}><img src="/brand/logo-light.png" alt={name} style={{ height: 150, maxWidth: '100%' }} /><div className="muted" style={{ marginTop: 6 }}>{title}</div></div>
        {stage === 'loading' && <div className="muted">Loading…</div>}
        {stage === 'setup' && <Setup needsCode={!!status?.setupNeedsCode} onDone={load} />}
        {stage === 'login' && <Login app={app} onDone={load} />}
        {stage === 'mfa' && <Mfa onDone={load} onCancel={logout} />}
        {stage === 'password' && <ChangePassword onDone={load} forced />}
        {stage === 'enrol' && <Enrol onDone={load} />}
      </div>
      <Toasts />
    </div>
  );
}

function Login({ app, onDone }: { app: string; onDone: () => void }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); try { await api.post('/auth/login', { username: u, password: p, app }); onDone(); } catch (er) { toastError(er); } finally { setBusy(false); } };
  return (
    <form className="col" onSubmit={submit}>
      <Field label={t('Username')}><input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoCapitalize="none" required /></Field>
      <Field label={t('Password')}><input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></Field>
      <button className="btn gold lg" disabled={busy}>{t('Sign in')}</button>
      <div className="small muted">{app === 'manager' ? 'Business Manager access is set by the owner.' : app === 'staff' ? 'Staff self-service: attendance, leave, payslips and your sales.' : 'Owner, admin, accounts, HR and till staff.'}</div>
    </form>
  );
}

function Setup({ needsCode, onDone }: { needsCode: boolean; onDone: () => void }) {
  const [f, setF] = useState({ businessName: 'Belle Âme', name: '', username: 'owner', password: '', setupCode: '', demo: true });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); try { await api.post('/auth/setup', f); onDone(); } catch (er) { toastError(er); } finally { setBusy(false); } };
  return (
    <form className="col" onSubmit={submit}>
      <div className="muted">First start: create the owner account. The owner controls every app, user, permission and setting.</div>
      <Field label="Business name"><input value={f.businessName} onChange={(e) => set('businessName', e.target.value)} /></Field>
      <Field label="Your name"><input value={f.name} onChange={(e) => set('name', e.target.value)} required /></Field>
      <Field label="Username"><input value={f.username} onChange={(e) => set('username', e.target.value)} required /></Field>
      <Field label="Password (8+ characters, letters and numbers)"><input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} required /></Field>
      {needsCode && <Field label="Setup code"><input value={f.setupCode} onChange={(e) => set('setupCode', e.target.value)} required /></Field>}
      <label className="check"><input type="checkbox" checked={f.demo} onChange={(e) => set('demo', e.target.checked)} /> Load sample data for testing (marked TEST, logins: cashier / manager / accountant / staff, password Demo1234)</label>
      <button className="btn gold lg" disabled={busy}>Create owner account</button>
    </form>
  );
}

function Mfa({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [c, setC] = useState('');
  const submit = async (e: FormEvent) => { e.preventDefault(); try { await api.post('/auth/mfa', { code: c }); onDone(); } catch (er) { toastError(er); } };
  return (
    <form className="col" onSubmit={submit}>
      <div>Enter the 6-digit code from your authenticator app.</div>
      <input value={c} onChange={(e) => setC(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="123456" style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }} />
      <button className="btn gold lg">Verify</button>
      <button type="button" className="btn ghost" onClick={onCancel}>Use another account</button>
    </form>
  );
}

export function ChangePassword({ onDone, forced }: { onDone: () => void; forced?: boolean }) {
  const [f, setF] = useState({ current: '', password: '', again: '' });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.password !== f.again) return toastError('The new passwords do not match');
    try { await api.post('/auth/password', { current: f.current, password: f.password }); onDone(); } catch (er) { toastError(er); }
  };
  return (
    <form className="col" onSubmit={submit}>
      {forced && <div>Please choose your own password before continuing.</div>}
      <Field label="Current password"><input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></Field>
      <Field label="New password"><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
      <Field label="New password again"><input type="password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} required /></Field>
      <button className="btn gold">Change password</button>
    </form>
  );
}

export function Enrol({ onDone }: { onDone: () => void }) {
  const [s, setS] = useState<{ secret: string; url: string } | null>(null);
  const [c, setC] = useState('');
  useEffect(() => { api.post('/auth/2fa/begin').then(setS).catch(toastError); }, []);
  const submit = async (e: FormEvent) => { e.preventDefault(); try { await api.post('/auth/2fa/enable', { code: c }); onDone(); } catch (er) { toastError(er); } };
  return (
    <form className="col" onSubmit={submit}>
      <div>Two-factor authentication protects this account. In Google Authenticator, Microsoft Authenticator or Authy choose <b>Enter a setup key</b> and type:</div>
      <code style={{ fontSize: 16, letterSpacing: 2, wordBreak: 'break-all', background: '#00000033', padding: 10, borderRadius: 8 }}>{s?.secret.replace(/(.{4})/g, '$1 ').trim() || '…'}</code>
      <a href={s?.url} className="small">Open in authenticator app (on this phone)</a>
      <Field label="Then enter the 6-digit code it shows"><input value={c} onChange={(e) => setC(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }} /></Field>
      <button className="btn gold">Turn on two-factor</button>
    </form>
  );
}

export { LangPick };
