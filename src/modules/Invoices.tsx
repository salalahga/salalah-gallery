import { useEffect, useState } from 'react';
import { Plus, Trash2, Printer, MessageCircle, Eye, HandCoins, Receipt, AlertCircle, CheckCircle2 } from 'lucide-react';
import { store, useDB, nextInvoiceNumber, today, uid } from '../core/store';
import { useRoute, go } from '../core/router';
import type { Invoice } from '../core/types';
import { docTotals, money, fmtDate, invoiceBalance, invoiceStatus } from '../core/calc';
import { statusMeta, lookup, waLink, daysFrom } from '../core/helpers';
import { Modal, Field, PageHeader, Badge, Empty, Tabs, SearchBox, Stat, toast, confirmDelete } from '../components/ui';
import { LinesEditor, DocView } from '../components/DocEditor';
import { useT } from '../core/i18n';
import { useWaText } from '../plugins/hooks';

export default function Invoices() {
  const db = useDB(); const s = db.settings; const L = lookup(db); const t = useT(); const { params } = useRoute(); const wa = useWaText();
  const [edit, setEdit] = useState<Partial<Invoice> | null>(null);
  const [view, setView] = useState<Invoice | null>(null);
  const [pay, setPay] = useState<{ inv: Invoice; amount: number; method: string } | null>(null);
  const [tab, setTab] = useState('all'); const [q, setQ] = useState('');
  const blank = (): Partial<Invoice> => ({ number: nextInvoiceNumber(), date: today(), dueDate: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), discount: 0, vat: s.vatRate, paid: 0, items: [{ id: uid(), description: '', qty: 1, unit: 'pcs', rate: 0 }], title: '' });
  useEffect(() => {
    if (params.new) { setEdit(blank()); go('invoices'); }
    if (params.id) { const i = db.invoices.find((x) => x.id === params.id); if (i) setEdit(structuredClone(i)); go('invoices'); }
  }, [params.new, params.id]); // eslint-disable-line

  const list = db.invoices.filter((x) => (tab === 'all' || invoiceStatus(x) === tab) && (x.number + x.title + (L.customer(x.customerId)?.name || '')).toLowerCase().includes(q.toLowerCase()));
  const save = () => { if (!edit?.customerId) return toast('Select a customer'); const v = store.upsert('invoices', edit as Invoice); setEdit(null); toast('Invoice saved'); return v; };
  const recordPayment = () => {
    if (!pay || pay.amount <= 0) return;
    store.upsert('invoices', { ...pay.inv, paid: (pay.inv.paid || 0) + pay.amount });
    store.upsert('txns', { date: today(), kind: 'income', category: 'Job Payment', amount: pay.amount, method: pay.method, description: `Payment ${pay.inv.number} — ${L.customer(pay.inv.customerId)?.name}`, ref: pay.inv.number });
    setPay(null); toast('Payment recorded in accounts');
  };
  const share = (x: Invoice) => { const c = L.customer(x.customerId); return waLink(c?.phone, wa('invoice', { customer: c?.name, number: x.number, title: x.title, total: money(docTotals(x).total, s), paid: money(x.paid, s), balance: money(invoiceBalance(x), s), due: fmtDate(x.dueDate), business: s.businessName, phone: s.phone })); };
  const totalDue = db.invoices.reduce((n, i) => n + Math.max(0, invoiceBalance(i)), 0);
  const overdue = db.invoices.filter((i) => invoiceBalance(i) > 0.001 && (daysFrom(i.dueDate) ?? 1) < 0);
  const collected = db.invoices.reduce((n, i) => n + (i.paid || 0), 0);

  return (
    <>
      <PageHeader title={t('Invoices')} sub="Bill customers, track partial payments and chase dues." actions={<button className="btn primary" onClick={() => setEdit(blank())}><Plus size={16} />New invoice</button>} />
      <div className="grid g3 mb">
        <Stat label="Outstanding" value={money(totalDue, s)} icon={<Receipt size={20} />} tone="wood" />
        <Stat label="Overdue" value={money(overdue.reduce((n, i) => n + invoiceBalance(i), 0), s)} icon={<AlertCircle size={20} />} tone="red" sub={`${overdue.length} invoices`} />
        <Stat label="Collected" value={money(collected, s)} icon={<CheckCircle2 size={20} />} tone="green" />
      </div>
      <div className="toolbar">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: 'All' }, ...['unpaid', 'partial', 'paid'].map((x) => ({ id: x, label: statusMeta[x].label, count: db.invoices.filter((y) => invoiceStatus(y) === x).length }))]} />
        <SearchBox value={q} onChange={setQ} />
      </div>
      <div className="card">
        {list.length ? <div className="table-wrap"><table>
          <thead><tr><th>Number</th><th>Customer</th><th>Date</th><th>Due</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th><th /></tr></thead>
          <tbody>{list.map((x) => { const st = invoiceStatus(x); const od = st !== 'paid' && (daysFrom(x.dueDate) ?? 1) < 0; return (
            <tr key={x.id} className="click" onClick={() => setEdit(structuredClone(x))}>
              <td><b>{x.number}</b></td><td>{L.customer(x.customerId)?.name}<div className="muted">{x.title}</div></td><td>{fmtDate(x.date)}</td>
              <td>{fmtDate(x.dueDate)}{od && <div><Badge tone="red">Overdue</Badge></div>}</td>
              <td><Badge tone={statusMeta[st].tone}>{statusMeta[st].label}</Badge></td><td className="num">{money(docTotals(x).total, s)}</td><td className="num"><b>{money(invoiceBalance(x), s)}</b></td>
              <td onClick={(e) => e.stopPropagation()}><div className="row-actions">
                {st !== 'paid' && <button className="icon-btn" title="Record payment" onClick={() => setPay({ inv: x, amount: +invoiceBalance(x).toFixed(3), method: 'Cash' })}><HandCoins size={16} /></button>}
                <button className="icon-btn" title="Preview / print" onClick={() => setView(x)}><Eye size={16} /></button>
                <a className="icon-btn" title="WhatsApp" target="_blank" rel="noreferrer" href={share(x)}><MessageCircle size={16} /></a>
              </div></td>
            </tr>); })}</tbody></table></div> : <Empty title="No invoices" />}
      </div>

      {edit && <Modal open wide title={edit.id ? `Invoice ${edit.number}` : 'New invoice'} onClose={() => setEdit(null)} footer={<>
        {edit.id && <button className="btn danger ghost" onClick={() => { if (confirmDelete(edit.number)) { store.remove('invoices', edit.id!); setEdit(null); } }}><Trash2 size={15} />Delete</button>}
        <span className="spacer" /><button className="btn" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn" onClick={() => { const v = save(); if (v) setView(v as Invoice); }}><Printer size={15} />Save & preview</button>
        <button className="btn primary" onClick={save}>Save</button></>}>
        <div className="form">
          <Field label="Customer"><select value={edit.customerId || ''} onChange={(e) => setEdit({ ...edit, customerId: e.target.value })}><option value="">— Select —</option>{db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Subject" span={2}><input value={edit.title || ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <Field label="Number"><input value={edit.number || ''} onChange={(e) => setEdit({ ...edit, number: e.target.value })} /></Field>
          <Field label="Date"><input type="date" value={edit.date || ''} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></Field>
          <Field label="Due date"><input type="date" value={edit.dueDate || ''} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} /></Field>
          <Field label="Linked job"><select value={edit.jobId || ''} onChange={(e) => setEdit({ ...edit, jobId: e.target.value })}><option value="">—</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>
          <Field label={`Amount paid (${s.currency})`}><input type="number" value={edit.paid || 0} onChange={(e) => setEdit({ ...edit, paid: +e.target.value })} /></Field>
          <div />
          <div className="section-title">Items</div>
          <LinesEditor doc={edit} set={(p) => setEdit({ ...edit, ...(p as Partial<Invoice>) })} s={s} />
          <Field label="Notes / bank details" span={3}><textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </div>
      </Modal>}
      {view && <Modal open wide title={view.number} onClose={() => setView(null)} footer={<><a className="btn" target="_blank" rel="noreferrer" href={share(view)}><MessageCircle size={15} />WhatsApp</a><span className="spacer" /><button className="btn" onClick={() => setView(null)}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print / Save PDF</button></>}>
        <DocView kind={Number(view.vat) > 0 ? 'TAX INVOICE' : 'INVOICE'} doc={view} s={s} customer={L.customer(view.customerId)} extra={<><div><span>Paid</span><span>{money(view.paid, s)}</span></div><div><b>Balance due</b><b>{money(invoiceBalance(view), s)}</b></div></>} />
        {view.notes && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{view.notes}</p>}
      </Modal>}
      {pay && <Modal open title={`Payment for ${pay.inv.number}`} onClose={() => setPay(null)} footer={<><button className="btn" onClick={() => setPay(null)}>Cancel</button><button className="btn primary" onClick={recordPayment}>Record payment</button></>}>
        <div className="form two">
          <Field label={`Amount (${s.currency})`}><input type="number" autoFocus value={pay.amount} onChange={(e) => setPay({ ...pay, amount: +e.target.value })} /></Field>
          <Field label="Method"><select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{['Cash', 'Bank', 'Card', 'Cheque', 'Online'].map((m) => <option key={m}>{m}</option>)}</select></Field>
          <p className="span-3 muted">Balance before payment: {money(invoiceBalance(pay.inv), s)}</p>
        </div>
      </Modal>}
    </>
  );
}
