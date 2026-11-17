import { useState } from 'react';
import { Plus, Trash2, Printer, PackageCheck, HandCoins, Truck, Phone, MessageCircle, Building2, Undo2, ScrollText } from 'lucide-react';
import { moveStock } from '../core/stock';
import { useUser } from '../core/session';
import { store, useDB, nextNumber, today, uid } from '../core/store';
import type { Purchase, PurchaseLine, Supplier } from '../core/types';
import { money, fmtDate, catOf } from '../core/calc';
import { lookup, waLink, daysFrom } from '../core/helpers';
import { Modal, Field, PageHeader, Tabs, Empty, Badge, Stat, SearchBox, toast, confirmDelete } from '../components/ui';
import { Letterhead, Bi, Signatures } from '../components/DocParts';

export const poTotal = (p: Pick<Purchase, 'lines' | 'vat'>) => { const sub = p.lines.reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0); return Math.round(sub * (1 + (Number(p.vat) || 0) / 100) * 1000) / 1000; };
/** Value of goods sent back, and money the supplier refunded for them. */
export const poReturned = (p: Pick<Purchase, 'returns'>) => (p.returns || []).reduce((n, r) => n + r.amount, 0);
const poRefunded = (p: Pick<Purchase, 'returns'>) => (p.returns || []).reduce((n, r) => n + (Number(r.refund) || 0), 0);
export const poDue = (p: Purchase) => (p.status === 'cancelled' ? 0 : Math.max(0, Math.round((poTotal(p) - poReturned(p) - (Number(p.paid) || 0) + poRefunded(p)) * 1000) / 1000));

export interface SupLine { date: string; ref: string; text: string; debit: number; credit: number }
/** Supplier ledger: bills (credit = we owe), payments and returns (debit). Positive balance = we owe them. */
export function supplierLedger(db: { purchases: Purchase[] }, supplierId: string): SupLine[] {
  const out: SupLine[] = [];
  for (const p of db.purchases.filter((x) => x.supplierId === supplierId && x.status !== 'cancelled')) {
    out.push({ date: p.receivedDate || p.date, ref: p.billNo || p.number, text: `Purchase ${p.number}${p.billNo ? ' · bill ' + p.billNo : ''}`, debit: 0, credit: poTotal(p) });
    const listed = (p.payments || []).reduce((n, x) => n + x.amount, 0);
    for (const x of p.payments || []) out.push({ date: x.date, ref: p.number, text: `Payment · ${x.method}${x.chequeNo ? ' ' + x.chequeNo : ''}`, debit: x.amount, credit: 0 });
    const rest = (Number(p.paid) || 0) - listed;
    if (rest > 0.0005) out.push({ date: p.date, ref: p.number, text: 'Payment recorded', debit: rest, credit: 0 });
    for (const r of p.returns || []) {
      out.push({ date: r.date, ref: p.number, text: `Goods returned${r.reason ? ' — ' + r.reason : ''}`, debit: r.amount, credit: 0 });
      if (r.refund) out.push({ date: r.date, ref: p.number, text: 'Refund received from supplier', debit: 0, credit: r.refund });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
const STATUS = { ordered: { label: 'Ordered', tone: 'blue' }, received: { label: 'Received', tone: 'green' }, cancelled: { label: 'Cancelled', tone: 'gray' } } as const;

export default function Purchases() {
  const db = useDB(); const s = db.settings; const L = lookup(db);
  const [tab, setTab] = useState<'orders' | 'suppliers'>('orders');
  const [q, setQ] = useState('');
  const [po, setPo] = useState<Partial<Purchase> | null>(null);
  const [sup, setSup] = useState<Partial<Supplier> | null>(null);
  const [view, setView] = useState<Purchase | null>(null);
  const user = useUser();
  const [ret, setRet] = useState<{ p: Purchase; qty: Record<string, number>; reason: string; refund: number; method: string } | null>(null);
  const [ledger, setLedger] = useState<Supplier | null>(null);
  const [pay, setPay] = useState<{ p: Purchase; amount: number; method: string; chequeNo?: string; chequeDate?: string; bank?: string } | null>(null);
  const supplier = (id?: string) => db.suppliers.find((x) => x.id === id);

  const blank = (): Partial<Purchase> => ({ number: nextNumber('PO', db.purchases.map((x) => x.number)), date: today(), status: 'ordered', vat: s.vatRate, paid: 0, lines: [{ id: uid(), description: '', qty: 1, unit: 'sheet', rate: 0 }] });
  const savePo = () => { if (!po?.supplierId) return toast('Choose a supplier'); const v = store.upsert('purchases', po as Purchase); setPo(null); toast('Purchase order saved'); return v as Purchase; };
  const receive = (p: Purchase) => {
    let n = 0;
    for (const l of p.lines) { if (l.itemId && L.item(l.itemId)) { moveStock(store.get(), { date: today(), itemId: l.itemId, kind: 'in', qty: Number(l.qty) || 0, cost: Number(l.rate) || undefined, purchaseId: p.id, note: `${p.number} — ${supplier(p.supplierId)?.name || ''}` }, user?.name); n++; } }
    store.upsert('purchases', { ...p, status: 'received', receivedDate: today() });
    toast(n ? `Received — ${n} stock item${n > 1 ? 's' : ''} updated` : 'Marked as received');
  };
  const recordPay = () => {
    if (!pay || pay.amount <= 0) return;
    if (pay.amount > poDue(pay.p) + 0.0005) return toast(`More than what is due (${money(poDue(pay.p), s)})`);
    if (pay.method === 'Cheque' && !pay.chequeNo?.trim()) return toast('Enter the cheque number');
    const cat = pay.p.lines.some((l) => /board|sheet|mdf|ply|acp|acrylic/i.test(l.description + (L.item(l.itemId)?.category || ''))) ? catOf(s, 'Wood and Plywood', 'Boards & Sheets') : /hinge|screw|handle|runner|hardware/i.test(pay.p.lines.map((l) => l.description).join(' ')) ? catOf(s, 'Hardware and Accessories', 'Hardware') : catOf(s, 'Materials');
    const t = store.upsert('txns', { date: today(), kind: 'expense', category: cat, amount: pay.amount, method: pay.method, description: `${pay.p.number} — ${supplier(pay.p.supplierId)?.name || 'Supplier'}`, ref: pay.p.billNo || pay.p.number, jobId: pay.p.jobId });
    store.upsert('purchases', { ...pay.p, paid: (Number(pay.p.paid) || 0) + pay.amount, payments: [...(pay.p.payments || []), { id: uid(), date: today(), amount: pay.amount, method: pay.method, txnId: t.id, chequeNo: pay.chequeNo }] });
    if (pay.method === 'Cheque') store.upsert('cheques', { direction: 'issued', chequeNo: pay.chequeNo!, bank: pay.bank, date: pay.chequeDate || today(), amount: pay.amount, party: supplier(pay.p.supplierId)?.name || 'Supplier', status: 'pending', purchaseId: pay.p.id, txnId: t.id, note: pay.p.number });
    setPay(null); toast('Supplier payment recorded in Accounts');
  };
  const doReturn = () => {
    if (!ret) return; const p = ret.p;
    const lines = p.lines.filter((l) => (ret.qty[l.id] || 0) > 0).map((l) => ({ lineId: l.id, qty: ret.qty[l.id] }));
    if (!lines.length) return toast('Enter the quantity sent back');
    for (const x of lines) { const l = p.lines.find((y) => y.id === x.lineId)!; const before = (p.returns || []).flatMap((r) => r.lines).filter((r) => r.lineId === l.id).reduce((n, r) => n + r.qty, 0); if (x.qty > l.qty - before + 1e-9) return toast(`Only ${l.qty - before} ${l.unit} of ${l.description} can be returned`); }
    const amount = +lines.reduce((n, x) => { const l = p.lines.find((y) => y.id === x.lineId)!; return n + x.qty * l.rate * (1 + (Number(p.vat) || 0) / 100); }, 0).toFixed(3);
    const overpaid = Math.max(0, (Number(p.paid) || 0) - (poTotal(p) - poReturned(p) - amount));
    const refund = Math.min(Number(ret.refund) || 0, overpaid + 1e-9);
    if (p.status === 'received') for (const x of lines) { const l = p.lines.find((y) => y.id === x.lineId)!; if (l.itemId) { const err = moveStock(store.get(), { date: today(), itemId: l.itemId, kind: 'return', qty: x.qty, purchaseId: p.id, note: `${p.number} — ${ret.reason || 'returned'}` }, user?.name); if (err) return toast(err); } }
    let txnId: string | undefined;
    if (refund > 0) txnId = store.upsert('txns', { date: today(), kind: 'income', category: 'Supplier refund', amount: refund, method: ret.method, description: `Refund for goods returned — ${p.number} ${supplier(p.supplierId)?.name || ''}`, ref: p.number, jobId: p.jobId }).id;
    store.upsert('purchases', { ...p, returns: [...(p.returns || []), { id: uid(), date: today(), lines, amount, reason: ret.reason || undefined, refund: refund || undefined, txnId }] });
    setRet(null); toast(`Return of ${money(amount, s)} recorded${refund ? `, refund ${money(refund, s)} in Accounts` : ''}`);
  };
  const setLine = (i: number, p: Partial<PurchaseLine>) => po && setPo({ ...po, lines: po.lines!.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  const orders = db.purchases.filter((p) => (p.number + (supplier(p.supplierId)?.name || '') + (p.billNo || '')).toLowerCase().includes(q.toLowerCase()));
  const totalDue = db.purchases.reduce((n, p) => n + poDue(p), 0);
  const open = db.purchases.filter((p) => p.status === 'ordered').length;
  const supDue = (id: string) => db.purchases.filter((p) => p.supplierId === id).reduce((n, p) => n + poDue(p), 0);

  return (
    <>
      <PageHeader title="Purchases" sub="Suppliers, purchase orders, goods received into stock and supplier payments."
        actions={<><Tabs value={tab} onChange={setTab} tabs={[{ id: 'orders', label: 'Purchase orders', count: db.purchases.length }, { id: 'suppliers', label: 'Suppliers', count: db.suppliers.length }]} />
          {tab === 'orders' ? <button className="btn primary" onClick={() => setPo(blank())}><Plus size={16} />New purchase order</button> : <button className="btn primary" onClick={() => setSup({})}><Plus size={16} />Add supplier</button>}</>} />
      <div className="grid g3 mb">
        <Stat label="To pay suppliers" value={money(totalDue, s)} icon={<HandCoins size={20} />} tone="red" />
        <Stat label="Orders waiting delivery" value={open} icon={<Truck size={20} />} tone="blue" />
        <Stat label="Suppliers" value={db.suppliers.length} icon={<Building2 size={20} />} tone="wood" />
      </div>
      {tab === 'orders' ? <>
        <div className="toolbar"><SearchBox value={q} onChange={setQ} placeholder="Search PO, supplier, bill no…" /></div>
        <div className="card">{orders.length ? <div className="table-wrap"><table>
          <thead><tr><th>PO</th><th>Supplier</th><th>Date</th><th>Status</th><th className="num">Total</th><th className="num">To pay</th><th /></tr></thead>
          <tbody>{orders.map((p) => { const due = poDue(p); const late = p.dueDate && due > 0 && (daysFrom(p.dueDate) ?? 1) < 0; return (
            <tr key={p.id} className="click" onClick={() => setPo(structuredClone(p))}>
              <td><b>{p.number}</b>{p.billNo && <div className="muted">Bill {p.billNo}</div>}</td><td>{supplier(p.supplierId)?.name}<div className="muted">{L.job(p.jobId)?.code || 'Workshop stock'}</div></td><td>{fmtDate(p.date)}</td>
              <td><Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>{late && <div><Badge tone="red">Overdue</Badge></div>}</td>
              <td className="num">{money(poTotal(p), s)}{poReturned(p) > 0 && <div className="muted">− {money(poReturned(p), s)} returned</div>}</td><td className={`num ${due > 0 ? 'neg' : ''}`}><b>{money(due, s)}</b></td>
              <td onClick={(e) => e.stopPropagation()}><div className="row-actions">
                {p.status === 'ordered' && <button className="icon-btn" title="Goods received" onClick={() => receive(p)}><PackageCheck size={16} /></button>}
                {p.status !== 'cancelled' && <button className="icon-btn" title="Return goods to supplier" onClick={() => setRet({ p, qty: {}, reason: '', refund: 0, method: 'Cash' })}><Undo2 size={16} /></button>}
                {due > 0 && <button className="icon-btn" title="Pay supplier" onClick={() => setPay({ p, amount: +due.toFixed(3), method: 'Cash' })}><HandCoins size={16} /></button>}
                <button className="icon-btn" title="Print" onClick={() => setView(p)}><Printer size={16} /></button>
              </div></td></tr>); })}</tbody></table></div> : <Empty title="No purchase orders" hint="Order boards, ACP, acrylic and hardware from your suppliers here." />}</div>
      </> : <div className="grid g3">
        {db.suppliers.map((x) => <div key={x.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setSup({ ...x })}>
          <div className="flex between"><b style={{ fontSize: 15 }}>{x.name}</b>{supDue(x.id) > 0 && <Badge tone="red">Owe {money(supDue(x.id), s)}</Badge>}</div>
          <div className="muted">{x.category || '—'}</div><div className="muted">{x.address}</div>
          <div className="flex" style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>{x.phone && <a className="icon-btn" href={`tel:${x.phone}`}><Phone size={16} /></a>}{x.phone && <a className="icon-btn" target="_blank" rel="noreferrer" href={waLink(x.phone, 'Hello, ')}><MessageCircle size={16} /></a>}<span className="muted">{db.purchases.filter((p) => p.supplierId === x.id).length} orders</span><span className="spacer" /><button className="btn sm" onClick={() => setLedger(x)}><ScrollText size={14} />Ledger</button></div>
          {x.vatNumber && <div className="muted" style={{ fontSize: 12 }}>VAT {x.vatNumber}</div>}
        </div>)}
        {!db.suppliers.length && <div className="card"><Empty title="No suppliers yet" /></div>}
      </div>}

      {po && <Modal open wide title={db.purchases.some((p) => p.id === po.id) ? `Purchase order ${po.number}` : 'New purchase order'} onClose={() => setPo(null)} footer={<>
        {po.id && <button className="btn danger ghost" onClick={() => {
          const cur = db.purchases.find((x) => x.id === po.id);
          if (cur && (Number(cur.paid) > 0 || cur.status === 'received')) return toast('This order was received or paid. Set its status to Cancelled instead of deleting it.');
          if (confirmDelete(po.number)) { store.remove('purchases', po.id!); setPo(null); } }}><Trash2 size={15} />Delete</button>}
        <span className="spacer" /><button className="btn" onClick={() => setPo(null)}>Cancel</button><button className="btn" onClick={() => { const v = savePo(); if (v) setView(v); }}><Printer size={15} />Save & print</button><button className="btn primary" onClick={savePo}>Save</button></>}>
        <div className="form">
          <Field label="Supplier"><select value={po.supplierId || ''} onChange={(e) => setPo({ ...po, supplierId: e.target.value })}><option value="">— Select —</option>{db.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label="PO number"><input value={po.number || ''} onChange={(e) => setPo({ ...po, number: e.target.value })} /></Field>
          <Field label="Date"><input type="date" value={po.date} onChange={(e) => setPo({ ...po, date: e.target.value })} /></Field>
          <Field label="For"><select value={po.jobId || ''} onChange={(e) => setPo({ ...po, jobId: e.target.value || undefined })}><option value="">General workshop stock</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>
          <Field label="Supplier bill / invoice no."><input value={po.billNo || ''} onChange={(e) => setPo({ ...po, billNo: e.target.value })} /></Field>
          <Field label="Payment due"><input type="date" value={po.dueDate || ''} onChange={(e) => setPo({ ...po, dueDate: e.target.value })} /></Field>
          <Field label="Status"><select value={po.status} onChange={(e) => setPo({ ...po, status: e.target.value as Purchase['status'] })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          <Field label="VAT %"><input type="number" value={po.vat ?? 0} onChange={(e) => setPo({ ...po, vat: +e.target.value })} /></Field>
          <Field label={`Paid so far (${s.currency})`}><input type="number" value={po.paid || 0} onChange={(e) => setPo({ ...po, paid: +e.target.value })} /></Field>
          <div className="section-title">Items — link to a stock item so “Goods received” adds it to Inventory</div>
          <div className="span-3"><div className="table-wrap" style={{ margin: 0 }}><table className="lines">
            <thead><tr><th>Stock item</th><th style={{ minWidth: 180 }}>Description</th><th style={{ width: 80 }}>Qty</th><th style={{ width: 80 }}>Unit</th><th style={{ width: 100 }}>Rate</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>{(po.lines || []).map((l, i) => <tr key={l.id}>
              <td><select value={l.itemId || ''} onChange={(e) => { const it = L.item(e.target.value); setLine(i, { itemId: e.target.value || undefined, description: it ? `${it.name} ${it.thickness || ''} ${it.size || ''}`.trim() : l.description, unit: it?.unit || l.unit, rate: it?.cost || l.rate }); }}><option value="">— not stocked —</option>{db.items.filter((x) => x.kind === 'material').map((x) => <option key={x.id} value={x.id}>{x.name} {x.thickness}</option>)}</select></td>
              <td><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
              <td><input type="number" value={l.qty} onChange={(e) => setLine(i, { qty: +e.target.value })} /></td>
              <td><input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} /></td>
              <td><input type="number" value={l.rate} onChange={(e) => setLine(i, { rate: +e.target.value })} /></td>
              <td className="num">{money(l.qty * l.rate, s)}</td>
              <td><button className="icon-btn" onClick={() => setPo({ ...po, lines: po.lines!.filter((_, k) => k !== i) })}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>
            <div className="flex between wrap" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => setPo({ ...po, lines: [...(po.lines || []), { id: uid(), description: '', qty: 1, unit: 'pcs', rate: 0 }] })}><Plus size={14} />Add item</button><b>Total {money(poTotal({ lines: po.lines || [], vat: po.vat || 0 }), s)}</b></div></div>
          <Field label="Notes" span={3}><textarea value={po.notes || ''} onChange={(e) => setPo({ ...po, notes: e.target.value })} /></Field>
        </div>
      </Modal>}

      {sup && <Modal open title={sup.id ? 'Edit supplier' : 'New supplier'} onClose={() => setSup(null)} footer={<>
        {sup.id && <button className="btn danger ghost" onClick={() => {
          const n = db.purchases.filter((x) => x.supplierId === sup.id).length;
          if (n) return toast(`${sup.name} has ${n} purchase order${n > 1 ? 's' : ''} and cannot be deleted.`);
          if (confirmDelete(sup.name)) { store.remove('suppliers', sup.id!); setSup(null); } }}><Trash2 size={15} />Delete</button>}
        <span className="spacer" /><button className="btn" onClick={() => setSup(null)}>Cancel</button><button className="btn primary" onClick={() => { if (!sup.name) return toast('Enter a name'); store.upsert('suppliers', sup as Supplier); setSup(null); toast('Supplier saved'); }}>Save</button></>}>
        <div className="form two">
          <Field label="Name" span={3}><input autoFocus value={sup.name || ''} onChange={(e) => setSup({ ...sup, name: e.target.value })} /></Field>
          <Field label="Phone"><input value={sup.phone || ''} onChange={(e) => setSup({ ...sup, phone: e.target.value })} /></Field>
          <Field label="Email"><input value={sup.email || ''} onChange={(e) => setSup({ ...sup, email: e.target.value })} /></Field>
          <Field label="Supplies"><input value={sup.category || ''} onChange={(e) => setSup({ ...sup, category: e.target.value })} placeholder="Boards, ACP, hardware…" /></Field>
          <Field label="VAT number"><input value={sup.vatNumber || ''} onChange={(e) => setSup({ ...sup, vatNumber: e.target.value })} /></Field>
          <Field label="Address" span={3}><input value={sup.address || ''} onChange={(e) => setSup({ ...sup, address: e.target.value })} /></Field>
          <Field label="Notes" span={3}><textarea value={sup.notes || ''} onChange={(e) => setSup({ ...sup, notes: e.target.value })} /></Field>
        </div>
      </Modal>}

      {pay && <Modal open title={`Pay ${supplier(pay.p.supplierId)?.name || 'supplier'} — ${pay.p.number}`} onClose={() => setPay(null)} footer={<><button className="btn" onClick={() => setPay(null)}>Cancel</button><button className="btn primary" onClick={recordPay}>Record payment</button></>}>
        <div className="form two">
          <Field label={`Amount (${s.currency})`}><input type="number" autoFocus value={pay.amount} onChange={(e) => setPay({ ...pay, amount: +e.target.value })} /></Field>
          <Field label="Method"><select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{['Cash', 'Cheque', 'Bank transfer', 'Card'].map((m) => <option key={m}>{m}</option>)}</select></Field>
          {pay.method === 'Cheque' && <Field label="Cheque number"><input value={pay.chequeNo || ''} onChange={(e) => setPay({ ...pay, chequeNo: e.target.value })} /></Field>}
          {pay.method === 'Cheque' && <Field label="Cheque date (PDC)"><input type="date" value={pay.chequeDate || today()} onChange={(e) => setPay({ ...pay, chequeDate: e.target.value })} /></Field>}
          {pay.method === 'Cheque' && <Field label="Bank"><input value={pay.bank || ''} onChange={(e) => setPay({ ...pay, bank: e.target.value })} /></Field>}
        </div>
      </Modal>}

      {ret && <Modal open title={`Return goods — ${ret.p.number}`} onClose={() => setRet(null)} footer={<><button className="btn" onClick={() => setRet(null)}>Cancel</button><button className="btn primary" onClick={doReturn}>Record return</button></>}>
        <div className="table-wrap"><table><thead><tr><th>Item</th><th className="num">Bought</th><th className="num">Already returned</th><th style={{ width: 110 }}>Return now</th></tr></thead>
          <tbody>{ret.p.lines.map((l) => { const done = (ret.p.returns || []).flatMap((r) => r.lines).filter((r) => r.lineId === l.id).reduce((n, r) => n + r.qty, 0); return <tr key={l.id}><td>{l.description}</td><td className="num">{l.qty} {l.unit}</td><td className="num">{done || '—'}</td>
            <td><input type="number" min={0} max={l.qty - done} value={ret.qty[l.id] || ''} onChange={(e) => setRet({ ...ret, qty: { ...ret.qty, [l.id]: +e.target.value } })} /></td></tr>; })}</tbody></table></div>
        <div className="form two" style={{ marginTop: 10 }}>
          <Field label="Reason" span={3}><input value={ret.reason} onChange={(e) => setRet({ ...ret, reason: e.target.value })} placeholder="Damaged, wrong size…" /></Field>
          <Field label={`Refund received (${s.currency})`}><input type="number" value={ret.refund || ''} onChange={(e) => setRet({ ...ret, refund: +e.target.value })} placeholder="0 = deduct from what we owe" /></Field>
          <Field label="Refund method"><select value={ret.method} onChange={(e) => setRet({ ...ret, method: e.target.value })}>{['Cash', 'Bank transfer', 'Cheque'].map((m) => <option key={m}>{m}</option>)}</select></Field>
        </div>
        <p className="muted">Received stock is taken out of Inventory. Without a refund, the value is deducted from what you owe this supplier.</p>
      </Modal>}
      {ledger && <SupplierLedger supplier={ledger} onClose={() => setLedger(null)} />}
      {view && <Modal open wide title={view.number} onClose={() => setView(null)} footer={<><span className="spacer" /><button className="btn" onClick={() => setView(null)}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print / Save PDF</button></>}>
        <div className="print-area"><div className="doc">
          <Letterhead s={s} title="PURCHASE ORDER" meta={<><div><b>{view.number}</b></div><div><Bi en="Date" inline />: {fmtDate(view.date)}</div></>} />
          <div style={{ marginBottom: 16 }}><div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase' }}><Bi en="Supplier" inline /></div><b>{supplier(view.supplierId)?.name}</b><div>{supplier(view.supplierId)?.address}</div><div>{supplier(view.supplierId)?.phone}</div></div>
          <table style={{ width: '100%' }}><thead><tr><th>#</th><th><Bi en="Description" /></th><th className="num"><Bi en="Qty" /></th><th><Bi en="Unit" /></th><th className="num"><Bi en="Rate" /></th><th className="num"><Bi en="Amount" /></th></tr></thead>
            <tbody>{view.lines.map((l, i) => <tr key={l.id}><td>{i + 1}</td><td>{l.description}</td><td className="num">{l.qty}</td><td>{l.unit}</td><td className="num">{money(l.rate, s)}</td><td className="num">{money(l.qty * l.rate, s)}</td></tr>)}</tbody></table>
          <div className="totals" style={{ marginTop: 14 }}><div className="grand"><span><Bi en="Total" inline /></span><span>{money(poTotal(view), s)}</span></div></div>
          {view.notes && <div className="doc-terms">{view.notes}</div>}
          <Signatures left="Authorised signature" right="Supplier" />
        </div></div>
      </Modal>}
    </>
  );
}

function SupplierLedger({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const db = useDB(); const s = db.settings; let run = 0;
  const lines = supplierLedger(db, supplier.id);
  const bal = lines.reduce((n, l) => n + l.credit - l.debit, 0);
  return (
    <Modal open wide title={`Supplier ledger — ${supplier.name}`} onClose={onClose} footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print / Save PDF</button></>}>
      <div className="print-area"><div className="doc">
        <Letterhead s={s} title="SUPPLIER STATEMENT" meta={<div>{fmtDate(today())}</div>} />
        <div style={{ marginBottom: 12 }}><b>{supplier.name}</b><div>{supplier.address}</div><div>{supplier.phone}{supplier.vatNumber ? ` · VAT ${supplier.vatNumber}` : ''}</div></div>
        <table style={{ width: '100%' }} className="statement"><thead><tr><th>Date</th><th>Ref</th><th>Details</th><th className="num">Paid / returned</th><th className="num">Billed</th><th className="num">We owe</th></tr></thead>
          <tbody>{lines.map((l, i) => { run += l.credit - l.debit; return <tr key={i}><td>{fmtDate(l.date)}</td><td>{l.ref}</td><td>{l.text}</td><td className="num">{l.debit ? money(l.debit, s) : ''}</td><td className="num">{l.credit ? money(l.credit, s) : ''}</td><td className="num">{money(run, s)}</td></tr>; })}
            {!lines.length && <tr><td colSpan={6} className="muted">No purchases yet</td></tr>}</tbody></table>
        <div className="totals" style={{ marginTop: 12 }}><div className="grand"><span>{bal >= 0 ? 'Balance we owe' : 'Supplier owes us'}</span><span>{money(Math.abs(bal), s)}</span></div></div>
      </div></div>
    </Modal>
  );
}
