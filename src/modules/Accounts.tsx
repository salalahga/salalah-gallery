import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Download, TrendingUp, TrendingDown, Scale, ChevronLeft, ChevronRight } from 'lucide-react';
import { store, useDB, today } from '../core/store';
import { useRoute, go } from '../core/router';
import type { Txn } from '../core/types';
import { money, fmtDate, monthLabel, lastMonths, finance } from '../core/calc';
import { Modal, Field, PageHeader, Badge, Empty, Tabs, SearchBox, Stat, BarChart, toast, confirmDelete } from '../components/ui';
import { useT } from '../core/i18n';

export default function Accounts() {
  const db = useDB(); const s = db.settings; const t = useT(); const { params } = useRoute();
  const [month, setMonth] = useState(today().slice(0, 7)); const [all, setAll] = useState(false);
  const [kind, setKind] = useState<'all' | 'income' | 'expense'>('all'); const [q, setQ] = useState(''); const [proj, setProj] = useState('');
  const [edit, setEdit] = useState<Partial<Txn> | null>(null);
  useEffect(() => { if (params.new) { setEdit({ kind: params.new === 'income' ? 'income' : 'expense', date: today(), method: 'Cash', category: params.new === 'income' ? s.incomeCategories[0] : s.expenseCategories[0] }); go('accounts'); } }, [params.new]); // eslint-disable-line
  const shift = (n: number) => { const d = new Date(month + '-01T00:00:00'); d.setMonth(d.getMonth() + n); setMonth(d.toISOString().slice(0, 7)); setAll(false); };
  const period = all ? undefined : month;
  const list = useMemo(() => db.txns.filter((x) => (!period || x.date.startsWith(period)) && (kind === 'all' || x.kind === kind) && (!proj || (proj === 'none' ? !x.jobId : x.jobId === proj)) && (x.description + x.category + (x.ref || '')).toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date)), [db.txns, period, kind, q, proj]);
  const f = finance(db, period);
  const byCat = (k: 'income' | 'expense') => { const m: Record<string, number> = {}; db.txns.filter((x) => x.kind === k && (!period || x.date.startsWith(period))).forEach((x) => (m[x.category] = (m[x.category] || 0) + x.amount)); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const save = () => { if (!edit?.amount || !edit.description) return toast('Enter amount and description'); store.upsert('txns', edit as Txn); setEdit(null); toast('Saved'); };
  const csv = () => {
    const rows = [['Date', 'Type', 'Category', 'Description', 'Method', 'Ref', 'Amount'], ...list.map((x) => [x.date, x.kind, x.category, x.description, x.method, x.ref || '', x.amount])];
    const blob = new Blob([rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `accounts-${period || 'all'}.csv`; a.click();
  };
  const cats = edit?.kind === 'income' ? s.incomeCategories : s.expenseCategories;

  return (
    <>
      <PageHeader title={t('Accounts')} sub="Every income and expense — payments, salaries and sales post here automatically."
        actions={<>
          <div className="flex"><button className="icon-btn" onClick={() => shift(-1)}><ChevronLeft size={18} /></button><b style={{ minWidth: 90, textAlign: 'center' }}>{all ? 'All time' : monthLabel(month)}</b><button className="icon-btn" onClick={() => shift(1)}><ChevronRight size={18} /></button></div>
          <button className={`chip ${all ? 'on' : ''}`} onClick={() => setAll(!all)}>All time</button>
          <button className="btn" onClick={csv}><Download size={16} />CSV</button>
          <button className="btn" onClick={() => setEdit({ kind: 'income', date: today(), method: 'Cash', category: s.incomeCategories[0] })}><Plus size={16} />{t('Income')}</button>
          <button className="btn primary" onClick={() => setEdit({ kind: 'expense', date: today(), method: 'Cash', category: s.expenseCategories[0] })}><Plus size={16} />{t('Expense')}</button>
        </>} />
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
      <div className="toolbar"><Tabs value={kind} onChange={setKind} tabs={[{ id: 'all', label: 'All' }, { id: 'income', label: t('Income') }, { id: 'expense', label: t('Expense') }]} /><SearchBox value={q} onChange={setQ} /><select style={{ width: 'auto' }} value={proj} onChange={(e) => setProj(e.target.value)}><option value="">All projects</option><option value="none">General / overhead</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></div>
      <div className="card">
        {list.length ? <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Project</th><th>Method</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>{list.map((x) => <tr key={x.id} className="click" onClick={() => setEdit({ ...x })}>
            <td>{fmtDate(x.date)}</td><td><b>{x.description}</b>{x.ref && <div className="muted">{x.ref}</div>}</td><td><Badge tone={x.kind === 'income' ? 'green' : 'gray'}>{x.category}</Badge></td><td>{x.jobId ? <span className="muted">{db.jobs.find((j) => j.id === x.jobId)?.code || '—'}</span> : '—'}</td><td>{x.method}</td>
            <td className={`num ${x.kind === 'income' ? 'pos' : 'neg'}`}><b>{x.kind === 'income' ? '+' : '−'}{money(x.amount, s)}</b></td>
            <td onClick={(e) => e.stopPropagation()}><button className="icon-btn" onClick={() => confirmDelete('this entry') && store.remove('txns', x.id)}><Trash2 size={15} /></button></td></tr>)}</tbody></table></div>
          : <Empty title="No transactions in this period" />}
      </div>
      {edit && <Modal open title={`${edit.id ? 'Edit' : 'New'} ${edit.kind}`} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
        <div className="form two">
          <Field label="Type"><select value={edit.kind} onChange={(e) => { const k = e.target.value as Txn['kind']; setEdit({ ...edit, kind: k, category: (k === 'income' ? s.incomeCategories : s.expenseCategories)[0] }); }}><option value="income">Income</option><option value="expense">Expense</option></select></Field>
          <Field label="Date"><input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></Field>
          <Field label={`Amount (${s.currency})`}><input type="number" autoFocus value={edit.amount || ''} onChange={(e) => setEdit({ ...edit, amount: +e.target.value })} /></Field>
          <Field label="Category"><select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{cats.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Description" span={3}><input value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          <Field label="Method"><select value={edit.method} onChange={(e) => setEdit({ ...edit, method: e.target.value })}>{['Cash', 'Bank', 'Card', 'Cheque', 'Online'].map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Project (optional)"><select value={edit.jobId || ''} onChange={(e) => setEdit({ ...edit, jobId: e.target.value || undefined })}><option value="">— General / overhead —</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>
          <Field label="Reference / bill no."><input value={edit.ref || ''} onChange={(e) => setEdit({ ...edit, ref: e.target.value })} /></Field>
        </div>
      </Modal>}
    </>
  );
}
