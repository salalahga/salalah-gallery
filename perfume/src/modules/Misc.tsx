// Smaller screens: assistant, approvals, reports & exports, audit log, my account.
import { useState } from 'react';
import { api, qs } from '../core/api';
import { t } from '../core/i18n';
import { money, useSession, dateTime, monthStart, today } from '../core/session';
import { go } from '../core/router';
import { Card, Empty, Loading, PageHead, Status, useAction, useData, download } from '../components/ui';
import { ChangePassword, Enrol } from '../components/Auth';

const QUESTIONS = ['How much did my shop sell today?', 'What is my net profit this month?', 'Which perfume sells the most?', 'Which products are not selling?', 'Which staff member generated the highest sales?', 'What is my total stock value?', 'Which suppliers have outstanding balances?', 'How much did I spend this month?', 'Which offers generated the most revenue?', 'How can I improve my profit?', 'What is my cash and bank balance?', 'Which products are low on stock?'];

export function Assistant() {
  const [log, setLog] = useState<{ q: string; a: any }[]>([]);
  const [q, setQ] = useState('');
  const { busy, run } = useAction();
  const ask = (text: string) => run(async () => { const a = await api.post('/assistant', { question: text }); setLog((l) => [{ q: text, a }, ...l]); setQ(''); });
  return (
    <>
      <PageHead title={t('Assistant')} sub="Answers come only from your live business data, with the period and source. It never estimates figures." />
      <Card>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (q) ask(q); }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about sales, profit, stock, staff, suppliers, offers…" style={{ flex: 1 }} autoFocus /><button className="btn primary" disabled={busy}>Ask</button></form>
        <div className="pill-group" style={{ marginTop: 10 }}>{QUESTIONS.map((x) => <button key={x} onClick={() => ask(x)} disabled={busy}>{x}</button>)}</div>
      </Card>
      <div className="col" style={{ marginTop: 14 }}>{log.map((x, i) => (
        <Card key={i}>
          <div className="muted small">You asked: {x.q}</div>
          <div style={{ fontSize: 16, marginTop: 4 }} className={x.a.denied ? 'bad' : ''}>{x.a.answer}</div>
          {x.a.tips && <ul>{x.a.tips.map((tip: string) => <li key={tip}>{tip}</li>)}</ul>}
          {x.a.suggestions && <div className="pill-group" style={{ marginTop: 6 }}>{x.a.suggestions.map((s: string) => <button key={s} onClick={() => ask(s)}>{s}</button>)}</div>}
          {x.a.source && <div className="small muted" style={{ marginTop: 6 }}>Source: {x.a.source}</div>}
        </Card>
      ))}</div>
    </>
  );
}

export function Approvals() {
  const [status, setStatus] = useState('pending');
  const { data, reload } = useData<any[]>('/approvals' + qs({ status }), [status]);
  const { data: pos } = useData<any[]>('/purchase-orders?status=pending_approval');
  const { data: promos } = useData<any[]>('/promotions');
  const { data: leave } = useData<any[]>('/leave');
  const { busy, run } = useAction();
  return (
    <>
      <PageHead title={t('Approvals')} sub="Refunds, cancellations, purchase orders, offers and leave waiting for a decision" />
      <div className="grid g2">
        <Card title="Refunds & cancellations" actions={<div className="pill-group">{['pending', 'executed', 'rejected'].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s}</button>)}</div>}>
          {!data ? <Loading /> : !data.length ? <Empty>Nothing here</Empty> : <table className="t"><tbody>{data.map((a) => (
            <tr key={a.id}><td><b>{a.kind.replace('_', ' ')}</b> · <a href={`#/sales/${a.entity_id}`}>{a.sale_number}</a> ({money(a.sale_total)})<div className="small muted">{a.payload?.reason} · by {a.requested_by_name} · {dateTime(a.requested_at)}</div>{a.decided_by_name && <div className="small muted">decided by {a.decided_by_name}</div>}</td>
              <td className="right">{a.status === 'pending' ? <><button className="btn gold sm" disabled={busy} onClick={() => run(() => api.post(`/approvals/${a.id}/approve`), 'Approved and done').then(reload)}>Approve</button> <button className="btn danger sm" disabled={busy} onClick={() => { const r = prompt('Reason?'); if (r !== null) run(() => api.post(`/approvals/${a.id}/reject`, { reason: r }), 'Rejected').then(reload); }}>Reject</button></> : <Status s={a.status} />}</td></tr>
          ))}</tbody></table>}
        </Card>
        <Card title="Purchase orders">{pos?.length ? pos.map((p) => <div key={p.id} className="row"><span className="grow">{p.number} · {p.supplier}</span><b>{p.currency} {money(p.total)}</b><button className="btn sm" onClick={() => go('/purchases')}>Open</button></div>) : <Empty>None waiting</Empty>}</Card>
        <Card title="Offers">{promos?.filter((p) => p.status === 'pending_approval').map((p) => <div key={p.id} className="row"><span className="grow">{p.name}</span><button className="btn sm" onClick={() => go('/promotions')}>Open</button></div>)}{!promos?.some((p) => p.status === 'pending_approval') && <Empty>None waiting</Empty>}</Card>
        <Card title="Leave requests">{leave?.filter((l) => l.status === 'pending').map((l) => <div key={l.id} className="row"><span className="grow">{l.name} · {l.days} day(s)</span><button className="btn sm" onClick={() => go('/hr')}>Open</button></div>)}{!leave?.some((l) => l.status === 'pending') && <Empty>None waiting</Empty>}</Card>
      </div>
    </>
  );
}

const DATASETS: [string, string, string][] = [
  ['sales', 'Sales (orders)', 'sales'], ['sale-lines', 'Sales by product line', 'sales'], ['staff-sales', 'Sales by staff', 'sales'], ['payments', 'Payments & refunds', 'payments'],
  ['purchases', 'Purchases (supplier bills)', 'purchases'], ['suppliers', 'Suppliers & balances', 'purchases'], ['inventory', 'Stock by branch', 'inventory'], ['inventory-valuation', 'Inventory valuation', 'finance'],
  ['expenses', 'Expenses', 'finance'], ['journal', 'General journal', 'finance'], ['customers', 'Customers', 'customers'], ['attendance', 'Attendance', 'hr'], ['audit', 'Audit log', 'audit'],
];
export function Reports() {
  const { can } = useSession();
  const [r, setR] = useState({ from: monthStart(), to: today() });
  return (
    <>
      <PageHead title={t('Reports')} sub="Download any report for a date range as CSV or Excel. Every screen can also be printed or saved as PDF from the browser." />
      <div className="card row" style={{ marginBottom: 12 }}>
        <input type="date" value={r.from} onChange={(e) => setR({ ...r, from: e.target.value })} style={{ width: 'auto' }} /><span>→</span><input type="date" value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} style={{ width: 'auto' }} />
        <div className="pill-group">{[['Today', today(), today()], ['This month', monthStart(), today()], ['This year', today().slice(0, 4) + '-01-01', today()]].map(([l, a, b]) => <button key={l} onClick={() => setR({ from: a, to: b })}>{l}</button>)}</div>
      </div>
      {!can('reports', 'export') && <div className="alert">You can view reports on each screen, but downloading needs the “export” permission.</div>}
      <div className="grid g3">{DATASETS.filter(([, , m]) => can(m)).map(([k, label]) => (
        <Card key={k} title={label}><div className="row"><button className="btn sm" disabled={!can('reports', 'export')} onClick={() => download(`/export/${k}` + qs(r))}>CSV</button><button className="btn sm" disabled={!can('reports', 'export')} onClick={() => download(`/export/${k}` + qs({ ...r, format: 'xls' }))}>Excel</button></div></Card>
      ))}
        {can('finance') && <Card title="Financial statements"><div className="small muted">Profit & loss, balance sheet, cash flow, trial balance and VAT are in Finance — print them to PDF from there.</div><button className="btn sm" style={{ marginTop: 8 }} onClick={() => go('/finance')}>Open Finance</button></Card>}
      </div>
    </>
  );
}

export function Audit() {
  const [f, setF] = useState({ from: today(), to: today(), role: '', app: '' });
  const { data } = useData<any[]>('/audit' + qs(f), [JSON.stringify(f)]);
  return (
    <>
      <PageHead title={t('Audit log')} sub="Who did what and when. Entries cannot be edited or deleted." actions={<button className="btn" onClick={() => download('/export/audit' + qs(f))}>CSV</button>} />
      <div className="card row" style={{ marginBottom: 10 }}>
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={{ width: 'auto' }} /><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={{ width: 'auto' }} />
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} style={{ width: 'auto' }}><option value="">Any role</option>{['owner', 'admin', 'manager', 'accountant', 'hr', 'cashier', 'staff'].map((r) => <option key={r}>{r}</option>)}</select>
        <select value={f.app} onChange={(e) => setF({ ...f, app: e.target.value })} style={{ width: 'auto' }}><option value="">Any app</option><option value="admin">Main app</option><option value="manager">Manager app</option><option value="staff">Staff app</option></select>
      </div>
      <div className="card tablewrap">{!data ? <Loading /> : !data.length ? <Empty>No activity</Empty> : (
        <table className="t"><thead><tr><th>When</th><th>Who</th><th>App</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
          <tbody>{data.map((a) => <tr key={a.id}><td className="small">{dateTime(a.at)}</td><td>{a.user_name}<div className="small muted">{a.user_role}</div></td><td>{a.app}</td><td className={a.action === 'denied' || a.action.includes('failed') ? 'bad' : ''}>{a.action}</td><td className="small">{a.entity} {a.entity_id}</td><td className="small muted" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify(a.detail)}>{a.detail ? JSON.stringify(a.detail) : ''}</td></tr>)}</tbody></table>
      )}</div>
    </>
  );
}

export function Account() {
  const { me, refresh } = useSession();
  const { data: sessions, reload } = useData<any[]>('/auth/sessions');
  const [enrol, setEnrol] = useState(false);
  const { busy, run } = useAction();
  return (
    <>
      <PageHead title="My account" sub={`${me.user.name} · ${me.user.role}`} />
      <div className="grid g2">
        <Card title="Change password"><ChangePassword onDone={() => refresh()} /></Card>
        <Card title="Two-factor authentication">
          {me.user.totpEnabled ? <div className="col"><div className="alert ok">Two-factor authentication is on.</div><button className="btn danger" disabled={busy} onClick={() => { const p = prompt('Enter your password to turn off two-factor authentication'); if (p) run(() => api.post('/auth/2fa/disable', { password: p }), 'Turned off').then(refresh); }}>Turn off</button></div>
            : enrol ? <Enrol onDone={() => { setEnrol(false); refresh(); }} /> : <div className="col"><div>Protect your account with a 6-digit code from an authenticator app.</div><button className="btn gold" onClick={() => setEnrol(true)}>Set up two-factor</button></div>}
        </Card>
        <Card title="Where you are signed in">
          <table className="t"><tbody>{sessions?.map((s) => <tr key={s.id}><td>{s.app} app{s.current && <span className="badge ok" style={{ marginInlineStart: 6 }}>this device</span>}<div className="small muted">{s.user_agent?.slice(0, 60)}</div></td><td className="small">{dateTime(s.last_seen)}<div className="muted">{s.ip}</div></td><td>{!s.current && <button className="btn ghost sm" onClick={() => api.del(`/auth/sessions/${s.id}`).then(reload)}>Sign out</button>}</td></tr>)}</tbody></table>
        </Card>
      </div>
    </>
  );
}
