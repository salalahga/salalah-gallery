import { useState } from 'react';
import { Copy, MessageCircle, FileText, Lock, Unlock, Trash2, ExternalLink, ImageOff, Share2 } from 'lucide-react';
import { store, useDB, nextNumber, today, uid } from '../core/store';
import { go } from '../core/router';
import type { Selection, Customer } from '../core/types';
import { fmtDate, money } from '../core/calc';
import { lookup, waLink } from '../core/helpers';
import { randomToken } from '../core/upload';
import { Modal, Field, Badge, Empty, toast, confirmDelete } from '../components/ui';
import { brandName } from './Catalog';

export const pickLink = (token: string) => `${window.location.origin}/pick/${token}`;
const STATUS: Record<Selection['status'], { label: string; tone: string }> = { sent: { label: 'Sent', tone: 'gray' }, viewed: { label: 'Opened', tone: 'blue' }, submitted: { label: 'Customer chose', tone: 'green' }, closed: { label: 'Closed', tone: 'gray' } };

function shareText(sel: Selection, business: string, customer?: string) {
  return `Dear ${customer || 'customer'},\nPlease choose your ${sel.title.toLowerCase().includes('select') ? '' : 'materials for '}${sel.title} from this link:\n${pickLink(sel.token)}\n\nTap the items you like and press Send. — ${business}`;
}

/** Make a link for a customer with the chosen catalogue items. */
export function ShareSelection({ itemIds, jobId, onClose, onDone }: { itemIds: string[]; jobId?: string; onClose: () => void; onDone: () => void }) {
  const db = useDB(); const s = db.settings; const job = db.jobs.find((j) => j.id === jobId);
  const [f, setF] = useState<Partial<Selection>>({ title: job ? `${job.title} — materials` : 'Material selection', customerId: job?.customerId, jobId, showPrices: false, message: 'Please choose the colours / finishes you like. You can add the quantity or the room for each.' });
  const [made, setMade] = useState<Selection | null>(null);
  const create = () => {
    if (!f.title?.trim()) return toast('Give the selection a title');
    const sel = store.upsert('selections', { ...f, title: f.title.trim(), token: randomToken(16), itemIds, status: 'sent', picks: [] } as Selection) as Selection;
    setMade(sel); toast('Link ready — send it to the customer');
  };
  const cust = db.customers.find((c) => c.id === (made || f).customerId);
  if (made) return (
    <Modal open title="Link ready" onClose={onDone} footer={<><span className="spacer" /><button className="btn" onClick={onDone}>Done</button></>}>
      <p>Send this link to {cust?.name || 'the customer'}. They see the {made.itemIds.length} materials with pictures and codes and tick what they want — no login needed.</p>
      <div className="flex"><input readOnly value={pickLink(made.token)} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => { void navigator.clipboard?.writeText(pickLink(made.token)); toast('Link copied'); }}><Copy size={15} />Copy</button></div>
      <div className="flex wrap" style={{ marginTop: 12 }}>
        <a className="btn primary" target="_blank" rel="noreferrer" href={waLink(cust?.phone, shareText(made, s.businessName, cust?.name))}><MessageCircle size={15} />Send on WhatsApp</a>
        <a className="btn" target="_blank" rel="noreferrer" href={pickLink(made.token)}><ExternalLink size={15} />Open as customer</a>
      </div>
    </Modal>
  );
  return (
    <Modal open title={`Send ${itemIds.length} materials to a customer`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={create}><Share2 size={15} />Create link</button></>}>
      <div className="form two">
        <Field label="Title the customer sees" span={3}><input autoFocus value={f.title || ''} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Kitchen laminate colours" /></Field>
        <Field label="Customer"><select value={f.customerId || ''} onChange={(e) => setF({ ...f, customerId: e.target.value || undefined })}><option value="">— Ask for their name —</option>{db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Project"><select value={f.jobId || ''} onChange={(e) => { const j = db.jobs.find((x) => x.id === e.target.value); setF({ ...f, jobId: e.target.value || undefined, customerId: f.customerId || j?.customerId }); }}><option value="">—</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>
        <Field label="Show prices"><select value={f.showPrices ? '1' : '0'} onChange={(e) => setF({ ...f, showPrices: e.target.value === '1' })}><option value="0">No</option><option value="1">Yes</option></select></Field>
        <Field label="Most they can choose (empty = any)"><input type="number" min={1} value={f.maxPicks ?? ''} onChange={(e) => setF({ ...f, maxPicks: e.target.value === '' ? undefined : +e.target.value })} /></Field>
        <Field label="Message" span={3}><textarea value={f.message || ''} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
      </div>
      <div className="mini-strip">{itemIds.slice(0, 24).map((id) => { const it = db.catalog.find((x) => x.id === id); return it && <div key={id} title={`${it.code} ${it.name}`} className="mini" style={it.image ? { backgroundImage: `url(${it.image})` } : undefined}>{!it.image && it.code}</div>; })}{itemIds.length > 24 && <span className="muted">+{itemIds.length - 24}</span>}</div>
    </Modal>
  );
}

export function SelectionList() {
  const db = useDB(); const s = db.settings; const L = lookup(db);
  const [open, setOpen] = useState<Selection | null>(null);
  const list = [...db.selections].sort((a, b) => (b.submittedAt || b.createdAt).localeCompare(a.submittedAt || a.createdAt));
  const cur = open && db.selections.find((x) => x.id === open.id);
  return (
    <>
      <div className="card">{list.length ? <div className="table-wrap"><table>
        <thead><tr><th>Selection</th><th>Customer</th><th>Project</th><th>Status</th><th className="num">Items</th><th className="num">Chosen</th></tr></thead>
        <tbody>{list.map((x) => <tr key={x.id} className="click" onClick={() => setOpen(x)}>
          <td><b>{x.title}</b><div className="muted">sent {fmtDate(x.createdAt.slice(0, 10))}</div></td>
          <td>{L.customer(x.customerId)?.name || x.customerName || '—'}{x.customerPhone && <div className="muted">{x.customerPhone}</div>}</td>
          <td>{L.job(x.jobId)?.code || '—'}</td>
          <td><Badge tone={STATUS[x.status].tone}>{STATUS[x.status].label}</Badge>{x.submittedAt && <div className="muted">{fmtDate(x.submittedAt.slice(0, 10))}</div>}{x.quotationId && <div><Badge tone="blue">Quoted</Badge></div>}</td>
          <td className="num">{x.itemIds.length}</td><td className="num"><b>{x.picks.length || '—'}</b></td></tr>)}</tbody></table></div>
        : <Empty title="No selection links yet" hint="In Materials press “Choose to send”, tick the materials and send the link to your customer." />}</div>
      {cur && <SelectionDetail sel={cur} onClose={() => setOpen(null)} business={s.businessName} />}
    </>
  );
}

function SelectionDetail({ sel, onClose, business }: { sel: Selection; onClose: () => void; business: string }) {
  const db = useDB(); const s = db.settings; const L = lookup(db);
  const cust = L.customer(sel.customerId);
  const item = (id: string) => db.catalog.find((x) => x.id === id);
  const toQuote = () => {
    if (!sel.picks.length) return toast('The customer has not chosen anything yet');
    if (sel.quotationId && db.quotations.some((q) => q.id === sel.quotationId)) return go('quotations', { id: sel.quotationId });
    let customerId = sel.customerId;
    if (!customerId) {
      const found = db.customers.find((c) => (sel.customerPhone && c.phone?.replace(/\D/g, '').endsWith(sel.customerPhone.replace(/\D/g, '').slice(-8))) || c.name.toLowerCase() === (sel.customerName || '').toLowerCase());
      customerId = found?.id || (store.upsert('customers', { name: sel.customerName || 'Customer', phone: sel.customerPhone, type: 'Individual', notes: `From selection “${sel.title}”` } as Customer)).id;
    }
    const items = sel.picks.map((p) => { const it = item(p.itemId); return { id: uid(), description: `${brandName(db.brands, it?.brandId)} ${it?.code || ''} — ${it?.name || ''}${p.area ? ` (${p.area})` : ''}${p.note ? ` · ${p.note}` : ''}`.trim(), qty: Number(p.qty) || 1, unit: it?.unit || 'pcs', rate: Number(it?.price) || 0 }; });
    const q = store.upsert('quotations', { number: nextNumber('QT', db.quotations.map((x) => x.number)), date: today(), validUntil: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), customerId, title: sel.title, status: 'draft', discount: 0, vat: s.vatRate, terms: s.quoteTerms, items, jobId: sel.jobId });
    store.upsert('selections', { ...sel, customerId, quotationId: q.id }); toast('Draft quotation made from the customer’s choice'); go('quotations', { id: q.id });
  };
  return (
    <Modal open wide title={sel.title} onClose={onClose} footer={<>
      <button className="btn danger ghost" onClick={() => { if (confirmDelete('this selection link')) { store.remove('selections', sel.id); onClose(); } }}><Trash2 size={15} />Delete</button>
      {sel.status === 'closed' ? <button className="btn ghost" onClick={() => store.upsert('selections', { ...sel, status: sel.submittedAt ? 'submitted' : 'viewed' })}><Unlock size={15} />Reopen</button>
        : <button className="btn ghost" onClick={() => { store.upsert('selections', { ...sel, status: 'closed' }); toast('Closed — the customer can still see it but not change it'); }}><Lock size={15} />Close</button>}
      <span className="spacer" />
      <a className="btn" target="_blank" rel="noreferrer" href={waLink(cust?.phone || sel.customerPhone, shareText(sel, business, cust?.name || sel.customerName))}><MessageCircle size={15} />WhatsApp link</a>
      <button className="btn primary" disabled={!sel.picks.length} onClick={toQuote}><FileText size={15} />{sel.quotationId ? 'Open quotation' : 'Make quotation'}</button></>}>
      <div className="flex wrap" style={{ marginBottom: 10 }}>
        <Badge tone={STATUS[sel.status].tone}>{STATUS[sel.status].label}</Badge>
        <span className="muted">{cust?.name || sel.customerName || 'Customer not set'}{sel.customerPhone ? ` · ${sel.customerPhone}` : ''}{sel.viewedAt ? ` · opened ${fmtDate(sel.viewedAt.slice(0, 10))}` : ' · not opened yet'}</span>
      </div>
      <div className="flex"><input readOnly value={pickLink(sel.token)} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => { void navigator.clipboard?.writeText(pickLink(sel.token)); toast('Link copied'); }}><Copy size={15} /></button><a className="btn" href={pickLink(sel.token)} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a></div>
      {sel.customerNote && <div className="alert" style={{ marginTop: 10 }}>“{sel.customerNote}”</div>}
      <h3 style={{ marginTop: 16 }}>Customer’s choice {sel.picks.length ? `(${sel.picks.length})` : ''}</h3>
      {sel.picks.length ? <div className="pick-list">{sel.picks.map((p) => { const it = item(p.itemId); return <div key={p.itemId} className="pick-row">
        <div className="mini" style={it?.image ? { backgroundImage: `url(${it.image})` } : undefined}>{!it?.image && <ImageOff size={16} />}</div>
        <div className="grow"><b>{it?.code}</b> {it?.name}<div className="muted">{brandName(db.brands, it?.brandId)} · {it?.category}{it?.price ? ` · ${money(it.price, s)}` : ''}</div></div>
        <div className="right">{p.qty ? <b>× {p.qty}</b> : null}{p.area && <div>{p.area}</div>}{p.note && <div className="muted">{p.note}</div>}</div></div>; })}</div>
        : <p className="muted">Nothing chosen yet. You will see it here as soon as the customer presses Send. For a Telegram alert, switch on the “Customer picked materials” automation.</p>}
      <h3 style={{ marginTop: 16 }}>Materials offered ({sel.itemIds.length})</h3>
      <div className="mini-strip">{sel.itemIds.map((id) => { const it = item(id); const on = sel.picks.some((p) => p.itemId === id); return it && <div key={id} title={`${it.code} ${it.name}`} className={`mini ${on ? 'on' : ''}`} style={it.image ? { backgroundImage: `url(${it.image})` } : undefined}>{!it.image && it.code}</div>; })}</div>
    </Modal>
  );
}
