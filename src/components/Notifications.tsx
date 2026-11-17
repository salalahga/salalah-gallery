import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import type { DB } from '../core/types';
import { useDB } from '../core/store';
import { invoiceBalance, money, projectFinance, fmtDate } from '../core/calc';
import { daysFrom } from '../core/helpers';
import { go } from '../core/router';
import { poDue } from '../modules/Purchases';

export interface Alert { id: string; tone: 'red' | 'amber' | 'blue' | 'green'; group: string; text: string; go: [string, Record<string, string>?] }

/** Everything that needs attention, worked out from the data (nothing is stored). */
export function alerts(db: DB): Alert[] {
  const s = db.settings; const out: Alert[] = []; const m = (n: number) => money(n, s);
  const open = db.jobs.filter((j) => !['completed', 'cancelled'].includes(j.status));
  for (const j of open) {
    const d = daysFrom(j.dueDate);
    if (d !== undefined && d < 0) out.push({ id: `late:${j.id}:${j.dueDate}`, tone: 'red', group: 'Delayed projects', text: `${j.code} ${j.title} — ${-d} days late`, go: ['jobs', { id: j.id }] });
    else if (d !== undefined && d <= 3) out.push({ id: `due:${j.id}:${j.dueDate}`, tone: 'amber', group: 'Upcoming deliveries', text: `${j.code} ${j.title} — due ${d === 0 ? 'today' : fmtDate(j.dueDate)}`, go: ['jobs', { id: j.id }] });
  }
  for (const j of db.jobs.filter((x) => x.status !== 'cancelled' && Number(x.budget) > 0)) {
    const f = projectFinance(db, j);
    if (f.overBudget) out.push({ id: `budget:${j.id}:${Math.round(f.expenses)}`, tone: 'red', group: 'Budget overruns', text: `${j.code} costs ${m(f.expenses)} — over budget ${m(f.budget)}`, go: ['jobs', { id: j.id }] });
  }
  for (const i of db.invoices) {
    const b = invoiceBalance(i); const d = daysFrom(i.dueDate || i.date);
    if (b > 0.0005 && d !== undefined && d < 0) out.push({ id: `inv:${i.id}:${b.toFixed(3)}`, tone: 'red', group: 'Pending customer payments', text: `${i.number} — ${m(b)} overdue ${-d} days`, go: ['invoices', { id: i.id }] });
  }
  for (const p of db.purchases) {
    const due = poDue(p); const d = daysFrom(p.dueDate);
    if (due > 0.0005 && d !== undefined && d <= 3) out.push({ id: `po:${p.id}:${due.toFixed(3)}`, tone: d < 0 ? 'red' : 'amber', group: 'Supplier payments', text: `${p.number} ${db.suppliers.find((x) => x.id === p.supplierId)?.name || ''} — ${m(due)} ${d < 0 ? `${-d} days overdue` : 'due soon'}`, go: ['purchases'] });
  }
  for (const c of db.cheques.filter((x) => x.status === 'pending' && (daysFrom(x.date) ?? 1) <= 0)) out.push({ id: `chq:${c.id}`, tone: 'amber', group: 'Important financial activity', text: `Cheque ${c.chequeNo} (${c.direction}) ${m(c.amount)} — ${c.party}, due ${fmtDate(c.date)}`, go: ['documents'] });
  for (const c of db.cheques.filter((x) => x.status === 'bounced')) out.push({ id: `bounce:${c.id}`, tone: 'red', group: 'Important financial activity', text: `Bounced cheque ${c.chequeNo} ${m(c.amount)} — ${c.party}`, go: ['documents'] });
  const big = Number(s.bigTxn) || 500; const since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  for (const t of db.txns.filter((x) => x.date >= since && x.amount >= big && x.kind !== 'transfer')) out.push({ id: `big:${t.id}`, tone: 'blue', group: 'Important financial activity', text: `${t.kind === 'income' ? 'Received' : 'Paid'} ${m(t.amount)} — ${t.description}`, go: ['accounts'] });
  for (const i of db.items.filter((x) => Number(x.reorder) > 0 && x.qty <= x.reorder)) out.push({ id: `low:${i.id}:${i.qty}`, tone: 'amber', group: 'Low inventory', text: `${i.name} ${i.thickness || ''} — ${i.qty} ${i.unit} left (min ${i.reorder})`, go: ['inventory'] });
  for (const c of db.customers.filter((x) => x.leadStatus === 'new')) out.push({ id: `lead:${c.id}:${c.updatedAt || c.createdAt}`, tone: 'green', group: 'New enquiries', text: `${c.name} (${c.source || 'enquiry'}) — ${(c.enquiry || '').split('\n')[0].slice(0, 60)}`, go: ['customers'] });
  for (const c of db.customers.filter((x) => x.nextFollowUp && x.leadStatus && !['won', 'lost'].includes(x.leadStatus) && (daysFrom(x.nextFollowUp) ?? 1) <= 0)) out.push({ id: `fu:${c.id}:${c.nextFollowUp}`, tone: 'amber', group: 'New enquiries', text: `Follow up ${c.name} (${fmtDate(c.nextFollowUp)})`, go: ['customers'] });
  const claims = db.expenseChat.filter((x) => x.status === 'pending');
  if (claims.length) out.push({ id: `claims:${claims.map((x) => x.id).join(',').slice(-60)}`, tone: 'blue', group: 'Important financial activity', text: `${claims.length} staff bill${claims.length > 1 ? 's' : ''} waiting for approval`, go: ['expchat'] });
  return out;
}

const SEEN = 'ww-seen-alerts';
export function NotificationBell() {
  const db = useDB(); const list = useMemo(() => alerts(db), [db]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(SEEN) || '[]'); } catch { return []; } });
  const unseen = list.filter((a) => !seen.includes(a.id)).length;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  const markAll = () => { const ids = list.map((a) => a.id); setSeen(ids); try { localStorage.setItem(SEEN, JSON.stringify(ids)); } catch { /* */ } };
  const groups = [...new Set(list.map((a) => a.group))];
  return (
    <div className="notif" ref={ref}>
      <button className="icon-btn" title="Notifications" aria-label="Notifications" onClick={() => setOpen(!open)}><Bell size={18} />{unseen > 0 && <span className="notif-dot">{unseen > 99 ? '99+' : unseen}</span>}</button>
      {open && <div className="notif-panel">
        <div className="flex between" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}><b>Notifications</b>{list.length > 0 && <button className="btn ghost sm" onClick={markAll}>Mark all read</button>}</div>
        <div className="notif-list">{groups.length ? groups.map((g) => <div key={g}><div className="nav-label" style={{ padding: '8px 12px 2px' }}>{g}</div>
          {list.filter((a) => a.group === g).slice(0, 12).map((a) => <button key={a.id} className={`notif-item ${seen.includes(a.id) ? '' : 'new'}`} onClick={() => { go(a.go[0], a.go[1]); setOpen(false); }}><span className={`dot tone-${a.tone}`} />{a.text}</button>)}</div>)
          : <p className="muted" style={{ padding: 14 }}>All clear — nothing needs attention.</p>}</div>
      </div>}
    </div>
  );
}
