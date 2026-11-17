import type { DB, Invoice, Job, LineItem, Quotation, Sale, Settings, Staff, Txn, MoneyAccount } from './types';

export const lineTotal = (l: LineItem) => (Number(l.qty) || 0) * (Number(l.rate) || 0);
export function docTotals(d: Pick<Quotation | Invoice, 'items' | 'discount' | 'vat'>) {
  const subtotal = d.items.reduce((s, l) => s + lineTotal(l), 0);
  const discount = Number(d.discount) || 0;
  const taxable = Math.max(0, subtotal - discount);
  const vat = taxable * ((Number(d.vat) || 0) / 100);
  return { subtotal, discount, taxable, vat, total: taxable + vat };
}
/** What the customer still owes: total − paid − credit notes. */
export const invoiceBalance = (inv: Invoice) => docTotals(inv).total - (Number(inv.paid) || 0) - (Number(inv.credited) || 0);
export const invoiceStatus = (inv: Invoice) => {
  const t = docTotals(inv).total - (Number(inv.credited) || 0); const p = Number(inv.paid) || 0;
  return p >= t - 0.001 && (p > 0 || t <= 0.001) ? 'paid' : p <= 0 ? 'unpaid' : 'partial';
};
/** Draft/sent quotations past their validity date show as expired. */
export const quoteState = (q: Quotation, today = new Date().toISOString().slice(0, 10)) =>
  (q.status === 'draft' || q.status === 'sent') && q.validUntil && q.validUntil < today ? 'expired' : q.status;

/** POS sale totals; returns refund part of the bill. */
export function saleTotals(x: Sale) {
  const sub = x.lines.reduce((n, l) => n + l.qty * l.price, 0);
  const total = Math.max(0, sub - (Number(x.discount) || 0)) * (1 + (Number(x.vat) || 0) / 100);
  const returned = (x.returns || []).reduce((n, r) => n + r.amount, 0);
  return { sub, total, returned, net: total - returned };
}
/** Refund for returning `qty` of each line: the line's share of the bill after discount, with VAT. */
export function returnAmount(x: Sale, lines: { itemId: string; qty: number }[]) {
  const sub = x.lines.reduce((n, l) => n + l.qty * l.price, 0); if (!sub) return 0;
  const k = Math.max(0, sub - (Number(x.discount) || 0)) / sub * (1 + (Number(x.vat) || 0) / 100);
  return lines.reduce((n, r) => n + (x.lines.find((l) => l.itemId === r.itemId)?.price || 0) * r.qty * k, 0);
}

// ---------- cash & bank ----------
export const accountOf = (t: Pick<Txn, 'account' | 'method'>): MoneyAccount => t.account || (t.method === 'Cash' ? 'cash' : 'bank');
export function balances(db: DB) {
  const s = db.settings; const from = s.openingDate || '';
  const b = { cash: Number(s.openingCash) || 0, bank: Number(s.openingBank) || 0 };
  for (const t of db.txns) {
    if (from && t.date < from) continue;
    if (t.kind === 'transfer') { b[t.account || 'cash'] -= t.amount; b[t.toAccount || 'bank'] += t.amount; continue; }
    b[accountOf(t)] += t.kind === 'income' ? t.amount : -t.amount;
  }
  // manual journal lines on Cash / Bank (Finance → Journal entries)
  for (const j of db.journals || []) {
    if (from && j.date < from) continue;
    for (const l of j.lines) { if (l.account === 'Cash') b.cash += (Number(l.debit) || 0) - (Number(l.credit) || 0); if (l.account === 'Bank') b.bank += (Number(l.debit) || 0) - (Number(l.credit) || 0); }
  }
  const pendingIn = db.cheques.filter((c) => c.direction === 'received' && ['pending', 'deposited'].includes(c.status)).reduce((n, c) => n + c.amount, 0);
  const pendingOut = db.cheques.filter((c) => c.direction === 'issued' && ['pending', 'deposited'].includes(c.status)).reduce((n, c) => n + c.amount, 0);
  return { ...b, total: b.cash + b.bank, pendingIn, pendingOut };
}

// ---------- staff cost, gratuity & leave ----------
/** What one hour of this person's time costs the business (salary + allowance). */
export function hourlyCost(st: Pick<Staff, 'salaryType' | 'rate' | 'allowance'> | undefined, s: Settings) {
  if (!st || !(Number(st.rate) >= 0)) return 0;
  const h = Number(s.workHoursPerDay) || 8; const days = Number(s.workingDaysPerMonth) || 26;
  if (st.salaryType === 'hourly') return Number(st.rate) || 0;
  if (st.salaryType === 'daily') return (Number(st.rate) || 0) / h;
  return ((Number(st.rate) || 0) + (Number(st.allowance) || 0)) / days / h;
}
export function monthlyBasic(st: Staff, s: Settings) {
  const days = Number(s.workingDaysPerMonth) || 26; const h = Number(s.workHoursPerDay) || 8;
  return st.salaryType === 'monthly' ? Number(st.rate) || 0 : st.salaryType === 'daily' ? (Number(st.rate) || 0) * days : (Number(st.rate) || 0) * h * days;
}
export function serviceYears(joinDate?: string, asOf = new Date().toISOString().slice(0, 10)) {
  if (!joinDate) return 0;
  return Math.max(0, (new Date(asOf + 'T00:00:00').getTime() - new Date(joinDate + 'T00:00:00').getTime()) / (365.25 * 864e5));
}
/**
 * End-of-service gratuity and annual leave balance. Omani nationals are covered by social insurance
 * instead of gratuity. Days per year are set in Settings → Lists & payroll.
 */
export function staffEntitlements(db: DB, st: Staff) {
  const s = db.settings; const years = serviceYears(st.joinDate);
  const basic = monthlyBasic(st, s);
  const omani = /oman/i.test(st.nationality || '');
  const gratuity = omani ? 0 : (basic / 30) * (Number(s.gratuityDaysPerYear ?? 30)) * years;
  const from = st.leaveFrom || st.joinDate;
  const leaveAccrued = (Number(s.annualLeaveDays ?? 30)) * serviceYears(from) + (Number(st.leaveOpening) || 0);
  const leaveTaken = db.attendance.filter((a) => a.staffId === st.id && a.mark === 'L' && (!from || a.date >= from)).length;
  return { years, basic, gratuity, omani, leaveAccrued, leaveTaken, leaveBalance: leaveAccrued - leaveTaken };
}

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
  // transfers between cash and bank are not income or expense
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
  // advances given up to the end of this month are recovered from this month's salary
  const advance = db.advances.filter((a) => a.staffId === staffId && !a.recovered && a.date <= `${month}-31`).reduce((n, a) => n + a.amount, 0);
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

/** Project (job) accounts: contract value incl. additional work, money collected, expenses and profit. */
/**
 * Project accounts. Revenue = contract + approved additional work − credit notes (collections are
 * not revenue, so an advance is never counted twice). Direct cost = expenses posted to the project
 * + stock issued + staff hours. Net profit also takes the overhead share (Settings → overhead %).
 */
export function projectFinance(db: DB, job: Pick<Job, 'id' | 'value' | 'extras' | 'materials'> & { budget?: number }) {
  const tasks = db.tasks.filter((t) => t.jobId === job.id && Number(t.spent) > 0);
  const labourHours = tasks.reduce((n, t) => n + Number(t.spent), 0);
  const labour = tasks.reduce((n, t) => n + Number(t.spent) * hourlyCost(db.staff.find((x) => x.id === t.staffId), db.settings), 0);
  const base = Number(job.value) || 0;
  const extras = (job.extras || []).reduce((n, e) => n + (Number(e.amount) || 0), 0);
  const credited = db.invoices.filter((i) => i.jobId === job.id).reduce((n, i) => n + (Number(i.credited) || 0), 0);
  const contract = base + extras - credited;
  const txns = db.txns.filter((t) => t.jobId === job.id);
  // money paid back to the customer (credit-note refunds) lowers what was collected, it is not a project cost
  const isRefund = (t: Txn) => t.kind === 'expense' && t.category === 'Refund';
  const refunds = txns.filter(isRefund).reduce((n, t) => n + t.amount, 0);
  const collected = txns.filter((t) => t.kind === 'income').reduce((n, t) => n + t.amount, 0) - refunds;
  const spent = txns.filter((t) => t.kind === 'expense' && !isRefund(t)).reduce((n, t) => n + t.amount, 0);
  const materials = (job.materials || []).reduce((n, m) => n + (Number(m.issued) || 0) * (db.items.find((i) => i.id === m.itemId)?.cost || 0), 0);
  const expenses = spent + materials + labour;
  const invoiced = db.invoices.filter((i) => i.jobId === job.id).reduce((n, i) => n + docTotals(i).total, 0);
  const byCategory: Record<string, number> = {};
  txns.filter((t) => t.kind === 'expense' && !isRefund(t)).forEach((t) => (byCategory[t.category] = (byCategory[t.category] || 0) + t.amount));
  if (materials) byCategory['Materials from stock'] = (byCategory['Materials from stock'] || 0) + materials;
  if (labour) byCategory['Staff time (from tasks)'] = (byCategory['Staff time (from tasks)'] || 0) + labour;
  const overheadRate = Number(db.settings.overheadRate) || 0;
  const overhead = contract * overheadRate / 100;
  const gross = contract - expenses; const net = gross - overhead;
  const budget = Number(job.budget) || 0;
  return {
    base, extras, credited, contract, collected, toCollect: Math.max(0, contract - collected), spent, materials, labour, labourHours, expenses, invoiced,
    // labour is the cost of salaried time already paid through payroll, so it lowers profit but not cash
    direct: expenses, overhead, overheadRate, gross, net, profit: net, cash: collected - spent - materials,
    grossMargin: contract ? gross / contract : 0, margin: contract ? net / contract : 0, byCategory,
    budget, estimatedProfit: budget ? contract - budget - overhead : undefined, budgetLeft: budget ? budget - expenses : undefined,
    overBudget: budget > 0 && expenses > budget + 0.0005, loss: contract > 0 && net < -0.0005,
  };
}

/** Overheads (expenses not tied to a project, salaries excluded) as % of income over the last 12 months — a suggestion for Settings. */
export function suggestedOverheadRate(db: DB) {
  const from = new Date(); from.setFullYear(from.getFullYear() - 1); const f = from.toISOString().slice(0, 10);
  const inc = db.txns.filter((t) => t.kind === 'income' && t.date >= f).reduce((n, t) => n + t.amount, 0);
  const ovh = db.txns.filter((t) => t.kind === 'expense' && !t.jobId && t.date >= f && !['Salary', 'Refund', 'Sales Return'].includes(t.category)).reduce((n, t) => n + t.amount, 0);
  return inc ? Math.round((ovh / inc) * 1000) / 10 : 0;
}
/** The first of these expense categories that exists in Settings (so new and older category names both work). */
export const catOf = (s: Settings, ...names: string[]) => names.find((n) => s.expenseCategories.includes(n)) || names[0];
/** Project expense categories from the ERP spec; added once to older setups. */
export const PROJECT_CATS = ['Wood and Plywood', 'Hardware and Accessories', 'Labour', 'Carpenter Wages', 'Polishing', 'Painting', 'Transportation', 'Installation', 'Electricity', 'Outsourced Work', 'Other Expenses'];
