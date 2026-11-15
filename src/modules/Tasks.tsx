import { useEffect, useState } from 'react';
import { Plus, Trash2, MessageCircle } from 'lucide-react';
import { store, useDB, today } from '../core/store';
import { useRoute, go } from '../core/router';
import type { Task, TaskStatus } from '../core/types';
import { statusMeta, lookup, dueLabel, priorityTone, waLink } from '../core/helpers';
import { Modal, Field, Badge, PageHeader, Avatar, toast, confirmDelete } from '../components/ui';
import { useT } from '../core/i18n';
import { useRole, useUser } from '../core/session';

const COLS: TaskStatus[] = ['todo', 'doing', 'review', 'done'];

export default function Tasks() {
  const db = useDB(); const L = lookup(db); const t = useT(); const { params } = useRoute();
  const isStaff = useRole() === 'staff'; const me = useUser()?.staffId;
  const [who, setWho] = useState(isStaff && me ? me : 'all');
  const [edit, setEdit] = useState<Partial<Task> | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  useEffect(() => { if (params.new) { setEdit({ status: 'todo', priority: 'normal', jobId: params.job, dueDate: today() }); go('tasks'); } }, [params.new]); // eslint-disable-line

  const list = db.tasks.filter((x) => who === 'all' || x.staffId === who || (who === 'none' && !x.staffId));
  const save = () => { if (!edit?.title?.trim()) return toast('Enter a task title'); if (isStaff && edit.staffId !== me) return toast('You can only add tasks for yourself'); store.upsert('tasks', edit as Task); setEdit(null); toast('Task saved'); };
  const staff = L.staff(edit?.staffId);
  const job = L.job(edit?.jobId);

  return (
    <>
      <PageHeader title={t('Tasks')} sub="Assign work to your team and drag cards as they progress."
        actions={<button className="btn primary" onClick={() => setEdit({ status: 'todo', priority: 'normal', dueDate: today(), staffId: isStaff ? me : undefined })}><Plus size={16} />{isStaff ? 'Add my task' : 'Assign task'}</button>} />
      {!isStaff && <div className="toolbar chips">
        <button className={`chip ${who === 'all' ? 'on' : ''}`} onClick={() => setWho('all')}>Everyone</button>
        {db.staff.filter((x) => x.active).map((p) => <button key={p.id} className={`chip ${who === p.id ? 'on' : ''}`} onClick={() => setWho(p.id)}>{p.name} <span className="muted">({db.tasks.filter((x) => x.staffId === p.id && x.status !== 'done').length})</span></button>)}
        <button className={`chip ${who === 'none' ? 'on' : ''}`} onClick={() => setWho('none')}>Unassigned</button>
      </div>}
      {isStaff && !me && <div className="alert">Your login is not linked to a staff profile yet — ask the owner to link it in Settings → Users.</div>}
      <div className="kanban">
        {COLS.map((c) => { const items = list.filter((x) => x.status === c); return (
          <div key={c} className={`kcol ${over === c ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(c); }} onDragLeave={() => setOver(null)}
            onDrop={() => { const x = db.tasks.find((y) => y.id === drag); if (x) store.upsert('tasks', { ...x, status: c }); setDrag(null); setOver(null); }}>
            <div className="kcol-head"><span className="flex"><span className="dot" style={{ background: statusMeta[c].color }} />{statusMeta[c].label}</span><span className="muted">{items.length}</span></div>
            {items.map((x) => { const p = L.staff(x.staffId); const d = dueLabel(x.dueDate); const j = L.job(x.jobId); return (
              <div key={x.id} className="kcard" draggable={!isStaff || x.staffId === me} onDragStart={() => setDrag(x.id)} onClick={() => setEdit({ ...x })}>
                <div className="flex between"><span className="muted">{j ? j.code : 'General'}</span><Badge tone={priorityTone[x.priority]}>{x.priority}</Badge></div>
                <div className="ktitle" style={x.status === 'done' ? { textDecoration: 'line-through', opacity: .6 } : undefined}>{x.title}</div>
                <div className="kmeta"><span className="flex">{p ? <Avatar name={p.name} color={p.color} size={22} /> : null}{p?.name || 'Unassigned'}</span>{x.status !== 'done' && <Badge tone={d.tone}>{d.text}</Badge>}</div>
              </div>); })}
          </div>); })}
      </div>
      {edit && (
        <Modal open title={edit.id ? 'Edit task' : 'Assign task'} onClose={() => setEdit(null)}
          footer={<>
            {edit.id && !isStaff && <button className="btn danger ghost" onClick={() => { if (confirmDelete('this task')) { store.remove('tasks', edit.id!); setEdit(null); } }}><Trash2 size={15} />Delete</button>}
            {staff?.phone && edit.title && <a className="btn ghost" target="_blank" rel="noreferrer" href={waLink(staff.phone, `New task for you: ${edit.title}${job ? ` (${job.code} ${job.title})` : ''}. Due: ${edit.dueDate || '-'}. Priority: ${edit.priority}.${edit.notes ? '\n' + edit.notes : ''}`)}><MessageCircle size={15} />Send on WhatsApp</a>}
            <span className="spacer" /><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button>
          </>}>
          <div className="form two">
            <Field label="Task" span={3}><input autoFocus value={edit.title || ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="e.g. Cut carcass panels" /></Field>
            <Field label="Assign to"><select disabled={isStaff} value={edit.staffId || ''} onChange={(e) => setEdit({ ...edit, staffId: e.target.value })}><option value="">— Unassigned —</option>{db.staff.filter((x) => x.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}</select></Field>
            <Field label="Job"><select value={edit.jobId || ''} onChange={(e) => setEdit({ ...edit, jobId: e.target.value })}><option value="">— General —</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>
            <Field label="Status"><select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as TaskStatus })}>{COLS.map((c) => <option key={c} value={c}>{statusMeta[c].label}</option>)}</select></Field>
            <Field label="Priority"><select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value as Task['priority'] })}>{['low', 'normal', 'high', 'urgent'].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Due date"><input type="date" value={edit.dueDate || ''} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} /></Field>
            <Field label="Estimated hours"><input type="number" value={edit.hours || ''} onChange={(e) => setEdit({ ...edit, hours: +e.target.value })} /></Field>
            <Field label="Instructions" span={3}><textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
