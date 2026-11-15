import type { DB, Invoice, LineItem, Quotation, Settings } from './types';

export const lineTotal = (l: LineItem) => (Number(l.qty) || 0) * (Number(l.rate) || 0);
export function docTotals(d: Pick<Quotation | Invoice, 'items' | 'discount' | 'vat'>) {
  const subtotal = d.items.reduce((s, l) => s + lineTotal(l), 0);
  const discount = Number(d.discount) || 0;
  const taxable = Math.max(0, subtotal - discount);
  const vat = taxable * ((Number(d.vat) || 0) / 100);
  return { subtotal, discount, taxable, vat, total: taxable + vat };
}
export const invoiceBalance = (inv: Invoice) => docTotals(inv).total - (Number(inv.paid) || 0);
export const invoiceStatus = (inv: Invoice) => {
  const t = docTotals(inv).total; const p = Number(inv.paid) || 0;
  return p <= 0 ? 'unpaid' : p >= t - 0.001 ? 'paid' : 'partial';
};

export function money(n: number, s: Settings | string) {
  const cur = typeof s === 'string' ? s : s.currency;
  const dec = ['OMR', 'KWD', 'BHD'].includes(cur) ? 3 : 2;
  return `${cur} ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}
export const fmtDate = (d?: string) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const monthKey = (d: string) => d.slice(0, 7);
export const monthLabel = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
export function lastMonths(n: number) {
  const out: string[] = []; const d = new Date(); d.setDate(1);
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d); x.setMonth(d.getMonth() - i); out.push(x.toISOString().slice(0, 7)); }
  return out;
}
export function daysInMonth(m: string) { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); }

export function finance(db: DB, month?: string) {
  const inMonth = (d: string) => !month || d.startsWith(month);
  const income = db.txns.filter((t) => t.kind === 'income' && inMonth(t.date)).reduce((s, t) => s + t.amount, 0);
  const expense = db.txns.filter((t) => t.kind === 'expense' && inMonth(t.date)).reduce((s, t) => s + t.amount, 0);
  return { income, expense, profit: income - expense };
}

export function payrollCalc(db: DB, staffId: string, month: string) {
  const st = db.staff.find((s) => s.id === staffId)!;
  const s = db.settings;
  const att = db.attendance.filter((a) => a.staffId === staffId && a.date.startsWith(month));
  const present = att.reduce((n, a) => n + (a.mark === 'P' ? 1 : a.mark === 'H' ? 0.5 : a.mark === 'L' ? 1 : 0), 0);
  const otHours = att.reduce((n, a) => n + (Number(a.overtime) || 0), 0);
  const days = att.length ? present : s.workingDaysPerMonth;
  let basic = 0; let hourly = 0;
  if (st.salaryType === 'monthly') {
    basic = att.length ? (st.rate / s.workingDaysPerMonth) * Math.min(days, s.workingDaysPerMonth) : st.rate;
    hourly = st.rate / s.workingDaysPerMonth / s.workHoursPerDay;
  } else if (st.salaryType === 'daily') { basic = st.rate * days; hourly = st.rate / s.workHoursPerDay; }
  else { basic = st.rate * s.workHoursPerDay * days; hourly = st.rate; }
  const overtimePay = otHours * hourly * s.overtimeMultiplier;
  const advance = db.advances.filter((a) => a.staffId === staffId && !a.recovered).reduce((n, a) => n + a.amount, 0);
  return { basic, daysPresent: days, overtimeHours: otHours, overtimePay, allowance: st.allowance || 0, advance };
}
