import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, Send, Ruler, X } from 'lucide-react';
import type { Job } from '../core/types';
import { store, useDB, today, uid } from '../core/store';
import { useUser } from '../core/session';
import { WORKFLOW, displayStep, setStep } from '../core/workflow';
import { projectFinance, fmtDate } from '../core/calc';
import { statusMeta } from '../core/helpers';
import { go } from '../core/router';
import { compressImage } from './Photos';
import { storePhoto } from '../core/upload';
import { Attachments } from './Attachments';
import { Badge, Empty, toast } from './ui';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Workflow (20 steps), status history, daily work updates, drawings and site measurements of one project. */
export function ProjectProgress({ job, setJob, readOnly }: { job: Job; setJob: (j: Job) => void; readOnly?: boolean }) {
  const db = useDB(); const user = useUser();
  const saved = db.jobs.find((j) => j.id === job.id) || job;
  const f = projectFinance(db, saved);
  const cur = displayStep(saved, f.toCollect, f.contract);
  const by = user?.name || 'Owner';
  const persist = (n: Job) => { store.upsert('jobs', n); setJob({ ...job, ...n }); };
  const pick = (n: number) => {
    if (readOnly || n === cur || n > 18) return;
    const note = window.prompt(`Move ${saved.code} to step ${n}: ${WORKFLOW[n - 1].label}?\nNote (optional):`, '');
    if (note === null) return;
    persist(setStep(saved, n, by, today(), note || undefined)); toast(`${saved.code}: ${WORKFLOW[n - 1].label}`);
  };
  const [text, setText] = useState(''); const [photos, setPhotos] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const [big, setBig] = useState<string | null>(null); const ref = useRef<HTMLInputElement>(null);
  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return; setBusy(true);
    try { const out = [...photos]; for (const x of Array.from(files).slice(0, 6)) out.push(await compressImage(x, 1400, 0.75)); setPhotos(out.slice(0, 6)); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  const post = async () => {
    if (!text.trim() && !photos.length) return;
    setBusy(true);
    try {
      const urls: string[] = []; for (const p of photos) urls.push(await storePhoto(p));
      persist({ ...saved, updates: [{ id: uid(), at: new Date().toISOString(), by, text: text.trim(), photos: urls }, ...(saved.updates || [])] });
      setText(''); setPhotos([]); toast('Work update added');
    } finally { setBusy(false); }
  };
  const stepsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = stepsRef.current?.querySelector('.wf-step.cur') as HTMLElement | null; if (el && stepsRef.current) stepsRef.current.scrollLeft = el.offsetLeft - stepsRef.current.clientWidth / 2 + el.clientWidth / 2; }, [cur]);
  const measurements = db.measurements.filter((m) => m.jobId === saved.id);
  const history = [...(saved.history || [])].reverse();

  return (
    <div className="project-progress">
      <div className="card flat mb">
        <h3>Workflow <span className="muted" style={{ fontWeight: 400 }}>step {cur} of 20 · {WORKFLOW[cur - 1].label}</span></h3>
        <div className="wf-steps" ref={stepsRef}>{WORKFLOW.map((w) => (
          <button key={w.n} type="button" className={`wf-step ${w.n < cur ? 'done' : w.n === cur ? 'cur' : ''}`} disabled={readOnly || w.n > 18} onClick={() => pick(w.n)} title={w.n > 18 ? 'Set automatically from the payments' : `Move to: ${w.label}`}>
            <i>{w.n}</i><span>{w.label}</span></button>))}</div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Tap a step to move the project there — the date, time and your name are saved. “Quotation approved” and “Advance received” are set automatically; steps 19–20 follow the payments.</p>
      </div>

      <div className="grid g2 mb">
        <div className="card flat">
          <h3>Daily work updates <span className="muted" style={{ fontWeight: 400 }}>{(saved.updates || []).length}</span></h3>
          {!readOnly && <div className="update-box">
            <textarea rows={2} placeholder="What was done today? e.g. Carcass assembled, doors sent for polish" value={text} onChange={(e) => setText(e.target.value)} />
            {photos.length > 0 && <div className="compose-photos">{photos.map((p, i) => <div key={i} className="compose-ph" style={{ backgroundImage: `url(${p})` }}><button onClick={() => setPhotos(photos.filter((_, k) => k !== i))} aria-label="Remove"><X size={12} /></button></div>)}</div>}
            <div className="flex">
              <input ref={ref} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
              <button type="button" className="btn sm" disabled={busy} onClick={() => ref.current?.click()}><Camera size={14} />Photo</button>
              <button type="button" className="btn sm primary" disabled={busy || (!text.trim() && !photos.length)} onClick={post}>{busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />}Add update</button>
            </div>
          </div>}
          {(saved.updates || []).length ? <ul className="updates">{(saved.updates || []).map((u) => <li key={u.id}>
            <div className="u-head"><b>{u.by || '—'}</b><time>{when(u.at)}</time></div>
            {u.text && <div style={{ whiteSpace: 'pre-wrap' }}>{u.text}</div>}
            {u.photos?.length ? <div className="u-photos">{u.photos.map((p, i) => <img key={i} src={p} alt="" onClick={() => setBig(p)} />)}</div> : null}
          </li>)}</ul> : <Empty title="No updates yet" hint="Add a short note (and photos) each day the work moves on." />}
        </div>
        <div className="card flat">
          <h3>Status history</h3>
          {history.length ? <ul className="hist">{history.map((h, i) => <li key={i}><time>{when(h.at)}</time><div className="grow">
            <b>{h.step ? `${h.step}. ${WORKFLOW[h.step - 1]?.label}` : h.status ? statusMeta[h.status].label : ''}</b>{h.note && <div className="muted">{h.note}</div>}</div>
            <span className="muted">{h.by === 'system' ? 'automatic' : h.by}</span></li>)}</ul>
            : <p className="muted">Changes of step or status are listed here with the date, time and who made them.</p>}
          {saved.stageDates && <div className="chips" style={{ marginTop: 10 }}>{Object.entries(saved.stageDates).map(([k, v]) => <Badge key={k}>{statusMeta[k]?.label || k}: {fmtDate(v)}</Badge>)}</div>}
        </div>
      </div>

      <div className="grid g2">
        <div className="card flat">
          <h3>Drawings & designs</h3>
          <Attachments files={saved.attachments || []} readOnly={readOnly} kind="drawing" onChange={(attachments) => persist({ ...saved, attachments })} />
        </div>
        <div className="card flat">
          <h3>Site measurements <span className="muted" style={{ fontWeight: 400 }}>{measurements.length}</span></h3>
          {measurements.length ? <ul className="list">{measurements.map((m) => <li key={m.id} style={{ cursor: 'pointer' }} onClick={() => go('measurements', { id: m.id })}><Ruler size={16} /><div className="grow"><div className="title">{m.number} · {m.items.length} items</div><div className="muted">{fmtDate(m.date)} · {m.site || ''}</div></div><Badge>{m.status}</Badge></li>)}</ul>
            : <p className="muted">None linked. In Site measurements, choose this project on the measurement.</p>}
        </div>
      </div>
      {big && <div className="modal-back" onMouseDown={() => setBig(null)}><img className="photo-big" src={big} alt="" /></div>}
    </div>
  );
}
