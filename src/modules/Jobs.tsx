import { useEffect, useState } from 'react';
import { Plus, LayoutGrid, List, Trash2, Receipt, MessageCircle, PackageMinus } from 'lucide-react';
import { store, useDB, nextInvoiceNumber, today, uid } from '../core/store';
import { useRoute, go } from '../core/router';
import type { Job, JobStatus } from '../core/types';
import { money, fmtDate } from '../core/calc';
import { statusMeta, lookup, dueLabel, priorityTone, waLink } from '../core/helpers';
import { Modal, Field, Badge, PageHeader, SearchBox, Tabs, Avatar, Progress, Empty, toast, confirmDelete } from '../components/ui';
import { useT } from '../core/i18n';
import { useCanWrite } from '../core/session';
import { usePlugin, useWaText, gcalLink, mapsLink, QR } from '../plugins/hooks';
import { CalendarPlus, MapPin, Star, Printer } from 'lucide-react';

const STATUSES: JobStatus[] = ['enquiry', 'design', 'production', 'finishing', 'installation', 'completed'];

export function blankJob(code: string, workTypeId?: string): Partial<Job> {
  return { code, title: '', status: 'enquiry', priority: 'normal', value: 0, staffIds: [], details: {}, materials: [], progress: 0, startDate: today(), workTypeId };
}

export default function Jobs() {
  const db = useDB(); const s = db.settings; const L = lookup(db); const t = useT(); const can = useCanWrite()('jobs');
  const { params } = useRoute();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<Job> | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const newCode = () => { const nums = db.jobs.map((j) => parseInt(j.code.replace(/\D/g, ''), 10) || 0); return `JOB-${(nums.length ? Math.max(...nums) : 100) + 1}`; };
  useEffect(() => {
    if (params.new) { setEdit(blankJob(newCode(), params.type)); go('jobs'); }
    if (params.id) { const j = db.jobs.find((x) => x.id === params.id); if (j) setEdit(structuredClone(j)); go('jobs'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.new, params.id]);

  const list = db.jobs.filter((j) => (type === 'all' || j.workTypeId === type) && (j.title + j.code + (L.customer(j.customerId)?.name || '')).toLowerCase().includes(q.toLowerCase()));

  const save = () => {
    if (!edit?.title?.trim()) return toast('Please enter a job title');
    store.upsert('jobs', edit as Job); toast('Job saved'); setEdit(null);
  };
  const moveTo = (id: string, status: JobStatus) => {
    const j = db.jobs.find((x) => x.id === id); if (!j || j.status === status) return;
    store.upsert('jobs', { ...j, status, progress: status === 'completed' ? 100 : j.progress }); toast(`Moved to ${statusMeta[status].label}`);
  };

  return (
    <>
      <PageHeader title={t('Jobs')} sub="Track every work order — CNC, carpentry, board work, polish and installation."
        actions={<>
          <div className="tabs"><button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}><LayoutGrid size={15} />Board</button><button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><List size={15} />List</button></div>
          {can && <button className="btn primary" onClick={() => setEdit(blankJob(newCode(), type !== 'all' ? type : undefined))}><Plus size={16} />{t('New job')}</button>}
        </>} />
      <div className="toolbar">
        <Tabs value={type} onChange={setType} tabs={[{ id: 'all', label: 'All work', count: db.jobs.length }, ...s.workTypes.map((w) => ({ id: w.id, label: w.name, count: db.jobs.filter((j) => j.workTypeId === w.id).length }))]} />
        <SearchBox value={q} onChange={setQ} placeholder="Search jobs, customers…" />
      </div>

      {view === 'board' ? (
        <div className="kanban">
          {STATUSES.map((st) => { const items = list.filter((j) => j.status === st); return (
            <div key={st} className={`kcol ${over === st ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(st); }} onDragLeave={() => setOver(null)} onDrop={() => { if (drag) moveTo(drag, st); setDrag(null); setOver(null); }}>
              <div className="kcol-head"><span className="flex"><span className="dot" style={{ background: statusMeta[st].color }} />{statusMeta[st].label}</span><span className="muted">{items.length}</span></div>
              {items.map((j) => { const wt = L.workType(j.workTypeId); const due = dueLabel(j.dueDate); return (
                <div key={j.id} className="kcard" draggable={can} onDragStart={() => setDrag(j.id)} onClick={() => setEdit(structuredClone(j))} style={{ borderTop: `3px solid ${wt?.color || 'var(--line)'}` }}>
                  <div className="flex between"><Badge color={wt?.color}>{wt?.name || 'General'}</Badge><Badge tone={priorityTone[j.priority]}>{j.priority}</Badge></div>
                  <div className="ktitle">{j.title}</div>
                  <div className="muted">{j.code} · {L.customer(j.customerId)?.name || 'No customer'}</div>
                  <div style={{ marginTop: 8 }}><Progress value={j.progress} color={wt?.color} /></div>
                  <div className="kmeta"><div className="avatars">{j.staffIds.map((id) => { const p = L.staff(id); return p && <Avatar key={id} name={p.name} color={p.color} size={24} />; })}</div><Badge tone={due.tone}>{due.text}</Badge></div>
                </div>); })}
            </div>); })}
        </div>
      ) : (
        <div className="card">
          {list.length ? <div className="table-wrap"><table>
            <thead><tr><th>Job</th><th>Type</th><th>Customer</th><th>Status</th><th>Team</th><th>Due</th><th className="num">Value</th></tr></thead>
            <tbody>{list.map((j) => { const wt = L.workType(j.workTypeId); return (
              <tr key={j.id} className="click" onClick={() => setEdit(structuredClone(j))}>
                <td><b>{j.title}</b><div className="muted">{j.code}</div></td><td><Badge color={wt?.color}>{wt?.name || '—'}</Badge></td>
                <td>{L.customer(j.customerId)?.name || '—'}</td><td><Badge tone={statusMeta[j.status].tone}>{statusMeta[j.status].label}</Badge></td>
                <td><div className="avatars">{j.staffIds.map((id) => { const p = L.staff(id); return p && <Avatar key={id} name={p.name} color={p.color} size={26} />; })}</div></td>
                <td>{fmtDate(j.dueDate)}</td><td className="num">{j.value === undefined ? '—' : money(j.value, s)}</td>
              </tr>); })}</tbody></table></div> : <Empty title="No jobs found" hint="Create your first work order." />}
        </div>
      )}

      {edit && <JobForm job={edit} setJob={setEdit} onSave={save} onClose={() => setEdit(null)} readOnly={!can} />}
    </>
  );
}

function JobForm({ job, setJob, onSave, onClose, readOnly }: { job: Partial<Job>; setJob: (j: Partial<Job>) => void; onSave: () => void; onClose: () => void; readOnly?: boolean }) {
  const db = useDB(); const s = db.settings; const L = lookup(db);
  const wt = L.workType(job.workTypeId);
  const set = (p: Partial<Job>) => setJob({ ...job, ...p });
  const exists = !!job.id && db.jobs.some((j) => j.id === job.id);
  const tasks = db.tasks.filter((x) => x.jobId === job.id);
  const cust = L.customer(job.customerId);
  const materials = job.materials || [];
  const wa = useWaText(); const gcal = usePlugin('gcal').enabled; const maps = usePlugin('maps').enabled; const review = usePlugin('reviews'); const jobcard = usePlugin('jobcard').enabled;
  const [card, setCard] = useState(false);
  const site = job.details?.['Site address'] || cust?.address;

  const issueMaterials = () => {
    for (const m of materials) { const it = L.item(m.itemId); if (it) store.upsert('items', { ...it, qty: it.qty - m.qty }); }
    const cost = materials.reduce((n, m) => n + (L.item(m.itemId)?.cost || 0) * m.qty, 0);
    toast(`Stock reduced · material cost ${money(cost, s)}`);
  };
  const makeInvoice = () => {
    const inv = store.upsert('invoices', { number: nextInvoiceNumber(), date: today(), customerId: job.customerId, title: job.title || '', jobId: job.id, discount: 0, vat: s.vatRate, paid: 0,
      items: [{ id: uid(), description: job.title || 'Job', workTypeId: job.workTypeId, qty: 1, unit: 'lot', rate: job.value || 0 }] });
    go('invoices', { id: inv.id });
  };

  return (
    <Modal open wide title={exists ? `${job.code} · Edit job` : 'New job'} onClose={onClose}
      footer={readOnly ? <button className="btn" onClick={onClose}>Close</button> : <>
        {exists && <button className="btn danger ghost" onClick={() => { if (confirmDelete('this job')) { store.remove('jobs', job.id!); onClose(); } }}><Trash2 size={15} />Delete</button>}
        {exists && <button className="btn ghost" onClick={makeInvoice}><Receipt size={15} />Create invoice</button>}
        {exists && cust?.phone && <a className="btn ghost" target="_blank" rel="noreferrer" href={waLink(cust.phone, wa('jobUpdate', { customer: cust.name, code: job.code, title: job.title, status: statusMeta[job.status!].label, business: s.businessName }))}><MessageCircle size={15} />WhatsApp update</a>}
        <span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={onSave}>Save job</button>
      </>}>
      {exists && (jobcard || gcal || (maps && site) || (review.enabled && job.status === 'completed')) && <div className="chips" style={{ marginBottom: 14 }}>
        {jobcard && <button className="btn sm" onClick={() => setCard(true)}><Printer size={14} />Job card</button>}
        {gcal && job.dueDate && <a className="btn sm" target="_blank" rel="noreferrer" href={gcalLink(`${job.code} ${job.title}`, job.dueDate, `Customer: ${cust?.name || '-'}\n${wt?.name || ''}`, site || '')}><CalendarPlus size={14} />Add to calendar</a>}
        {maps && site && <a className="btn sm" target="_blank" rel="noreferrer" href={mapsLink(site)}><MapPin size={14} />Directions</a>}
        {!readOnly && review.enabled && job.status === 'completed' && cust?.phone && <a className="btn sm" target="_blank" rel="noreferrer" href={waLink(cust.phone, wa('review', { customer: cust.name, title: job.title, business: s.businessName, link: review.link || '' }))}><Star size={14} />Ask for Google review</a>}
      </div>}
      {card && <JobCard job={job} onClose={() => setCard(false)} />}
      <fieldset className="form" disabled={readOnly}>
        <Field label="Job title" span={2}><input autoFocus value={job.title || ''} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Kitchen cabinets — Villa 12" /></Field>
        <Field label="Job code"><input value={job.code || ''} onChange={(e) => set({ code: e.target.value })} /></Field>
        <Field label="Work type">
          <select value={job.workTypeId || ''} onChange={(e) => set({ workTypeId: e.target.value })}><option value="">— General —</option>{s.workTypes.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        </Field>
        <Field label="Customer">
          <select value={job.customerId || ''} onChange={(e) => set({ customerId: e.target.value })}><option value="">— Select —</option>{db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
        {!readOnly && <Field label={`Job value (${s.currency})`}><input type="number" value={job.value ?? 0} onChange={(e) => set({ value: +e.target.value })} /></Field>}
        <Field label="Status"><select value={job.status} onChange={(e) => set({ status: e.target.value as JobStatus })}>{[...STATUSES, 'cancelled'].map((x) => <option key={x} value={x}>{statusMeta[x].label}</option>)}</select></Field>
        <Field label="Priority"><select value={job.priority} onChange={(e) => set({ priority: e.target.value as Job['priority'] })}>{['low', 'normal', 'high', 'urgent'].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label={`Progress — ${job.progress || 0}%`}><input type="range" min={0} max={100} step={5} value={job.progress || 0} onChange={(e) => set({ progress: +e.target.value })} style={{ padding: 0 }} /></Field>
        <Field label="Start date"><input type="date" value={job.startDate || ''} onChange={(e) => set({ startDate: e.target.value })} /></Field>
        <Field label="Due date"><input type="date" value={job.dueDate || ''} onChange={(e) => set({ dueDate: e.target.value })} /></Field>
        <div />
        {wt && wt.fields.length > 0 && <>
          <div className="section-title">{wt.name} details</div>
          {wt.fields.map((f) => <Field key={f} label={f}><input value={job.details?.[f] || ''} onChange={(e) => set({ details: { ...job.details, [f]: e.target.value } })} /></Field>)}
        </>}
        <div className="section-title">Assigned team</div>
        <div className="span-3 chips">
          {db.staff.filter((x) => x.active).map((p) => { const on = job.staffIds?.includes(p.id); return (
            <button key={p.id} type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => set({ staffIds: on ? job.staffIds!.filter((i) => i !== p.id) : [...(job.staffIds || []), p.id] })}>{p.name} · {p.role}</button>); })}
        </div>
        <div className="section-title">Materials used</div>
        <div className="span-3">
          {materials.map((m, i) => (
            <div key={i} className="flex" style={{ marginBottom: 6 }}>
              <select value={m.itemId} onChange={(e) => set({ materials: materials.map((x, k) => (k === i ? { ...x, itemId: e.target.value } : x)) })}>{db.items.map((it) => <option key={it.id} value={it.id}>{it.name} {it.thickness || ''} (stock {it.qty})</option>)}</select>
              <input type="number" style={{ width: 100 }} value={m.qty} onChange={(e) => set({ materials: materials.map((x, k) => (k === i ? { ...x, qty: +e.target.value } : x)) })} />
              <button className="icon-btn" onClick={() => set({ materials: materials.filter((_, k) => k !== i) })}><Trash2 size={15} /></button>
            </div>))}
          <div className="flex">
            <button className="btn sm" disabled={!db.items.length} onClick={() => set({ materials: [...materials, { itemId: db.items[0]?.id, qty: 1 }] })}><Plus size={14} />Add material</button>
            {exists && materials.length > 0 && <button className="btn sm" onClick={issueMaterials}><PackageMinus size={14} />Issue from stock</button>}
            {materials.length > 0 && <span className="muted">Est. cost {money(materials.reduce((n, m) => n + (L.item(m.itemId)?.cost || 0) * m.qty, 0), s)}</span>}
          </div>
        </div>
        <Field label="Notes" span={3}><textarea value={job.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
        {exists && <>
          <div className="section-title">Tasks for this job ({tasks.length})</div>
          <div className="span-3">
            <ul className="list">{tasks.map((x) => <li key={x.id}><div className="grow title">{x.title}</div><span className="muted">{L.staff(x.staffId)?.name || 'Unassigned'}</span><Badge tone={statusMeta[x.status].tone}>{statusMeta[x.status].label}</Badge></li>)}</ul>
            <button className="btn sm" onClick={() => go('tasks', { new: '1', job: job.id! })}><Plus size={14} />Assign task</button>
          </div>
        </>}
      </fieldset>
    </Modal>
  );
}

function JobCard({ job, onClose }: { job: Partial<Job>; onClose: () => void }) {
  const db = useDB(); const s = db.settings; const L = lookup(db);
  const wt = L.workType(job.workTypeId); const cust = L.customer(job.customerId);
  const link = `${window.location.origin}/#/jobs?id=${job.id}`;
  return (
    <Modal open title={`Job card ${job.code}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print</button></>}>
      <div className="print-area"><div className="doc jobcard">
        <div className="doc-head"><div><div className="big">{job.code}</div><h2 style={{ margin: '4px 0' }}>{job.title}</h2><div>{wt?.name || 'General'} · Priority: <b>{job.priority}</b></div></div>
          <QR value={link} size={110} caption="Scan to open this job" /></div>
        <table style={{ width: '100%' }}><tbody>
          <tr><td>Customer</td><td><b>{cust?.name || '—'}</b> {cust?.phone}</td></tr>
          <tr><td>Site / address</td><td>{job.details?.['Site address'] || cust?.address || '—'}</td></tr>
          <tr><td>Start → Due</td><td>{fmtDate(job.startDate)} → <b>{fmtDate(job.dueDate)}</b></td></tr>
          <tr><td>Team</td><td>{(job.staffIds || []).map((id) => L.staff(id)?.name).filter(Boolean).join(', ') || '—'}</td></tr>
          {Object.entries(job.details || {}).filter(([, v]) => v).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
        </tbody></table>
        {(job.materials || []).length > 0 && <><h3 style={{ marginTop: 18 }}>Materials</h3><table style={{ width: '100%' }}><tbody>{job.materials!.map((m, i) => { const it = L.item(m.itemId); return <tr key={i}><td className="checks"><span />{it?.name} {it?.thickness}</td><td className="num">{m.qty} {it?.unit}</td></tr>; })}</tbody></table></>}
        <h3 style={{ marginTop: 18 }}>Stages</h3>
        <div className="checks" style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>{['Design OK', 'Cutting', 'CNC', 'Assembly', 'Finishing', 'QC', 'Delivery', 'Installed'].map((x) => <label key={x}><span />{x}</label>)}</div>
        {job.notes && <div className="doc-terms"><b>Notes</b><br />{job.notes}</div>}
        <div className="doc-sign"><div>Supervisor</div><div>Customer sign-off</div></div>
        <p style={{ fontSize: 11, color: '#888', marginTop: 16 }}>{s.businessName} · printed {new Date().toLocaleDateString('en-GB')}</p>
      </div></div>
    </Modal>
  );
}
