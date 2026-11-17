import { useState } from 'react';
import { api, qs } from '../core/api';
import { t } from '../core/i18n';
import { money, parseMoney, useSession, date, dateTime } from '../core/session';
import { go } from '../core/router';
import { Card, Empty, Field, Loading, Modal, PageHead, Stat, Status, Tabs, TestBadge, useAction, useData, download } from '../components/ui';

export default function Customers({ params }: { params: string[] }) {
  const { can } = useSession();
  const [tab, setTab] = useState<'list' | 'insights'>('list');
  const [search, setSearch] = useState('');
  const { data, reload } = useData<any[]>('/customers' + qs({ search }), [search]);
  const [edit, setEdit] = useState<any>(null);
  if (params[0]) return <CustomerView id={params[0]} />;
  return (
    <>
      <PageHead title={t('Customers')} actions={<>{can('reports', 'export') && <button className="btn" onClick={() => download('/export/customers')}>CSV</button>}{can('customers', 'create') && <button className="btn primary" onClick={() => setEdit({})}>+ Customer</button>}</>} />
      <Tabs tabs={[['list', 'All customers'], ['insights', 'Follow-ups, birthdays & reminders']]} value={tab} onChange={setTab} />
      {tab === 'list' ? (
        <>
          <input placeholder="Search name, phone, email or code" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 10, maxWidth: 420 }} />
          <div className="card tablewrap">{!data ? <Loading /> : !data.length ? <Empty>No customers</Empty> : (
            <table className="t"><thead><tr><th>Customer</th><th>Phone</th><th>Segment</th><th className="num">Orders</th><th className="num">Spent</th><th className="num">Points</th><th>Last purchase</th></tr></thead>
              <tbody>{data.map((c) => <tr key={c.id} className="click" onClick={() => go('/customers/' + c.id)}><td><b>{c.name}</b> {c.vip && <span className="badge gold">VIP</span>} <TestBadge on={c.is_test} /><div className="small muted">{c.code}</div></td><td>{c.phone}</td><td>{c.segment}</td><td className="num">{c.orders}</td><td className="num">{money(c.spent)}</td><td className="num">{c.loyalty_points}</td><td>{date(c.last_purchase)}</td></tr>)}</tbody></table>
          )}</div>
        </>
      ) : <Insights />}
      {edit && <CustomerForm c={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function Insights() {
  const { data } = useData<any>('/customers/insights');
  if (!data) return <Loading />;
  const wa = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, '').replace(/^(?!968)(\d{8})$/, '968$1')}?text=${encodeURIComponent(text)}`;
  return (
    <div className="grid g2">
      <Card title="Open follow-ups & complaints">{data.followUps.length ? <table className="t"><tbody>{data.followUps.map((f: any) => <tr key={f.id} className="click" onClick={() => go('/customers/' + f.customer_id)}><td><Status s={f.kind} /> {f.subject}<div className="small muted">{f.name} · {f.phone}</div></td><td>{date(f.due_date)}</td></tr>)}</tbody></table> : <Empty>Nothing open</Empty>}</Card>
      <Card title="Birthdays this month">{data.birthdays.length ? <table className="t"><tbody>{data.birthdays.map((b: any) => <tr key={b.id}><td>{b.name}</td><td>{date(b.birthday).slice(0, 6)}</td><td>{b.phone && <a target="_blank" rel="noreferrer" href={wa(b.phone, `Happy birthday ${b.name}! Enjoy a special gift from us this month.`)}>WhatsApp</a>}</td></tr>)}</tbody></table> : <Empty>No birthdays this month</Empty>}</Card>
      <Card title="Repeat-purchase reminders (no purchase in 90 days)">{data.lapsed.length ? <table className="t"><tbody>{data.lapsed.map((c: any) => <tr key={c.id}><td>{c.name}<div className="small muted">{c.orders} orders · last {date(c.last_purchase)}</div></td><td>{c.phone && <a target="_blank" rel="noreferrer" href={wa(c.phone, `Hello ${c.name}, we miss you! New fragrances have arrived.`)}>WhatsApp</a>}</td></tr>)}</tbody></table> : <Empty>Every customer bought recently</Empty>}</Card>
      <Card title="Segments">{data.segments.map((s: any) => <div key={s.segment} className="row"><span className="grow">{s.segment}</span><b>{s.n}</b></div>)}</Card>
    </div>
  );
}

function CustomerView({ id }: { id: string }) {
  const { can } = useSession();
  const { data: c, reload } = useData<any>(`/customers/${id}`);
  const [edit, setEdit] = useState(false);
  const [note, setNote] = useState({ kind: 'note', subject: '', body: '', dueDate: '' });
  const { busy, run } = useAction();
  if (!c) return <Loading />;
  return (
    <>
      <PageHead title={<>{c.name} {c.vip && <span className="badge gold">VIP</span>} <TestBadge on={c.is_test} /></>} sub={`${c.code} · ${c.phone || ''} ${c.email || ''} · customer since ${date(c.created_at)}`} actions={<><button className="btn" onClick={() => go('/customers')}>← All customers</button>{can('customers', 'edit') && <button className="btn primary" onClick={() => setEdit(true)}>Edit</button>}</>} />
      <div className="grid g4">
        <Stat dark label="Total spent" value={money(c.spent)} sub={`${c.history.length} orders`} />
        <Stat label="Loyalty points" value={c.loyalty_points} />
        <Stat label="Balance owed" value={money(c.balance)} sub={c.credit_enabled ? `credit limit ${money(c.credit_limit)}` : 'no credit account'} />
        <Stat label="Segment" value={c.segment} sub={c.favourite_brands?.join(', ')} />
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Purchase history">{c.history.length ? <table className="t"><tbody>{c.history.map((s: any) => <tr key={s.id} className="click" onClick={() => go('/sales/' + s.id)}><td>{s.number}<div className="small muted">{s.channel}</div></td><td>{dateTime(s.created_at)}</td><td><Status s={s.status} /></td><td className="num">{money(s.total)}</td></tr>)}</tbody></table> : <Empty>No purchases yet</Empty>}</Card>
        <div className="col">
          <Card title="Favourite perfumes">{c.favourites.length ? c.favourites.map((f: any) => <div key={f.name} className="row"><span className="grow">{f.brand} {f.name}</span><b>{f.qty}</b></div>) : <Empty>—</Empty>}{c.preferences && <div className="small muted" style={{ marginTop: 6 }}>Preferences: {c.preferences}</div>}</Card>
          <Card title="Notes, complaints & follow-ups">
            {can('customers', 'create') && <div className="col" style={{ marginBottom: 10 }}>
              <div className="row"><select value={note.kind} onChange={(e) => setNote({ ...note, kind: e.target.value })} style={{ width: 140 }}>{['note', 'complaint', 'follow_up', 'call', 'whatsapp', 'visit'].map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}</select><input placeholder="Subject" value={note.subject} onChange={(e) => setNote({ ...note, subject: e.target.value })} style={{ flex: 1 }} />{['complaint', 'follow_up', 'whatsapp'].includes(note.kind) && <input type="date" value={note.dueDate} onChange={(e) => setNote({ ...note, dueDate: e.target.value })} style={{ width: 'auto' }} />}</div>
              <textarea rows={2} placeholder="Details" value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} />
              <button className="btn sm primary" disabled={busy || !note.subject} onClick={() => run(() => api.post(`/customers/${id}/interactions`, note), 'Saved').then(() => { setNote({ kind: 'note', subject: '', body: '', dueDate: '' }); reload(); })}>Add</button>
            </div>}
            {c.interactions.map((i: any) => <div key={i.id} style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}><div className="row"><Status s={i.kind} /> <b className="grow">{i.subject}</b><Status s={i.status} />{i.status === 'open' && can('customers', 'edit') && <button className="btn ghost sm" onClick={() => api.put(`/interactions/${i.id}`, { status: 'closed' }).then(reload)}>Close</button>}</div>{i.body && <div className="small">{i.body}</div>}<div className="small muted">{dateTime(i.created_at)}{i.due_date && ` · due ${date(i.due_date)}`}</div></div>)}
          </Card>
          <Card title="Loyalty history">{c.loyalty.length ? <table className="t"><tbody>{c.loyalty.map((l: any) => <tr key={l.id}><td>{dateTime(l.at)}</td><td>{l.reason}</td><td className={'num ' + (l.points < 0 ? 'bad' : 'ok')}>{l.points > 0 ? '+' : ''}{l.points}</td></tr>)}</tbody></table> : <Empty>No points yet</Empty>}</Card>
        </div>
      </div>
      {edit && <CustomerForm c={c} onClose={() => setEdit(false)} onDone={() => { setEdit(false); reload(); }} />}
    </>
  );
}

function CustomerForm({ c, onClose, onDone }: { c: any; onClose: () => void; onDone: () => void }) {
  const { can } = useSession();
  const { data: brands } = useData<any[]>('/brands');
  const [f, setF] = useState({ name: c.name || '', phone: c.phone || '', email: c.email || '', birthday: c.birthday?.slice(0, 10) || '', gender: c.gender || '', address: c.address || '', city: c.city || '', segment: c.segment || 'regular', vip: !!c.vip, favouriteBrands: c.favourite_brands || [], preferences: c.preferences || '', notes: c.notes || '', marketingOptIn: !!c.marketing_opt_in, creditEnabled: !!c.credit_enabled, creditLimit: c.credit_limit ? money(c.credit_limit) : '' });
  const { busy, run } = useAction();
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const canCredit = can('finance', 'edit') || can('customers', 'approve');
  const save = () => run(() => {
    const body: any = { ...f };
    if (canCredit && c.id) body.creditLimit = parseMoney(f.creditLimit || '0'); else { delete body.creditEnabled; delete body.creditLimit; }
    return c.id ? api.put(`/customers/${c.id}`, body) : api.post('/customers', body);
  }, 'Saved').then((r) => r && onDone());
  return (
    <Modal title={c.id ? 'Edit customer' : 'New customer'} onClose={onClose} footer={<button className="btn primary" disabled={busy || !f.name} onClick={save}>Save</button>}>
      <div className="grid g2">
        <Field label="Name"><input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Phone"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" /></Field>
        <Field label="Email"><input value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Birthday"><input type="date" value={f.birthday} onChange={(e) => set('birthday', e.target.value)} /></Field>
        <Field label="City"><input value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="Segment"><input value={f.segment} onChange={(e) => set('segment', e.target.value)} list="segments" /><datalist id="segments"><option>regular</option><option>vip</option><option>wholesale</option><option>corporate</option><option>tourist</option></datalist></Field>
        <Field label="Address"><input value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Preferences"><input value={f.preferences} onChange={(e) => set('preferences', e.target.value)} placeholder="e.g. likes woody oud, 100ml" /></Field>
      </div>
      <Field label="Favourite brands"><div className="pill-group">{brands?.map((b) => <button key={b.id} className={f.favouriteBrands.includes(b.name) ? 'on' : ''} onClick={() => set('favouriteBrands', f.favouriteBrands.includes(b.name) ? f.favouriteBrands.filter((x: string) => x !== b.name) : [...f.favouriteBrands, b.name])}>{b.name}</button>)}</div></Field>
      <div className="row" style={{ marginTop: 8 }}><label className="check"><input type="checkbox" checked={f.vip} onChange={(e) => set('vip', e.target.checked)} /> VIP</label><label className="check"><input type="checkbox" checked={f.marketingOptIn} onChange={(e) => set('marketingOptIn', e.target.checked)} /> Agrees to marketing messages</label></div>
      {c.id && canCredit && <div className="row" style={{ marginTop: 8 }}><label className="check"><input type="checkbox" checked={f.creditEnabled} onChange={(e) => set('creditEnabled', e.target.checked)} /> Credit account</label>{f.creditEnabled && <Field label="Credit limit (OMR)"><input value={f.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} /></Field>}</div>}
    </Modal>
  );
}
