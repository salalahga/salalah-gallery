import { useEffect, useState } from 'react';
import { Plus, Printer, Trash2, MessageCircle, HandCoins, Truck } from 'lucide-react';
import { store, useDB, nextNumber, today, uid } from '../core/store';
import { useRoute, go } from '../core/router';
import type { Delivery, Receipt, Settings, Customer, DB } from '../core/types';
import { money, fmtDate, amountInWords, docTotals, invoiceBalance } from '../core/calc';
import { lookup, waLink } from '../core/helpers';
import { issueReceipt } from '../core/receipts';
import { Modal, Field, PageHeader, Tabs, Empty, Badge, Stat, toast, confirmDelete } from '../components/ui';
import { Letterhead, Bi, Signatures } from '../components/DocParts';

const METHODS = ['Cash', 'Cheque', 'Bank transfer', 'Card', 'Online'];

export function ReceiptPrint({ r, s, customer, against }: { r: Receipt; s: Settings; customer?: Customer; against?: string }) {
  return (
    <div className="print-area"><div className="doc">
      <Letterhead s={s} title={r.kind === 'advance' ? 'ADVANCE RECEIPT' : 'RECEIPT'} meta={<><div><b>{r.number}</b></div><div><Bi en="Date" inline />: {fmtDate(r.date)}</div></>} />
      <table style={{ width: '100%' }} className="receipt-table"><tbody>
        <tr><td><Bi en="Received from" /></td><td><b>{customer?.name || '—'}</b></td></tr>
        <tr><td><Bi en="Amount" /></td><td><b style={{ fontSize: 20 }}>{money(r.amount, s)}</b></td></tr>
        <tr><td><Bi en="Amount in words" /></td><td><i>{amountInWords(r.amount, s.currency)}</i></td></tr>
        <tr><td><Bi en="Payment method" /></td><td>{r.method}{r.chequeNo ? ` · Cheque no. ${r.chequeNo}` : ''}</td></tr>
        {against && <tr><td><Bi en="Against" /></td><td>{against}</td></tr>}
        {r.note && <tr><td><Bi en="Ref" /></td><td>{r.note}</td></tr>}
      </tbody></table>
      <Signatures left="Authorised signature" right="Received by" />
    </div></div>
  );
}

export function DeliveryPrint({ d, s, customer }: { d: Delivery; s: Settings; customer?: Customer }) {
  return (
    <div className="print-area"><div className="doc">
      <Letterhead s={s} title="DELIVERY NOTE" meta={<><div><b>{d.number}</b></div><div><Bi en="Date" inline />: {fmtDate(d.date)}</div></>} />
      <div style={{ marginBottom: 16 }}><div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase' }}><Bi en="Deliver to" inline /></div><b>{customer?.name || '—'}</b><div>{d.address || customer?.address}</div><div>{customer?.phone}</div></div>
      <table style={{ width: '100%' }}><thead><tr><th>#</th><th><Bi en="Description" /></th><th className="num"><Bi en="Qty" /></th><th><Bi en="Unit" /></th></tr></thead>
        <tbody>{d.lines.map((l, i) => <tr key={l.id}><td>{i + 1}</td><td>{l.description}</td><td className="num">{l.qty}</td><td>{l.unit}</td></tr>)}</tbody></table>
      <p style={{ marginTop: 14 }}>{d.deliveredBy && <><Bi en="Delivered by" inline />: <b>{d.deliveredBy}</b>   </>}{d.vehicle && <><Bi en="Vehicle" inline />: {d.vehicle}</>}</p>
      {d.notes && <div className="doc-terms">{d.notes}</div>}
      <p className="doc-words"><Bi en="Received in good condition" inline /> ☐</p>
      <Signatures left="Delivered by" right="Received by" />
    </div></div>
  );
}

const againstLabel = (db: DB, r: Partial<Receipt>) => {
  const L = lookup(db);
  const inv = db.invoices.find((i) => i.id === r.invoiceId); const q = db.quotations.find((x) => x.id === r.quotationId); const j = L.job(r.jobId);
  return [inv && `Invoice ${inv.number}`, q && `Quotation ${q.number}`, j && `${j.code} ${j.title}`].filter(Boolean).join(' · ');
};

export default function Documents() {
  const db = useDB(); const s = db.settings; const L = lookup(db); const { params } = useRoute();
  const [tab, setTab] = useState<'receipts' | 'deliveries'>(params.delivery ? 'deliveries' : 'receipts');
  const [rEdit, setREdit] = useState<Partial<Receipt> | null>(null);
  const [dEdit, setDEdit] = useState<Partial<Delivery> | null>(null);
  const [rView, setRView] = useState<Receipt | null>(null);
  const [dView, setDView] = useState<Delivery | null>(null);

  useEffect(() => {
    if (params.receipt) {
      const j = L.job(params.job); const q = db.quotations.find((x) => x.id === params.quotation); const inv = db.invoices.find((x) => x.id === params.invoice);
      setTab('receipts');
      setREdit({ date: today(), kind: inv ? 'payment' : 'advance', method: 'Cash', jobId: j?.id || q?.jobId || inv?.jobId, quotationId: q?.id || j?.quotationId, invoiceId: inv?.id,
        customerId: j?.customerId || q?.customerId || inv?.customerId, amount: inv ? +invoiceBalance(inv).toFixed(3) : q ? +(docTotals(q).total / 2).toFixed(3) : j?.value ? +(j.value / 2).toFixed(3) : 0 });
    }
    if (params.delivery) {
      const j = L.job(params.job); const inv = db.invoices.find((x) => x.id === (params.invoice || db.invoices.find((i) => i.jobId === params.job)?.id));
      setTab('deliveries');
      setDEdit({ date: today(), jobId: j?.id || inv?.jobId, invoiceId: inv?.id, customerId: j?.customerId || inv?.customerId, address: j?.details?.['Site address'] || L.customer(j?.customerId || inv?.customerId)?.address,
        lines: inv ? inv.items.map((l) => ({ id: uid(), description: l.description, qty: l.qty, unit: l.unit })) : [{ id: uid(), description: j?.title || '', qty: 1, unit: 'lot' }] });
    }
    if (params.receipt || params.delivery) go('documents');
  }, [params.receipt, params.delivery]); // eslint-disable-line

  const saveReceipt = () => {
    if (!rEdit?.customerId || !(Number(rEdit.amount) > 0)) return toast('Choose the customer and enter the amount');
    if (rEdit.kind === 'payment' && !rEdit.invoiceId) return toast('Choose the invoice this payment is for');
    const r = issueReceipt(rEdit as Receipt); setREdit(null); setRView(r); toast('Receipt issued and recorded in Accounts');
  };
  const saveDelivery = () => {
    if (!dEdit?.customerId) return toast('Choose the customer');
    const d = store.upsert('deliveries', { ...dEdit, number: dEdit.number || nextNumber('DN', db.deliveries.map((x) => x.number)) } as Delivery) as Delivery;
    setDEdit(null); setDView(d); toast('Delivery note saved');
  };
  const custInvoices = db.invoices.filter((i) => i.customerId === rEdit?.customerId);
  const advOpen = db.receipts.filter((r) => r.kind === 'advance' && !r.invoiceId).reduce((n, r) => n + r.amount, 0);
  const month = today().slice(0, 7);

  return (
    <>
      <PageHeader title="Receipts & Delivery" sub="Advance receipts, payment receipts and delivery notes — printed in English and Arabic."
        actions={<><Tabs value={tab} onChange={setTab} tabs={[{ id: 'receipts', label: 'Receipts', count: db.receipts.length }, { id: 'deliveries', label: 'Delivery notes', count: db.deliveries.length }]} />
          {tab === 'receipts' ? <button className="btn primary" onClick={() => setREdit({ date: today(), kind: 'advance', method: 'Cash', amount: 0 })}><Plus size={16} />New receipt</button>
            : <button className="btn primary" onClick={() => setDEdit({ date: today(), lines: [{ id: uid(), description: '', qty: 1, unit: 'pcs' }] })}><Plus size={16} />New delivery note</button>}</>} />
      {tab === 'receipts' ? <>
        <div className="grid g3 mb">
          <Stat label="Received this month" value={money(db.receipts.filter((r) => r.date.startsWith(month)).reduce((n, r) => n + r.amount, 0), s)} icon={<HandCoins size={20} />} tone="green" />
          <Stat label="Advances not yet invoiced" value={money(advOpen, s)} icon={<HandCoins size={20} />} tone="wood" sub="deducted automatically when you invoice the job" />
          <Stat label="Receipts issued" value={db.receipts.length} icon={<Printer size={20} />} tone="blue" />
        </div>
        <div className="card">{db.receipts.length ? <div className="table-wrap"><table>
          <thead><tr><th>Number</th><th>Date</th><th>Customer</th><th>Type</th><th>Against</th><th>Method</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>{db.receipts.map((r) => <tr key={r.id} className="click" onClick={() => setRView(r)}>
            <td><b>{r.number}</b></td><td>{fmtDate(r.date)}</td><td>{L.customer(r.customerId)?.name}</td>
            <td><Badge tone={r.kind === 'advance' ? 'amber' : 'green'}>{r.kind}</Badge>{r.kind === 'advance' && r.invoiceId && <div className="muted">credited to invoice</div>}</td>
            <td className="muted">{againstLabel(db, r) || '—'}</td><td>{r.method}</td><td className="num"><b>{money(r.amount, s)}</b></td>
            <td><Printer size={15} /></td></tr>)}</tbody></table></div> : <Empty title="No receipts yet" hint="Issue an advance receipt from a job or quotation, or a payment receipt from an invoice." />}</div>
      </> : <div className="card">{db.deliveries.length ? <div className="table-wrap"><table>
        <thead><tr><th>Number</th><th>Date</th><th>Customer</th><th>Items</th><th>Delivered by</th><th /></tr></thead>
        <tbody>{db.deliveries.map((d) => <tr key={d.id} className="click" onClick={() => setDView(d)}>
          <td><b>{d.number}</b></td><td>{fmtDate(d.date)}</td><td>{L.customer(d.customerId)?.name}<div className="muted">{L.job(d.jobId)?.code}</div></td>
          <td className="muted">{d.lines.map((l) => `${l.qty} ${l.unit} ${l.description}`).join(', ')}</td><td>{d.deliveredBy}</td>
          <td onClick={(e) => e.stopPropagation()}><div className="row-actions"><button className="icon-btn" onClick={() => setDEdit(structuredClone(d))}>Edit</button></div></td></tr>)}</tbody></table></div>
        : <Empty title="No delivery notes yet" hint="Create one from a job or an invoice, or press New delivery note." />}</div>}

      {rEdit && <Modal open title="New receipt" onClose={() => setREdit(null)} footer={<><button className="btn" onClick={() => setREdit(null)}>Cancel</button><button className="btn primary" onClick={saveReceipt}><Printer size={15} />Issue & print</button></>}>
        <div className="form two">
          <Field label="Type"><select value={rEdit.kind} onChange={(e) => setREdit({ ...rEdit, kind: e.target.value as Receipt['kind'] })}><option value="advance">Advance (before invoice)</option><option value="payment">Payment against an invoice</option></select></Field>
          <Field label="Date"><input type="date" value={rEdit.date} onChange={(e) => setREdit({ ...rEdit, date: e.target.value })} /></Field>
          <Field label="Customer"><select value={rEdit.customerId || ''} onChange={(e) => setREdit({ ...rEdit, customerId: e.target.value, invoiceId: undefined })}><option value="">— Select —</option>{db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          {rEdit.kind === 'payment'
            ? <Field label="Invoice"><select value={rEdit.invoiceId || ''} onChange={(e) => { const inv = db.invoices.find((i) => i.id === e.target.value); setREdit({ ...rEdit, invoiceId: e.target.value, amount: inv ? +invoiceBalance(inv).toFixed(3) : rEdit.amount }); }}><option value="">— Select —</option>{custInvoices.map((i) => <option key={i.id} value={i.id}>{i.number} · due {money(invoiceBalance(i), s)}</option>)}</select></Field>
            : <Field label="For job"><select value={rEdit.jobId || ''} onChange={(e) => setREdit({ ...rEdit, jobId: e.target.value || undefined })}><option value="">—</option>{db.jobs.filter((j) => !rEdit.customerId || j.customerId === rEdit.customerId).map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>}
          <Field label={`Amount (${s.currency})`}><input type="number" value={rEdit.amount || ''} onChange={(e) => setREdit({ ...rEdit, amount: +e.target.value })} /></Field>
          <Field label="Method"><select value={rEdit.method} onChange={(e) => setREdit({ ...rEdit, method: e.target.value })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
          {rEdit.method === 'Cheque' && <Field label="Cheque no. / bank"><input value={rEdit.chequeNo || ''} onChange={(e) => setREdit({ ...rEdit, chequeNo: e.target.value })} /></Field>}
          <Field label="Note"><input value={rEdit.note || ''} onChange={(e) => setREdit({ ...rEdit, note: e.target.value })} /></Field>
          {Number(rEdit.amount) > 0 && <p className="span-3 muted">{amountInWords(Number(rEdit.amount), s.currency)}{rEdit.kind === 'advance' && ' · This advance will be shown as paid when you create the invoice for this job/quotation.'}</p>}
        </div>
      </Modal>}

      {dEdit && <Modal open wide title={dEdit.id ? `Delivery note ${dEdit.number}` : 'New delivery note'} onClose={() => setDEdit(null)} footer={<>
        {dEdit.id && <button className="btn danger ghost" onClick={() => { if (confirmDelete(dEdit.number)) { store.remove('deliveries', dEdit.id!); setDEdit(null); } }}><Trash2 size={15} />Delete</button>}
        <span className="spacer" /><button className="btn" onClick={() => setDEdit(null)}>Cancel</button><button className="btn primary" onClick={saveDelivery}><Truck size={15} />Save & print</button></>}>
        <div className="form">
          <Field label="Customer"><select value={dEdit.customerId || ''} onChange={(e) => setDEdit({ ...dEdit, customerId: e.target.value })}><option value="">— Select —</option>{db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Date"><input type="date" value={dEdit.date} onChange={(e) => setDEdit({ ...dEdit, date: e.target.value })} /></Field>
          <Field label="Job"><select value={dEdit.jobId || ''} onChange={(e) => setDEdit({ ...dEdit, jobId: e.target.value || undefined })}><option value="">—</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>
          <Field label="Delivery address" span={2}><input value={dEdit.address || ''} onChange={(e) => setDEdit({ ...dEdit, address: e.target.value })} /></Field>
          <Field label="Delivered by"><select value={dEdit.deliveredBy || ''} onChange={(e) => setDEdit({ ...dEdit, deliveredBy: e.target.value })}><option value="">—</option>{db.staff.filter((x) => x.active).map((x) => <option key={x.id}>{x.name}</option>)}</select></Field>
          <Field label="Vehicle"><input value={dEdit.vehicle || ''} onChange={(e) => setDEdit({ ...dEdit, vehicle: e.target.value })} placeholder="e.g. Pickup 1234 AB" /></Field>
          <div className="section-title">Items</div>
          <div className="span-3">{(dEdit.lines || []).map((l, i) => { const upd = (p: object) => setDEdit({ ...dEdit, lines: dEdit.lines!.map((x, k) => (k === i ? { ...x, ...p } : x)) }); return (
            <div key={l.id} className="flex" style={{ marginBottom: 6 }}><input value={l.description} placeholder="Description" onChange={(e) => upd({ description: e.target.value })} /><input type="number" style={{ width: 90 }} value={l.qty} onChange={(e) => upd({ qty: +e.target.value })} /><input style={{ width: 80 }} value={l.unit} onChange={(e) => upd({ unit: e.target.value })} /><button className="icon-btn" onClick={() => setDEdit({ ...dEdit, lines: dEdit.lines!.filter((_, k) => k !== i) })}><Trash2 size={14} /></button></div>); })}
            <button className="btn sm" onClick={() => setDEdit({ ...dEdit, lines: [...(dEdit.lines || []), { id: uid(), description: '', qty: 1, unit: 'pcs' }] })}><Plus size={14} />Add item</button></div>
          <Field label="Notes" span={3}><textarea value={dEdit.notes || ''} onChange={(e) => setDEdit({ ...dEdit, notes: e.target.value })} /></Field>
        </div>
      </Modal>}

      {rView && <Modal open wide title={rView.number} onClose={() => setRView(null)} footer={<>
        {L.customer(rView.customerId)?.phone && <a className="btn" target="_blank" rel="noreferrer" href={waLink(L.customer(rView.customerId)!.phone, `Dear ${L.customer(rView.customerId)!.name}, we received ${money(rView.amount, s)} (${rView.method}) — receipt ${rView.number}. Thank you! — ${s.businessName}`)}><MessageCircle size={15} />WhatsApp</a>}
        <span className="spacer" /><button className="btn" onClick={() => setRView(null)}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print / Save PDF</button></>}>
        <ReceiptPrint r={rView} s={s} customer={L.customer(rView.customerId)} against={againstLabel(db, rView)} />
      </Modal>}
      {dView && <Modal open wide title={dView.number} onClose={() => setDView(null)} footer={<><span className="spacer" /><button className="btn" onClick={() => setDView(null)}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print / Save PDF</button></>}>
        <DeliveryPrint d={dView} s={s} customer={L.customer(dView.customerId)} />
      </Modal>}
    </>
  );
}
