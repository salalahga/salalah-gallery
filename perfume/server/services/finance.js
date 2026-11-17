// Expenses and financial statements — every figure is computed from the general ledger.
import { id, nextNumber, must, money, str, isoDate, today } from '../util.js';
import { post, reverse, balances, MONEY_SUBTYPES } from './ledger.js';

export async function createExpense(q, input, { user }) {
  const account = await q.one("SELECT * FROM accounts WHERE id = $1 AND type = 'expense' AND active", ['acc_' + String(input.account).replace('acc_', '')]);
  must(account, 400, 'Choose an expense category');
  const paidFrom = await q.one("SELECT * FROM accounts WHERE id = $1 AND (subtype IN ('cash','bank') OR code = '2000')", ['acc_' + String(input.paidFrom || '1000').replace('acc_', '')]);
  must(paidFrom, 400, 'Pay from cash, bank or accounts payable');
  const amount = money(input.amount);
  must(amount > 0, 400, 'Enter the amount');
  const vat = money(input.vat || 0, 'VAT');
  const date = isoDate(input.date) || today();
  const eid = id('exp_');
  const number = await nextNumber(q, 'expense', 'EXP');
  const jid = await post(q, {
    date, memo: `${account.name}: ${str(input.description) || ''}`.trim(), sourceType: 'expense', sourceId: eid, branchId: input.branchId, userId: user.id, isTest: !!input.isTest,
    lines: [{ account: account.id, debit: amount }, { account: '1300', debit: vat }, { account: paidFrom.id, credit: amount + vat }],
  });
  await q(`INSERT INTO expenses (id, number, date, branch_id, account_id, paid_from, amount, vat, payee, description, reference, journal_id, created_by, is_test)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [eid, number, date, input.branchId || null, account.id, paidFrom.id, amount, vat, str(input.payee), str(input.description), str(input.reference), jid, user.id, !!input.isTest]);
  return { id: eid, number };
}

export async function reverseExpense(q, expenseId, { user, reason }) {
  const e = await q.one('SELECT * FROM expenses WHERE id = $1 FOR UPDATE', [expenseId]);
  must(e, 404, 'Expense not found');
  must(e.status === 'posted', 409, 'Already reversed');
  must(str(reason), 400, 'Give a reason');
  await reverse(q, e.journal_id, { userId: user.id, memo: `Reversal of ${e.number}: ${reason}` });
  await q("UPDATE expenses SET status = 'reversed' WHERE id = $1", [expenseId]);
  return { ok: true };
}

export async function journalEntry(q, input, { user }) {
  must(str(input.memo), 400, 'Describe the entry');
  must(Array.isArray(input.lines) && input.lines.length >= 2, 400, 'A journal entry needs at least two lines');
  const lines = input.lines.map((l) => ({ account: 'acc_' + String(l.account).replace('acc_', ''), debit: money(l.debit || 0), credit: money(l.credit || 0), partyType: l.partyType, partyId: l.partyId }));
  const jid = await post(q, { date: isoDate(input.date) || today(), memo: str(input.memo), sourceType: 'manual', userId: user.id, branchId: input.branchId, lines });
  must(jid, 400, 'The entry has no amounts');
  return { id: jid };
}

const sumBy = (rows, f) => rows.filter(f).reduce((a, r) => a + r.balance, 0);

export async function profitLoss(q, { from, to, branchId }) {
  const rows = (await balances(q, { from, to, branchId })).filter((r) => ['income', 'expense'].includes(r.type) && (r.debit || r.credit));
  const income = rows.filter((r) => r.type === 'income').map((r) => ({ ...r, amount: -r.balance }));
  const expense = rows.filter((r) => r.type === 'expense').map((r) => ({ ...r, amount: r.balance }));
  const revenue = income.filter((r) => ['sales', 'contra'].includes(r.subtype)).reduce((a, r) => a + r.amount, 0);
  const otherIncome = income.filter((r) => r.subtype === 'other_income').reduce((a, r) => a + r.amount, 0);
  const cogs = expense.filter((r) => r.subtype === 'cogs').reduce((a, r) => a + r.amount, 0);
  const opex = expense.filter((r) => r.subtype !== 'cogs').reduce((a, r) => a + r.amount, 0);
  const grossProfit = revenue - cogs;
  return {
    from, to, income, expense, revenue, otherIncome, cogs, grossProfit, operatingExpenses: opex,
    netProfit: grossProfit + otherIncome - opex,
    grossMarginPct: revenue ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
    definitions: {
      revenue: 'Sales after discounts and returns, excluding VAT',
      grossProfit: 'Revenue minus the cost of the goods sold (including stock write-offs)',
      netProfit: 'Gross profit plus other income minus all operating expenses (salaries, rent, utilities, marketing …)',
    },
  };
}

export async function balanceSheet(q, { asOf }) {
  const rows = await balances(q, { to: asOf });
  const assets = rows.filter((r) => r.type === 'asset' && r.balance).map((r) => ({ ...r, amount: r.balance }));
  const liabilities = rows.filter((r) => r.type === 'liability' && r.balance).map((r) => ({ ...r, amount: -r.balance }));
  const equity = rows.filter((r) => r.type === 'equity' && r.balance).map((r) => ({ ...r, amount: -r.balance }));
  const earnings = -sumBy(rows, (r) => ['income', 'expense'].includes(r.type));
  const totalAssets = assets.reduce((a, r) => a + r.amount, 0);
  const totalLiabilities = liabilities.reduce((a, r) => a + r.amount, 0);
  const totalEquity = equity.reduce((a, r) => a + r.amount, 0) + earnings;
  return { asOf, assets, liabilities, equity, currentEarnings: earnings, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
}

export async function trialBalance(q, { asOf }) {
  const rows = (await balances(q, { to: asOf })).filter((r) => r.debit || r.credit);
  const out = rows.map((r) => ({ code: r.code, name: r.name, type: r.type, debit: r.balance > 0 ? r.balance : 0, credit: r.balance < 0 ? -r.balance : 0 }));
  return { asOf, rows: out, totalDebit: out.reduce((a, r) => a + r.debit, 0), totalCredit: out.reduce((a, r) => a + r.credit, 0) };
}

const FLOW_GROUP = { sale: 'operating', payment: 'operating', refund: 'operating', expense: 'operating', supplier_payment: 'operating', cash_movement: 'operating', till_close: 'operating', payroll: 'operating', manual: 'other', opening: 'financing', transfer: 'internal' };

/** Direct-method cash flow: movements on cash, bank and clearing accounts grouped by what caused them. */
export async function cashFlow(q, { from, to }) {
  const all = await q(`SELECT e.source_type, SUM(l.debit) AS inflow, SUM(l.credit) AS outflow FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    JOIN accounts a ON a.id = l.account_id WHERE a.subtype = ANY($1) AND e.date BETWEEN $2 AND $3 GROUP BY e.source_type`, [MONEY_SUBTYPES, from, to]);
  const opening = (await q.one(`SELECT COALESCE(SUM(l.debit - l.credit),0) AS b FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
    WHERE a.subtype = ANY($1) AND e.date < $2`, [MONEY_SUBTYPES, from])).b;
  const lines = all.map((r) => ({ source: r.source_type, group: FLOW_GROUP[r.source_type] || 'other', inflow: r.inflow, outflow: r.outflow, net: r.inflow - r.outflow }));
  const net = lines.reduce((a, r) => a + r.net, 0);
  return { from, to, opening, lines, net, closing: opening + net };
}

export async function generalLedger(q, { accountId, from, to, limit = 500 }) {
  const acct = await q.one('SELECT * FROM accounts WHERE id = $1', [accountId]);
  must(acct, 404, 'Account not found');
  const opening = (await q.one('SELECT COALESCE(SUM(l.debit - l.credit),0) AS b FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = $1 AND e.date < $2', [accountId, from])).b;
  const rows = await q(`SELECT e.date, e.number, e.memo, e.source_type, e.source_id, e.reversal_of, l.debit, l.credit, l.party_type, l.party_id
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = $1 AND e.date BETWEEN $2 AND $3 ORDER BY e.date, e.created_at, l.id LIMIT $4`, [accountId, from, to, limit]);
  let run = opening;
  return { account: acct, opening, rows: rows.map((r) => ({ ...r, balance: (run += r.debit - r.credit) })), closing: run };
}

/** Oman VAT return helper: output VAT on sales vs input VAT on purchases and expenses for the period. */
export async function vatReport(q, { from, to }) {
  const b = await balances(q, { from, to });
  const out = b.find((r) => r.code === '2100');
  const inp = b.find((r) => r.code === '1300');
  const sales = await q.one(`SELECT COALESCE(SUM(net),0) AS net, COALESCE(SUM(vat),0) AS vat FROM sales WHERE status NOT IN ('pending','cancelled') AND created_at::date BETWEEN $1 AND $2`, [from, to]);
  const refunds = await q.one('SELECT COALESCE(SUM(amount - vat),0) AS net, COALESCE(SUM(vat),0) AS vat FROM refunds WHERE created_at::date BETWEEN $1 AND $2', [from, to]);
  const outputVat = out.credit - out.debit;
  const inputVat = inp.debit - inp.credit;
  return {
    from, to, taxableSales: sales.net - refunds.net, outputVat, inputVat, netPayable: outputVat - inputVat,
    note: 'Prepared from the books for review. File the return on the Oman Tax Authority portal after checking it with your tax adviser.',
  };
}

export async function moneyPosition(q) {
  const b = await balances(q, {});
  const pick = (f) => b.filter(f).reduce((a, r) => a + r.balance, 0);
  return {
    cash: pick((r) => r.subtype === 'cash'), bank: pick((r) => r.subtype === 'bank'), clearing: pick((r) => r.subtype === 'clearing'),
    receivable: pick((r) => r.code === '1100'), payable: -pick((r) => r.code === '2000' || r.code === '2150'), vatDue: -pick((r) => r.code === '2100') - pick((r) => r.code === '1300'),
    inventoryBooks: pick((r) => r.code === '1200'),
  };
}
