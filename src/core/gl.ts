import type { DB, Settings } from './types';
import { accountOf, docTotals, invoiceBalance, PROJECT_CATS } from './calc';

/**
 * General ledger built from the books: every cash/bank entry (Accounts), every manual journal and the
 * opening balances become balanced double-entry postings. Customer invoices, supplier bills and stock
 * are shown beside it on the balance sheet (the books are kept on a cash basis).
 */
export type AccType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export interface Account { name: string; type: AccType }
export interface Posting { date: string; account: string; debit: number; credit: number; ref: string; text: string; src: 'txn' | 'journal' | 'opening'; srcId?: string; jobId?: string }

export const BS_ACCOUNTS: Account[] = [
  { name: 'Cash', type: 'asset' }, { name: 'Bank', type: 'asset' }, { name: 'Accounts receivable', type: 'asset' }, { name: 'Inventory', type: 'asset' },
  { name: 'VAT receivable', type: 'asset' }, { name: 'Fixed assets', type: 'asset' }, { name: 'Staff advances', type: 'asset' }, { name: 'Prepaid expenses', type: 'asset' },
  { name: 'Accounts payable', type: 'liability' }, { name: 'VAT payable', type: 'liability' }, { name: 'Customer advances', type: 'liability' }, { name: 'Loans', type: 'liability' }, { name: 'Accrued expenses', type: 'liability' },
  { name: 'Owner capital', type: 'equity' }, { name: 'Owner drawings', type: 'equity' }, { name: 'Opening balance equity', type: 'equity' }, { name: 'Retained earnings', type: 'equity' },
];
export function chart(s: Settings): Account[] {
  const bs = new Set(BS_ACCOUNTS.map((a) => a.name));
  return [...BS_ACCOUNTS,
    ...s.incomeCategories.filter((c) => !bs.has(c)).map((name) => ({ name, type: 'income' as const })),
    ...s.expenseCategories.filter((c) => !bs.has(c)).map((name) => ({ name, type: 'expense' as const }))];
}
export const accountType = (s: Settings, name: string): AccType => chart(s).find((a) => a.name === name)?.type || (/income|sales|revenue/i.test(name) ? 'income' : 'expense');
const money = (a: 'cash' | 'bank') => (a === 'cash' ? 'Cash' : 'Bank');

export function postings(db: DB): Posting[] {
  const s = db.settings; const out: Posting[] = []; const from = s.openingDate || '';
  const od = s.openingDate || '1970-01-01';
  if (Number(s.openingCash)) out.push({ date: od, account: 'Cash', debit: Math.max(0, +s.openingCash!), credit: Math.max(0, -s.openingCash!), ref: 'OPEN', text: 'Opening cash', src: 'opening' }, { date: od, account: 'Opening balance equity', debit: Math.max(0, -s.openingCash!), credit: Math.max(0, +s.openingCash!), ref: 'OPEN', text: 'Opening cash', src: 'opening' });
  if (Number(s.openingBank)) out.push({ date: od, account: 'Bank', debit: Math.max(0, +s.openingBank!), credit: Math.max(0, -s.openingBank!), ref: 'OPEN', text: 'Opening bank', src: 'opening' }, { date: od, account: 'Opening balance equity', debit: Math.max(0, -s.openingBank!), credit: Math.max(0, +s.openingBank!), ref: 'OPEN', text: 'Opening bank', src: 'opening' });
  for (const t of db.txns) {
    if (from && t.date < from) continue;
    const base = { date: t.date, ref: t.ref || t.category, text: t.description || t.category, src: 'txn' as const, srcId: t.id, jobId: t.jobId };
    if (t.kind === 'transfer') { out.push({ ...base, account: money(t.toAccount || 'bank'), debit: t.amount, credit: 0 }, { ...base, account: money(t.account || 'cash'), debit: 0, credit: t.amount }); continue; }
    const acc = money(accountOf(t)); const other = t.category || (t.kind === 'income' ? 'Other income' : 'Other Expenses');
    if (t.kind === 'income') out.push({ ...base, account: acc, debit: t.amount, credit: 0 }, { ...base, account: other, debit: 0, credit: t.amount });
    else out.push({ ...base, account: other, debit: t.amount, credit: 0 }, { ...base, account: acc, debit: 0, credit: t.amount });
  }
  for (const j of db.journals) for (const l of j.lines) out.push({ date: j.date, account: l.account, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, ref: j.number, text: l.note || j.memo, src: 'journal', srcId: j.id, jobId: l.jobId });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Debit-positive balance of each account up to a date. */
export function trialBalance(db: DB, to = '9999-12-31', from = '') {
  const rows: Record<string, { debit: number; credit: number }> = {};
  for (const p of postings(db)) { if (p.date > to || (from && p.date < from)) continue; const r = rows[p.account] ||= { debit: 0, credit: 0 }; r.debit += p.debit; r.credit += p.credit; }
  const list = Object.entries(rows).map(([account, r]) => ({ account, type: accountType(db.settings, account), debit: r.debit, credit: r.credit, balance: r.debit - r.credit }));
  const order: AccType[] = ['asset', 'liability', 'equity', 'income', 'expense'];
  list.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.account.localeCompare(b.account));
  return { rows: list, debit: list.reduce((n, r) => n + Math.max(0, r.balance), 0), credit: list.reduce((n, r) => n + Math.max(0, -r.balance), 0) };
}

const DIRECT = new Set([...PROJECT_CATS, 'Materials', 'Boards & Sheets', 'Hardware', 'Subcontract', 'Transport', 'Fuel']);
/** Profit & loss for a period; expenses split into direct project costs and overheads. */
export function profitLoss(db: DB, from: string, to: string) {
  const inc: Record<string, number> = {}; const direct: Record<string, number> = {}; const ovh: Record<string, number> = {};
  for (const p of postings(db)) {
    if (p.date < from || p.date > to) continue;
    const t = accountType(db.settings, p.account);
    if (t === 'income') inc[p.account] = (inc[p.account] || 0) + p.credit - p.debit;
    if (t === 'expense') { const m = p.jobId || DIRECT.has(p.account) ? direct : ovh; m[p.account] = (m[p.account] || 0) + p.debit - p.credit; }
  }
  const sum = (m: Record<string, number>) => Object.values(m).reduce((n, v) => n + v, 0);
  const income = sum(inc); const directCost = sum(direct); const overheads = sum(ovh);
  return { inc, direct, ovh, income, directCost, gross: income - directCost, overheads, net: income - directCost - overheads };
}

/** Balance sheet on a date: ledger balances plus what customers owe, stock and what is owed to suppliers. */
export function balanceSheet(db: DB, asOf: string) {
  const tb = trialBalance(db, asOf);
  const bal = (t: AccType) => tb.rows.filter((r) => r.type === t);
  const receivable = db.invoices.filter((i) => i.date <= asOf).reduce((n, i) => n + Math.max(0, invoiceBalance(i)), 0);
  const stock = db.items.reduce((n, i) => n + (Number(i.qty) || 0) * (Number(i.cost) || 0), 0);
  const payable = db.purchases.filter((p) => p.date <= asOf && p.status !== 'cancelled').reduce((n, p) => {
    const sub = p.lines.reduce((m, l) => m + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0) * (1 + (Number(p.vat) || 0) / 100);
    const ret = (p.returns || []).reduce((m, r) => m + r.amount - (Number(r.refund) || 0), 0);
    return n + Math.max(0, sub - ret - (Number(p.paid) || 0));
  }, 0);
  const assets = bal('asset').map((r) => ({ name: r.account, amount: r.balance }));
  const pushA = (name: string, amount: number) => { if (!amount) return; const x = assets.find((a) => a.name === name); if (x) x.amount += amount; else assets.push({ name, amount }); };
  pushA('Accounts receivable', receivable); pushA('Inventory', stock);
  const liabilities = bal('liability').map((r) => ({ name: r.account, amount: -r.balance }));
  if (payable) { const x = liabilities.find((a) => a.name === 'Accounts payable'); if (x) x.amount += payable; else liabilities.push({ name: 'Accounts payable', amount: payable }); }
  const earnings = bal('income').reduce((n, r) => n - r.balance, 0) - bal('expense').reduce((n, r) => n + r.balance, 0);
  const equity = bal('equity').map((r) => ({ name: r.account, amount: -r.balance }));
  equity.push({ name: 'Retained earnings (cash profit to date)', amount: earnings });
  if (receivable || stock || payable) equity.push({ name: 'Receivables + stock − payables (not yet in cash)', amount: receivable + stock - payable });
  const tA = assets.reduce((n, a) => n + a.amount, 0); const tL = liabilities.reduce((n, a) => n + a.amount, 0); const tE = equity.reduce((n, a) => n + a.amount, 0);
  return { assets, liabilities, equity, totalAssets: tA, totalLiabilities: tL, totalEquity: tE, balanced: Math.abs(tA - tL - tE) < 0.01 };
}

const INVESTING = /fixed asset|machine|equipment|vehicle|tools? purchase|furniture & fittings/i;
const FINANCING = /capital|loan|drawing|owner|dividend/i;
/** Cash-flow statement: money in and out of cash + bank, by activity. */
export function cashFlow(db: DB, from: string, to: string) {
  const cashAcc = new Set(['Cash', 'Bank']);
  const ps = postings(db);
  const before = ps.filter((p) => cashAcc.has(p.account) && p.date < from).reduce((n, p) => n + p.debit - p.credit, 0);
  const groups = { operating: {} as Record<string, number>, investing: {} as Record<string, number>, financing: {} as Record<string, number> };
  // pair each cash posting with its other side (same source)
  const bySrc = new Map<string, typeof ps>();
  for (const p of ps) { if (p.date < from || p.date > to) continue; const k = `${p.src}:${p.srcId || p.ref}:${p.date}`; bySrc.set(k, [...(bySrc.get(k) || []), p]); }
  for (const list of bySrc.values()) {
    const cash = list.filter((p) => cashAcc.has(p.account)); const other = list.filter((p) => !cashAcc.has(p.account));
    const net = cash.reduce((n, p) => n + p.debit - p.credit, 0); if (Math.abs(net) < 1e-9) continue;
    const name = other[0]?.account || 'Other';
    const g = INVESTING.test(name) ? groups.investing : FINANCING.test(name) ? groups.financing : groups.operating;
    g[name] = (g[name] || 0) + net;
  }
  const sum = (m: Record<string, number>) => Object.values(m).reduce((n, v) => n + v, 0);
  const op = sum(groups.operating), inv = sum(groups.investing), fin = sum(groups.financing);
  return { opening: before, ...groups, op, inv, fin, net: op + inv + fin, closing: before + op + inv + fin };
}

/** Sales in a period (invoices net of credit notes + shop sales), grouped by day, month or year. */
export function salesBy(db: DB, from: string, to: string, by: 'day' | 'month' | 'year') {
  const key = (d: string) => (by === 'day' ? d : by === 'month' ? d.slice(0, 7) : d.slice(0, 4));
  const m: Record<string, { invoices: number; shop: number; vat: number; count: number }> = {};
  for (const i of db.invoices) { if (i.date < from || i.date > to) continue; const t = docTotals(i); const r = m[key(i.date)] ||= { invoices: 0, shop: 0, vat: 0, count: 0 }; r.invoices += t.total - (Number(i.credited) || 0); r.vat += t.vat; r.count++; }
  for (const x of db.sales) {
    if (x.date < from || x.date > to) continue;
    const sub = x.lines.reduce((n, l) => n + l.qty * l.price, 0) - (Number(x.discount) || 0); const tot = sub * (1 + (Number(x.vat) || 0) / 100);
    const ret = (x.returns || []).reduce((n, r) => n + r.amount, 0);
    const r = m[key(x.date)] ||= { invoices: 0, shop: 0, vat: 0, count: 0 }; r.shop += tot - ret; r.vat += tot - sub; r.count++;
  }
  return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([period, r]) => ({ period, ...r, total: r.invoices + r.shop }));
}
