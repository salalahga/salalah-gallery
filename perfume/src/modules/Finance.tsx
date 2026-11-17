import { useState } from 'react';
import { api, qs } from '../core/api';
import { t } from '../core/i18n';
import { money, parseMoney, useSession, date, monthStart, today } from '../core/session';
import { Card, Empty, Field, Loading, Modal, PageHead, Stat, Status, Tabs, TestBadge, useAction, useData, download } from '../components/ui';

type Tab = 'pl' | 'bs' | 'cf' | 'expenses' | 'tb' | 'gl' | 'journal' | 'vat' | 'tills';

export default function Finance() {
  const [tab, setTab] = useState<Tab>('pl');
  const [r, setR] = useState({ from: monthStart(), to: today() });
  const range = <div className="row no-print"><input type="date" value={r.from} onChange={(e) => setR({ ...r, from: e.target.value })} style={{ width: 'auto' }} /><span>→</span><input type="date" value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} style={{ width: 'auto' }} /><button className="btn" onClick={() => window.print()}>Print / PDF</button></div>;
  return (
    <>
      <PageHead title={t('Finance')} sub="Double-entry books in OMR. Every sale, refund, purchase, payment and expense posts automatically." actions={range} />
      <Tabs tabs={[['pl', 'Profit & loss'], ['bs', 'Balance sheet'], ['cf', 'Cash flow'], ['expenses', t('Expenses')], ['tb', 'Trial balance'], ['gl', 'General ledger'], ['journal', 'Journal'], ['vat', 'VAT'], ['tills', 'Till closings']]} value={tab} onChange={setTab} />
      {tab === 'pl' && <PL {...r} />}
      {tab === 'bs' && <BS asOf={r.to} />}
      {tab === 'cf' && <CF {...r} />}
      {tab === 'expenses' && <Expenses {...r} />}
      {tab === 'tb' && <TB asOf={r.to} />}
      {tab === 'gl' && <GL {...r} />}
      {tab === 'journal' && <Journal {...r} />}
      {tab === 'vat' && <Vat {...r} />}
      {tab === 'tills' && <Tills />}
    </>
  );
}

function PL({ from, to }: { from: string; to: string }) {
  const { data: p } = useData<any>('/reports/pl' + qs({ from, to }), [from, to]);
  if (!p) return <Loading />;
  const rows = (list: any[]) => list.map((r) => <tr key={r.id}><td>{r.code} {r.name}</td><td className="num">{money(r.amount)}</td></tr>);
  return (
    <>
      <div className="grid g4">
        <Stat dark label={t('Revenue')} value={money(p.revenue)} sub={p.definitions.revenue} />
        <Stat label={t('Gross profit')} value={money(p.grossProfit)} sub={`${p.grossMarginPct}% · ${p.definitions.grossProfit}`} />
        <Stat label={t('Expenses')} value={money(p.operatingExpenses)} sub="operating expenses" />
        <Stat label={t('Net profit')} value={<span className={p.netProfit < 0 ? 'bad' : 'ok'}>{money(p.netProfit)}</span>} sub={p.definitions.netProfit} />
      </div>
      <Card title={`Profit & loss · ${date(from)} – ${date(to)}`} className="" >
        <table className="t">
          <tbody>
            <tr><td colSpan={2}><b>Income</b></td></tr>{rows(p.income)}
            <tr><td colSpan={2}><b>Cost of goods sold</b></td></tr>{rows(p.expense.filter((e: any) => e.subtype === 'cogs'))}
            <tr><td><b>Gross profit</b></td><td className="num"><b>{money(p.grossProfit)}</b></td></tr>
            <tr><td colSpan={2}><b>Operating expenses</b></td></tr>{rows(p.expense.filter((e: any) => e.subtype !== 'cogs'))}
          </tbody>
          <tfoot><tr><td>Net profit</td><td className="num">{money(p.netProfit)}</td></tr></tfoot>
        </table>
      </Card>
    </>
  );
}

function BS({ asOf }: { asOf: string }) {
  const { data: b } = useData<any>('/reports/balance-sheet' + qs({ asOf }), [asOf]);
  if (!b) return <Loading />;
  const sec = (title: string, list: any[], extra?: [string, number]) => <><tr><td colSpan={2}><b>{title}</b></td></tr>{list.map((r) => <tr key={r.id}><td>{r.code} {r.name}</td><td className="num">{money(r.amount)}</td></tr>)}{extra && <tr><td>{extra[0]}</td><td className="num">{money(extra[1])}</td></tr>}</>;
  return (
    <Card title={`Balance sheet as of ${date(asOf)}`} actions={b.balanced ? <span className="badge ok">Balanced</span> : <span className="badge bad">Not balanced — contact support</span>}>
      <div className="grid g2">
        <table className="t"><tbody>{sec('Assets', b.assets)}</tbody><tfoot><tr><td>Total assets</td><td className="num">{money(b.totalAssets)}</td></tr></tfoot></table>
        <table className="t"><tbody>{sec('Liabilities', b.liabilities)}{sec('Equity', b.equity, ['Profit to date (not yet closed)', b.currentEarnings])}</tbody><tfoot><tr><td>Liabilities + equity</td><td className="num">{money(b.totalLiabilities + b.totalEquity)}</td></tr></tfoot></table>
      </div>
    </Card>
  );
}

const SRC: Record<string, string> = { sale: 'Sales receipts', payment: 'Customer payments', refund: 'Refunds paid', expense: 'Expenses paid', supplier_payment: 'Supplier payments', cash_movement: 'Till pay in / out', till_close: 'Till over / short', opening: 'Opening balances & capital', manual: 'Manual entries' };
function CF({ from, to }: { from: string; to: string }) {
  const { data: c } = useData<any>('/reports/cash-flow' + qs({ from, to }), [from, to]);
  if (!c) return <Loading />;
  return (
    <Card title="Cash flow (cash, bank and card/gateway settlements)">
      <table className="t"><thead><tr><th>Source</th><th className="num">In</th><th className="num">Out</th><th className="num">Net</th></tr></thead>
        <tbody><tr><td>Opening balance</td><td /><td /><td className="num">{money(c.opening)}</td></tr>
          {c.lines.map((l: any) => <tr key={l.source}><td>{SRC[l.source] || l.source} <span className="small muted">{l.group}</span></td><td className="num">{money(l.inflow)}</td><td className="num">{money(l.outflow)}</td><td className="num">{money(l.net)}</td></tr>)}</tbody>
        <tfoot><tr><td>Closing balance</td><td /><td /><td className="num">{money(c.closing)}</td></tr></tfoot></table>
    </Card>
  );
}

function Expenses({ from, to }: { from: string; to: string }) {
  const { can } = useSession();
  const { data, reload } = useData<any[]>('/expenses' + qs({ from, to }), [from, to]);
  const [open, setOpen] = useState(false);
  const { busy, run } = useAction();
  const total = (data || []).filter((e) => e.status === 'posted').reduce((a, e) => a + e.amount, 0);
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}><b className="grow">{money(total)} OMR in this period</b>{can('reports', 'export') && <button className="btn" onClick={() => download('/export/expenses' + qs({ from, to }))}>CSV</button>}{can('finance', 'create') && <button className="btn primary" onClick={() => setOpen(true)}>+ Expense</button>}</div>
      <div className="card tablewrap">{!data ? <Loading /> : !data.length ? <Empty>No expenses in this period</Empty> : (
        <table className="t"><thead><tr><th>Number</th><th>Date</th><th>Category</th><th>Description</th><th>Paid from</th><th className="num">Amount</th><th className="num">VAT</th><th /></tr></thead>
          <tbody>{data.map((e) => <tr key={e.id} style={{ opacity: e.status === 'reversed' ? 0.5 : 1 }}><td>{e.number} <TestBadge on={e.is_test} /></td><td>{date(e.date)}</td><td>{e.category}</td><td>{e.payee} {e.description}</td><td>{e.paid_from_name}</td><td className="num">{money(e.amount)}</td><td className="num">{money(e.vat)}</td>
            <td>{e.status === 'reversed' ? <Status s="reversed" /> : can('finance', 'approve') && <button className="btn ghost sm" disabled={busy} onClick={() => { const r = prompt('Reason for reversing?'); if (r) run(() => api.post(`/expenses/${e.id}/reverse`, { reason: r }), 'Reversed').then(reload); }}>Reverse</button>}</td></tr>)}</tbody></table>
      )}</div>
      {open && <ExpenseForm onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
    </>
  );
}

function ExpenseForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { me } = useSession();
  const { data: accts } = useData<any[]>('/accounts/list');
  const { data: branches } = useData<any[]>('/branches');
  const [f, setF] = useState({ account: '6900', amount: '', vat: '', paidFrom: '1000', date: today(), payee: '', description: '', reference: '', branchId: me.user.branchId || 'br_main' });
  const { busy, run } = useAction();
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  return (
    <Modal title="New expense" onClose={onClose} footer={<button className="btn primary" disabled={busy || !f.amount} onClick={() => run(() => api.post('/expenses', { ...f, amount: parseMoney(f.amount), vat: f.vat ? parseMoney(f.vat) : 0 }), 'Expense recorded').then((r) => r && onDone())}>Save</button>}>
      <div className="grid g2">
        <Field label="Category"><select value={f.account} onChange={(e) => set('account', e.target.value)}>{accts?.filter((a) => a.type === 'expense' && a.subtype !== 'cogs').map((a) => <option key={a.id} value={a.code}>{a.name}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Amount before VAT (OMR)"><input value={f.amount} onChange={(e) => set('amount', e.target.value)} inputMode="decimal" /></Field>
        <Field label="VAT on the bill (OMR)" hint="Only if the bill shows recoverable VAT"><input value={f.vat} onChange={(e) => set('vat', e.target.value)} inputMode="decimal" /></Field>
        <Field label="Paid from"><select value={f.paidFrom} onChange={(e) => set('paidFrom', e.target.value)}><option value="1000">Cash</option><option value="1020">Bank</option><option value="2000">Not paid yet (payable)</option></select></Field>
        <Field label="Branch"><select value={f.branchId} onChange={(e) => set('branchId', e.target.value)}>{branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Paid to"><input value={f.payee} onChange={(e) => set('payee', e.target.value)} /></Field>
        <Field label="Description"><input value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Bill / receipt number"><input value={f.reference} onChange={(e) => set('reference', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function TB({ asOf }: { asOf: string }) {
  const { data: tb } = useData<any>('/reports/trial-balance' + qs({ asOf }), [asOf]);
  if (!tb) return <Loading />;
  return (
    <Card title={`Trial balance as of ${date(asOf)}`} actions={tb.totalDebit === tb.totalCredit ? <span className="badge ok">Debits = credits</span> : <span className="badge bad">Out of balance</span>}>
      <table className="t"><thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
        <tbody>{tb.rows.map((r: any) => <tr key={r.code}><td>{r.code} {r.name}</td><td className="num">{r.debit ? money(r.debit) : ''}</td><td className="num">{r.credit ? money(r.credit) : ''}</td></tr>)}</tbody>
        <tfoot><tr><td>Total</td><td className="num">{money(tb.totalDebit)}</td><td className="num">{money(tb.totalCredit)}</td></tr></tfoot></table>
    </Card>
  );
}

function GL({ from, to }: { from: string; to: string }) {
  const { data: accts } = useData<any[]>('/accounts' + qs({ from, to }), [from, to]);
  const [acc, setAcc] = useState('acc_1000');
  const { data: gl } = useData<any>('/reports/ledger' + qs({ accountId: acc, from, to }), [acc, from, to]);
  const [manual, setManual] = useState(false);
  const { can } = useSession();
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <select value={acc} onChange={(e) => setAcc(e.target.value)} style={{ maxWidth: 420 }}>{accts?.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name} ({money(a.balance)})</option>)}</select>
        <div className="grow" />{can('finance', 'manage') && <button className="btn" onClick={() => setManual(true)}>+ Manual journal entry</button>}
      </div>
      <Card title="Chart of accounts — period movement">
        <div className="tablewrap" style={{ maxHeight: 240, overflowY: 'auto' }}><table className="t"><tbody>{accts?.filter((a) => a.debit || a.credit).map((a) => <tr key={a.id} className="click" onClick={() => setAcc(a.id)}><td>{a.code} {a.name}</td><td className="small muted">{a.type}</td><td className="num">{money(a.debit)}</td><td className="num">{money(a.credit)}</td></tr>)}</tbody></table></div>
      </Card>
      <div style={{ height: 12 }} />
      <Card title={gl ? `${gl.account.code} ${gl.account.name}` : 'Ledger'}>
        {!gl ? <Loading /> : (
          <table className="t"><thead><tr><th>Date</th><th>Entry</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody><tr><td colSpan={5}>Opening balance</td><td className="num">{money(gl.opening)}</td></tr>
              {gl.rows.map((r: any, i: number) => <tr key={i}><td>{date(r.date)}</td><td className="small">{r.number}{r.reversal_of && ' (reversal)'}</td><td className="small">{r.memo}</td><td className="num">{r.debit ? money(r.debit) : ''}</td><td className="num">{r.credit ? money(r.credit) : ''}</td><td className="num">{money(r.balance)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={5}>Closing balance</td><td className="num">{money(gl.closing)}</td></tr></tfoot></table>
        )}
      </Card>
      {manual && accts && <ManualJE accts={accts} onClose={() => setManual(false)} />}
    </>
  );
}

function ManualJE({ accts, onClose }: { accts: any[]; onClose: () => void }) {
  const [f, setF] = useState({ date: today(), memo: '' });
  const [lines, setLines] = useState([{ account: '1020', debit: '', credit: '' }, { account: '1000', debit: '', credit: '' }]);
  const { busy, run } = useAction();
  const dr = lines.reduce((a, l) => a + (parseMoney(l.debit) || 0), 0), cr = lines.reduce((a, l) => a + (parseMoney(l.credit) || 0), 0);
  return (
    <Modal wide title="Manual journal entry" onClose={onClose} footer={<button className="btn primary" disabled={busy || dr !== cr || !dr || !f.memo} onClick={() => run(() => api.post('/journal', { ...f, lines: lines.map((l) => ({ account: l.account, debit: parseMoney(l.debit) || 0, credit: parseMoney(l.credit) || 0 })) }), 'Posted').then((r) => r && onClose())}>Post entry</button>}>
      <div className="alert">Use this for bank transfers between accounts, owner capital or drawings and corrections. Sales, purchases and expenses post themselves.</div>
      <div className="row" style={{ margin: '10px 0' }}><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} style={{ width: 'auto' }} /><input placeholder="Description" value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} style={{ flex: 1 }} /></div>
      <table className="t"><tbody>{lines.map((l, i) => <tr key={i}><td><select value={l.account} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)))}>{accts.map((a) => <option key={a.id} value={a.code}>{a.code} {a.name}</option>)}</select></td><td><input placeholder="Debit" value={l.debit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, debit: e.target.value, credit: '' } : x)))} /></td><td><input placeholder="Credit" value={l.credit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, credit: e.target.value, debit: '' } : x)))} /></td></tr>)}</tbody>
        <tfoot><tr><td><button className="btn sm" onClick={() => setLines([...lines, { account: '6900', debit: '', credit: '' }])}>+ Line</button></td><td className="num">{money(dr)}</td><td className="num">{money(cr)}</td></tr></tfoot></table>
      {dr !== cr && <div className="bad small">Debits and credits must be equal.</div>}
    </Modal>
  );
}

function Journal({ from, to }: { from: string; to: string }) {
  const { can } = useSession();
  const { data, reload } = useData<any[]>('/journal' + qs({ from, to }), [from, to]);
  const { busy, run } = useAction();
  return (
    <div className="card tablewrap">
      <div className="row" style={{ marginBottom: 8 }}><div className="grow muted small">Entries are never deleted. Corrections are reversing entries.</div>{can('reports', 'export') && <button className="btn sm" onClick={() => download('/export/journal' + qs({ from, to }))}>CSV</button>}</div>
      {!data ? <Loading /> : !data.length ? <Empty>No entries</Empty> : (
        <table className="t"><thead><tr><th>Entry</th><th>Date</th><th>Description</th><th>Lines</th><th /></tr></thead>
          <tbody>{data.map((e) => <tr key={e.id}><td>{e.number} <TestBadge on={e.is_test} /><div className="small muted">{e.source_type}</div></td><td>{date(e.date)}</td><td>{e.memo}<div className="small muted">{e.created_by_name}{e.reversed_by && ' · reversed'}</div></td>
            <td className="small">{e.lines?.map((l: any, i: number) => <div key={i}>{l.account}: {l.debit ? 'Dr ' + money(l.debit) : 'Cr ' + money(l.credit)}</div>)}</td>
            <td>{e.source_type === 'manual' && !e.reversed_by && !e.reversal_of && can('finance', 'manage') && <button className="btn ghost sm" disabled={busy} onClick={() => { const r = prompt('Reason for reversing?'); if (r) run(() => api.post(`/journal/${e.id}/reverse`, { reason: r }), 'Reversed').then(reload); }}>Reverse</button>}</td></tr>)}</tbody></table>
      )}
    </div>
  );
}

function Vat({ from, to }: { from: string; to: string }) {
  const { data: v } = useData<any>('/reports/vat' + qs({ from, to }), [from, to]);
  if (!v) return <Loading />;
  return (
    <Card title={`VAT summary · ${date(from)} – ${date(to)}`}>
      <table className="t"><tbody>
        <tr><td>Taxable sales (excl. VAT, net of returns)</td><td className="num">{money(v.taxableSales)}</td></tr>
        <tr><td>Output VAT (on sales)</td><td className="num">{money(v.outputVat)}</td></tr>
        <tr><td>Input VAT (on purchases & expenses)</td><td className="num">{money(v.inputVat)}</td></tr>
      </tbody><tfoot><tr><td>{v.netPayable >= 0 ? 'VAT payable' : 'VAT refundable'}</td><td className="num">{money(Math.abs(v.netPayable))}</td></tr></tfoot></table>
      <div className="alert" style={{ marginTop: 10 }}>{v.note} The VAT rate and registration are set in Settings → Tax.</div>
    </Card>
  );
}

function Tills() {
  const { data } = useData<any[]>('/register-sessions');
  return (
    <div className="card tablewrap">{!data ? <Loading /> : !data.length ? <Empty>No till sessions</Empty> : (
      <table className="t"><thead><tr><th>Till</th><th>Opened</th><th>Closed</th><th className="num">Float</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Over / short</th></tr></thead>
        <tbody>{data.map((s) => <tr key={s.id}><td>{s.register}<div className="small muted">{s.branch}</div></td><td>{date(s.opened_at)} · {s.opened_by_name}</td><td>{s.closed_at ? `${date(s.closed_at)} · ${s.closed_by_name}` : <Status s="open" />}</td><td className="num">{money(s.opening_float)}</td><td className="num">{s.expected_cash != null ? money(s.expected_cash) : ''}</td><td className="num">{s.counted_cash != null ? money(s.counted_cash) : ''}</td><td className={'num ' + (s.variance ? 'bad' : '')}>{s.variance != null ? money(s.variance) : ''}</td></tr>)}</tbody></table>
    )}</div>
  );
}
