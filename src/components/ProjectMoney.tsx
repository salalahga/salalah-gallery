import { useState } from 'react';
import { Plus, Trash2, HandCoins, TrendingUp, TrendingDown, Scale, Wallet, Printer } from 'lucide-react';
import { store, useDB, today, uid } from '../core/store';
import { go } from '../core/router';
import type { Job, Txn } from '../core/types';
import { money, fmtDate, projectFinance, invoiceBalance } from '../core/calc';
import { Badge, Stat, Progress, Empty, Modal, toast, confirmDelete } from './ui';

const EXTRA_CATS = ['Labour', 'Subcontractor', 'Transport', 'Materials', 'Boards & Sheets', 'Hardware', 'Paint & Polish', 'Installation', 'Other'];

/**
 * Project accounts for one job: contract value + additional work, money collected, every expense,
 * and the resulting profit. Expenses and additional work are saved immediately.
 */
export function ProjectMoney({ job, setJob }: { job: Job; setJob: (j: Job) => void }) {
  const db = useDB(); const s = db.settings;
  const f = projectFinance(db, job);
  const cats = [...new Set([...s.expenseCategories.filter((c) => c !== 'Salary'), ...EXTRA_CATS])];
  const [exp, setExp] = useState({ date: today(), category: cats[0], description: '', amount: '', method: 'Cash' });
  const [extra, setExtra] = useState({ date: today(), description: '', amount: '' });
  const [stmt, setStmt] = useState(false);
  const txns = db.txns.filter((t) => t.jobId === job.id).sort((a, b) => b.date.localeCompare(a.date));
  const income = txns.filter((t) => t.kind === 'income');
  const expenses = txns.filter((t) => t.kind === 'expense');
  const persist = (j: Job) => { store.upsert('jobs', j); setJob(j); };

  const addExpense = () => {
    const amount = Number(exp.amount);
    if (!(amount > 0) || !exp.description.trim()) return toast('Enter what the expense was and the amount');
    store.upsert('txns', { date: exp.date, kind: 'expense', category: exp.category, amount, method: exp.method, description: exp.description.trim(), jobId: job.id, ref: job.code } as Txn);
    setExp({ ...exp, description: '', amount: '' }); toast(`Expense added to ${job.code}`);
  };
  const addExtra = () => {
    const amount = Number(extra.amount);
    if (!(amount > 0) || !extra.description.trim()) return toast('Describe the additional work and its amount');
    persist({ ...job, extras: [...(job.extras || []), { id: uid(), date: extra.date, description: extra.description.trim(), amount }] });
    setExtra({ ...extra, description: '', amount: '' }); toast('Additional work added — project value updated');
  };
  const pct = f.contract ? Math.min(100, (f.collected / f.contract) * 100) : 0;

  return (
    <div className="project-money">
      <div className="grid g4 mb">
        <Stat label="Project value" value={money(f.contract, s)} icon={<Wallet size={20} />} tone="wood" sub={f.extras ? `${money(f.base, s)} + ${money(f.extras, s)} additional` : 'contract amount'} />
        <Stat label="Collected" value={money(f.collected, s)} icon={<TrendingUp size={20} />} tone="green" sub={`To collect: ${money(f.toCollect, s)}`} />
        <Stat label="Expenses" value={money(f.expenses, s)} icon={<TrendingDown size={20} />} tone="red" sub={f.materials ? `incl. ${money(f.materials, s)} stock materials` : `${expenses.length} entries`} />
        <Stat label="Profit" value={<span className={f.profit >= 0 ? 'pos' : 'neg'}>{money(f.profit, s)}</span>} icon={<Scale size={20} />} tone="blue" sub={f.contract ? `${Math.round(f.margin * 100)}% margin · cash in hand ${money(f.cash, s)}` : '—'} />
      </div>
      <div className="flex between wrap" style={{ marginBottom: 6 }}><span className="muted">Collected {Math.round(pct)}% of project value</span>
        <span className="flex"><button type="button" className="btn sm" onClick={() => { const open = db.invoices.find((i) => i.jobId === job.id && invoiceBalance(i) > 0.0005); go('documents', open ? { receipt: 'new', invoice: open.id } : { receipt: 'new', job: job.id }); }}><HandCoins size={14} />Receive payment</button>
          <button type="button" className="btn sm" onClick={() => setStmt(true)}><Printer size={14} />Project statement</button></span></div>
      <Progress value={pct} color="var(--green)" />

      <div className="grid g2" style={{ marginTop: 18 }}>
        <div className="card flat">
          <h3>Additional work <span className="muted" style={{ fontWeight: 400 }}>{money(f.extras, s)}</span></h3>
          <ul className="list">{(job.extras || []).map((e) => <li key={e.id}><div className="grow"><div className="title">{e.description}</div><div className="muted">{fmtDate(e.date)}{e.invoiced && ' · invoiced'}</div></div><b>{money(e.amount, s)}</b>
            {!e.invoiced && <button type="button" className="icon-btn" onClick={() => confirmDelete('this additional work') && persist({ ...job, extras: job.extras!.filter((x) => x.id !== e.id) })}><Trash2 size={14} /></button>}</li>)}
            {!(job.extras || []).length && <li className="muted">Original contract only — {money(f.base, s)}</li>}</ul>
          <div className="add-row">
            <input placeholder="e.g. Extra shelf unit, TV panel…" value={extra.description} onChange={(e) => setExtra({ ...extra, description: e.target.value })} />
            <input type="number" inputMode="decimal" placeholder={s.currency} value={extra.amount} onChange={(e) => setExtra({ ...extra, amount: e.target.value })} />
            <button type="button" className="btn sm primary" onClick={addExtra}><Plus size={14} />Add work</button>
          </div>
        </div>

        <div className="card flat">
          <h3>Money received <span className="muted" style={{ fontWeight: 400 }}>{money(f.collected, s)}</span></h3>
          <ul className="list">{income.map((t) => <li key={t.id}><div className="grow"><div className="title">{t.description}</div><div className="muted">{fmtDate(t.date)} · {t.method}{t.ref ? ` · ${t.ref}` : ''}</div></div><b className="pos">{money(t.amount, s)}</b></li>)}
            {!income.length && <Empty title="Nothing received yet" hint="Use Receive payment for advances and payments." />}</ul>
          {f.invoiced > 0 && <p className="muted" style={{ margin: '8px 0 0' }}>Invoiced so far: {money(f.invoiced, s)}</p>}
        </div>
      </div>

      <div className="card flat" style={{ marginTop: 16 }}>
        <h3>Project expenses <span className="muted" style={{ fontWeight: 400 }}>{money(f.expenses, s)}</span></h3>
        <div className="add-row expense-row">
          <input type="date" value={exp.date} onChange={(e) => setExp({ ...exp, date: e.target.value })} />
          <select value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
          <input placeholder="What was it? (e.g. 6 sheets MDF, helper 2 days)" value={exp.description} onChange={(e) => setExp({ ...exp, description: e.target.value })} />
          <input type="number" inputMode="decimal" placeholder={s.currency} value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} />
          <select value={exp.method} onChange={(e) => setExp({ ...exp, method: e.target.value })}>{['Cash', 'Bank', 'Card', 'Cheque'].map((m) => <option key={m}>{m}</option>)}</select>
          <button type="button" className="btn sm primary" onClick={addExpense}><Plus size={14} />Add expense</button>
        </div>
        {(expenses.length > 0 || f.materials > 0) ? <div className="table-wrap" style={{ margin: '10px 0 0' }}><table>
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Paid by</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>
            {expenses.map((t) => <tr key={t.id}><td>{fmtDate(t.date)}</td><td><Badge>{t.category}</Badge></td><td>{t.description}</td><td>{t.method}</td><td className="num neg">{money(t.amount, s)}</td>
              <td><button type="button" className="icon-btn" onClick={() => confirmDelete('this expense') && store.remove('txns', t.id)}><Trash2 size={14} /></button></td></tr>)}
            {f.materials > 0 && <tr><td>—</td><td><Badge>Materials from stock</Badge></td><td>{job.materials.filter((m) => m.issued).map((m) => `${m.issued} × ${db.items.find((i) => i.id === m.itemId)?.name || 'item'}`).join(', ')}</td><td>Stock</td><td className="num neg">{money(f.materials, s)}</td><td /></tr>}
          </tbody></table></div> : <p className="muted">No expenses yet. Every expense you add here also appears in Accounts.</p>}
        {Object.keys(f.byCategory).length > 1 && <div className="chips" style={{ marginTop: 10 }}>{Object.entries(f.byCategory).sort((a, b) => b[1] - a[1]).map(([c, v]) => <Badge key={c}>{c}: {money(v, s)}</Badge>)}</div>}
      </div>

      {stmt && <Modal open wide title={`Project statement — ${job.code}`} onClose={() => setStmt(false)} footer={<><button className="btn" onClick={() => setStmt(false)}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print</button></>}>
        <div className="print-area"><div className="doc">
          <div className="doc-head"><div><h2>{s.businessName}</h2><div>Project statement</div></div><div className="right"><b>{job.code}</b><div>{job.title}</div><div>{fmtDate(today())}</div></div></div>
          <table style={{ width: '100%' }}><tbody>
            <tr><td>Original contract</td><td className="num">{money(f.base, s)}</td></tr>
            {(job.extras || []).map((e) => <tr key={e.id}><td>+ {e.description} ({fmtDate(e.date)})</td><td className="num">{money(e.amount, s)}</td></tr>)}
            <tr><td><b>Project value</b></td><td className="num"><b>{money(f.contract, s)}</b></td></tr>
            <tr><td>Collected</td><td className="num">{money(f.collected, s)}</td></tr>
            <tr><td><b>Balance to collect</b></td><td className="num"><b>{money(f.toCollect, s)}</b></td></tr>
          </tbody></table>
          <h3 style={{ marginTop: 18 }}>Expenses</h3>
          <table style={{ width: '100%' }}><tbody>{Object.entries(f.byCategory).map(([c, v]) => <tr key={c}><td>{c}</td><td className="num">{money(v, s)}</td></tr>)}
            <tr><td><b>Total expenses</b></td><td className="num"><b>{money(f.expenses, s)}</b></td></tr></tbody></table>
          <div className="totals" style={{ marginTop: 14 }}><div className="grand"><span>Profit</span><span>{money(f.profit, s)}</span></div><div><span>Margin</span><span>{Math.round(f.margin * 100)}%</span></div></div>
        </div></div>
      </Modal>}
    </div>
  );
}
