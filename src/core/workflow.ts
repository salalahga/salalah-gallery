/**
 * The detailed 20-step project workflow. Each step belongs to one of the broad statuses used by the
 * board, and carries a typical "% done". Every change is written to the project history with the
 * date, time and the user who made it.
 */
import type { Job, JobStatus } from './types';
import { withStatus } from './stages';

export const WORKFLOW: { n: number; label: string; status: JobStatus; pct: number }[] = [
  { n: 1, label: 'New enquiry', status: 'enquiry', pct: 0 },
  { n: 2, label: 'Site inspection', status: 'enquiry', pct: 2 },
  { n: 3, label: 'Measurement completed', status: 'enquiry', pct: 4 },
  { n: 4, label: 'Quotation prepared', status: 'enquiry', pct: 5 },
  { n: 5, label: 'Quotation approved', status: 'design', pct: 8 },
  { n: 6, label: 'Advance received', status: 'design', pct: 10 },
  { n: 7, label: 'Design in progress', status: 'design', pct: 12 },
  { n: 8, label: 'Design approved', status: 'design', pct: 15 },
  { n: 9, label: 'Material purchasing', status: 'production', pct: 20 },
  { n: 10, label: 'Material ready', status: 'production', pct: 25 },
  { n: 11, label: 'Production started', status: 'production', pct: 30 },
  { n: 12, label: 'Work in progress', status: 'production', pct: 45 },
  { n: 13, label: 'Polishing & finishing', status: 'finishing', pct: 70 },
  { n: 14, label: 'Quality inspection', status: 'finishing', pct: 80 },
  { n: 15, label: 'Ready for delivery', status: 'finishing', pct: 85 },
  { n: 16, label: 'Delivery', status: 'installation', pct: 90 },
  { n: 17, label: 'Installation', status: 'installation', pct: 95 },
  { n: 18, label: 'Project completed', status: 'completed', pct: 100 },
  { n: 19, label: 'Final payment pending', status: 'completed', pct: 100 },
  { n: 20, label: 'Closed', status: 'completed', pct: 100 },
];
const FIRST_OF: Record<JobStatus, number> = { enquiry: 1, design: 7, production: 11, finishing: 13, installation: 16, completed: 18, cancelled: 1 };

/** The step a project is at (older projects without a step get one from their status). */
export function stepOf(job: Pick<Job, 'step' | 'status'>) {
  if (job.step && WORKFLOW[job.step - 1]?.status === job.status) return job.step;
  return FIRST_OF[job.status] ?? 1;
}
/** Steps 18–20 depend on money: completed + balance due = 19, nothing due = 20. */
export function displayStep(job: Pick<Job, 'step' | 'status'>, balance?: number, contract?: number) {
  const n = stepOf(job);
  if (job.status !== 'completed' || balance === undefined) return n;
  if (!contract) return Math.max(n, 18);
  return balance > 0.0005 ? 19 : 20;
}

/** Move a project to a step: status, % done, stage dates and a history entry with who and when. */
export function setStep<T extends Partial<Job>>(job: T, n: number, by: string | undefined, today: string, note?: string): T {
  const w = WORKFLOW[n - 1]; if (!w) return job;
  const moved = job.status !== w.status ? withStatus(job, w.status, today) : job;
  const history = [...(job.history || []), { at: new Date().toISOString(), by, step: n, status: w.status, ...(note ? { note } : {}) }];
  return { ...moved, step: n, progress: Math.max(w.status === 'completed' ? 100 : Number(job.progress) || 0, w.pct), history };
}
/** Status changed some other way (board drag, status field): keep step and history in line. */
export function logStatus<T extends Partial<Job>>(job: T, status: JobStatus, by: string | undefined, today: string): T {
  const moved = withStatus(job, status, today);
  const keep = job.step && WORKFLOW[job.step - 1]?.status === status;
  return { ...moved, step: keep ? job.step : FIRST_OF[status], history: [...(job.history || []), { at: new Date().toISOString(), by, status, step: keep ? job.step : FIRST_OF[status] }] };
}
/** Raise a project to an automatic step (quotation approved, advance received) if it is behind it. */
export function autoStep<T extends Partial<Job>>(job: T, n: number, today: string, note: string): T | null {
  if (job.status === 'cancelled' || stepOf(job as Job) >= n) return null;
  return setStep(job, n, 'system', today, note);
}
