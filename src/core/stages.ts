/**
 * Project stages, worked out from the data so nobody has to tick them by hand:
 *   Quotation → Advance / billing → Work started (with % done) → Work finished → Installed → Balance received.
 * Quotation and billing can also be marked done manually (when they happened outside the app).
 */
import type { DB, Job, JobStatus, Settings } from './types';
import { money, projectFinance } from './calc';

export type StageId = 'quote' | 'billing' | 'work' | 'finished' | 'install' | 'paid';
export const STAGES: { id: StageId; label: string; short: string }[] = [
  { id: 'quote', label: 'Quotation accepted', short: 'Quotation' },
  { id: 'billing', label: 'Advance / billing', short: 'Billing' },
  { id: 'work', label: 'Work started', short: 'Work' },
  { id: 'finished', label: 'Work finished', short: 'Finished' },
  { id: 'install', label: 'Installation done', short: 'Installed' },
  { id: 'paid', label: 'Balance received', short: 'Paid' },
];
const WORKING: JobStatus[] = ['production', 'finishing', 'installation', 'completed'];

export interface StageState { id: StageId; label: string; short: string; done: boolean; date?: string; manual?: boolean; skipped?: boolean; current?: boolean; note?: string }
export interface ProjectTrack {
  stages: StageState[]; current?: StageState; doneCount: number; progress: number; next: string; tone: 'gray' | 'blue' | 'amber' | 'green' | 'red';
  late: boolean; contract: number; billed: number; collected: number; balance: number; quotationStatus?: string;
}

/** Record the day a project first reached a status (used for the stage dates). */
export function withStatus<T extends Partial<Job>>(job: T, status: JobStatus, today: string): T {
  const stageDates = { ...(job.stageDates || {}) };
  if (!stageDates[status]) stageDates[status] = today;
  const progress = status === 'completed' || status === 'installation' ? 100 : job.progress;
  return { ...job, status, stageDates, progress, completedDate: status === 'completed' ? job.completedDate || today : undefined };
}

export function projectTrack(db: DB, job: Job, withMoney = true): ProjectTrack {
  const quotes = db.quotations.filter((q) => q.jobId === job.id || q.id === job.quotationId);
  const accepted = quotes.find((q) => q.status === 'accepted');
  const invoices = db.invoices.filter((i) => i.jobId === job.id);
  const advances = db.receipts.filter((r) => r.jobId === job.id && !r.voided);
  const billedDates = [...invoices.map((i) => i.date), ...advances.map((r) => r.date)].sort();
  const sd = job.stageDates || {}; const man = job.stageDone || {};
  const f = withMoney ? projectFinance(db, job) : undefined;
  const lastIncome = db.txns.filter((t) => t.jobId === job.id && t.kind === 'income').map((t) => t.date).sort().pop();
  const working = WORKING.includes(job.status);
  const raw: Record<StageId, { done: boolean; date?: string; manual?: boolean; note?: string }> = {
    quote: accepted ? { done: true, date: accepted.date, note: accepted.number } : man.quote ? { done: true, date: man.quote, manual: true } : { done: false, note: quotes[0] ? `${quotes[0].number} · ${quotes[0].status}` : undefined },
    billing: billedDates.length ? { done: true, date: billedDates[0], note: invoices[0]?.number } : man.billing ? { done: true, date: man.billing, manual: true } : { done: false },
    work: { done: working, date: sd.production || sd.finishing || sd.installation || (working ? job.startDate : undefined), note: working ? `${job.progress || 0}% done` : undefined },
    finished: { done: job.status === 'installation' || job.status === 'completed', date: sd.installation || sd.completed },
    install: { done: job.status === 'completed', date: job.completedDate || sd.completed },
    paid: f ? { done: f.contract > 0 && f.toCollect <= 0.0005, date: f.contract > 0 && f.toCollect <= 0.0005 ? lastIncome : undefined, note: f.toCollect > 0.0005 ? `${f.toCollect.toFixed(3)} due` : undefined } : { done: false },
  };
  const ids = STAGES.map((s) => s.id).filter((id) => withMoney || (id !== 'billing' && id !== 'paid'));
  // the furthest stage reached decides where the project is; earlier ones never recorded count as skipped
  let last = -1; ids.forEach((id, k) => { if (raw[id].done) last = k; });
  const stages: StageState[] = ids.map((id, k) => {
    const s = STAGES.find((x) => x.id === id)!;
    return { ...s, ...raw[id], skipped: !raw[id].done && k < last, current: k === last + 1 };
  });
  const current = stages.find((s) => s.current);
  const today = new Date().toISOString().slice(0, 10);
  const late = !!job.dueDate && job.dueDate < today && job.status !== 'completed' && job.status !== 'cancelled';
  const balance = f ? Math.max(0, f.toCollect) : 0;
  let next = 'Closed — fully paid'; let tone: ProjectTrack['tone'] = 'green';
  if (job.status === 'cancelled') { next = 'Cancelled'; tone = 'gray'; }
  else if (current) {
    tone = 'blue';
    switch (current.id) {
      case 'quote': next = quotes.some((q) => q.status === 'sent') ? 'Quotation sent — waiting for reply' : quotes.length ? 'Send the quotation' : 'Make the quotation'; tone = 'gray'; break;
      case 'billing': next = 'Take the advance / make the invoice'; tone = 'amber'; break;
      case 'work': next = 'Start the work'; tone = 'amber'; break;
      case 'finished': next = `Work in progress — ${job.progress || 0}%`; break;
      case 'install': next = job.status === 'installation' ? 'Install at site' : 'Finish & install'; break;
      case 'paid': next = withMoney && f ? `Collect balance ${money(balance, db.settings)}` : 'Collect the balance'; tone = 'red'; break;
    }
  } else if (!withMoney) next = 'Installed';
  if (late && tone !== 'green') tone = 'red';
  return {
    stages, current, doneCount: stages.filter((s) => s.done).length, progress: job.progress || 0, next, tone, late,
    contract: f?.contract || 0, billed: f?.invoiced || 0, collected: f?.collected || 0, balance, quotationStatus: quotes[0]?.status,
  };
}

/** Next project code: PREFIX-101, PREFIX-102 … or PREFIX-26-001 when the year is included. */
export function nextProjectCode(db: Pick<DB, 'jobs'>, s: Pick<Settings, 'projectPrefix' | 'projectCodeYear'>, date = new Date()) {
  const prefix = (s.projectPrefix || 'JOB').trim().toUpperCase();
  if (s.projectCodeYear) {
    const yy = String(date.getFullYear()).slice(2);
    const head = `${prefix}-${yy}-`;
    const nums = db.jobs.filter((j) => j.code?.toUpperCase().startsWith(head)).map((j) => parseInt(j.code.slice(head.length), 10) || 0);
    return `${head}${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
  }
  const head = `${prefix}-`;
  const nums = db.jobs.filter((j) => j.code?.toUpperCase().startsWith(head)).map((j) => parseInt(j.code.slice(head.length).replace(/\D/g, ''), 10) || 0);
  return `${head}${(nums.length ? Math.max(...nums) : 100) + 1}`;
}
