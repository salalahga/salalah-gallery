import { useState } from 'react';
import { Plus, Trash2, Printer, PackageCheck, HandCoins, Truck, Phone, MessageCircle, Building2 } from 'lucide-react';
import { store, useDB, nextNumber, today, uid } from '../core/store';
import type { Purchase, PurchaseLine, Supplier } from '../core/types';
import { money, fmtDate } from '../core/calc';
import { lookup, waLink, daysFrom } from '../core/helpers';
import { Modal, Field, PageHeader, Tabs, Empty, Badge, Stat, SearchBox, toast, confirmDelete } from '../components/ui';
import { Letterhead, Bi, Signatures } from '../components/DocParts';

export const poTotal = (p: Pick<Purchase, 'lines' | 'vat'>) => { const sub = p.lines.reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0); return sub * (1 + (Number(p.vat) || 0) / 100); };
const poDue = (p: Purchase) => (p.status === 'cancelled' ? 0 : Math.max(0, poTotal(p) - (Number(p.paid) || 0)));
const STATUS = { ordered: { label: 'Ordered', tone: 'blue' }, received: { label: 'Received', tone: 'green' }, cancelled: { label: 'Cancelled', tone: 'gray' } } as const;

export default function Purchases() {
  const db = useDB(); const s = db.settings; const L = lookup(db);
  const [tab, setTab] = useState<'orders' | 'suppliers'>('orders');
  const [q, setQ] = useState('');
  const [po, setPo] = useState<Partial<Purchase> | null>(null);
  const [sup, setSup] = useState<Partial<Supplier> | null>(null);
  const [view, setView] = useState<Purchase | null>(null);
  const [pay, setPay] = useState<{ p: Purchase; amount: number; method: string } | null>(null);
  const supplier = (id?: string) => db.suppliers.find((x) => x.id === id);

  const blank = (): Partial<Purchase> => ({ number: nextNumber('PO', db.purchases.map((x) => x.number)), date: today(), status: 'ordered', vat: s.vatRate, paid: 0, lines: [{ id: uid(), description: '', qty: 1, unit: 'sheet', rate: 0 }] });
  const savePo = () => { if (!po?.supplierId) return toast('Choose a supplier'); const v = store.upsert('purchases', po as Purchase); setPo(null); toast('Purchase order saved'); return v as Purchase; };
  const receive = (p: Purchase) => {
    let n = 0;
    for (const l of p.lines) { const it = L.item(l.itemId); if (it) { store.upsert('items', { ...it, qty: it.qty + (Number(l.qty) || 0), cost: Number(l.rate) || it.cost }); n++; } }
    store.upsert('purchases', { ...p, status: 'received', receivedDate: today() });
    toast(n ? `Received — ${n} stock item${n > 1 ? 's' : ''} updated` : 'Marked as received');
  };
  const recordPay = () => {
    if (!pay || pay.amount <= 0) return;
    store.upsert('purchases', { ...pay.p, paid: (Number(pay.p.paid) || 0) + pay.amount });
    const cat = pay.p.lines.some((l) => /board|sheet|mdf|ply|acp|acrylic/i.test(l.description + (L.item(l.itemId)?.category || ''))) ? 'Boards & Sheets' : 'Materials';
    store.upsert('txns', { date: today(), kind: 'expense', category: cat, amount: pay.amount, method: pay.method, description: `${pay.p.number} — ${supplier(pay.p.supplierId)?.name || 'Supplier'}`, ref: pay.p.billNo || pay.p.number });
    setPay(null); toast('Supplier payment recorded in Accounts');
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
              <td><b>{p.number}</b>{p.billNo && <div className="muted">Bill {p.billNo}</div>}</td><td>{supplier(p.supplierId)?.name}<div className="muted">{L.job(p.jobId)?.code}</div></td><td>{fmtDate(p.date)}</td>
              <td><Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>{late && <div><Badge tone="red">Overdue</Badge></div>}</td>
              <td className="num">{money(poTotal(p), s)}</td><td className={`num ${due > 0 ? 'neg' : ''}`}><b>{money(due, s)}</b></td>
              <td onClick={(e) => e.stopPropagation()}><div className="row-actions">
                {p.status === 'ordered' && <button className="icon-btn" title="Goods received" onClick={() => receive(p)}><PackageCheck size={16} /></button>}
                {due > 0 && <button className="icon-btn" title="Pay supplier" onClick={() => setPay({ p, amount: +due.toFixed(3), method: 'Cash' })}><HandCoins size={16} /></button>}
                <button className="icon-btn" title="Print" onClick={() => setView(p)}><Printer size={16} /></button>
              </div></td></tr>); })}</tbody></table></div> : <Empty title="No purchase orders" hint="Order boards, ACP, acrylic and hardware from your suppliers here." />}</div>
      </> : <div className="grid g3">
        {db.suppliers.map((x) => <div key={x.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setSup({ ...x })}>
          <div className="flex between"><b style={{ fontSize: 15 }}>{x.name}</b>{supDue(x.id) > 0 && <Badge tone="red">Owe {money(supDue(x.id), s)}</Badge>}</div>
          <div className="muted">{x.category || '—'}</div><div className="muted">{x.address}</div>
          <div className="flex" style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>{x.phone && <a className="icon-btn" href={`tel:${x.phone}`}><Phone size={16} /></a>}{x.phone && <a className="icon-btn" target="_blank" rel="noreferrer" href={waLink(x.phone, 'Hello, ')}><MessageCircle size={16} /></a>}<span className="muted">{db.purchases.filter((p) => p.supplierId === x.id).length} orders</span></div>
        </div>)}
        {!db.suppliers.length && <div className="card"><Empty title="No suppliers yet" /></div>}
      </div>}

      {po && <Modal open wide title={db.purchases.some((p) => p.id === po.id) ? `Purchase order ${po.number}` : 'New purchase order'} onClose={() => setPo(null)} footer={<>
        {po.id && <button className="btn danger ghost" onClick={() => { if (confirmDelete(po.number)) { store.remove('purchases', po.id!); setPo(null); } }}><Trash2 size={15} />Delete</button>}
        <span className="spacer" /><button className="btn" onClick={() => setPo(null)}>Cancel</button><button className="btn" onClick={() => { const v = savePo(); if (v) setView(v); }}><Printer size={15} />Save & print</button><button className="btn primary" onClick={savePo}>Save</button></>}>
        <div className="form">
          <Field label="Supplier"><select value={po.supplierId || ''} onChange={(e) => setPo({ ...po, supplierId: e.target.value })}><option value="">— Select —</option>{db.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label="PO number"><input value={po.number || ''} onChange={(e) => setPo({ ...po, number: e.target.value })} /></Field>
          <Field label="Date"><input type="date" value={po.date} onChange={(e) => setPo({ ...po, date: e.target.value })} /></Field>
          <Field label="For job (optional)"><select value={po.jobId || ''} onChange={(e) => setPo({ ...po, jobId: e.target.value || undefined })}><option value="">—</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>
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
        {sup.id && <button className="btn danger ghost" onClick={() => { if (confirmDelete(sup.name)) { store.remove('suppliers', sup.id!); setSup(null); } }}><Trash2 size={15} />Delete</button>}
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
        </div>
      </Modal>}

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
