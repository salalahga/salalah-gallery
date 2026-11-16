import { useEffect, useState } from 'react';
import { Plus, Trash2, MessageCircle, ShieldCheck, Wrench, Receipt, CalendarClock } from 'lucide-react';
import { store, useDB, today, nextNumber, nextInvoiceNumber, uid } from '../core/store';
import { useRoute, go } from '../core/router';
import type { ServiceCall } from '../core/types';
import { fmtDate, money } from '../core/calc';
import { lookup, waLink, dueLabel } from '../core/helpers';
import { Modal, Field, PageHeader, Tabs, Badge, Empty, Stat, SearchBox, toast, confirmDelete } from '../components/ui';
import { Photos } from '../components/Photos';
import { useRole, useUser } from '../core/session';
import { warrantyEnd } from './Jobs';

const ST: ServiceCall['status'][] = ['open', 'scheduled', 'done', 'cancelled'];
const META: Record<ServiceCall['status'], { label: string; tone: string }> = { open: { label: 'Open', tone: 'red' }, scheduled: { label: 'Scheduled', tone: 'blue' }, done: { label: 'Done', tone: 'green' }, cancelled: { label: 'Cancelled', tone: 'gray' } };

export default function Services() {
  const db = useDB(); const s = db.settings; const L = lookup(db); const { params } = useRoute();
  const role = useRole(); const me = useUser()?.staffId; const staff = role === 'staff';
  const [tab, setTab] = useState<'active' | 'all'>('active'); const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<ServiceCall> | null>(null);
  const blank = (jobId?: string, customerId?: string): Partial<ServiceCall> => {
    const j = L.job(jobId); const end = j ? warrantyEnd(j) : undefined;
    return { date: today(), status: 'open', jobId, customerId, warranty: !!end && end >= today(), issue: '' };
  };
  useEffect(() => {
    if (params.new && !staff) { const j = L.job(params.job); setEdit(blank(j?.id, j?.customerId)); go('services'); }
    if (params.id) { const x = db.services.find((y) => y.id === params.id); if (x) setEdit(structuredClone(x)); go('services'); }
  }, [params.new, params.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = db.services.filter((x) => (!staff || x.staffId === me) && (tab === 'all' || ['open', 'scheduled'].includes(x.status))
    && (x.number + x.issue + (L.customer(x.customerId)?.name || '') + (L.job(x.jobId)?.code || '')).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.visitDate || a.date).localeCompare(b.visitDate || b.date));
  const setJob = (jobId: string) => { const j = L.job(jobId); const end = j ? warrantyEnd(j) : undefined; setEdit({ ...edit, jobId: jobId || undefined, customerId: j?.customerId || edit?.customerId, warranty: !!end && end >= (edit?.date || today()) }); };
  const save = () => {
    if (!edit) return;
    if (!edit.customerId) return toast('Choose the customer');
    if (!edit.issue?.trim()) return toast('Describe the problem');
    if (edit.status === 'scheduled' && !edit.visitDate) return toast('Set the visit date');
    const rec = store.upsert('services', { ...edit, number: edit.number || nextNumber('SV', db.services.map((x) => x.number)) } as ServiceCall);
    setEdit(null); toast(edit.id ? 'Service call saved' : `Service call ${rec.number} created`);
  };
  const bill = (x: Partial<ServiceCall>) => {
    if (!x.id || !(Number(x.charge) > 0)) return toast('Enter the service charge first and save');
    if (x.invoiceId && db.invoices.some((i) => i.id === x.invoiceId)) return go('invoices', { id: x.invoiceId });
    const inv = store.upsert('invoices', { number: nextInvoiceNumber(), date: today(), dueDate: today(), customerId: x.customerId, title: `Service ${x.number}`, jobId: x.jobId, discount: 0, vat: s.vatRate, paid: 0, items: [{ id: uid(), description: `Service visit — ${x.issue}`, qty: 1, unit: 'visit', rate: Number(x.charge) }] });
    store.upsert('services', { ...db.services.find((y) => y.id === x.id)!, ...x, invoiceId: inv.id } as ServiceCall); setEdit(null); go('invoices', { id: inv.id });
  };
  const open = db.services.filter((x) => x.status === 'open').length; const sched = db.services.filter((x) => x.status === 'scheduled').length;
  const job = L.job(edit?.jobId); const wEnd = job ? warrantyEnd(job) : undefined; const tech = L.staff(edit?.staffId); const cust = L.customer(edit?.customerId);

  return (
    <>
      <PageHeader title="Service & warranty" sub="After-sales complaints and repair visits — know at once if the work is still under warranty."
        actions={!staff && <button className="btn primary" onClick={() => setEdit(blank())}><Plus size={16} />New service call</button>} />
      <div className="grid g3 mb">
        <Stat label="Open calls" value={open} icon={<Wrench size={20} />} tone="red" />
        <Stat label="Visits scheduled" value={sched} icon={<CalendarClock size={20} />} tone="blue" />
        <Stat label="Projects under warranty" value={db.jobs.filter((j) => (warrantyEnd(j) || '') >= today()).length} icon={<ShieldCheck size={20} />} tone="green" />
      </div>
      <div className="toolbar"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'active', label: 'Open & scheduled', count: open + sched }, { id: 'all', label: 'All', count: db.services.length }]} /><SearchBox value={q} onChange={setQ} /></div>
      <div className="card">{list.length ? <div className="table-wrap"><table>
        <thead><tr><th>Call</th><th>Customer / project</th><th>Problem</th><th>Technician</th><th>Visit</th><th>Status</th></tr></thead>
        <tbody>{list.map((x) => { const d = dueLabel(x.visitDate); return <tr key={x.id} className="click" onClick={() => setEdit(structuredClone(x))}>
          <td><b>{x.number}</b><div className="muted">{fmtDate(x.date)}</div></td>
          <td>{L.customer(x.customerId)?.name || '—'}<div className="muted">{L.job(x.jobId)?.code || ''}</div></td>
          <td>{x.issue}{x.warranty ? <div><Badge tone="green">Warranty</Badge></div> : x.charge ? <div className="muted">{money(x.charge, s)}</div> : null}</td>
          <td>{L.staff(x.staffId)?.name || <span className="muted">Unassigned</span>}</td>
          <td>{x.visitDate ? <>{fmtDate(x.visitDate)}{['open', 'scheduled'].includes(x.status) && <div><Badge tone={d.tone}>{d.text}</Badge></div>}</> : '—'}</td>
          <td><Badge tone={META[x.status].tone}>{META[x.status].label}</Badge></td></tr>; })}</tbody></table></div>
        : <Empty title={staff ? 'No service visits assigned to you' : 'No service calls'} hint="When a customer calls about a problem, log it here and assign a technician." />}</div>

      {edit && <Modal open wide title={edit.id ? `Service call ${edit.number}` : 'New service call'} onClose={() => setEdit(null)} footer={<>
        {edit.id && role === 'admin' && <button className="btn danger ghost" onClick={() => { if (confirmDelete(edit.number)) { store.remove('services', edit.id!); setEdit(null); } }}><Trash2 size={15} />Delete</button>}
        {tech?.phone && edit.issue && <a className="btn ghost" target="_blank" rel="noreferrer" href={waLink(tech.phone, `Service visit ${edit.number || ''}\nCustomer: ${cust?.name || ''} ${cust?.phone || ''}\nAddress: ${job?.details?.['Site address'] || cust?.address || ''}\nProblem: ${edit.issue}\nVisit: ${edit.visitDate ? fmtDate(edit.visitDate) : 'to be fixed'}${edit.warranty ? '\nUnder warranty — no charge' : ''}`)}><MessageCircle size={15} />Send to technician</a>}
        {cust?.phone && edit.visitDate && <a className="btn ghost" target="_blank" rel="noreferrer" href={waLink(cust.phone, `Dear ${cust.name}, our technician${tech ? ' ' + tech.name : ''} will visit on ${fmtDate(edit.visitDate)} about: ${edit.issue}. — ${s.businessName}`)}><MessageCircle size={15} />Tell customer</a>}
        {!staff && edit.id && !edit.warranty && Number(edit.charge) > 0 && <button className="btn ghost" onClick={() => bill(edit)}><Receipt size={15} />{edit.invoiceId ? 'Open invoice' : 'Bill customer'}</button>}
        <span className="spacer" /><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
        <div className="form">
          <Field label="Project (optional)"><select disabled={staff} value={edit.jobId || ''} onChange={(e) => setJob(e.target.value)}><option value="">— Not from a project —</option>{db.jobs.filter((j) => !edit.customerId || j.customerId === edit.customerId || j.id === edit.jobId).map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>
          <Field label="Customer"><select disabled={staff} value={edit.customerId || ''} onChange={(e) => setEdit({ ...edit, customerId: e.target.value })}><option value="">— Select —</option>{db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Reported on"><input type="date" disabled={staff} value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></Field>
          {job && <div className="span-3">{wEnd ? (wEnd >= (edit.date || today()) ? <Badge tone="green">Under warranty until {fmtDate(wEnd)}</Badge> : <Badge tone="amber">Warranty ended {fmtDate(wEnd)}</Badge>) : <Badge>{job.completedDate ? 'No warranty set on this project' : 'Project not completed yet'}</Badge>}</div>}
          <Field label="Problem reported" span={3}><textarea disabled={staff} value={edit.issue || ''} onChange={(e) => setEdit({ ...edit, issue: e.target.value })} placeholder="e.g. Kitchen drawer runner broken" /></Field>
          <Field label="Status"><select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as ServiceCall['status'] })}>{ST.filter((x) => !staff || x !== 'cancelled').map((x) => <option key={x} value={x}>{META[x].label}</option>)}</select></Field>
          <Field label="Technician"><select disabled={staff} value={edit.staffId || ''} onChange={(e) => setEdit({ ...edit, staffId: e.target.value || undefined })}><option value="">— Unassigned —</option>{db.staff.filter((x) => x.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}</select></Field>
          <Field label="Visit date"><input type="date" value={edit.visitDate || ''} onChange={(e) => setEdit({ ...edit, visitDate: e.target.value, status: edit.status === 'open' && e.target.value ? 'scheduled' : edit.status })} /></Field>
          {!staff && <Field label="Covered by warranty"><select value={edit.warranty ? '1' : '0'} onChange={(e) => setEdit({ ...edit, warranty: e.target.value === '1' })}><option value="1">Yes — free of charge</option><option value="0">No — chargeable</option></select></Field>}
          {!staff && !edit.warranty && <Field label={`Service charge (${s.currency})`}><input type="number" value={edit.charge || ''} onChange={(e) => setEdit({ ...edit, charge: +e.target.value })} /></Field>}
          <Field label="What was done" span={3}><textarea value={edit.resolution || ''} onChange={(e) => setEdit({ ...edit, resolution: e.target.value })} placeholder="Filled in after the visit" /></Field>
          <div className="section-title">Photos</div>
          <div className="span-3"><Photos photos={edit.photos || []} onChange={(photos) => setEdit({ ...edit, photos })} kinds={['before', 'after']} /></div>
        </div>
      </Modal>}
    </>
  );
}
