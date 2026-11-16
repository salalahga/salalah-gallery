import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Download, TrendingUp, TrendingDown, Scale, ChevronLeft, ChevronRight, ArrowLeftRight, Repeat, Banknote, Landmark, Clock } from 'lucide-react';
import { store, useDB, today } from '../core/store';
import { useRoute, go } from '../core/router';
import type { Txn, Recurring, MoneyAccount } from '../core/types';
import { money, fmtDate, monthLabel, lastMonths, finance, balances, accountOf } from '../core/calc';
import { txnSource } from '../core/ledger';
import { postDueRecurring, dueMonths } from '../core/recurring';
import { Modal, Field, PageHeader, Badge, Empty, Tabs, SearchBox, Stat, BarChart, toast, confirmDelete } from '../components/ui';
import { useT } from '../core/i18n';
import { useCanWrite } from '../core/session';
import { BillThumbs, BillPhotosEdit } from '../components/BillPhotos';

const METHODS = ['Cash', 'Bank', 'Card', 'Cheque', 'Online'];
const ACC: Record<MoneyAccount, string> = { cash: 'Cash box', bank: 'Bank' };

export default function Accounts() {
  const db = useDB(); const s = db.settings; const t = useT(); const { params } = useRoute(); const can = useCanWrite()('txns');
  const [month, setMonth] = useState(today().slice(0, 7)); const [all, setAll] = useState(false);
  const [kind, setKind] = useState<'all' | 'income' | 'expense' | 'transfer'>('all'); const [q, setQ] = useState(''); const [proj, setProj] = useState('');
  const [edit, setEdit] = useState<Partial<Txn> | null>(null);
  const [rec, setRec] = useState(false);
  useEffect(() => { if (params.new) { setEdit({ kind: params.new === 'income' ? 'income' : 'expense', date: today(), method: 'Cash', category: params.new === 'income' ? s.incomeCategories[0] : s.expenseCategories[0] }); go('accounts'); } }, [params.new]); // eslint-disable-line
  // recurring expenses (rent, electricity…) are posted as soon as they fall due
  useEffect(() => { if (can) { const n = postDueRecurring(); if (n) toast(`${n} recurring expense${n > 1 ? 's' : ''} posted`); } }, []); // eslint-disable-line
  const shift = (n: number) => { const d = new Date(month + '-01T00:00:00'); d.setMonth(d.getMonth() + n); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); setAll(false); };
  const period = all ? undefined : month;
  const list = useMemo(() => db.txns.filter((x) => (!period || x.date.startsWith(period)) && (kind === 'all' || x.kind === kind) && (!proj || (proj === 'none' ? !x.jobId : x.jobId === proj)) && (x.description + x.category + (x.ref || '')).toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date)), [db.txns, period, kind, q, proj]);
  const f = finance(db, period);
  const bal = balances(db);
  const byCat = (k: 'income' | 'expense') => { const m: Record<string, number> = {}; db.txns.filter((x) => x.kind === k && (!period || x.date.startsWith(period))).forEach((x) => (m[x.category] = (m[x.category] || 0) + x.amount)); return Object.entries(m).sort((a, b) => b[1] - a[1]); };

  const save = () => {
    if (!edit) return;
    if (!(Number(edit.amount) > 0)) return toast('Enter an amount more than zero');
    if (edit.kind === 'transfer') {
      if ((edit.account || 'cash') === (edit.toAccount || 'bank')) return toast('Choose two different accounts');
      store.upsert('txns', { ...edit, category: 'Transfer', method: 'Transfer', description: edit.description || `${ACC[edit.account || 'cash']} → ${ACC[edit.toAccount || 'bank']}` } as Txn);
      setEdit(null); return toast('Transfer saved');
    }
    if (!edit.description?.trim()) return toast('Enter a description');
    const before = edit.id ? db.txns.find((x) => x.id === edit.id) : undefined;
    const src = before && txnSource(before);
    if (src && (before!.amount !== edit.amount || before!.kind !== edit.kind)) return toast(src);
    store.upsert('txns', edit as Txn); setEdit(null); toast('Saved');
  };
  const remove = (x: Txn) => { const src = txnSource(x); if (src) return toast(src); if (confirmDelete('this entry')) store.remove('txns', x.id); };
  const csv = () => {
    const rows = [['Date', 'Type', 'Category', 'Description', 'Method', 'Account', 'Project', 'Ref', 'Amount'], ...list.map((x) => [x.date, x.kind, x.category, x.description, x.method, x.kind === 'transfer' ? `${x.account}→${x.toAccount}` : accountOf(x), db.jobs.find((j) => j.id === x.jobId)?.code || '', x.ref || '', x.amount])];
    const blob = new Blob(['﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `accounts-${period || 'all'}.csv`; a.click();
  };
  const cats = edit?.kind === 'income' ? s.incomeCategories : s.expenseCategories;
  const catOptions = edit?.category && !cats.includes(edit.category) ? [edit.category, ...cats] : cats;

  return (
    <>
      <PageHeader title={t('Accounts')} sub="Every income and expense — payments, salaries and sales post here automatically."
        actions={<>
          <div className="flex"><button className="icon-btn" onClick={() => shift(-1)}><ChevronLeft size={18} /></button><b style={{ minWidth: 90, textAlign: 'center' }}>{all ? 'All time' : monthLabel(month)}</b><button className="icon-btn" onClick={() => shift(1)}><ChevronRight size={18} /></button></div>
          <button className={`chip ${all ? 'on' : ''}`} onClick={() => setAll(!all)}>All time</button>
          <button className="btn" onClick={csv}><Download size={16} />CSV</button>
          {can && <button className="btn" onClick={() => setRec(true)}><Repeat size={16} />Recurring</button>}
          {can && <button className="btn" onClick={() => setEdit({ kind: 'transfer', date: today(), account: 'cash', toAccount: 'bank' })}><ArrowLeftRight size={16} />Transfer</button>}
          {can && <button className="btn" onClick={() => setEdit({ kind: 'income', date: today(), method: 'Cash', category: s.incomeCategories[0] })}><Plus size={16} />{t('Income')}</button>}
          {can && <button className="btn primary" onClick={() => setEdit({ kind: 'expense', date: today(), method: 'Cash', category: s.expenseCategories[0] })}><Plus size={16} />{t('Expense')}</button>}
        </>} />
      <div className="grid g3 mb">
        <Stat label="Cash in hand" value={<span className={bal.cash < 0 ? 'neg' : ''}>{money(bal.cash, s)}</span>} icon={<Banknote size={20} />} tone="green" sub={s.openingDate ? `since ${fmtDate(s.openingDate)}` : 'set opening balance in Settings'} />
        <Stat label="Bank balance" value={<span className={bal.bank < 0 ? 'neg' : ''}>{money(bal.bank, s)}</span>} icon={<Landmark size={20} />} tone="blue" sub={`Total ${money(bal.total, s)}`} />
        <Stat label="Cheques not yet cleared" value={money(bal.pendingIn, s)} icon={<Clock size={20} />} tone="wood" sub={<a className="link" href="#/documents?tab=cheques">{bal.pendingOut ? `we issued ${money(bal.pendingOut, s)} · ` : ''}view cheques</a>} />
      </div>
      <div className="grid g3 mb">
        <Stat label={t('Income')} value={money(f.income, s)} icon={<TrendingUp size={20} />} tone="green" />
        <Stat label={t('Expense')} value={money(f.expense, s)} icon={<TrendingDown size={20} />} tone="red" />
        <Stat label={`Net ${t('Profit')}`} value={<span className={f.profit >= 0 ? 'pos' : 'neg'}>{money(f.profit, s)}</span>} icon={<Scale size={20} />} tone="wood" sub={f.income ? `Margin ${Math.round((f.profit / f.income) * 100)}%` : undefined} />
      </div>
      <div className="grid g-main mb">
        <div className="card"><h3>12-month trend</h3><BarChart data={lastMonths(12).map((m) => { const x = finance(db, m); return { label: monthLabel(m).slice(0, 3), a: x.income, b: x.expense }; })} /></div>
        <div className="card"><h3>Profit & loss</h3>
          <div className="muted" style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: '.08em' }}>Income</div>
          <ul className="list">{byCat('income').map(([c, v]) => <li key={c}><span className="grow">{c}</span><b>{money(v, s)}</b></li>)}</ul>
          <div className="muted" style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: '.08em', marginTop: 10 }}>Expenses</div>
          <ul className="list">{byCat('expense').map(([c, v]) => <li key={c}><span className="grow">{c}</span><b className="neg">{money(v, s)}</b></li>)}</ul>
          <div className="totals" style={{ width: '100%' }}><div className="grand"><span>Net</span><span>{money(f.profit, s)}</span></div></div>
        </div>
      </div>
      <div className="toolbar"><Tabs value={kind} onChange={setKind} tabs={[{ id: 'all', label: 'All' }, { id: 'income', label: t('Income') }, { id: 'expense', label: t('Expense') }, { id: 'transfer', label: 'Transfers' }]} /><SearchBox value={q} onChange={setQ} /><select style={{ width: 'auto' }} value={proj} onChange={(e) => setProj(e.target.value)}><option value="">All projects</option><option value="none">General / overhead</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></div>
      <div className="card">
        {list.length ? <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Project</th><th>Paid by</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>{list.map((x) => <tr key={x.id} className={can ? 'click' : ''} onClick={() => can && setEdit({ ...x })}>
            <td>{fmtDate(x.date)}</td><td><b>{x.description}</b><BillThumbs photos={x.photos} />{x.ref && <div className="muted">{x.ref}</div>}</td>
            <td><Badge tone={x.kind === 'income' ? 'green' : x.kind === 'transfer' ? 'blue' : 'gray'}>{x.category}</Badge></td>
            <td>{x.jobId ? <span className="muted">{db.jobs.find((j) => j.id === x.jobId)?.code || '—'}</span> : '—'}</td>
            <td>{x.kind === 'transfer' ? `${ACC[x.account || 'cash']} → ${ACC[x.toAccount || 'bank']}` : <>{x.method}<div className="muted">{ACC[accountOf(x)]}</div></>}</td>
            <td className={`num ${x.kind === 'income' ? 'pos' : x.kind === 'expense' ? 'neg' : ''}`}><b>{x.kind === 'income' ? '+' : x.kind === 'expense' ? '−' : ''}{money(x.amount, s)}</b></td>
            <td onClick={(e) => e.stopPropagation()}>{can && <button className="icon-btn" title="Delete" onClick={() => remove(x)}><Trash2 size={15} /></button>}</td></tr>)}</tbody></table></div>
          : <Empty title="No transactions in this period" />}
      </div>
      {edit && <Modal open title={edit.kind === 'transfer' ? 'Move money between cash and bank' : `${edit.id ? 'Edit' : 'New'} ${edit.kind}`} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
        {edit.kind === 'transfer' ? <div className="form two">
          <Field label="From"><select value={edit.account || 'cash'} onChange={(e) => setEdit({ ...edit, account: e.target.value as MoneyAccount })}><option value="cash">Cash box</option><option value="bank">Bank</option></select></Field>
          <Field label="To"><select value={edit.toAccount || 'bank'} onChange={(e) => setEdit({ ...edit, toAccount: e.target.value as MoneyAccount })}><option value="bank">Bank</option><option value="cash">Cash box</option></select></Field>
          <Field label={`Amount (${s.currency})`}><input type="number" autoFocus value={edit.amount || ''} onChange={(e) => setEdit({ ...edit, amount: +e.target.value })} /></Field>
          <Field label="Date"><input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></Field>
          <Field label="Note" span={2}><input value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="e.g. Cash deposited at Bank Muscat" /></Field>
          <p className="span-3 muted">A transfer moves money between your cash box and bank. It is not income or expense.</p>
        </div> : <div className="form two">
          <Field label="Type"><select value={edit.kind} onChange={(e) => { const k = e.target.value as Txn['kind']; setEdit({ ...edit, kind: k, category: (k === 'income' ? s.incomeCategories : s.expenseCategories)[0] }); }}><option value="income">Income</option><option value="expense">Expense</option></select></Field>
          <Field label="Date"><input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></Field>
          <Field label={`Amount (${s.currency})`}><input type="number" min={0} autoFocus value={edit.amount || ''} onChange={(e) => setEdit({ ...edit, amount: +e.target.value })} /></Field>
          <Field label="Category"><select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{catOptions.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Description" span={3}><input value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          <Field label="Method"><select value={edit.method} onChange={(e) => setEdit({ ...edit, method: e.target.value, account: undefined })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Cash box or bank"><select value={accountOf(edit as Txn)} onChange={(e) => setEdit({ ...edit, account: e.target.value as MoneyAccount })}><option value="cash">Cash box</option><option value="bank">Bank</option></select></Field>
          <Field label="Project (optional)"><select value={edit.jobId || ''} onChange={(e) => setEdit({ ...edit, jobId: e.target.value || undefined })}><option value="">— General / overhead —</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>
          <Field label="Reference / bill no."><input value={edit.ref || ''} onChange={(e) => setEdit({ ...edit, ref: e.target.value })} /></Field>
          <Field label="Bill / receipt pictures" span={3}><BillPhotosEdit photos={edit.photos} onChange={(photos) => setEdit((e) => (e ? { ...e, photos } : e))} onRead={(b) => setEdit((e) => {
            if (!e) return e;
            const n = { ...e };
            if (!(Number(n.amount) > 0) && b.amount) n.amount = b.amount;
            if (b.date) n.date = b.date;
            if (!n.description && (b.vendor || b.billNo)) n.description = `${b.vendor || 'Bill'}${b.billNo ? ` — bill ${b.billNo}` : ''}`;
            if (!n.ref && b.billNo) n.ref = b.billNo;
            toast(b.amount ? `Read from the bill: ${money(b.amount, s)}${b.date ? ' · ' + fmtDate(b.date) : ''} — check and save` : 'Could not find the total on the bill');
            return n;
          })} /></Field>
        </div>}
      </Modal>}
      {rec && <RecurringModal onClose={() => setRec(false)} />}
    </>
  );
}

function RecurringModal({ onClose }: { onClose: () => void }) {
  const db = useDB(); const s = db.settings;
  const [edit, setEdit] = useState<Partial<Recurring> | null>(null);
  const save = () => {
    if (!edit?.description?.trim() || !(Number(edit.amount) > 0)) return toast('Enter a description and an amount');
    const day = Math.min(28, Math.max(1, Number(edit.day) || 1));
    store.upsert('recurring', { ...edit, day, active: edit.active !== false } as Recurring);
    setEdit(null); const n = postDueRecurring(); toast(n ? `Saved · ${n} due month${n > 1 ? 's' : ''} posted` : 'Saved — it will post automatically every month');
  };
  return (
    <Modal open wide title="Recurring expenses" onClose={onClose} footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Close</button>{!edit && <button className="btn primary" onClick={() => setEdit({ day: 1, method: 'Bank', category: s.expenseCategories.includes('Rent') ? 'Rent' : s.expenseCategories[0], startMonth: today().slice(0, 7), active: true })}><Plus size={15} />Add recurring expense</button>}</>}>
      <p className="muted" style={{ marginTop: 0 }}>Rent, electricity, internet, loan instalments… are added to Accounts automatically on their day each month.</p>
      {edit ? <div className="form two">
        <Field label="Description" span={2}><input autoFocus value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="e.g. Workshop rent" /></Field>
        <Field label={`Amount (${s.currency})`}><input type="number" value={edit.amount || ''} onChange={(e) => setEdit({ ...edit, amount: +e.target.value })} /></Field>
        <Field label="Category"><select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{s.expenseCategories.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Paid by"><select value={edit.method} onChange={(e) => setEdit({ ...edit, method: e.target.value })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Day of month (1–28)"><input type="number" min={1} max={28} value={edit.day || 1} onChange={(e) => setEdit({ ...edit, day: +e.target.value })} /></Field>
        <Field label="Start from month"><input type="month" value={edit.startMonth || ''} disabled={!!edit.lastMonth} onChange={(e) => setEdit({ ...edit, startMonth: e.target.value })} /></Field>
        <Field label="Project (optional)"><select value={edit.jobId || ''} onChange={(e) => setEdit({ ...edit, jobId: e.target.value || undefined })}><option value="">— General / overhead —</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>
        <Field label="Active"><select value={edit.active === false ? '0' : '1'} onChange={(e) => setEdit({ ...edit, active: e.target.value === '1' })}><option value="1">Yes</option><option value="0">Paused</option></select></Field>
        <div className="span-3 flex"><button className="btn" onClick={() => setEdit(null)}>Back</button><button className="btn primary" onClick={save}>Save</button>
          {edit.id && <button className="btn danger ghost" onClick={() => { if (confirmDelete(edit.description)) { store.remove('recurring', edit.id!); setEdit(null); } }}><Trash2 size={15} />Delete rule</button>}</div>
      </div> : db.recurring.length ? <div className="table-wrap"><table>
        <thead><tr><th>Expense</th><th>Category</th><th>Day</th><th>Last posted</th><th className="num">Amount</th><th /></tr></thead>
        <tbody>{db.recurring.map((r) => <tr key={r.id} className="click" onClick={() => setEdit({ ...r })}>
          <td><b>{r.description}</b><div className="muted">{r.method}{r.active === false ? ' · paused' : ''}</div></td><td>{r.category}</td><td>{r.day}</td>
          <td>{r.lastMonth ? monthLabel(r.lastMonth) : '—'}{dueMonths(r).length > 0 && <div><Badge tone="amber">{dueMonths(r).length} due</Badge></div>}</td>
          <td className="num"><b>{money(r.amount, s)}</b></td><td /></tr>)}</tbody></table></div> : <Empty title="No recurring expenses yet" />}
    </Modal>
  );
}
