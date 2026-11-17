import { Hammer, Wallet, AlertTriangle, TrendingUp, FileText, ShoppingCart, Plus, Receipt } from 'lucide-react';
import { useDB } from '../core/store';
import { useT } from '../core/i18n';
import { docTotals, finance, invoiceBalance, lastMonths, money, monthLabel, balances, fmtDate } from '../core/calc';
import { daysFrom } from '../core/helpers';
import { Landmark, Wrench } from 'lucide-react';
import { projectTrack } from '../core/stages';
import { StageDots } from '../components/ProjectStages';
import { statusMeta, lookup, dueLabel, priorityTone, expiringDocs, expiryLabel } from '../core/helpers';
import { IdCard } from 'lucide-react';
import { go } from '../core/router';
import { Stat, BarChart, Donut, Badge, Avatar, Progress, Empty } from '../components/ui';

export default function Dashboard() {
  const db = useDB(); const t = useT(); const s = db.settings; const L = lookup(db);
  const month = new Date().toISOString().slice(0, 7);
  const f = finance(db, month);
  const active = db.jobs.filter((j) => !['completed', 'cancelled'].includes(j.status));
  const receivable = db.invoices.reduce((n, i) => n + Math.max(0, invoiceBalance(i)), 0);
  const low = db.items.filter((i) => i.qty <= i.reorder);
  const docs = expiringDocs(db);
  const pipeline = db.quotations.filter((q) => q.status === 'sent').reduce((n, q) => n + docTotals(q).total, 0);
  const chart = lastMonths(6).map((m) => { const x = finance(db, m); return { label: monthLabel(m).split(' ')[0], a: x.income, b: x.expense }; });
  const byType = s.workTypes.map((w) => ({ label: w.name, color: w.color, value: active.filter((j) => j.workTypeId === w.id).length })).filter((p) => p.value);
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const bal = balances(db);
  const chequesSoon = db.cheques.filter((c) => ['pending', 'deposited'].includes(c.status) && (daysFrom(c.date) ?? 99) <= 7).sort((a, b) => a.date.localeCompare(b.date));
  const services = db.services.filter((x) => ['open', 'scheduled'].includes(x.status));
  const openTasks = db.tasks.filter((x) => x.status !== 'done').sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9')).slice(0, 6);

  return (
    <>
      <div className="hero">
        <div className="hero-title">{(s.logoLight || s.logo) && <img src={s.logoLight || s.logo} alt="" />}<h1>{s.businessName}</h1></div>
        <p>{t(greet)} 👋 · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {active.length} active jobs · {db.tasks.filter((x) => x.status !== 'done').length} open tasks</p>
        <div className="hero-actions">
          <button className="btn primary" onClick={() => go('jobs', { new: '1' })}><Plus size={16} />New project</button>
          <button className="btn" onClick={() => go('quotations', { new: '1' })}><FileText size={16} />{t('New quotation')}</button>
          <button className="btn" onClick={() => go('sales', { new: '1' })}><ShoppingCart size={16} />{t('New sale')}</button>
          <button className="btn" onClick={() => go('accounts', { new: 'expense' })}><Receipt size={16} />{t('Add expense')}</button>
        </div>
      </div>

      {db.expenseChat.some((m) => m.status === 'pending') && <div className="alert mb" style={{ cursor: 'pointer' }} onClick={() => go('expchat')}>
        🧾 {db.expenseChat.filter((m) => m.status === 'pending').length} bill photo(s) from staff waiting for approval — open Expense chat</div>}
      {db.selections.some((x) => x.status === 'submitted' && !x.quotationId) && <div className="alert mb" style={{ cursor: 'pointer' }} onClick={() => go('catalog', { selections: '1' })}>
        🎨 {db.selections.filter((x) => x.status === 'submitted' && !x.quotationId).map((x) => `${x.customerName || L.customer(x.customerId)?.name || 'A customer'} chose materials for “${x.title}”`).join(' · ')} — open to make a quotation</div>}
      <div className="grid g4 mb">
        <Stat label={`${t('Income')} · ${monthLabel(month)}`} value={money(f.income, s)} icon={<TrendingUp size={20} />} tone="green" sub={`${t('Profit')}: ${money(f.profit, s)}`} />
        <Stat label={`${t('Expense')} · ${monthLabel(month)}`} value={money(f.expense, s)} icon={<Wallet size={20} />} tone="red" />
        <Stat label={t('Unpaid invoices')} value={money(receivable, s)} icon={<Receipt size={20} />} tone="wood" sub={`Quotes pending: ${money(pipeline, s)}`} />
        <Stat label={t('Active jobs')} value={active.length} icon={<Hammer size={20} />} tone="blue" sub={`${low.length} low-stock items`} />
      </div>

      <div className="grid g-main mb">
        <div className="card">
          <h3>Cash flow — last 6 months <span className="legend"><span><i style={{ background: '#c98a45' }} />Income</span><span><i style={{ background: '#d9c9b8' }} />Expense</span></span></h3>
          <BarChart data={chart} />
        </div>
        <div className="card">
          <h3>Active jobs by type</h3>
          {byType.length ? <Donut parts={byType} /> : <Empty title="No active jobs" />}
        </div>
      </div>

      <div className="grid g2 mb">
        <div className="card">
          <h3>Jobs in progress <a className="link" href="#/jobs">View all</a></h3>
          <ul className="list">
            {active.slice(0, 6).map((j) => { const wt = L.workType(j.workTypeId); const due = dueLabel(j.dueDate); return (
              <li key={j.id} style={{ cursor: 'pointer' }} onClick={() => go('jobs', { id: j.id })}>
                <span className="dot" style={{ background: wt?.color }} />
                <div className="grow"><div className="title"><span className="code-tag">{j.code}</span> {j.title}</div><div className="muted">{L.customer(j.customerId)?.name || '—'} · {projectTrack(db, j).next}</div><div className="flex" style={{ gap: 8 }}><StageDots t={projectTrack(db, j)} /><div style={{ flex: 1 }}><Progress value={j.progress} color={wt?.color} /></div></div></div>
                <div className="right"><Badge tone={statusMeta[j.status].tone}>{statusMeta[j.status].label}</Badge><div className="muted" style={{ marginTop: 4 }}>{due.text}</div></div>
              </li>); })}
            {!active.length && <Empty title="No active jobs" />}
          </ul>
        </div>
        <div className="card">
          <h3>Staff tasks <a className="link" href="#/tasks">Board</a></h3>
          <ul className="list">
            {openTasks.map((x) => { const st = L.staff(x.staffId); return (
              <li key={x.id}>
                {st ? <Avatar name={st.name} color={st.color} /> : <Avatar name="?" color="#bbb" />}
                <div className="grow"><div className="title">{x.title}</div><div className="muted">{st?.name || 'Unassigned'} · {L.job(x.jobId)?.code || 'General'}</div></div>
                <Badge tone={priorityTone[x.priority]}>{x.priority}</Badge><Badge tone={dueLabel(x.dueDate).tone}>{dueLabel(x.dueDate).text}</Badge>
              </li>); })}
            {!openTasks.length && <Empty title="All tasks done 🎉" />}
          </ul>
        </div>
      </div>

      {(() => {
        const rows = db.jobs.filter((j) => j.status !== 'cancelled').map((j) => ({ j, t: projectTrack(db, j) })).filter((r) => r.t.balance > 0.0005 && ['installation', 'completed'].includes(r.j.status)).sort((a, b) => b.t.balance - a.t.balance);
        return rows.length > 0 && <div className="card mb">
          <h3><span className="flex"><Wallet size={16} color="#c2410c" />Balance to collect — finished & installed projects</span><b className="neg">{money(rows.reduce((n, r) => n + r.t.balance, 0), s)}</b></h3>
          <ul className="list">{rows.slice(0, 6).map(({ j, t }) => <li key={j.id} style={{ cursor: 'pointer' }} onClick={() => go('jobs', { id: j.id })}>
            <span className="code-tag">{j.code}</span><div className="grow"><div className="title">{j.title}</div><div className="muted">{L.customer(j.customerId)?.name || '—'} · {j.status === 'completed' ? `installed ${fmtDate(j.completedDate)}` : 'installing'}</div></div>
            <b className="neg">{money(t.balance, s)}</b></li>)}</ul>
        </div>;
      })()}
      <div className="grid g2 mb">
        <div className="card">
          <h3><span className="flex"><Landmark size={16} />Cash & bank</span><a className="link" href="#/accounts">Accounts</a></h3>
          <ul className="list">
            <li><span className="grow">Cash in hand</span><b className={bal.cash < 0 ? 'neg' : ''}>{money(bal.cash, s)}</b></li>
            <li><span className="grow">Bank</span><b className={bal.bank < 0 ? 'neg' : ''}>{money(bal.bank, s)}</b></li>
            {chequesSoon.map((c) => <li key={c.id}><div className="grow"><div className="title">Cheque {c.chequeNo} · {c.party}</div><div className="muted">{c.direction === 'received' ? 'to deposit' : 'we pay'} · {fmtDate(c.date)}</div></div><Badge tone={(daysFrom(c.date) ?? 0) <= 0 ? 'red' : 'amber'}>{c.direction === 'received' ? '+' : '−'}{money(c.amount, s)}</Badge></li>)}
            {!chequesSoon.length && <li className="muted">No cheques due this week</li>}
          </ul>
        </div>
        <div className="card">
          <h3><span className="flex"><Wrench size={16} />Service calls</span><a className="link" href="#/services">Service</a></h3>
          <ul className="list">{services.slice(0, 5).map((x) => <li key={x.id} style={{ cursor: 'pointer' }} onClick={() => go('services', { id: x.id })}><div className="grow"><div className="title">{x.issue}</div><div className="muted">{L.customer(x.customerId)?.name} · {L.staff(x.staffId)?.name || 'unassigned'}</div></div>{x.warranty && <Badge tone="green">Warranty</Badge>}<Badge tone={x.status === 'open' ? 'red' : 'blue'}>{x.visitDate ? fmtDate(x.visitDate) : 'Open'}</Badge></li>)}
            {!services.length && <Empty title="No open service calls" />}</ul>
        </div>
      </div>

      {docs.length > 0 && <div className="card mb">
        <h3><span className="flex"><IdCard size={16} color="#c2410c" />Staff documents expiring</span><a className="link" href="#/staff">Staff</a></h3>
        <ul className="list">{docs.slice(0, 6).map((x) => { const e = expiryLabel(x.days); return <li key={x.staff.id + x.doc.id}><div className="grow"><div className="title">{x.staff.name} — {x.doc.type}</div><div className="muted">{x.doc.number || ''} · {x.doc.expiry}</div></div><Badge tone={e.tone}>{e.text}</Badge></li>; })}</ul>
      </div>}
      <div className="grid g2">
        <div className="card">
          <h3><span className="flex"><AlertTriangle size={16} color="#c2410c" />{t('Low stock')}</span><a className="link" href="#/inventory">Inventory</a></h3>
          <ul className="list">
            {low.map((i) => <li key={i.id}><div className="grow"><div className="title">{i.name} {i.thickness}</div><div className="muted">{i.category}</div></div><Badge tone="red">{i.qty} {i.unit} left</Badge><span className="muted">min {i.reorder}</span></li>)}
            {!low.length && <Empty title="Stock levels healthy" />}
          </ul>
        </div>
        <div className="card">
          <h3>Recent transactions <a className="link" href="#/accounts">Accounts</a></h3>
          <ul className="list">
            {[...db.txns].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map((x) => (
              <li key={x.id}><div className="grow"><div className="title">{x.description}</div><div className="muted">{x.date} · {x.category}</div></div><b className={x.kind === 'income' ? 'pos' : x.kind === 'expense' ? 'neg' : ''}>{x.kind === 'income' ? '+' : x.kind === 'expense' ? '−' : '⇄ '}{money(x.amount, s)}</b></li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
