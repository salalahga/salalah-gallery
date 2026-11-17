import type { DB, Job, Txn } from './types';
import { invoiceBalance, money, projectFinance } from './calc';
import { guessCategory, expenseCats, parseAmount } from '../modules/ExpenseChat';

/**
 * Business assistant: understands short commands and questions. It only reads figures that are in
 * the books and never saves anything itself — money entries come back as a draft the owner confirms.
 */
export interface ExpenseDraft { kind: 'expense' | 'income'; amount?: number; category: string; jobId?: string; description: string; date: string; method: string; vendor?: string; billNo?: string; vat?: number; photos?: string[]; items?: { description: string; qty: number; price: number; total: number }[] }
export type Answer =
  | { type: 'text'; text: string; rows?: { label: string; value: string; go?: [string, Record<string, string>?] }[] }
  | { type: 'draft'; text: string; draft: ExpenseDraft };

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s.-]/gu, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'to', 'for', 'of', 'project', 'job', 'this', 'that', 'my', 'add', 'upload', 'receipt', 'bill', 'show', 'how', 'much', 'did', 'make', 'in', 'on', 'with', 'from', 'omr', 'ro', 'purchase', 'expense', 'payment', 'paid', 'is', 'what', 'was', 'and']);

/** Find a project by its code number ("105", "TZ-26-105") or by words of its title / customer ("kitchen project"). */
export function findJob(db: DB, text: string): Job | undefined {
  const t = norm(text);
  for (const j of db.jobs) if (j.code && t.includes(j.code.toLowerCase())) return j;
  const m = /(?:project|job|proj|#)\s*#?\s*([a-z0-9-]*\d+)/i.exec(text);
  if (m) {
    const n = m[1].toLowerCase(); const tail = n.replace(/^.*?(\d+)$/, '$1');
    const hit = db.jobs.find((j) => j.code.toLowerCase() === n) || db.jobs.find((j) => j.code.toLowerCase().endsWith('-' + n) || j.code.replace(/\D/g, '').endsWith(tail) && Number(j.code.replace(/^.*\D/, '')) === Number(tail));
    if (hit) return hit;
  }
  const words = t.split(' ').filter((w) => w.length > 2 && !STOP.has(w) && !/^\d/.test(w));
  if (!words.length) return undefined;
  let best: { j: Job; n: number } | undefined;
  for (const j of db.jobs.filter((x) => x.status !== 'cancelled')) {
    const hay = norm(`${j.title} ${j.description || ''} ${db.customers.find((c) => c.id === j.customerId)?.name || ''}`);
    const n = words.filter((w) => hay.includes(w)).length;
    if (n && (!best || n > best.n || (n === best.n && String(j.createdAt) > String(best.j.createdAt)))) best = { j, n };
  }
  return best?.j;
}

/** Bills already in the books that look like this one (same bill number and supplier, or same amount on the same day). */
export function findDuplicates(db: DB, d: { amount?: number; date?: string; billNo?: string; vendor?: string; jobId?: string }, ignoreId?: string): Txn[] {
  if (!d.amount && !d.billNo) return [];
  const v = (d.vendor || '').toLowerCase().slice(0, 8);
  return db.txns.filter((t) => t.id !== ignoreId && t.kind === 'expense' && (
    (d.billNo && t.billNo && t.billNo.toLowerCase() === d.billNo.toLowerCase() && (!v || !t.vendor || t.vendor.toLowerCase().startsWith(v))) ||
    (d.amount && Math.abs(t.amount - d.amount) < 0.0005 && d.date && t.date === d.date && (!d.jobId || !t.jobId || t.jobId === d.jobId))
  ));
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function period(t: string): { from: string; to: string; label: string } {
  const n = new Date(); const y = n.getFullYear(); const m = n.getMonth();
  if (/last month|previous month/.test(t)) return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)), label: 'last month' };
  if (/this year|year to date|ytd/.test(t)) return { from: `${y}-01-01`, to: `${y}-12-31`, label: 'this year' };
  if (/last year/.test(t)) return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: 'last year' };
  if (/today/.test(t)) return { from: ymd(n), to: ymd(n), label: 'today' };
  if (/this week/.test(t)) { const a = new Date(n); a.setDate(n.getDate() - ((n.getDay() + 6) % 7)); return { from: ymd(a), to: ymd(n), label: 'this week' }; }
  if (/all time|ever|total so far/.test(t)) return { from: '0000', to: '9999', label: 'all time' };
  return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)), label: 'this month' };
}

export const EXAMPLES = [
  'Add 150 OMR wood purchase to Project 105',
  'Show all projects with pending payments',
  'How much profit did Project 105 make?',
  'Show this month’s total expenses',
  'Which customers owe money?',
  'What is low in stock?',
  'Cash and bank balance',
];

export function answer(db: DB, input: string, today: string): Answer {
  const s = db.settings; const t = norm(input); const m$ = (n: number) => money(n, s);
  const job = findJob(db, input);

  // ---- money entries (never saved here) ----
  if (/\b(add|record|enter|log|put|upload|book|spent|paid|pay)\b/.test(t) && (parseAmount(input.replace(/project\s*#?\s*[\w-]+/i, '')) || /upload|receipt|bill/.test(t))) {
    const amount = parseAmount(input.replace(/(?:project|job)\s*#?\s*[\w-]*\d[\w-]*/ig, ' ').replace(/\b(19|20)\d{2}-\d{2}-\d{2}\b/g, ' '));
    const income = /\b(received|income|collected|got paid)\b/.test(t);
    const cats = income ? s.incomeCategories : expenseCats(s);
    const category = income ? (cats.find((c) => /job|project/i.test(c)) || cats[0]) : guessCategory(input, cats);
    const description = input.replace(/\b(add|record|enter|log|put|upload|book)\b/ig, '').replace(/(?:to|for)\s+(?:the\s+)?(?:project|job)\s*#?\s*[\w-]+/ig, '').replace(/\d+(?:\.\d+)?\s*(omr|ro)?/ig, '').replace(/\s+/g, ' ').trim() || category;
    const draft: ExpenseDraft = { kind: income ? 'income' : 'expense', amount, category, jobId: job?.id, description, date: today, method: /\bbank|transfer\b/.test(t) ? 'Bank' : /\bcard\b/.test(t) ? 'Card' : /\bcheque\b/.test(t) ? 'Cheque' : 'Cash' };
    const missing = [!amount && 'the amount', !job && !income && 'which project (or leave it as a workshop expense)'].filter(Boolean);
    return { type: 'draft', draft, text: missing.length ? `Please check ${missing.join(' and ')} below, then confirm.` : `Here is the ${draft.kind} I understood. Check it and press Confirm — nothing is saved until you do.` };
  }

  // ---- profit of a project ----
  if (/profit|loss|margin|earn|made/.test(t) && job) {
    const f = projectFinance(db, job);
    return { type: 'text', text: `${job.code} · ${job.title}: net ${f.net >= 0 ? 'profit' : 'loss'} ${m$(Math.abs(f.net))} (${Math.round(f.margin * 100)}% of ${m$(f.contract)}).`, rows: [
      { label: 'Project value', value: m$(f.contract) }, { label: 'Collected', value: m$(f.collected) }, { label: 'Direct costs', value: m$(f.direct) },
      { label: `Overheads (${f.overheadRate}%)`, value: m$(f.overhead) }, { label: 'Gross profit', value: m$(f.gross) }, { label: 'Balance to collect', value: m$(f.toCollect), go: ['jobs', { id: job.id }] }] };
  }
  // ---- project status ----
  if (job && /status|stage|progress|where|update/.test(t)) {
    const f = projectFinance(db, job);
    return { type: 'text', text: `${job.code} · ${job.title} is ${job.status} (${job.progress || 0}% done)${job.dueDate ? `, due ${job.dueDate}` : ''}. ${f.toCollect > 0.0005 ? `${m$(f.toCollect)} still to collect.` : 'Fully paid.'}`, rows: [{ label: 'Open project', value: job.code, go: ['jobs', { id: job.id }] }] };
  }
  // ---- pending payments ----
  if (/pending|outstanding|unpaid|owe|due|balance to collect|receivable/.test(t) && !/supplier|we owe|payable/.test(t)) {
    if (/customer|who/.test(t)) {
      const by: Record<string, number> = {};
      for (const i of db.invoices) { const b = invoiceBalance(i); if (b > 0.0005) by[i.customerId || ''] = (by[i.customerId || ''] || 0) + b; }
      const rows = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([cid, v]) => ({ label: db.customers.find((c) => c.id === cid)?.name || '—', value: m$(v), go: ['customers', {}] as [string, Record<string, string>] }));
      return { type: 'text', text: rows.length ? `${rows.length} customers owe ${m$(Object.values(by).reduce((n, v) => n + v, 0))} on invoices.` : 'No customer owes anything on invoices.', rows };
    }
    const rows = db.jobs.filter((j) => j.status !== 'cancelled').map((j) => ({ j, f: projectFinance(db, j) })).filter((r) => r.f.toCollect > 0.0005 && r.f.contract > 0).sort((a, b) => b.f.toCollect - a.f.toCollect);
    return { type: 'text', text: rows.length ? `${rows.length} projects have ${m$(rows.reduce((n, r) => n + r.f.toCollect, 0))} still to collect.` : 'No project has a pending payment.', rows: rows.map((r) => ({ label: `${r.j.code} · ${r.j.title}`, value: m$(r.f.toCollect), go: ['jobs', { id: r.j.id }] as [string, Record<string, string>] })) };
  }
  // ---- supplier dues ----
  if (/supplier|payable|we owe/.test(t)) {
    const by: Record<string, number> = {};
    for (const p of db.purchases) { if (p.status === 'cancelled') continue; const tot = p.lines.reduce((n, l) => n + l.qty * l.rate, 0) * (1 + (Number(p.vat) || 0) / 100) - (p.returns || []).reduce((n, r) => n + r.amount - (Number(r.refund) || 0), 0) - (Number(p.paid) || 0); if (tot > 0.0005) by[p.supplierId || ''] = (by[p.supplierId || ''] || 0) + tot; }
    const rows = Object.entries(by).map(([id, v]) => ({ label: db.suppliers.find((x) => x.id === id)?.name || '—', value: m$(v), go: ['purchases', {}] as [string, Record<string, string>] }));
    return { type: 'text', text: rows.length ? `You owe ${rows.length} suppliers ${m$(Object.values(by).reduce((n, v) => n + v, 0))}.` : 'Nothing is owed to suppliers.', rows };
  }
  // ---- totals for a period ----
  if (/expense|spent|spend|cost/.test(t) || /income|revenue|sales|received|collected/.test(t) || /profit/.test(t)) {
    const p = period(t);
    const tx = db.txns.filter((x) => x.date >= p.from && x.date <= p.to && (!job || x.jobId === job.id));
    const inc = tx.filter((x) => x.kind === 'income').reduce((n, x) => n + x.amount, 0); const exp = tx.filter((x) => x.kind === 'expense').reduce((n, x) => n + x.amount, 0);
    const byCat: Record<string, number> = {};
    const kind = /expense|spent|spend|cost/.test(t) ? 'expense' : /profit/.test(t) ? '' : 'income';
    for (const x of tx.filter((y) => !kind || y.kind === kind)) byCat[x.category] = (byCat[x.category] || 0) + (x.kind === 'income' ? x.amount : -x.amount) * (kind === 'expense' ? -1 : 1);
    const head = kind === 'expense' ? `Total expenses ${p.label}: ${m$(exp)}` : kind === 'income' ? `Money received ${p.label}: ${m$(inc)}` : `Profit ${p.label}: ${m$(inc - exp)} (income ${m$(inc)} − expenses ${m$(exp)})`;
    return { type: 'text', text: `${head}${job ? ` for ${job.code}` : ''} — from ${tx.length} entries in Accounts.`, rows: Object.entries(byCat).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([c, v]) => ({ label: c, value: m$(v), go: ['accounts', {}] as [string, Record<string, string>] })) };
  }
  // ---- stock ----
  if (/stock|inventory|low|reorder/.test(t)) {
    const words = t.split(' ').filter((w) => w.length > 2 && !STOP.has(w) && !['stock', 'inventory', 'low', 'left', 'have', 'many'].includes(w));
    const items = words.length ? db.items.filter((i) => words.some((w) => norm(`${i.name} ${i.category} ${i.thickness || ''}`).includes(w))) : db.items.filter((i) => i.reorder > 0 && i.qty <= i.reorder);
    return { type: 'text', text: items.length ? (words.length ? `${items.length} matching items in stock:` : `${items.length} items are at or below their minimum:`) : words.length ? 'No stock item matches that.' : 'Nothing is below its minimum stock.', rows: items.map((i) => ({ label: `${i.name} ${i.thickness || ''}`.trim(), value: `${i.qty} ${i.unit}`, go: ['inventory', {}] as [string, Record<string, string>] })) };
  }
  // ---- cash ----
  if (/cash|bank|balance/.test(t)) {
    let cash = Number(s.openingCash) || 0, bank = Number(s.openingBank) || 0;
    for (const x of db.txns) { if (s.openingDate && x.date < s.openingDate) continue; const acc = x.account || (x.method === 'Cash' ? 'cash' : 'bank'); if (x.kind === 'transfer') { if ((x.account || 'cash') === 'cash') { cash -= x.amount; bank += x.amount; } else { bank -= x.amount; cash += x.amount; } continue; } const v = x.kind === 'income' ? x.amount : -x.amount; if (acc === 'cash') cash += v; else bank += v; }
    return { type: 'text', text: `Cash in hand ${m$(cash)} · Bank ${m$(bank)} · Total ${m$(cash + bank)}.`, rows: [{ label: 'Open Accounts', value: '', go: ['accounts', {}] }] };
  }
  if (job) return answer(db, `status of ${job.code}`, today);
  return { type: 'text', text: 'I can add expenses (with or without a bill photo), and answer questions about project profit, pending payments, expenses, income, supplier dues, stock and cash. Try one of the examples.' };
}
