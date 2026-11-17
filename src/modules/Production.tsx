import { useState } from 'react';
import { Factory, Plus, Check, ClipboardList, CalendarDays } from 'lucide-react';
import { store, useDB, today, uid, nextNumber } from '../core/store';
import type { Job, ProdLog, ProdStage } from '../core/types';
import { fmtDate } from '../core/calc';
import { lookup, daysFrom } from '../core/helpers';
import { go } from '../core/router';
import { useCanWrite, useUser } from '../core/session';
import { PageHeader, Badge, Empty, Modal, Field, Stat, Tabs, Progress, toast } from '../components/ui';
import { ExportButtons } from '../components/Export';

export const PROD_STAGES: { id: ProdStage; label: string }[] = [
  { id: 'cutting', label: 'Cutting' }, { id: 'assembly', label: 'Assembly' }, { id: 'sanding', label: 'Sanding' }, { id: 'polishing', label: 'Polishing' },
  { id: 'finishing', label: 'Finishing' }, { id: 'qc', label: 'Quality check' }, { id: 'packing', label: 'Packing' }, { id: 'dispatch', label: 'Delivery preparation' },
];
const stageIdx = (s: ProdStage) => PROD_STAGES.findIndex((x) => x.id === s);
export const prodPct = (j: Job) => (j.production ? Math.round((Object.keys(j.production.done || {}).length / PROD_STAGES.length) * 100) : 0);

/** Workshop production: production orders, the stage each one is at, and a daily production log. */
export default function Production() {
  const db = useDB(); const L = lookup(db); const can = useCanWrite()('jobs'); const user = useUser();
  const [tab, setTab] = useState<'board' | 'today' | 'list'>('board');
  const [day, setDay] = useState(today());
  const [log, setLog] = useState<{ job: Job; entry: Partial<ProdLog> } | null>(null);
  const orders = db.jobs.filter((j) => j.production && !j.closedAt && j.status !== 'cancelled');
  const ready = db.jobs.filter((j) => !j.production && ['design', 'production', 'finishing'].includes(j.status));
  const persist = (j: Job) => store.upsert('jobs', j);

  const start = (j: Job) => {
    const orderNo = nextNumber('PRD', db.jobs.map((x) => x.production?.orderNo || ''));
    persist({ ...j, status: ['enquiry', 'design'].includes(j.status) ? 'production' : j.status, production: { orderNo, started: today(), stage: 'cutting', done: {}, log: [] } });
    toast(`Production order ${orderNo} started for ${j.code}`);
  };
  const finishStage = (j: Job) => {
    const p = j.production!; const i = stageIdx(p.stage);
    const done = { ...p.done, [p.stage]: today() }; const next = PROD_STAGES[i + 1]?.id;
    const entry: ProdLog = { id: uid(), date: today(), stage: p.stage, text: `${PROD_STAGES[i].label} finished`, by: user?.name };
    const progress = Math.max(j.progress || 0, Math.round(30 + (Object.keys(done).length / PROD_STAGES.length) * 55));
    persist({ ...j, progress, status: next ? (['polishing', 'finishing', 'qc', 'packing', 'dispatch'].includes(next) ? 'finishing' : j.status) : 'finishing', production: { ...p, done, stage: next || p.stage, log: [entry, ...(p.log || [])] } });
    toast(next ? `${j.code}: now ${PROD_STAGES[i + 1].label}` : `${j.code}: ready for delivery`);
  };
  const saveLog = () => {
    if (!log?.entry.text?.trim()) return toast('Write what was done');
    const p = log.job.production!;
    persist({ ...log.job, production: { ...p, log: [{ id: uid(), date: log.entry.date || today(), stage: log.entry.stage || p.stage, text: log.entry.text.trim(), hours: Number(log.entry.hours) || undefined, staffIds: log.entry.staffIds, by: user?.name }, ...(p.log || [])] } });
    setLog(null); toast('Production update saved');
  };
  const dayLog = orders.flatMap((j) => (j.production!.log || []).filter((l) => l.date === day).map((l) => ({ j, l })));
  const late = orders.filter((j) => j.dueDate && (daysFrom(j.dueDate) ?? 0) < 0 && !j.production!.done.dispatch);

  return (
    <>
      <PageHeader title="Production" sub="Production orders through cutting, assembly, sanding, polishing, finishing, quality check, packing and delivery preparation." />
      <div className="grid g4 mb">
        <Stat label="In production" value={orders.filter((j) => !j.production!.done.dispatch).length} icon={<Factory size={20} />} tone="wood" />
        <Stat label="Ready for delivery" value={orders.filter((j) => j.production!.done.dispatch && !['installation', 'completed'].includes(j.status)).length} icon={<Check size={20} />} tone="green" />
        <Stat label="Updates today" value={orders.reduce((n, j) => n + (j.production!.log || []).filter((l) => l.date === today()).length, 0)} icon={<ClipboardList size={20} />} tone="blue" />
        <Stat label="Late" value={<span className={late.length ? 'neg' : ''}>{late.length}</span>} icon={<CalendarDays size={20} />} tone="red" sub="past the delivery date" />
      </div>
      <div className="toolbar"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'board', label: 'Production board', count: orders.length }, { id: 'today', label: 'Daily production' }, { id: 'list', label: 'Project progress' }]} />
        {tab === 'today' && <input type="date" style={{ width: 'auto' }} value={day} onChange={(e) => setDay(e.target.value)} />}</div>

      {tab === 'board' && <>
        <div className="prod-board">{PROD_STAGES.map((st) => { const here = orders.filter((j) => j.production!.stage === st.id && !(st.id === 'dispatch' && j.production!.done.dispatch)); return (
          <div key={st.id} className="prod-col"><div className="prod-col-head"><b>{st.label}</b><Badge>{here.length}</Badge></div>
            {here.map((j) => <div key={j.id} className="prod-card">
              <div className="flex between"><span className="code-tag">{j.code}</span><span className="muted" style={{ fontSize: 11 }}>{j.production!.orderNo}</span></div>
              <div className="title" style={{ cursor: 'pointer' }} onClick={() => go('jobs', { id: j.id })}>{j.title}</div>
              <div className="muted" style={{ fontSize: 12 }}>{L.customer(j.customerId)?.name || ''}{j.dueDate ? ` · due ${fmtDate(j.dueDate)}` : ''}</div>
              <Progress value={prodPct(j)} />
              {can && <div className="flex" style={{ marginTop: 6, gap: 6 }}><button className="btn sm primary" onClick={() => finishStage(j)}><Check size={13} />{st.label} done</button><button className="btn sm" onClick={() => setLog({ job: j, entry: { date: today(), stage: st.id } })}><Plus size={13} />Update</button></div>}
            </div>)}
          </div>); })}
          <div className="prod-col"><div className="prod-col-head"><b>Ready</b><Badge tone="green">{orders.filter((j) => j.production!.done.dispatch).length}</Badge></div>
            {orders.filter((j) => j.production!.done.dispatch).map((j) => <div key={j.id} className="prod-card done" onClick={() => go('jobs', { id: j.id })}><span className="code-tag">{j.code}</span><div className="title">{j.title}</div><div className="muted" style={{ fontSize: 12 }}>Packed {fmtDate(j.production!.done.dispatch)}</div></div>)}</div>
        </div>
        {can && ready.length > 0 && <div className="card" style={{ marginTop: 14 }}><h3>Start a production order</h3><ul className="list">{ready.map((j) => <li key={j.id}><span className="code-tag">{j.code}</span><div className="grow"><div className="title">{j.title}</div><div className="muted">{L.customer(j.customerId)?.name} · {j.dueDate ? `due ${fmtDate(j.dueDate)}` : 'no due date'}</div></div><button className="btn sm" onClick={() => start(j)}><Factory size={14} />Start production</button></li>)}</ul></div>}
      </>}

      {tab === 'today' && <div className="card">
        <div className="flex between"><h3>Production on {fmtDate(day)}</h3><ExportButtons name={`production-${day}`} head={['Project', 'Order', 'Stage', 'Work done', 'Hours', 'Staff', 'By']} rows={dayLog.map(({ j, l }) => [j.code, j.production!.orderNo, PROD_STAGES[stageIdx(l.stage)]?.label, l.text, l.hours || '', (l.staffIds || []).map((id) => L.staff(id)?.name).join(', '), l.by || ''])} /></div>
        {dayLog.length ? <ul className="updates">{dayLog.map(({ j, l }) => <li key={l.id}><div className="u-head"><b><span className="code-tag">{j.code}</span> {j.title}</b><Badge>{PROD_STAGES[stageIdx(l.stage)]?.label}</Badge></div>
          <div>{l.text}</div><div className="muted" style={{ fontSize: 12 }}>{[l.hours ? `${l.hours} h` : '', (l.staffIds || []).map((id) => L.staff(id)?.name).filter(Boolean).join(', '), l.by].filter(Boolean).join(' · ')}</div></li>)}</ul>
          : <Empty title="No production updates for this day" hint="Use “Update” on a card to record what the workshop did." />}
      </div>}

      {tab === 'list' && <div className="card">{orders.length ? <div className="table-wrap"><table><thead><tr><th>Project</th><th>Order</th><th>Stage</th>{PROD_STAGES.map((s) => <th key={s.id} style={{ fontSize: 11 }}>{s.label}</th>)}<th className="num">Done</th></tr></thead>
        <tbody>{orders.map((j) => <tr key={j.id} className="click" onClick={() => go('jobs', { id: j.id })}><td><span className="code-tag">{j.code}</span> {j.title}</td><td>{j.production!.orderNo}</td><td><Badge tone="amber">{PROD_STAGES[stageIdx(j.production!.stage)]?.label}</Badge></td>
          {PROD_STAGES.map((s) => <td key={s.id} style={{ fontSize: 11 }}>{j.production!.done[s.id] ? <span className="pos">✓ {fmtDate(j.production!.done[s.id]).slice(0, 6)}</span> : ''}</td>)}<td className="num"><b>{prodPct(j)}%</b></td></tr>)}</tbody></table></div>
        : <Empty title="No production orders yet" />}</div>}

      {log && <Modal open title={`Production update — ${log.job.code}`} onClose={() => setLog(null)} footer={<><span className="spacer" /><button className="btn" onClick={() => setLog(null)}>Cancel</button><button className="btn primary" onClick={saveLog}>Save</button></>}>
        <div className="form two">
          <Field label="Date"><input type="date" value={log.entry.date} onChange={(e) => setLog({ ...log, entry: { ...log.entry, date: e.target.value } })} /></Field>
          <Field label="Stage"><select value={log.entry.stage} onChange={(e) => setLog({ ...log, entry: { ...log.entry, stage: e.target.value as ProdStage } })}>{PROD_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
          <Field label="Hours"><input type="number" value={log.entry.hours ?? ''} onChange={(e) => setLog({ ...log, entry: { ...log.entry, hours: +e.target.value } })} /></Field>
          <Field label="Work done" span={3}><textarea autoFocus value={log.entry.text || ''} onChange={(e) => setLog({ ...log, entry: { ...log.entry, text: e.target.value } })} placeholder="Cut all carcass panels, edge banding done" /></Field>
          <Field label="Staff" span={3}><div className="chips">{db.staff.filter((x) => x.active !== false).map((x) => { const on = (log.entry.staffIds || []).includes(x.id); return <button key={x.id} type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => setLog({ ...log, entry: { ...log.entry, staffIds: on ? log.entry.staffIds!.filter((y) => y !== x.id) : [...(log.entry.staffIds || []), x.id] } })}>{x.name}</button>; })}</div></Field>
        </div>
      </Modal>}
    </>
  );
}
