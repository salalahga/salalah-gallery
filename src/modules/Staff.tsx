import { useState } from 'react';
import { Plus, Trash2, Phone, MessageCircle } from 'lucide-react';
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
  const list = db.staff.filter((x) => (x.name + x.role + x.skills.join(' ')).toLowerCase().includes(q.toLowerCase()));
  const save = () => { if (!edit?.name?.trim()) return toast('Enter staff name'); store.upsert('staff', edit as Staff); setEdit(null); toast('Staff saved'); };
  const monthlyCost = db.staff.filter((x) => x.active).reduce((n, x) => n + (x.salaryType === 'monthly' ? x.rate : x.salaryType === 'daily' ? x.rate * s.workingDaysPerMonth : x.rate * s.workHoursPerDay * s.workingDaysPerMonth) + (x.allowance || 0), 0);
  return (
    <>
      <PageHeader title={t('Staff')} sub={`${db.staff.filter((x) => x.active).length} active · est. monthly cost ${money(monthlyCost, s)}`}
        actions={<><SearchBox value={q} onChange={setQ} /><button className="btn primary" onClick={() => setEdit({ salaryType: 'monthly', rate: 0, allowance: 0, skills: [], active: true, role: s.roles[0], color: COLORS[db.staff.length % COLORS.length], joinDate: today() })}><Plus size={16} />Add staff</button></>} />
      {list.length ? <div className="grid g3">
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
      </div> : <div className="card"><Empty title="No staff yet" /></div>}
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
