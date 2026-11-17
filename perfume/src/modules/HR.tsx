import { useState } from 'react';
import { api, qs } from '../core/api';
import { t } from '../core/i18n';
import { money, parseMoney, useSession, date, dateTime, today } from '../core/session';
import { Card, Empty, Field, Loading, Modal, PageHead, Status, Tabs, TestBadge, useAction, useData, download } from '../components/ui';

type Tab = 'people' | 'attendance' | 'leave' | 'announcements';

export default function HR() {
  const [tab, setTab] = useState<Tab>('people');
  return (
    <>
      <PageHead title={t('HR & staff')} sub="Employee records, attendance, leave and announcements" />
      <Tabs tabs={[['people', 'Employees'], ['attendance', t('Attendance')], ['leave', t('Leave')], ['announcements', t('Announcements')]]} value={tab} onChange={setTab} />
      {tab === 'people' && <People />}
      {tab === 'attendance' && <Attendance />}
      {tab === 'leave' && <Leave />}
      {tab === 'announcements' && <Announcements />}
    </>
  );
}

function People() {
  const { can } = useSession();
  const { data, reload } = useData<any[]>('/employees');
  const [edit, setEdit] = useState<any>(null);
  const pay = can('hr');
  const soon = (d?: string) => d && (new Date(d).getTime() - Date.now()) / 86400e3 < 45;
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}><div className="grow" />{can('hr', 'create') && <button className="btn primary" onClick={() => setEdit({})}>+ Employee</button>}</div>
      <div className="card tablewrap">{!data ? <Loading /> : !data.length ? <Empty>No employees yet</Empty> : (
        <table className="t"><thead><tr><th>Employee</th><th>Job</th><th>Branch</th><th>Joined</th><th>Status</th>{pay && <th className="num">Monthly pay</th>}<th>Documents</th></tr></thead>
          <tbody>{data.map((e) => <tr key={e.id} className={can('hr', 'edit') ? 'click' : ''} onClick={() => can('hr', 'edit') && setEdit(e)}>
            <td><b>{e.name}</b> <TestBadge on={e.is_test} /><div className="small muted">{e.code} · {e.phone}</div></td><td>{e.job_title}<div className="small muted">{e.department}</div></td><td>{e.branch}</td><td>{date(e.joining_date)}{e.probation_end && new Date(e.probation_end) > new Date() && <div className="small warn">probation to {date(e.probation_end)}</div>}</td><td><Status s={e.status} /></td>
            {pay && <td className="num">{money(e.basic_salary + e.housing_allowance + e.transport_allowance + e.other_allowance)}<div className="small muted">basic {money(e.basic_salary)}</div></td>}
            <td className="small">{e.id_expiry && <div className={soon(e.id_expiry) ? 'bad' : ''}>ID {date(e.id_expiry)}</div>}{e.passport_expiry && <div className={soon(e.passport_expiry) ? 'bad' : ''}>Passport {date(e.passport_expiry)}</div>}</td></tr>)}</tbody></table>
      )}</div>
      {edit && <EmployeeForm e={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function EmployeeForm({ e, onClose, onDone }: { e: any; onClose: () => void; onDone: () => void }) {
  const { data: branches } = useData<any[]>('/branches');
  const m = (v: number | undefined) => (v ? money(v) : '');
  const [f, setF] = useState<any>({ name: e.name || '', phone: e.phone || '', email: e.email || '', nationality: e.nationality || '', jobTitle: e.job_title || '', department: e.department || 'Retail', branchId: e.branch_id || 'br_main', joiningDate: e.joining_date?.slice(0, 10) || today(), probationEnd: e.probation_end?.slice(0, 10) || '', status: e.status || 'active',
    basicSalary: m(e.basic_salary), housingAllowance: m(e.housing_allowance), transportAllowance: m(e.transport_allowance), otherAllowance: m(e.other_allowance), workSchedule: e.work_schedule || 'Sat–Thu 10:00–22:00 split shift', annualLeaveDays: e.annual_leave_days ?? 30, salesTarget: m(e.sales_target), idExpiry: e.id_expiry?.slice(0, 10) || '', passportExpiry: e.passport_expiry?.slice(0, 10) || '', bankIban: '', idNumber: '' });
  const { busy, run } = useAction();
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const txt = (k: string, label: string, type = 'text') => <Field label={label}><input type={type} value={f[k]} onChange={(ev) => set(k, ev.target.value)} /></Field>;
  const save = () => run(() => {
    const body = { ...f, basicSalary: parseMoney(f.basicSalary), housingAllowance: parseMoney(f.housingAllowance), transportAllowance: parseMoney(f.transportAllowance), otherAllowance: parseMoney(f.otherAllowance), salesTarget: parseMoney(f.salesTarget), annualLeaveDays: Number(f.annualLeaveDays) };
    return e.id ? api.put(`/employees/${e.id}`, body) : api.post('/employees', body);
  }, 'Saved').then((r) => r && onDone());
  return (
    <Modal wide title={e.id ? `Edit ${e.name}` : 'New employee'} onClose={onClose} footer={<button className="btn primary" disabled={busy || !f.name} onClick={save}>Save</button>}>
      <div className="grid g3">
        {txt('name', 'Full name')}{txt('phone', 'Phone')}{txt('email', 'Email')}{txt('nationality', 'Nationality')}{txt('jobTitle', 'Job title')}{txt('department', 'Department')}
        <Field label="Branch"><select value={f.branchId} onChange={(ev) => set('branchId', ev.target.value)}>{branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        {txt('joiningDate', 'Joining date', 'date')}{txt('probationEnd', 'Probation ends', 'date')}
        <Field label="Status"><select value={f.status} onChange={(ev) => set('status', ev.target.value)}>{['candidate', 'onboarding', 'probation', 'active', 'on_leave', 'resigned', 'terminated'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></Field>
        {txt('basicSalary', 'Basic salary (OMR / month)')}{txt('housingAllowance', 'Housing allowance')}{txt('transportAllowance', 'Transport allowance')}{txt('otherAllowance', 'Other allowance')}{txt('salesTarget', 'Monthly sales target (OMR)')}{txt('annualLeaveDays', 'Annual leave days')}
        {txt('workSchedule', 'Work schedule')}{txt('idExpiry', 'Resident card expiry', 'date')}{txt('passportExpiry', 'Passport expiry', 'date')}
        <Field label="Bank IBAN" hint={e.bank_iban ? `Saved: ${e.bank_iban} — type to replace` : 'Stored encrypted'}><input value={f.bankIban} onChange={(ev) => set('bankIban', ev.target.value)} autoComplete="off" /></Field>
        <Field label="ID / civil number" hint={e.id_number ? `Saved: ${e.id_number}` : 'Stored encrypted'}><input value={f.idNumber} onChange={(ev) => set('idNumber', ev.target.value)} autoComplete="off" /></Field>
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>Oman labour rules (leave, end-of-service, social insurance) differ by nationality and change over time — confirm payroll settings with the Ministry of Labour / SPF guidance before relying on them.</div>
    </Modal>
  );
}

function Attendance() {
  const { can } = useSession();
  const [d, setD] = useState({ from: today(), to: today() });
  const { data, reload } = useData<any[]>('/attendance' + qs(d), [d.from, d.to]);
  const { data: emps } = useData<any[]>('/employees');
  const [mark, setMark] = useState({ employeeId: '', status: 'present', overtimeMinutes: '0', note: '' });
  const { busy, run } = useAction();
  return (
    <>
      <div className="card row" style={{ marginBottom: 10 }}>
        <input type="date" value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })} style={{ width: 'auto' }} /><input type="date" value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} style={{ width: 'auto' }} />
        <div className="grow" />{can('reports', 'export') && <button className="btn" onClick={() => download('/export/attendance' + qs(d))}>CSV</button>}
      </div>
      {(can('hr', 'edit') || can('staff', 'edit')) && (
        <Card title="Record attendance">
          <div className="row">
            <select value={mark.employeeId} onChange={(e) => setMark({ ...mark, employeeId: e.target.value })} style={{ width: 220 }}><option value="">Employee…</option>{emps?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            <select value={mark.status} onChange={(e) => setMark({ ...mark, status: e.target.value })} style={{ width: 130 }}>{['present', 'late', 'absent', 'leave', 'holiday'].map((s) => <option key={s}>{s}</option>)}</select>
            <input value={mark.overtimeMinutes} onChange={(e) => setMark({ ...mark, overtimeMinutes: e.target.value })} style={{ width: 120 }} placeholder="Overtime min" />
            <input value={mark.note} onChange={(e) => setMark({ ...mark, note: e.target.value })} placeholder="Note" style={{ flex: 1 }} />
            <button className="btn primary" disabled={busy || !mark.employeeId} onClick={() => run(() => api.post('/attendance', { ...mark, date: d.to, overtimeMinutes: Number(mark.overtimeMinutes) || 0 }), 'Saved').then(reload)}>Save for {date(d.to)}</button>
          </div>
        </Card>
      )}
      <div style={{ height: 10 }} />
      <div className="card tablewrap">{!data ? <Loading /> : !data.length ? <Empty>No attendance recorded</Empty> : (
        <table className="t"><thead><tr><th>Date</th><th>Employee</th><th>Status</th><th>In</th><th>Out</th><th className="num">Overtime</th><th>Note</th></tr></thead>
          <tbody>{data.map((a) => <tr key={a.id}><td>{date(a.date)}</td><td>{a.name}</td><td><Status s={a.status} /></td><td>{a.check_in ? dateTime(a.check_in) : '—'}</td><td>{a.check_out ? dateTime(a.check_out) : '—'}</td><td className="num">{a.overtime_minutes} min</td><td>{a.note}</td></tr>)}</tbody></table>
      )}</div>
    </>
  );
}

function Leave() {
  const { can } = useSession();
  const { data, reload } = useData<any[]>('/leave');
  const { busy, run } = useAction();
  return (
    <div className="card tablewrap">{!data ? <Loading /> : !data.length ? <Empty>No leave requests</Empty> : (
      <table className="t"><thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th className="num">Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
        <tbody>{data.map((l) => <tr key={l.id}><td>{l.name}</td><td>{l.kind}</td><td>{date(l.from_date)} – {date(l.to_date)}</td><td className="num">{l.days}</td><td>{l.reason}</td><td><Status s={l.status} /></td>
          <td>{l.status === 'pending' && (can('hr', 'approve') || can('staff', 'approve')) && <><button className="btn sm" disabled={busy} onClick={() => run(() => api.post(`/leave/${l.id}/decide`, { approve: true }), 'Approved').then(reload)}>Approve</button> <button className="btn danger sm" disabled={busy} onClick={() => run(() => api.post(`/leave/${l.id}/decide`, { approve: false }), 'Rejected').then(reload)}>Reject</button></>}</td></tr>)}</tbody></table>
    )}</div>
  );
}

function Announcements() {
  const { can } = useSession();
  const { data, reload } = useData<any[]>('/announcements');
  const [f, setF] = useState({ title: '', body: '' });
  const { busy, run } = useAction();
  return (
    <div className="grid g2">
      {(can('hr', 'create') || can('staff', 'create')) && <Card title="New announcement"><div className="col"><input placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /><textarea rows={4} placeholder="Message to all staff" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /><button className="btn primary" disabled={busy || !f.title} onClick={() => run(() => api.post('/announcements', f), 'Published').then(() => { setF({ title: '', body: '' }); reload(); })}>Publish</button></div></Card>}
      <Card title="Published">{!data?.length ? <Empty>No announcements</Empty> : data.map((a) => <div key={a.id} style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}><b>{a.title}</b><div style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div><div className="small muted">{a.author} · {dateTime(a.created_at)}</div></div>)}</Card>
    </div>
  );
}
