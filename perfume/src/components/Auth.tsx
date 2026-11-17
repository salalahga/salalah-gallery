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
      <div className="art">
        <PerfumeScene />
        <div style={{ position: 'relative' }}>
          <div className="eyebrow">Maison de parfum · Salalah</div>
          <h2>The art of<br />fragrance, managed<br />beautifully.</h2>
          <p>Every bottle, every sale and every customer of {name} — in one place.</p>
        </div>
      </div>
      <div className="formside">
        <div className="box">
          <div className="row" style={{ justifyContent: 'flex-end' }}><LangPick /></div>
          <div style={{ textAlign: 'center', marginBottom: 18 }}><img src="/brand/logo-dark.png" alt={name} style={{ height: 120, maxWidth: '100%' }} /><div className="muted" style={{ marginTop: 6, letterSpacing: '.18em', textTransform: 'uppercase', fontSize: 11 }}>{title}</div></div>
          {stage === 'loading' && <div className="muted">Loading…</div>}
          {stage === 'setup' && <Setup needsCode={!!status?.setupNeedsCode} onDone={load} />}
          {stage === 'login' && <Login app={app} onDone={load} />}
          {stage === 'mfa' && <Mfa onDone={load} onCancel={logout} />}
          {stage === 'password' && <ChangePassword onDone={load} forced />}
          {stage === 'enrol' && <Enrol onDone={load} />}
        </div>
      </div>
      <Toasts />
    </div>
  );
}

/** Decorative still life: three perfume bottles in the Belle Âme colours. */
function PerfumeScene() {
  const bottle = (x: number, y: number, w: number, h: number, a: string, b: string, id: string, round = 18) => (
    <g key={id}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>
        <linearGradient id={id + 'g'} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8f652c" /><stop offset=".5" stopColor="#f3dca6" /><stop offset="1" stopColor="#8f652c" /></linearGradient>
      </defs>
      <ellipse cx={x + w / 2} cy={y + h + 8} rx={w * 0.55} ry="8" fill="#000" opacity=".35" />
      <rect x={x + w * 0.3} y={y - h * 0.32} width={w * 0.4} height={h * 0.24} rx="6" fill={`url(#${id}g)`} />
      <rect x={x + w * 0.38} y={y - h * 0.09} width={w * 0.24} height={h * 0.1} fill="#e7d6b6" />
      <rect x={x} y={y} width={w} height={h} rx={round} fill={`url(#${id})`} opacity=".96" />
      <rect x={x} y={y} width={w} height={h} rx={round} fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2" />
      <path d={`M${x + w * 0.16} ${y + h * 0.12} q-6 ${h * 0.36} 0 ${h * 0.72}`} stroke="#fff" strokeOpacity=".4" strokeWidth="6" fill="none" strokeLinecap="round" />
    </g>
  );
  return (
    <svg className="bottles" viewBox="0 0 560 520" aria-hidden="true">
      <g transform="translate(330 40) rotate(45)" opacity=".18"><rect width="120" height="120" rx="26" fill="#e2127a" /></g>
      <g transform="translate(120 70) rotate(45)" opacity=".16"><rect width="90" height="90" rx="20" fill="#8fa38c" /></g>
      {bottle(70, 250, 130, 190, '#c8d6c4', '#6f8a6b', 'pb1', 28)}
      {bottle(220, 160, 160, 280, '#f7b0c8', '#e2127a', 'pb2', 36)}
      {bottle(400, 280, 110, 160, '#f2d29a', '#a87a3c', 'pb3', 24)}
      <rect x="252" y="300" width="96" height="62" rx="8" fill="#fffaf2" opacity=".9" />
      <text x="300" y="338" textAnchor="middle" fontFamily="Cormorant Garamond, Georgia, serif" fontSize="22" fontWeight="600" fill="#5a3a40">belle âme</text>
    </svg>
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
