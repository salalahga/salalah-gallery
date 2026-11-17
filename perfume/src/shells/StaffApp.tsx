import { useState } from 'react';
import { api } from '../core/api';
import { t, useLang } from '../core/i18n';
import { money, useSession, date, dateTime } from '../core/session';
import { Card, Empty, Field, Loading, Status, Stat, useAction, useData } from '../components/ui';
import { Icon } from '../components/Icon';
import { LangPick } from '../components/Auth';

type Tab = 'home' | 'attendance' | 'leave' | 'news' | 'me';

/** Staff self-service: only the signed-in person's own records plus what their role allows. */
export function StaffApp() {
  useLang();
  const { me, logout, can } = useSession();
  const [tab, setTab] = useState<Tab>('home');
  const { data: profile } = useData<any>('/me/profile');
  const linked = !!profile?.employee;
  return (
    <div className="mobile">
      <div className="head">
        <div className="row"><img src="/brand/mark.png" alt="" width="44" height="44" /><div className="grow"><div style={{ fontFamily: 'var(--serif)', fontSize: 22, color: 'var(--gold-2)' }}>{me.settings.business.name}</div><div className="small" style={{ color: '#a49d8c' }}>{me.user.name} · {profile?.employee?.job_title || me.user.role}</div></div><LangPick /></div>
      </div>
      {profile && !linked && <div className="alert" style={{ marginBottom: 10 }}>Your login is not linked to an employee profile yet. Ask HR or the owner to link it in Users.</div>}
      {tab === 'home' && <Home canPos={can('pos', 'create')} linked={linked} />}
      {tab === 'attendance' && linked && <MyAttendance />}
      {tab === 'leave' && linked && <MyLeave />}
      {tab === 'news' && <News />}
      {tab === 'me' && <MyProfile profile={profile} logout={logout} />}
      <nav className="tabbar">
        {([['home', 'home', 'Today'], ['attendance', 'clock', t('Attendance')], ['leave', 'hr', t('Leave')], ['news', 'bell', t('Announcements')], ['me', 'users', t('My profile')]] as [Tab, string, string][]).map(([k, icon, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon name={icon} size={22} />{label}</button>
        ))}
      </nav>
    </div>
  );
}

function Home({ canPos, linked }: { canPos: boolean; linked: boolean }) {
  const { data: sales } = useData<any>('/me/sales');
  const { data: att, reload } = useData<any[]>(linked ? '/me/attendance' : null, [linked]);
  const { busy, run } = useAction();
  const todayRow = att?.find((a) => a.date?.slice(0, 10) === new Date().toISOString().slice(0, 10));
  const pct = sales?.target ? Math.min(100, Math.round((sales.total / sales.target) * 100)) : null;
  return (
    <div className="col">
      {linked && (
        <Card title="Today">
          <div className="row">
            <div className="grow">{todayRow?.check_in ? <>In at {dateTime(todayRow.check_in)}{todayRow.check_out && <> · out at {dateTime(todayRow.check_out)}</>}</> : 'Not checked in yet'}</div>
            {!todayRow?.check_in && <button className="btn gold lg" disabled={busy} onClick={() => run(() => api.post('/me/check-in'), 'Checked in').then(reload)}>{t('Check in')}</button>}
            {todayRow?.check_in && !todayRow?.check_out && <button className="btn primary lg" disabled={busy} onClick={() => run(() => api.post('/me/check-out'), 'Checked out').then(reload)}>{t('Check out')}</button>}
          </div>
        </Card>
      )}
      <Stat dark label={t('My sales') + ' — this month'} value={sales ? money(sales.total) : '…'} sub={sales && `${sales.orders} sales${pct != null ? ` · ${pct}% of target ${money(sales.target)}` : ''}`} />
      {pct != null && <div className="bars"><div className="track" style={{ height: 14 }}><div className="fill" style={{ width: pct + '%' }} /></div></div>}
      {canPos && <a className="btn gold lg" href="/#/pos">Open the till (POS)</a>}
    </div>
  );
}

function MyAttendance() {
  const { data } = useData<any[]>('/me/attendance');
  if (!data) return <Loading />;
  return <Card title={t('Attendance')}>{!data.length ? <Empty>No records yet</Empty> : <table className="t"><tbody>{data.map((a) => <tr key={a.id}><td>{date(a.date)}</td><td><Status s={a.status} /></td><td className="small">{a.check_in ? new Date(a.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'} – {a.check_out ? new Date(a.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>{a.overtime_minutes > 0 && <td className="small">+{a.overtime_minutes} min</td>}</tr>)}</tbody></table>}</Card>;
}

function MyLeave() {
  const { data, reload } = useData<any[]>('/me/leave');
  const [f, setF] = useState({ kind: 'annual', fromDate: '', toDate: '', reason: '' });
  const { busy, run } = useAction();
  return (
    <div className="col">
      <Card title={t('Request leave')}>
        <div className="col">
          <Field label="Type"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['annual', 'sick', 'emergency', 'unpaid', 'hajj', 'maternity', 'other'].map((k) => <option key={k}>{k}</option>)}</select></Field>
          <div className="row"><Field label="From"><input type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></Field><Field label="To"><input type="date" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field></div>
          <Field label="Reason"><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <button className="btn gold" disabled={busy || !f.fromDate || !f.toDate} onClick={() => run(() => api.post('/me/leave', f), 'Request sent').then(() => { setF({ kind: 'annual', fromDate: '', toDate: '', reason: '' }); reload(); })}>Send request</button>
        </div>
      </Card>
      <Card title="My requests">{!data?.length ? <Empty>No requests</Empty> : data.map((l) => <div key={l.id} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}><span className="grow">{l.kind} · {date(l.from_date)} – {date(l.to_date)} ({l.days}d)</span><Status s={l.status} /></div>)}</Card>
    </div>
  );
}

function News() {
  const { data } = useData<any[]>('/announcements');
  return <Card title={t('Announcements')}>{!data?.length ? <Empty>No announcements</Empty> : data.map((a) => <div key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}><b>{a.title}</b><div style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div><div className="small muted">{dateTime(a.created_at)}</div></div>)}</Card>;
}

function MyProfile({ profile, logout }: { profile: any; logout: () => void }) {
  const e = profile?.employee;
  return (
    <div className="col">
      <Card title={t('My profile')}>
        {!e ? <Empty>No employee profile linked</Empty> : <dl className="kv">
          <dt>Employee ID</dt><dd>{e.code}</dd><dt>Job</dt><dd>{e.job_title} · {e.department}</dd><dt>Branch</dt><dd>{e.branch}</dd><dt>Joined</dt><dd>{date(e.joining_date)}</dd>
          <dt>Schedule</dt><dd>{e.work_schedule || '—'}</dd><dt>Annual leave</dt><dd>{e.annual_leave_days} days / year</dd><dt>Phone</dt><dd>{e.phone}</dd><dt>Bank</dt><dd>{e.bank_iban || '—'}</dd>
          <dt>Resident card</dt><dd>{date(e.id_expiry)}</dd>
        </dl>}
      </Card>
      <Card title="Salary slips"><div className="small muted">Payslips will appear here once payroll runs are enabled (next development phase).</div></Card>
      <a className="btn" href="/#/account">Password & two-factor</a>
      <button className="btn" onClick={logout}>{t('Log out')}</button>
    </div>
  );
}
