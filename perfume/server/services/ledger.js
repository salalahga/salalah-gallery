// Double-entry general ledger. Every money event (sale, refund, purchase, payment, expense, stock write-off,
// till variance) posts one balanced journal entry here. Entries are immutable: mistakes are corrected by
// reverse(), which posts the mirror-image entry and links the two.
import { id, nextNumber, fail, today } from '../util.js';

// account id = 'acc_' + code, so code can reference accounts without a lookup.
export const CHART = [
  ['1000', 'Cash on hand', 'asset', 'cash'],
  ['1010', 'Card settlements (clearing)', 'asset', 'clearing'],
  ['1020', 'Bank — main account', 'asset', 'bank'],
  ['1030', 'Digital wallet clearing', 'asset', 'clearing'],
  ['1040', 'Payment gateway clearing', 'asset', 'clearing'],
  ['1100', 'Accounts receivable', 'asset', 'receivable'],
  ['1200', 'Inventory', 'asset', 'inventory'],
  ['1300', 'VAT input (recoverable)', 'asset', 'tax'],
  ['1400', 'Prepaid expenses', 'asset', 'other'],
  ['1500', 'Fixtures & equipment', 'asset', 'fixed'],
  ['2000', 'Accounts payable', 'liability', 'payable'],
  ['2100', 'VAT output payable', 'liability', 'tax'],
  ['2150', 'Accrued landed costs', 'liability', 'payable'],
  ['2200', 'Customer deposits', 'liability', 'other'],
  ['2300', 'Salaries payable', 'liability', 'payable'],
  ['2400', 'Loans', 'liability', 'loan'],
  ['3000', "Owner's capital / opening balances", 'equity', 'capital'],
  ['3100', 'Retained earnings', 'equity', 'retained'],
  ['3200', "Owner's drawings", 'equity', 'drawings'],
  ['4000', 'Sales revenue', 'income', 'sales'],
  ['4100', 'Delivery income', 'income', 'other_income'],
  ['4200', 'Other income', 'income', 'other_income'],
  ['4910', 'Loyalty redemptions (contra revenue)', 'income', 'contra'],
  ['5000', 'Cost of goods sold', 'expense', 'cogs'],
  ['5100', 'Stock shrinkage, damage & loss', 'expense', 'cogs'],
  ['5200', 'Cash over / short', 'expense', 'other'],
  ['6000', 'Salaries & wages', 'expense', 'payroll'],
  ['6050', 'Staff allowances & benefits', 'expense', 'payroll'],
  ['6100', 'Rent', 'expense', 'operating'],
  ['6200', 'Utilities (electricity, water, internet)', 'expense', 'operating'],
  ['6300', 'Marketing & advertising', 'expense', 'operating'],
  ['6400', 'Bank & payment gateway fees', 'expense', 'operating'],
  ['6500', 'Delivery & shipping costs', 'expense', 'operating'],
  ['6600', 'Packaging & supplies', 'expense', 'operating'],
  ['6700', 'Licences, fees & government charges', 'expense', 'operating'],
  ['6800', 'Repairs & maintenance', 'expense', 'operating'],
  ['6900', 'Other operating expenses', 'expense', 'operating'],
];
export const acc = (code) => 'acc_' + code;
export const METHOD_ACCOUNT = { cash: '1000', card: '1010', bank_transfer: '1020', wallet: '1030', payment_link: '1040', credit: '1100', loyalty: '4910' };
// bank, cash and clearing accounts hold the business's money
export const MONEY_SUBTYPES = ['cash', 'bank', 'clearing'];

export async function seedChart(q) {
  for (const [code, name, type, subtype] of CHART) {
    await q(`INSERT INTO accounts (id, code, name, type, subtype, is_system, restricted) VALUES ($1,$2,$3,$4,$5,true,$6) ON CONFLICT (id) DO NOTHING`,
      [acc(code), code, name, type, subtype, ['equity', 'liability'].includes(type) || subtype === 'bank']);
  }
}

/**
 * Post a balanced entry.
 * lines: [{ account: '1000' | 'acc_x', debit?, credit?, partyType?, partyId?, memo? }] — zero lines are dropped.
 */
export async function post(q, { date, memo, sourceType, sourceId, branchId, lines, userId, isTest = false, currency = 'OMR', fxRate = 1, reversalOf = null }) {
  const clean = lines
    .map((l) => ({ ...l, debit: Math.round(l.debit || 0), credit: Math.round(l.credit || 0) }))
    .filter((l) => l.debit || l.credit);
  for (const l of clean) {
    if (l.debit < 0 || l.credit < 0) fail(500, 'Journal line with a negative amount');
    if (l.debit && l.credit) fail(500, 'Journal line with both debit and credit');
  }
  const dr = clean.reduce((a, l) => a + l.debit, 0);
  const cr = clean.reduce((a, l) => a + l.credit, 0);
  if (dr !== cr) fail(500, `Unbalanced journal entry (${dr} ≠ ${cr}) for ${sourceType}`);
  if (dr === 0) return null;
  const entryId = id('je_');
  const number = await nextNumber(q, 'journal', 'JE', 7);
  await q(`INSERT INTO journal_entries (id, number, date, memo, source_type, source_id, branch_id, created_by, is_test, currency, fx_rate, reversal_of)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [entryId, number, date || today(), memo || null, sourceType, sourceId || null, branchId || null, userId || null, isTest, currency, fxRate, reversalOf]);
  for (const l of clean) {
    const accountId = l.account.startsWith('acc_') ? l.account : acc(l.account);
    await q(`INSERT INTO journal_lines (entry_id, account_id, debit, credit, branch_id, party_type, party_id, memo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [entryId, accountId, l.debit, l.credit, l.branchId || branchId || null, l.partyType || null, l.partyId || null, l.memo || null]);
  }
  return entryId;
}

/** Post the mirror image of an entry. An entry can be reversed once. */
export async function reverse(q, entryId, { memo, userId, date } = {}) {
  const e = await q.one('SELECT * FROM journal_entries WHERE id = $1', [entryId]);
  if (!e) fail(404, 'Journal entry not found');
  if (e.reversed_by) fail(409, 'This entry was already reversed');
  if (e.reversal_of) fail(409, 'A reversal cannot itself be reversed; post a new entry instead');
  const lines = await q('SELECT * FROM journal_lines WHERE entry_id = $1', [entryId]);
  const rid = await post(q, {
    date: date || today(), memo: memo || `Reversal of ${e.number}`, sourceType: e.source_type, sourceId: e.source_id, branchId: e.branch_id,
    userId, isTest: e.is_test, reversalOf: e.id,
    lines: lines.map((l) => ({ account: l.account_id, debit: l.credit, credit: l.debit, branchId: l.branch_id, partyType: l.party_type, partyId: l.party_id, memo: l.memo })),
  });
  await q('UPDATE journal_entries SET reversed_by = $1 WHERE id = $2', [rid, entryId]);
  return rid;
}

/** Signed balance (debit − credit) of accounts, optionally for a date range and branch. */
export async function balances(q, { from, to, branchId, includeTest = true } = {}) {
  const where = ['1=1']; const p = [];
  if (from) { p.push(from); where.push(`e.date >= $${p.length}`); }
  if (to) { p.push(to); where.push(`e.date <= $${p.length}`); }
  if (branchId) { p.push(branchId); where.push(`l.branch_id = $${p.length}`); }
  if (!includeTest) where.push('e.is_test = false');
  return q(`SELECT a.id, a.code, a.name, a.type, a.subtype, a.restricted, COALESCE(s.debit,0) AS debit, COALESCE(s.credit,0) AS credit
    FROM accounts a LEFT JOIN (SELECT l.account_id, SUM(l.debit) AS debit, SUM(l.credit) AS credit FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id WHERE ${where.join(' AND ')} GROUP BY l.account_id) s ON s.account_id = a.id
    ORDER BY a.code`, p)
    .then((rows) => rows.map((r) => ({ ...r, balance: r.debit - r.credit })));
}

export async function partyBalance(q, account, partyType, partyId) {
  const r = await q.one(`SELECT COALESCE(SUM(debit - credit),0) AS b FROM journal_lines WHERE account_id = $1 AND party_type = $2 AND party_id = $3`, [acc(account), partyType, partyId]);
  return r.b;
}
