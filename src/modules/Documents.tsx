import { useEffect, useState } from 'react';
import { Plus, Printer, Trash2, MessageCircle, HandCoins, Truck, Ban, Landmark } from 'lucide-react';
import { voidReceipt, setChequeStatus } from '../core/ledger';
import { statusMeta, daysFrom } from '../core/helpers';
import { store, useDB, nextNumber, today, uid, advanceOpen } from '../core/store';
import { useRoute, go } from '../core/router';
import type { Delivery, Receipt, Settings, Customer, DB, Cheque, CreditNote, Invoice } from '../core/types';
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

export function CreditNotePrint({ c, s, customer, invoice }: { c: CreditNote; s: Settings; customer?: Customer; invoice?: Invoice }) {
  const vatPart = invoice && Number(invoice.vat) > 0 ? c.amount * Number(invoice.vat) / (100 + Number(invoice.vat)) : 0;
  return (
    <div className="print-area"><div className="doc">
      <Letterhead s={s} title={vatPart ? 'TAX CREDIT NOTE' : 'CREDIT NOTE'} meta={<><div><b>{c.number}</b></div><div><Bi en="Date" inline />: {fmtDate(c.date)}</div></>} />
      <table style={{ width: '100%' }} className="receipt-table"><tbody>
        <tr><td><Bi en="Customer" /></td><td><b>{customer?.name || '—'}</b>{customer?.address && <div>{customer.address}</div>}</td></tr>
        <tr><td><Bi en="Against invoice" /></td><td>{invoice ? `${invoice.number} · ${fmtDate(invoice.date)}` : '—'}</td></tr>
        <tr><td><Bi en="Reason" /></td><td>{c.reason}</td></tr>
        {vatPart > 0 && <tr><td><Bi en="Amount before VAT" /></td><td>{money(c.amount - vatPart, s)}</td></tr>}
        {vatPart > 0 && <tr><td><Bi en="VAT" /> {invoice!.vat}%</td><td>{money(vatPart, s)}</td></tr>}
        <tr><td><Bi en="Credit amount" /></td><td><b style={{ fontSize: 20 }}>{money(c.amount, s)}</b><div><i>{amountInWords(c.amount, s.currency)}</i></div></td></tr>
        {c.refund ? <tr><td><Bi en="Refunded" /></td><td>{money(c.refund, s)} · {c.method}</td></tr> : null}
      </tbody></table>
      <Signatures left="Authorised signature" right="Customer" />
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
  const [tab, setTab] = useState<'receipts' | 'deliveries' | 'cheques' | 'credits'>(params.delivery ? 'deliveries' : params.tab === 'cheques' ? 'cheques' : 'receipts');
  const [chq, setChq] = useState<Partial<Cheque> | null>(null);
  const [chqFilter, setChqFilter] = useState<'open' | 'all'>('open');
  const [cnView, setCnView] = useState<CreditNote | null>(null);
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
    if (params.tab === 'cheques') setTab('cheques');
    if (params.receipt || params.delivery || params.tab) go('documents');
  }, [params.receipt, params.delivery, params.tab]); // eslint-disable-line

  const saveReceipt = () => {
    if (!rEdit?.customerId || !(Number(rEdit.amount) > 0)) return toast('Choose the customer and enter the amount');
    if (rEdit.kind === 'payment' && !rEdit.invoiceId) return toast('Choose the invoice this payment is for');
    const inv = db.invoices.find((i) => i.id === rEdit.invoiceId);
    if (rEdit.kind === 'payment' && inv && Number(rEdit.amount) > invoiceBalance(inv) + 0.0005) return toast(`More than the invoice balance (${money(invoiceBalance(inv), s)}). Take the rest as an advance.`);
    if (rEdit.method === 'Cheque' && !rEdit.chequeNo?.trim()) return toast('Enter the cheque number');
    const r = issueReceipt(rEdit as Receipt); setREdit(null); setRView(r); toast('Receipt issued and recorded in Accounts');
  };
  const saveDelivery = () => {
    if (!dEdit?.customerId) return toast('Choose the customer');
    const d = store.upsert('deliveries', { ...dEdit, number: dEdit.number || nextNumber('DN', db.deliveries.map((x) => x.number)) } as Delivery) as Delivery;
    setDEdit(null); setDView(d); toast('Delivery note saved');
  };
  const custInvoices = db.invoices.filter((i) => i.customerId === rEdit?.customerId);
  const advOpen = db.receipts.filter((r) => r.kind === 'advance').reduce((n, r) => n + advanceOpen(r), 0);
  const saveCheque = () => {
    if (!chq?.chequeNo?.trim() || !(Number(chq.amount) > 0) || !chq.party?.trim()) return toast('Enter cheque number, party and amount');
    store.upsert('cheques', { status: 'pending', direction: 'issued', ...chq } as Cheque); setChq(null); toast('Cheque saved');
  };
  const moveCheque = (c: Cheque, st: Cheque['status']) => {
    const warn = st === 'bounced' ? (c.receiptId ? 'The receipt will be voided and the invoice will show as unpaid again.' : c.txnId ? 'The supplier payment will be reversed.' : '') : '';
    if ((st === 'bounced' || st === 'cancelled') && !window.confirm(`Mark cheque ${c.chequeNo} as ${st}? ${warn}`)) return;
    setChequeStatus(c, st); toast(`Cheque ${c.chequeNo} → ${statusMeta[st].label}`);
  };
  const chequesShown = db.cheques.filter((c) => chqFilter === 'all' || ['pending', 'deposited'].includes(c.status)).sort((a, b) => a.date.localeCompare(b.date));
  const month = today().slice(0, 7);

  return (
    <>
      <PageHeader title="Receipts & Delivery" sub="Advance receipts, payment receipts and delivery notes — printed in English and Arabic."
        actions={<><Tabs value={tab} onChange={setTab} tabs={[{ id: 'receipts', label: 'Receipts', count: db.receipts.length }, { id: 'cheques', label: 'Cheques', count: db.cheques.filter((c) => ['pending', 'deposited'].includes(c.status)).length }, { id: 'credits', label: 'Credit notes', count: db.creditNotes.length }, { id: 'deliveries', label: 'Delivery notes', count: db.deliveries.length }]} />
          {tab === 'receipts' ? <button className="btn primary" onClick={() => setREdit({ date: today(), kind: 'advance', method: 'Cash', amount: 0 })}><Plus size={16} />New receipt</button>
            : tab === 'cheques' ? <button className="btn primary" onClick={() => setChq({ direction: 'issued', date: today(), status: 'pending' })}><Plus size={16} />Add cheque</button>
            : tab === 'deliveries' ? <button className="btn primary" onClick={() => setDEdit({ date: today(), lines: [{ id: uid(), description: '', qty: 1, unit: 'pcs' }] })}><Plus size={16} />New delivery note</button> : null}</>} />
      {tab === 'receipts' ? <>
        <div className="grid g3 mb">
          <Stat label="Received this month" value={money(db.receipts.filter((r) => !r.voided && r.date.startsWith(month)).reduce((n, r) => n + r.amount, 0), s)} icon={<HandCoins size={20} />} tone="green" />
          <Stat label="Advances not yet invoiced" value={money(advOpen, s)} icon={<HandCoins size={20} />} tone="wood" sub="deducted automatically when you invoice the job" />
          <Stat label="Receipts issued" value={db.receipts.length} icon={<Printer size={20} />} tone="blue" />
        </div>
        <div className="card">{db.receipts.length ? <div className="table-wrap"><table>
          <thead><tr><th>Number</th><th>Date</th><th>Customer</th><th>Type</th><th>Against</th><th>Method</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>{db.receipts.map((r) => <tr key={r.id} className="click" onClick={() => setRView(r)} style={r.voided ? { opacity: .55 } : undefined}>
            <td><b style={r.voided ? { textDecoration: 'line-through' } : undefined}>{r.number}</b>{r.voided && <div><Badge tone="red">Void</Badge></div>}</td><td>{fmtDate(r.date)}</td><td>{L.customer(r.customerId)?.name}</td>
            <td><Badge tone={r.kind === 'advance' ? 'amber' : 'green'}>{r.kind}</Badge>{r.kind === 'advance' && r.invoiceId && <div className="muted">{advanceOpen(r) > 0.0005 ? `${money(advanceOpen(r), s)} not yet invoiced` : 'credited to invoice'}</div>}</td>
            <td className="muted">{againstLabel(db, r) || '—'}</td><td>{r.method}</td><td className="num"><b>{money(r.amount, s)}</b></td>
            <td><Printer size={15} /></td></tr>)}</tbody></table></div> : <Empty title="No receipts yet" hint="Issue an advance receipt from a job or quotation, or a payment receipt from an invoice." />}</div>
      </> : tab === 'cheques' ? <>
        <div className="grid g3 mb">
          <Stat label="To receive (not cleared)" value={money(db.cheques.filter((c) => c.direction === 'received' && ['pending', 'deposited'].includes(c.status)).reduce((n, c) => n + c.amount, 0), s)} icon={<Landmark size={20} />} tone="green" />
          <Stat label="We issued (not cleared)" value={money(db.cheques.filter((c) => c.direction === 'issued' && ['pending', 'deposited'].includes(c.status)).reduce((n, c) => n + c.amount, 0), s)} icon={<Landmark size={20} />} tone="red" />
          <Stat label="Due in the next 7 days" value={db.cheques.filter((c) => ['pending', 'deposited'].includes(c.status) && (daysFrom(c.date) ?? 99) <= 7).length} icon={<HandCoins size={20} />} tone="wood" />
        </div>
        <div className="toolbar"><Tabs value={chqFilter} onChange={setChqFilter} tabs={[{ id: 'open', label: 'Not cleared' }, { id: 'all', label: 'All cheques', count: db.cheques.length }]} /></div>
        <div className="card">{chequesShown.length ? <div className="table-wrap"><table>
          <thead><tr><th>Cheque date</th><th>No. / bank</th><th>Party</th><th>Type</th><th>Status</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>{chequesShown.map((c) => { const dd = daysFrom(c.date) ?? 0; const open = ['pending', 'deposited'].includes(c.status); return <tr key={c.id}>
            <td>{fmtDate(c.date)}{open && <div><Badge tone={dd < 0 ? 'red' : dd <= 3 ? 'amber' : 'gray'}>{dd < 0 ? `${-dd}d past` : dd === 0 ? 'Today' : `in ${dd}d`}</Badge></div>}</td>
            <td><b>{c.chequeNo}</b><div className="muted">{c.bank}</div></td><td>{c.party}<div className="muted">{c.note}</div></td>
            <td><Badge tone={c.direction === 'received' ? 'green' : 'gray'}>{c.direction === 'received' ? 'Received' : 'Issued'}</Badge></td>
            <td><Badge tone={statusMeta[c.status].tone}>{statusMeta[c.status].label}</Badge>{c.statusDate && !open && <div className="muted">{fmtDate(c.statusDate)}</div>}</td>
            <td className="num"><b>{money(c.amount, s)}</b></td>
            <td>{open && <div className="row-actions">
              {c.status === 'pending' && c.direction === 'received' && <button className="btn sm" onClick={() => moveCheque(c, 'deposited')}>Deposited</button>}
              <button className="btn sm" onClick={() => moveCheque(c, 'cleared')}>Cleared</button>
              <button className="btn sm danger ghost" onClick={() => moveCheque(c, 'bounced')}>Bounced</button>
            </div>}</td></tr>; })}</tbody></table></div>
          : <Empty title="No cheques to follow up" hint="Cheques taken on receipts and supplier payments appear here until they clear." />}</div>
      </> : tab === 'credits' ? <div className="card">{db.creditNotes.length ? <div className="table-wrap"><table>
        <thead><tr><th>Number</th><th>Date</th><th>Customer</th><th>Invoice</th><th>Reason</th><th className="num">Refunded</th><th className="num">Amount</th></tr></thead>
        <tbody>{db.creditNotes.map((c) => <tr key={c.id} className="click" onClick={() => setCnView(c)}><td><b>{c.number}</b></td><td>{fmtDate(c.date)}</td><td>{L.customer(c.customerId)?.name}</td><td>{db.invoices.find((i) => i.id === c.invoiceId)?.number}</td><td className="muted">{c.reason}</td><td className="num">{c.refund ? money(c.refund, s) : '—'}</td><td className="num"><b>{money(c.amount, s)}</b></td></tr>)}</tbody></table></div>
        : <Empty title="No credit notes" hint="Open an invoice and press Credit note to reduce what the customer owes or to refund." />}</div>
      : <div className="card">{db.deliveries.length ? <div className="table-wrap"><table>
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
          {rEdit.method === 'Cheque' && <Field label="Cheque date (PDC)"><input type="date" value={rEdit.chequeDate || rEdit.date} onChange={(e) => setREdit({ ...rEdit, chequeDate: e.target.value })} /></Field>}
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

      {rView && <Modal open wide title={rView.voided ? `${rView.number} — VOID` : rView.number} onClose={() => setRView(null)} footer={<>
        {!rView.voided && <button className="btn danger ghost" onClick={() => {
          const reason = window.prompt(`Void receipt ${rView.number}? Its ${money(rView.amount, s)} is removed from Accounts${rView.invoiceId ? ' and the invoice shows as owing again' : ''}.\n\nReason:`, 'Entered by mistake');
          if (reason === null) return; const err = voidReceipt(rView, reason || 'Void'); if (err) return toast(err); setRView(null); toast('Receipt voided'); }}><Ban size={15} />Void</button>}
        {rView.voided && <span className="muted">Voided {fmtDate(rView.voidedAt)} — {rView.voidReason}</span>}
        {L.customer(rView.customerId)?.phone && <a className="btn" target="_blank" rel="noreferrer" href={waLink(L.customer(rView.customerId)!.phone, `Dear ${L.customer(rView.customerId)!.name}, we received ${money(rView.amount, s)} (${rView.method}) — receipt ${rView.number}. Thank you! — ${s.businessName}`)}><MessageCircle size={15} />WhatsApp</a>}
        <span className="spacer" /><button className="btn" onClick={() => setRView(null)}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print / Save PDF</button></>}>
        <ReceiptPrint r={rView} s={s} customer={L.customer(rView.customerId)} against={againstLabel(db, rView)} />
      </Modal>}
      {chq && <Modal open title="Cheque" onClose={() => setChq(null)} footer={<><button className="btn" onClick={() => setChq(null)}>Cancel</button><button className="btn primary" onClick={saveCheque}>Save</button></>}>
        <div className="form two">
          <Field label="Type"><select value={chq.direction} onChange={(e) => setChq({ ...chq, direction: e.target.value as Cheque['direction'] })}><option value="issued">We issued (rent, supplier…)</option><option value="received">We received</option></select></Field>
          <Field label="Cheque date"><input type="date" value={chq.date} onChange={(e) => setChq({ ...chq, date: e.target.value })} /></Field>
          <Field label="Cheque number"><input value={chq.chequeNo || ''} onChange={(e) => setChq({ ...chq, chequeNo: e.target.value })} /></Field>
          <Field label="Bank"><input value={chq.bank || ''} onChange={(e) => setChq({ ...chq, bank: e.target.value })} /></Field>
          <Field label={chq.direction === 'received' ? 'From' : 'Pay to'}><input value={chq.party || ''} onChange={(e) => setChq({ ...chq, party: e.target.value })} /></Field>
          <Field label={`Amount (${s.currency})`}><input type="number" value={chq.amount || ''} onChange={(e) => setChq({ ...chq, amount: +e.target.value })} /></Field>
          <Field label="Note" span={3}><input value={chq.note || ''} onChange={(e) => setChq({ ...chq, note: e.target.value })} /></Field>
          <p className="span-3 muted">Only for tracking the date. Record the money itself as a receipt, supplier payment or expense.</p>
        </div>
      </Modal>}
      {cnView && <Modal open wide title={cnView.number} onClose={() => setCnView(null)} footer={<><span className="spacer" /><button className="btn" onClick={() => setCnView(null)}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print</button></>}>
        <CreditNotePrint c={cnView} s={s} customer={L.customer(cnView.customerId)} invoice={db.invoices.find((i) => i.id === cnView.invoiceId)} />
      </Modal>}
      {dView && <Modal open wide title={dView.number} onClose={() => setDView(null)} footer={<><span className="spacer" /><button className="btn" onClick={() => setDView(null)}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print / Save PDF</button></>}>
        <DeliveryPrint d={dView} s={s} customer={L.customer(dView.customerId)} />
      </Modal>}
    </>
  );
}
