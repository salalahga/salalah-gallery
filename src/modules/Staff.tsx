import { useState } from 'react';
import { Plus, Trash2, Phone, MessageCircle, Star } from 'lucide-react';
import type { WorkReport } from '../core/types';
import { Tabs } from '../components/ui';
import { ExportButtons } from '../components/Export';
import { lookup } from '../core/helpers';
import { store, useDB, today, uid } from '../core/store';
import type { Staff, SalaryType } from '../core/types';
import { money, fmtDate, staffEntitlements } from '../core/calc';
import { waLink, DOC_TYPES, daysFrom, expiryLabel } from '../core/helpers';
import { Modal, Field, PageHeader, Avatar, Badge, Empty, toast, confirmDelete, SearchBox } from '../components/ui';
import { useT } from '../core/i18n';

const COLORS = ['#b45309', '#2563eb', '#9333ea', '#059669', '#dc2626', '#0891b2', '#7c4a1e', '#db2777'];

export default function StaffPage() {
  const db = useDB(); const s = db.settings; const t = useT();
  const [edit, setEdit] = useState<Partial<Staff> | null>(null); const [q, setQ] = useState('');
  const [tab, setTab] = useState<'team' | 'reports' | 'perf'>('team'); const [month, setMonth] = useState(today().slice(0, 7));
  const [rep, setRep] = useState<Partial<WorkReport> | null>(null); const L = lookup(db);
  const reports = db.workReports.filter((r) => r.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
  const perf = db.staff.filter((x) => x.active).map((x) => {
    const att = db.attendance.filter((a) => a.staffId === x.id && a.date.startsWith(month));
    const tasks = db.tasks.filter((t) => t.staffId === x.id && (t.dueDate || String(t.createdAt)).startsWith(month));
    const done = tasks.filter((t) => t.status === 'done'); const onTime = done.filter((t) => !t.dueDate || !t.updatedAt || t.updatedAt.slice(0, 10) <= t.dueDate);
    const rr = db.workReports.filter((r) => r.staffId === x.id && r.date.startsWith(month)); const rated = rr.filter((r) => r.rating);
    const adv = db.advances.filter((a) => a.staffId === x.id && !a.recovered).reduce((n, a) => n + a.amount, 0);
    return { x, present: att.filter((a) => a.mark === 'P').length, absent: att.filter((a) => a.mark === 'A').length, leave: att.filter((a) => a.mark === 'L').length, ot: att.reduce((n, a) => n + (Number(a.overtime) || 0), 0),
      tasks: tasks.length, done: done.length, onTime: done.length ? Math.round((onTime.length / done.length) * 100) : null, hours: rr.reduce((n, r) => n + (Number(r.hours) || 0), 0), reports: rr.length,
      rating: rated.length ? rated.reduce((n, r) => n + (r.rating || 0), 0) / rated.length : null, adv };
  });
  const saveRep = () => { if (!rep?.staffId || !rep.text?.trim()) return toast('Choose the staff member and write the work done'); store.upsert('workReports', { ...rep, hours: Number(rep.hours) || 0 } as WorkReport); setRep(null); toast('Work report saved'); };
  const list = db.staff.filter((x) => (x.name + x.role + x.skills.join(' ')).toLowerCase().includes(q.toLowerCase()));
  const save = () => { if (!edit?.name?.trim()) return toast('Enter staff name'); store.upsert('staff', edit as Staff); setEdit(null); toast('Staff saved'); };
  const monthlyCost = db.staff.filter((x) => x.active).reduce((n, x) => n + (x.salaryType === 'monthly' ? x.rate : x.salaryType === 'daily' ? x.rate * s.workingDaysPerMonth : x.rate * s.workHoursPerDay * s.workingDaysPerMonth) + (x.allowance || 0), 0);
  return (
    <>
      <PageHeader title={t('Staff')} sub={`${db.staff.filter((x) => x.active).length} active · est. monthly cost ${money(monthlyCost, s)}`}
        actions={<><SearchBox value={q} onChange={setQ} /><button className="btn primary" onClick={() => setEdit({ salaryType: 'monthly', rate: 0, allowance: 0, skills: [], active: true, role: s.roles[0], color: COLORS[db.staff.length % COLORS.length], joinDate: today() })}><Plus size={16} />Add staff</button></>} />
      <div className="toolbar"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'team', label: 'Team', count: db.staff.length }, { id: 'reports', label: 'Daily work reports' }, { id: 'perf', label: 'Performance' }]} />
        {tab !== 'team' && <input type="month" style={{ width: 'auto' }} value={month} onChange={(e) => setMonth(e.target.value)} />}
        {tab === 'reports' && <button className="btn primary sm" onClick={() => setRep({ date: today(), hours: s.workHoursPerDay })}><Plus size={14} />Add report</button>}</div>
      {tab === 'reports' && <div className="card">
        <div className="flex between"><h3>Daily work reports</h3><ExportButtons name={`work-reports-${month}`} head={['Date', 'Staff', 'Project', 'Hours', 'Work done', 'Rating']} rows={reports.map((r) => [r.date, L.staff(r.staffId)?.name || '', L.job(r.jobId)?.code || '', r.hours, r.text, r.rating || ''])} /></div>
        {reports.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Staff</th><th>Project</th><th className="num">Hours</th><th>Work done</th><th>Rating</th></tr></thead>
          <tbody>{reports.map((r) => <tr key={r.id} className="click" onClick={() => setRep({ ...r })}><td>{fmtDate(r.date)}</td><td>{L.staff(r.staffId)?.name}</td><td>{L.job(r.jobId)?.code || '—'}</td><td className="num">{r.hours}</td><td style={{ whiteSpace: 'pre-wrap' }}>{r.text}</td>
            <td onClick={(e) => e.stopPropagation()}>{[1, 2, 3, 4, 5].map((n) => <button key={n} className="icon-btn" style={{ padding: 2 }} title={`Rate ${n}`} onClick={() => store.upsert('workReports', { ...r, rating: n })}><Star size={14} fill={(r.rating || 0) >= n ? '#e0a458' : 'none'} color="#e0a458" /></button>)}</td></tr>)}</tbody></table></div>
          : <Empty title="No work reports this month" hint="Record what each person did each day — the project, hours and work done — and rate it." />}
      </div>}
      {tab === 'perf' && <div className="card">
        <div className="flex between"><h3>Staff performance — {month}</h3><ExportButtons name={`staff-performance-${month}`} head={['Staff', 'Present', 'Absent', 'Leave', 'Overtime h', 'Tasks', 'Done', 'On time %', 'Reported h', 'Avg rating', 'Advance due']} rows={perf.map((p) => [p.x.name, p.present, p.absent, p.leave, p.ot, p.tasks, p.done, p.onTime ?? '', p.hours, p.rating ? +p.rating.toFixed(1) : '', +p.adv.toFixed(3)])} /></div>
        <div className="table-wrap"><table><thead><tr><th>Staff</th><th className="num">Present</th><th className="num">Absent</th><th className="num">Leave</th><th className="num">Overtime</th><th className="num">Tasks done</th><th className="num">On time</th><th className="num">Reported hours</th><th className="num">Rating</th><th className="num">Advance due</th></tr></thead>
          <tbody>{perf.map((p) => <tr key={p.x.id}><td><div className="flex"><Avatar name={p.x.name} color={p.x.color} size={26} /><b>{p.x.name}</b></div></td><td className="num">{p.present}</td><td className={`num ${p.absent ? 'neg' : ''}`}>{p.absent}</td><td className="num">{p.leave}</td><td className="num">{p.ot} h</td>
            <td className="num">{p.done}/{p.tasks}</td><td className="num">{p.onTime === null ? '—' : `${p.onTime}%`}</td><td className="num">{p.hours}</td><td className="num">{p.rating ? `★ ${p.rating.toFixed(1)}` : '—'}</td><td className="num">{p.adv ? money(p.adv, s) : '—'}</td></tr>)}</tbody></table></div>
      </div>}
      {rep && <Modal open title={rep.id ? 'Work report' : 'New work report'} onClose={() => setRep(null)} footer={<>{rep.id && <button className="btn danger ghost" onClick={() => { if (confirmDelete('this report')) { store.remove('workReports', rep.id!); setRep(null); } }}><Trash2 size={15} />Delete</button>}<span className="spacer" /><button className="btn" onClick={() => setRep(null)}>Cancel</button><button className="btn primary" onClick={saveRep}>Save</button></>}>
        <div className="form two">
          <Field label="Staff"><select value={rep.staffId || ''} onChange={(e) => setRep({ ...rep, staffId: e.target.value })}><option value="">—</option>{db.staff.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label="Date"><input type="date" value={rep.date} onChange={(e) => setRep({ ...rep, date: e.target.value })} /></Field>
          <Field label="Project"><select value={rep.jobId || ''} onChange={(e) => setRep({ ...rep, jobId: e.target.value || undefined })}><option value="">Workshop / general</option>{db.jobs.filter((j) => !['completed', 'cancelled'].includes(j.status)).map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>
          <Field label="Hours"><input type="number" value={rep.hours ?? ''} onChange={(e) => setRep({ ...rep, hours: +e.target.value })} /></Field>
          <Field label="Work done" span={3}><textarea autoFocus value={rep.text || ''} onChange={(e) => setRep({ ...rep, text: e.target.value })} /></Field>
        </div>
      </Modal>}
      {tab === 'team' && (list.length ? <div className="grid g3">
        {list.map((p) => { const open = db.tasks.filter((x) => x.staffId === p.id && x.status !== 'done').length; const jobs = db.jobs.filter((j) => j.staffIds.includes(p.id) && !['completed', 'cancelled'].includes(j.status)).length; return (
          <div key={p.id} className="card" style={{ cursor: 'pointer', opacity: p.active ? 1 : .55 }} onClick={() => setEdit({ ...p })}>
            <div className="flex" style={{ gap: 14 }}>
              <Avatar name={p.name} color={p.color} size={52} />
              <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 16 }}>{p.name}</b><div className="muted">{p.role} · {p.nationality || '—'}</div>{!p.active && <Badge tone="red">Inactive</Badge>}{(p.documents || []).filter((d) => d.expiry && daysFrom(d.expiry)! <= (s.docExpiryDays ?? 30)).map((d) => { const e = expiryLabel(daysFrom(d.expiry)!); return <div key={d.id}><Badge tone={e.tone}>{d.type}: {e.text}</Badge></div>; })}</div>
              <div onClick={(e) => e.stopPropagation()} className="flex">{p.phone && <a className="icon-btn" href={`tel:${p.phone}`}><Phone size={16} /></a>}{p.phone && <a className="icon-btn" target="_blank" rel="noreferrer" href={waLink(p.phone, `Hi ${p.name}, `)}><MessageCircle size={16} /></a>}</div>
            </div>
            <div className="chips" style={{ margin: '12px 0' }}>{p.skills.map((k) => <Badge key={k}>{k}</Badge>)}</div>
            <div className="flex between muted"><span>{money(p.rate, s)} / {p.salaryType === 'monthly' ? 'month' : p.salaryType === 'daily' ? 'day' : 'hour'}</span><span>{jobs} jobs · {open} tasks</span></div>
          </div>); })}
      </div> : <div className="card"><Empty title="No staff yet" /></div>)}
      {edit && <Modal open title={edit.id ? 'Edit staff' : 'New staff member'} onClose={() => setEdit(null)} footer={<>
        {edit.id && <button className="btn danger ghost" onClick={() => {
          const used = db.payslips.some((x) => x.staffId === edit.id) || db.attendance.some((x) => x.staffId === edit.id) || db.advances.some((x) => x.staffId === edit.id) || db.tasks.some((x) => x.staffId === edit.id);
          if (used) return toast(`${edit.name} has attendance, payslips or tasks on record. Set them to Inactive instead — history stays correct.`);
          if (confirmDelete(edit.name)) { store.remove('staff', edit.id!); setEdit(null); } }}><Trash2 size={15} />Delete</button>}
        <span className="spacer" /><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
        <div className="form">
          <Field label="Full name" span={2}><input autoFocus value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Role"><select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{s.roles.map((r) => <option key={r}>{r}</option>)}</select></Field>
          <Field label="Phone"><input value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label="Nationality"><input value={edit.nationality || ''} onChange={(e) => setEdit({ ...edit, nationality: e.target.value })} /></Field>
          <Field label="ID / Passport / Resident card"><input value={edit.idNumber || ''} onChange={(e) => setEdit({ ...edit, idNumber: e.target.value })} /></Field>
          <Field label="Join date"><input type="date" value={edit.joinDate || ''} onChange={(e) => setEdit({ ...edit, joinDate: e.target.value })} /></Field>
          <Field label="Salary type"><select value={edit.salaryType} onChange={(e) => setEdit({ ...edit, salaryType: e.target.value as SalaryType })}><option value="monthly">Monthly</option><option value="daily">Daily wage</option><option value="hourly">Hourly</option></select></Field>
          <Field label={`Rate (${s.currency})`}><input type="number" value={edit.rate ?? 0} onChange={(e) => setEdit({ ...edit, rate: +e.target.value })} /></Field>
          <Field label="Monthly allowance"><input type="number" value={edit.allowance ?? 0} onChange={(e) => setEdit({ ...edit, allowance: +e.target.value })} /></Field>
          <Field label="Telegram chat ID (for task alerts)"><input value={edit.telegramChatId || ''} onChange={(e) => setEdit({ ...edit, telegramChatId: e.target.value })} placeholder="from @userinfobot" /></Field>
          <Field label="Email"><input type="email" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
          <Field label="Bank / account"><input value={edit.bank || ''} onChange={(e) => setEdit({ ...edit, bank: e.target.value })} /></Field>
          <Field label="Leave counted from"><input type="date" value={edit.leaveFrom || ''} onChange={(e) => setEdit({ ...edit, leaveFrom: e.target.value || undefined })} /></Field>
          <Field label="Leave balance on that date (days)"><input type="number" step={0.5} value={edit.leaveOpening ?? ''} placeholder="0" onChange={(e) => setEdit({ ...edit, leaveOpening: e.target.value === '' ? undefined : +e.target.value })} /></Field>
          <Field label="Active"><select value={edit.active ? '1' : '0'} onChange={(e) => setEdit({ ...edit, active: e.target.value === '1' })}><option value="1">Active</option><option value="0">Inactive</option></select></Field>
          <div className="section-title">Documents & expiry dates</div>
          <div className="span-3">
            {(edit.documents || []).map((d, i) => { const n = d.expiry ? daysFrom(d.expiry)! : undefined; const e = n !== undefined ? expiryLabel(n) : null; const upd = (p: Partial<typeof d>) => setEdit({ ...edit, documents: edit.documents!.map((x, k) => (k === i ? { ...x, ...p } : x)) }); return (
              <div key={d.id} className="doc-row">
                <select value={d.type} onChange={(ev) => upd({ type: ev.target.value })}>{[...new Set([...DOC_TYPES, d.type])].map((t) => <option key={t}>{t}</option>)}</select>
                <input placeholder="Number" value={d.number || ''} onChange={(ev) => upd({ number: ev.target.value })} />
                <input type="date" value={d.expiry || ''} onChange={(ev) => upd({ expiry: ev.target.value })} />
                {e && n! <= (s.docExpiryDays ?? 30) ? <Badge tone={e.tone}>{e.text}</Badge> : <span />}
                <button type="button" className="icon-btn" onClick={() => setEdit({ ...edit, documents: edit.documents!.filter((_, k) => k !== i) })}><Trash2 size={14} /></button>
              </div>); })}
            <button type="button" className="btn sm" onClick={() => setEdit({ ...edit, documents: [...(edit.documents || []), { id: uid(), type: (edit.documents || []).length ? 'Passport' : 'Resident card' }] })}><Plus size={14} />Add document</button>
          </div>
          <Field label="Skills (comma separated)" span={3}><input value={(edit.skills || []).join(', ')} onChange={(e) => setEdit({ ...edit, skills: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="CNC, Kitchen, PU polish" /></Field>
          <Field label="Colour" span={3}><div className="chips">{COLORS.map((c) => <button key={c} type="button" onClick={() => setEdit({ ...edit, color: c })} style={{ width: 28, height: 28, borderRadius: 8, background: c, border: edit.color === c ? '3px solid var(--ink)' : '0', cursor: 'pointer' }} />)}</div></Field>
          {edit.joinDate && edit.id && (() => { const e = staffEntitlements(db, { ...(db.staff.find((x) => x.id === edit.id) as Staff), ...edit } as Staff); return (
            <div className="span-3 entitle">
              <div><span className="muted">Service</span><b>{e.years.toFixed(1)} years</b><small>since {fmtDate(edit.joinDate)}</small></div>
              <div><span className="muted">End-of-service gratuity</span><b>{e.omani ? 'Social insurance' : money(e.gratuity, s)}</b><small>{e.omani ? 'Omani — covered by PASI' : `${s.gratuityDaysPerYear ?? 30} days basic per year`}</small></div>
              <div><span className="muted">Annual leave balance</span><b className={e.leaveBalance < 0 ? 'neg' : ''}>{e.leaveBalance.toFixed(1)} days</b><small>{e.leaveAccrued.toFixed(1)} earned since {fmtDate(edit.leaveFrom || edit.joinDate)} · {e.leaveTaken} taken (L)</small></div>
            </div>); })()}
        </div>
      </Modal>}
    </>
  );
}
