import type { DB } from './types';
export const statusMeta: Record<string, { label: string; tone: string; color: string }> = {
  enquiry: { label: 'Enquiry', tone: 'gray', color: '#9a8a7c' }, design: { label: 'Design', tone: 'blue', color: '#2563eb' },
  production: { label: 'Production', tone: 'amber', color: '#d97706' }, finishing: { label: 'Finishing', tone: 'amber', color: '#9333ea' },
  installation: { label: 'Installation', tone: 'blue', color: '#0891b2' }, completed: { label: 'Completed', tone: 'green', color: '#15803d' },
  cancelled: { label: 'Cancelled', tone: 'red', color: '#c2410c' },
  todo: { label: 'To do', tone: 'gray', color: '#9a8a7c' }, doing: { label: 'In progress', tone: 'amber', color: '#d97706' },
  review: { label: 'Review', tone: 'blue', color: '#2563eb' }, done: { label: 'Done', tone: 'green', color: '#15803d' },
  draft: { label: 'Draft', tone: 'gray', color: '#9a8a7c' }, sent: { label: 'Sent', tone: 'blue', color: '#2563eb' },
  accepted: { label: 'Accepted', tone: 'green', color: '#15803d' }, rejected: { label: 'Rejected', tone: 'red', color: '#c2410c' },
  unpaid: { label: 'Unpaid', tone: 'red', color: '#c2410c' }, partial: { label: 'Partial', tone: 'amber', color: '#d97706' }, paid: { label: 'Paid', tone: 'green', color: '#15803d' },
  idea: { label: 'Idea', tone: 'gray', color: '#9a8a7c' }, scheduled: { label: 'Scheduled', tone: 'blue', color: '#2563eb' }, posted: { label: 'Posted', tone: 'green', color: '#15803d' },
};
export const priorityTone: Record<string, string> = { low: 'gray', normal: 'blue', high: 'amber', urgent: 'red' };
export const lookup = (db: DB) => ({
  customer: (id?: string) => db.customers.find((c) => c.id === id),
  staff: (id?: string) => db.staff.find((c) => c.id === id),
  job: (id?: string) => db.jobs.find((c) => c.id === id),
  workType: (id?: string) => db.settings.workTypes.find((c) => c.id === id),
  item: (id?: string) => db.items.find((c) => c.id === id),
});
export const daysFrom = (d?: string) => (d ? Math.round((new Date(d + 'T00:00:00').getTime() - new Date(new Date().toDateString()).getTime()) / 86400000) : undefined);
export function dueLabel(d?: string) {
  const n = daysFrom(d); if (n === undefined) return { text: 'No date', tone: 'gray' };
  if (n < 0) return { text: `${-n}d overdue`, tone: 'red' }; if (n === 0) return { text: 'Today', tone: 'amber' };
  if (n <= 3) return { text: `In ${n}d`, tone: 'amber' }; return { text: `In ${n}d`, tone: 'gray' };
}
export function waLink(phone: string | undefined, text: string) {
  const p = (phone || '').replace(/[^0-9]/g, '');
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
