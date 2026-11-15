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

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function words(n: number): string {
  if (n === 0) return 'Zero';
  const chunk = (x: number) => {
    const h = Math.floor(x / 100), r = x % 100;
    const t = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? '-' + ONES[r % 10] : '');
    return [h ? ONES[h] + ' Hundred' : '', t].filter(Boolean).join(' ');
  };
  const parts: string[] = [];
  for (const [v, name] of [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'], [1, '']] as const) {
    const c = Math.floor(n / v) % 1000; if (c) parts.push(chunk(c) + (name ? ' ' + name : ''));
  }
  return parts.join(' ');
}
/** e.g. 300 OMR → "Three Hundred Omani Rials Only"; 12.5 → "Twelve Omani Rials and Five Hundred Baisa Only". */
export function amountInWords(amount: number, currency: string) {
  const names: Record<string, [string, string, number]> = {
    OMR: ['Omani Rials', 'Baisa', 1000], AED: ['UAE Dirhams', 'Fils', 100], SAR: ['Saudi Riyals', 'Halalas', 100], QAR: ['Qatari Riyals', 'Dirhams', 100],
    KWD: ['Kuwaiti Dinars', 'Fils', 1000], BHD: ['Bahraini Dinars', 'Fils', 1000], INR: ['Rupees', 'Paise', 100], USD: ['US Dollars', 'Cents', 100], EUR: ['Euros', 'Cents', 100],
  };
  const [major, minor, div] = names[currency] || [currency, 'cents', 100];
  const total = Math.round((Number(amount) || 0) * div);
  const a = Math.floor(total / div), b = total % div;
  return `${words(a)} ${major}${b ? ` and ${words(b)} ${minor}` : ''} Only`;
}
