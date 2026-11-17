import { Check } from 'lucide-react';
import type { ProjectTrack } from '../core/stages';
import { fmtDate } from '../core/calc';

/** Row of stage dots: done ✓, current (pulsing), skipped (hollow), to come. */
export function StageDots({ t }: { t: ProjectTrack }) {
  return (
    <div className="stage-dots" title={t.stages.map((s) => `${s.label}: ${s.done ? 'done' + (s.date ? ' ' + fmtDate(s.date) : '') : s.current ? 'now' : s.skipped ? 'not recorded' : 'to come'}`).join('\n')}>
      {t.stages.map((s) => <span key={s.id} className={`sd ${s.done ? 'done' : s.current ? 'cur' : s.skipped ? 'skip' : ''}`}>{s.done && <Check size={9} strokeWidth={4} />}</span>)}
    </div>
  );
}

/** Full stage timeline with dates (inside a project). */
export function StageTimeline({ t, onMark }: { t: ProjectTrack; onMark?: (id: 'quote' | 'billing', on: boolean) => void }) {
  return (
    <ol className="stage-line">
      {t.stages.map((s, k) => (
        <li key={s.id} className={`${s.done ? 'done' : s.current ? 'cur' : s.skipped ? 'skip' : ''}`}>
          <span className="sl-dot">{s.done ? <Check size={13} strokeWidth={3} /> : k + 1}</span>
          <div className="sl-body">
            <b>{s.label}</b>
            <small>{s.done ? (s.date ? fmtDate(s.date) : 'done') : s.current ? 'now' : s.skipped ? 'not recorded' : ''}{s.note ? ` · ${s.note}` : ''}{s.manual ? ' · marked by hand' : ''}</small>
            {onMark && (s.id === 'quote' || s.id === 'billing') && (!s.done || s.manual) && <button type="button" className="sl-mark" onClick={() => onMark(s.id as 'quote' | 'billing', !s.done)}>{s.done ? 'Undo' : 'Mark done'}</button>}
          </div>
        </li>
      ))}
    </ol>
  );
}
