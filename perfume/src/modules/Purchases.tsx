import { useState } from 'react';
import { api, qs } from '../core/api';
import { t } from '../core/i18n';
import { money, parseMoney, useSession, variantName, date, today } from '../core/session';
import { LabelPrinter, type LabelItem } from '../components/Labels';
import { ScanBox, useScanner, beep } from '../core/scanner';
import { Card, Empty, Field, Loading, Modal, PageHead, Status, Tabs, TestBadge, useAction, useData, download } from '../components/ui';

type Tab = 'orders' | 'bills' | 'suppliers';

export default function Purchases() {
  const [tab, setTab] = useState<Tab>('orders');
  return (
    <>
      <PageHead title={t('Purchases')} sub="Purchase orders → approval → goods received (stock + supplier bill) → payment" />
      <Tabs tabs={[['orders', 'Purchase orders'], ['bills', 'Supplier bills'], ['suppliers', t('Suppliers')]]} value={tab} onChange={setTab} />
      {tab === 'orders' && <Orders />}
      {tab === 'bills' && <Bills />}
      {tab === 'suppliers' && <Suppliers />}
    </>
  );
}

function Orders() {
  const { can } = useSession();
  const [status, setStatus] = useState('');
  const { data, reload } = useData<any[]>('/purchase-orders' + qs({ status }), [status]);
  const [open, setOpen] = useState<string | 'new' | null>(null);
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="pill-group">{[['', 'All'], ['draft', 'Draft'], ['pending_approval', 'Waiting approval'], ['approved', 'Approved'], ['partially_received', 'Part received'], ['received', 'Received']].map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <div className="grow" />{can('purchases', 'create') && <button className="btn primary" onClick={() => setOpen('new')}>+ Purchase order</button>}
      </div>
      <div className="card tablewrap">{!data ? <Loading /> : !data.length ? <Empty>No purchase orders</Empty> : (
        <table className="t"><thead><tr><th>Number</th><th>Supplier</th><th>Branch</th><th>Created by</th><th>Status</th><th className="num">Total</th></tr></thead>
          <tbody>{data.map((p) => <tr key={p.id} className="click" onClick={() => setOpen(p.id)}><td>{p.number} <TestBadge on={p.is_test} /><div className="small muted">{date(p.created_at)}</div></td><td>{p.supplier}</td><td>{p.branch}</td><td>{p.created_by_name}</td><td><Status s={p.status} /></td><td className="num">{p.currency} {money(p.total)}</td></tr>)}</tbody></table>
      )}</div>
      {open === 'new' && <POForm onClose={() => setOpen(null)} onDone={(id) => { reload(); setOpen(id); }} />}
      {open && open !== 'new' && <PODetail id={open} onClose={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function POForm({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { me } = useSession();
  const { data: suppliers } = useData<any[]>('/suppliers');
  const { data: branches } = useData<any[]>('/branches');
  const { data: items } = useData<any[]>('/inventory');
  const [f, setF] = useState({ supplierId: '', branchId: me.user.branchId || 'br_main', currency: 'OMR', fxRate: '', expectedDate: '', notes: '' });
  const [lines, setLines] = useState<{ variantId: string; qty: string; unitCost: string }[]>([]);
  const [search, setSearch] = useState('');
  const { busy, run } = useAction();
  const vm = new Map((items || []).map((v) => [v.id, v]));
  const found = search ? (items || []).filter((v) => variantName(v).toLowerCase().includes(search.toLowerCase()) || v.sku.toLowerCase().includes(search.toLowerCase())).slice(0, 8) : [];
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (parseMoney(l.unitCost) || 0), 0);
  return (
    <Modal wide title="New purchase order" onClose={onClose} footer={<button className="btn primary" disabled={busy || !f.supplierId || !lines.length} onClick={() => run(() => api.post('/purchase-orders', { ...f, fxRate: f.fxRate ? Number(f.fxRate) : undefined, lines: lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty), unitCost: parseMoney(l.unitCost) })) }), 'Draft saved').then((r) => r && onDone(r.id))}>Save draft</button>}>
      <div className="grid g3">
        <Field label="Supplier"><select value={f.supplierId} onChange={(e) => { const s = suppliers?.find((x) => x.id === e.target.value); setF({ ...f, supplierId: e.target.value, currency: s?.currency || 'OMR' }); }}><option value="">—</option>{suppliers?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Deliver to"><select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Expected date"><input type="date" value={f.expectedDate} onChange={(e) => setF({ ...f, expectedDate: e.target.value })} /></Field>
        <Field label="Currency"><select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{['OMR', 'USD', 'EUR', 'AED', 'SAR', 'INR'].map((c) => <option key={c}>{c}</option>)}</select></Field>
        {f.currency !== 'OMR' && <Field label={`OMR per 1 ${f.currency}`} hint="Leave empty to use the rate in Settings"><input value={f.fxRate} onChange={(e) => setF({ ...f, fxRate: e.target.value })} /></Field>}
        <Field label="Notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <input placeholder="Search product to order" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginTop: 12 }} />
      {found.map((v) => <div key={v.id} className="row" style={{ padding: 4 }}><span className="grow">{variantName(v)} <span className="small muted">{v.sku} · {v.qty} in stock</span></span><button className="btn sm" onClick={() => { setLines([...lines, { variantId: v.id, qty: '1', unitCost: v.avg_cost != null && f.currency === 'OMR' ? money(v.avg_cost) : '' }]); setSearch(''); }}>Add</button></div>)}
      <table className="t" style={{ marginTop: 8 }}><thead><tr><th>Product</th><th>Qty</th><th>Unit cost ({f.currency}, before VAT)</th><th className="num">Line</th><th /></tr></thead>
        <tbody>{lines.map((l, i) => <tr key={i}><td>{variantName(vm.get(l.variantId) || {})}</td><td><input value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} style={{ width: 70 }} /></td><td><input value={l.unitCost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))} style={{ width: 110 }} /></td><td className="num">{money((Number(l.qty) || 0) * (parseMoney(l.unitCost) || 0))}</td><td><button className="btn ghost sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td></tr>)}</tbody>
        <tfoot><tr><td colSpan={3}>Subtotal before VAT</td><td className="num">{money(total)}</td><td /></tr></tfoot></table>
    </Modal>
  );
}

function PODetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useSession();
  const { data: po, reload } = useData<any>(`/purchase-orders/${id}`);
  const [recv, setRecv] = useState(false);
  const { busy, run } = useAction();
  if (!po) return <Modal title="Purchase order" onClose={onClose}><Loading /></Modal>;
  const act = (path: string, ok: string, body = {}) => run(() => api.post(`/purchase-orders/${id}/${path}`, body), ok).then(reload);
  return (
    <Modal wide title={<>{po.number} — {po.supplier} <Status s={po.status} /></>} onClose={onClose} footer={<>
      <button className="btn" onClick={() => window.print()}>Print</button>
      {po.status === 'draft' && can('purchases', 'create') && <button className="btn primary" disabled={busy} onClick={() => act('submit', 'Sent for approval')}>Submit for approval</button>}
      {po.status === 'pending_approval' && can('purchases', 'approve') && <><button className="btn danger" disabled={busy} onClick={() => { const r = prompt('Reason for returning it to draft?'); if (r !== null) act('reject', 'Returned to draft', { reason: r }); }}>Reject</button><button className="btn gold" disabled={busy} onClick={() => act('approve', 'Approved')}>Approve</button></>}
      {['approved', 'partially_received'].includes(po.status) && can('purchases', 'edit') && <button className="btn gold" onClick={() => setRecv(true)}>Receive goods</button>}
      {['draft', 'pending_approval', 'approved'].includes(po.status) && can('purchases', 'edit') && <button className="btn danger" disabled={busy} onClick={() => { const r = prompt('Why cancel?'); if (r) act('cancel', 'Cancelled', { reason: r }); }}>Cancel PO</button>}
    </>}>
      <div className="small muted" style={{ marginBottom: 8 }}>Created {date(po.created_at)} · {po.currency}{po.currency !== 'OMR' && ` @ ${po.fx_rate} OMR`} · expected {date(po.expected_date)}{po.notes && ` · ${po.notes}`}</div>
      <table className="t"><thead><tr><th>Product</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Unit cost</th><th className="num">Line</th></tr></thead>
        <tbody>{po.lines.map((l: any) => <tr key={l.id}><td>{variantName(l)} <span className="small muted">{l.sku}</span></td><td className="num">{l.qty}</td><td className="num">{l.received_qty}</td><td className="num">{money(l.unit_cost)}</td><td className="num">{money(l.qty * l.unit_cost)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={4}>Subtotal / VAT / Total ({po.currency})</td><td className="num">{money(po.subtotal)} / {money(po.vat)} / <b>{money(po.total)}</b></td></tr></tfoot></table>
      {po.bills.length > 0 && <><h3 style={{ marginTop: 12 }}>Goods received</h3>{po.bills.map((b: any) => <div key={b.id} className="small">{b.number} · {date(b.bill_date)} · goods {money(b.goods)} + landed {money(b.landed_cost)} + VAT {money(b.vat)} OMR · <Status s={b.status} /></div>)}</>}
      {recv && <Receive po={po} onClose={() => setRecv(false)} onDone={() => { setRecv(false); reload(); }} />}
    </Modal>
  );
}

function Receive({ po, onClose, onDone }: { po: any; onClose: () => void; onDone: () => void }) {
  const [lines, setLines] = useState<Record<string, { qty: string; batchNo: string; expiryDate: string }>>(() => Object.fromEntries(po.lines.map((l: any) => [l.id, { qty: String(l.qty - l.received_qty), batchNo: '', expiryDate: '' }])));
  const [f, setF] = useState({ landedCost: '', supplierRef: '', billDate: today() });
  const { busy, run } = useAction();
  const { can } = useSession();
  const [scanMode, setScanMode] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [print, setPrint] = useState<LabelItem[] | null>(null);
  const open = po.lines.filter((l: any) => l.qty > l.received_qty);
  const startScan = () => { setScanMode(true); setLines(Object.fromEntries(Object.entries(lines).map(([k, l]) => [k, { ...l, qty: '0' }]))); };
  const onScan = (code: string) => {
    const l = open.find((x: any) => x.barcode === code || x.sku.toLowerCase() === code.toLowerCase());
    if (!l) { beep(false); return setScanMsg(`${code}: not on this purchase order${po.lines.some((x: any) => x.barcode === code) ? ' (already fully received)' : ' — add it to the order or create the product first'}`); }
    const n = (Number(lines[l.id].qty) || 0) + 1;
    if (n > l.qty - l.received_qty) { beep(false); return setScanMsg(`${variantName(l)}: more than ordered (${l.qty - l.received_qty})`); }
    beep(true); setScanMsg(`${variantName(l)}: ${n} of ${l.qty - l.received_qty}`); setLines({ ...lines, [l.id]: { ...lines[l.id], qty: String(n) } });
  };
  useScanner(onScan, !print);
  const receive = () => run(() => api.post(`/purchase-orders/${po.id}/receive`, { ...f, landedCost: f.landedCost ? parseMoney(f.landedCost) : 0, lines: Object.entries(lines).map(([poLineId, l]) => ({ poLineId, qty: Number(l.qty) || 0, batchNo: l.batchNo, expiryDate: l.expiryDate || undefined })) }), 'Goods received — stock and supplier bill updated').then((r) => {
    if (!r) return;
    const items: LabelItem[] = open.filter((l: any) => Number(lines[l.id].qty) > 0).map((l: any) => ({ id: l.variant_id, barcode: l.barcode, symbology: l.symbology, sku: l.sku, name: l.name, brand: l.brand, label: l.label, size_ml: l.size_ml, retail_price: l.retail_price, original_price: l.original_price, batch_no: lines[l.id].batchNo || undefined, copies: Number(lines[l.id].qty) }));
    if (items.length && can('barcodes', 'create')) setPrint(items); else onDone();
  });
  if (print) return <LabelPrinter items={print} source="purchase" refId={po.id} onClose={() => { setPrint(null); onDone(); }} />;
  return (
    <Modal wide title="Receive goods" onClose={onClose} footer={<button className="btn gold" disabled={busy} onClick={receive}>Receive into stock{can('barcodes', 'create') ? ' & print labels' : ''}</button>}>
      <div className="row" style={{ marginBottom: 10 }}>
        {!scanMode ? <button className="btn sm" onClick={startScan}>Count by scanning each bottle</button> : <div className="grow"><ScanBox onScan={onScan} placeholder="Scan each bottle as you unpack it" />{scanMsg && <div className="small muted">{scanMsg}</div>}</div>}
      </div>
      <table className="t"><thead><tr><th>Product</th><th>Qty received</th><th>Batch</th><th>Expiry</th></tr></thead>
        <tbody>{po.lines.filter((l: any) => l.qty > l.received_qty).map((l: any) => <tr key={l.id}><td>{variantName(l)}<div className="small muted">{l.qty - l.received_qty} outstanding · {l.barcode}</div></td>
          <td><input value={lines[l.id].qty} onChange={(e) => setLines({ ...lines, [l.id]: { ...lines[l.id], qty: e.target.value } })} style={{ width: 70 }} /></td>
          <td><input value={lines[l.id].batchNo} onChange={(e) => setLines({ ...lines, [l.id]: { ...lines[l.id], batchNo: e.target.value } })} style={{ width: 110 }} /></td>
          <td><input type="date" value={lines[l.id].expiryDate} onChange={(e) => setLines({ ...lines, [l.id]: { ...lines[l.id], expiryDate: e.target.value } })} /></td></tr>)}</tbody></table>
      <div className="grid g3" style={{ marginTop: 10 }}>
        <Field label="Landed costs in OMR" hint="Freight, customs, clearing — spread over the items by value"><input value={f.landedCost} onChange={(e) => setF({ ...f, landedCost: e.target.value })} /></Field>
        <Field label="Supplier invoice number"><input value={f.supplierRef} onChange={(e) => setF({ ...f, supplierRef: e.target.value })} /></Field>
        <Field label="Invoice date"><input type="date" value={f.billDate} onChange={(e) => setF({ ...f, billDate: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Bills() {
  const { can } = useSession();
  const { data, reload } = useData<any[]>('/supplier-bills');
  const [pay, setPay] = useState<any>(null);
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}><div className="grow" />{can('reports', 'export') && <button className="btn" onClick={() => download('/export/purchases' + qs({ from: '2000-01-01' }))}>CSV</button>}</div>
      <div className="card tablewrap">{!data ? <Loading /> : !data.length ? <Empty>No supplier bills yet</Empty> : (
        <table className="t"><thead><tr><th>Bill</th><th>Supplier</th><th>Date</th><th>Due</th><th>Status</th><th className="num">Total</th><th className="num">Open</th><th /></tr></thead>
          <tbody>{data.map((b) => { const open = b.total - b.paid - b.returned; const late = open > 0 && b.due_date && new Date(b.due_date) < new Date(); return (
            <tr key={b.id}><td>{b.number} <TestBadge on={b.is_test} /><div className="small muted">{b.supplier_ref}</div></td><td>{b.supplier}</td><td>{date(b.bill_date)}</td><td className={late ? 'bad' : ''}>{date(b.due_date)}</td><td><Status s={b.status} /></td><td className="num">{money(b.total)}</td><td className="num">{money(open)}</td>
              <td>{open > 0 && (can('finance', 'create') || can('purchases', 'approve')) && <button className="btn sm" onClick={() => setPay(b)}>Pay</button>}</td></tr>
          ); })}</tbody></table>
      )}</div>
      {pay && <PaySupplier supplierId={pay.supplier_id} bill={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); reload(); }} />}
    </>
  );
}

function PaySupplier({ supplierId, bill, onClose, onDone }: { supplierId: string; bill?: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: bill ? money(bill.total - bill.paid - bill.returned) : '', paidFrom: '1020', method: 'bank_transfer', reference: '', date: today() });
  const { busy, run } = useAction();
  return (
    <Modal title={`Pay supplier${bill ? ' — ' + bill.number : ''}`} onClose={onClose} footer={<button className="btn primary" disabled={busy} onClick={() => run(() => api.post('/supplier-payments', { ...f, supplierId, billId: bill?.id, amount: parseMoney(f.amount) }), 'Payment recorded').then((r) => r && onDone())}>Record payment</button>}>
      <div className="grid g2">
        <Field label="Amount (OMR)"><input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Paid from"><select value={f.paidFrom} onChange={(e) => setF({ ...f, paidFrom: e.target.value })}><option value="1020">Bank</option><option value="1000">Cash</option></select></Field>
        <Field label="Method"><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{['bank_transfer', 'cheque', 'cash', 'card'].map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Reference"><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Suppliers() {
  const { can } = useSession();
  const { data, reload } = useData<any[]>('/suppliers');
  const [edit, setEdit] = useState<any>(null);
  const [view, setView] = useState<string | null>(null);
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}><div className="grow" />{can('purchases', 'create') && <button className="btn primary" onClick={() => setEdit({})}>+ Supplier</button>}</div>
      <div className="card tablewrap">{!data ? <Loading /> : !data.length ? <Empty>No suppliers yet</Empty> : (
        <table className="t"><thead><tr><th>Supplier</th><th>Contact</th><th className="num">Orders</th><th className="num">Purchased</th><th className="num">On time</th><th className="num">Returns</th>{data[0]?.balance !== undefined && <th className="num">Balance owed</th>}</tr></thead>
          <tbody>{data.map((s) => <tr key={s.id} className="click" onClick={() => setView(s.id)}><td><b>{s.name}</b> <TestBadge on={s.is_test} /><div className="small muted">{s.code} · {s.country} · {s.currency} · {s.payment_terms_days} days</div></td><td>{s.phone}<div className="small muted">{s.email}</div></td><td className="num">{s.orders}</td><td className="num">{money(s.purchased)}</td><td className="num">{s.on_time_pct != null ? s.on_time_pct + '%' : '—'}</td><td className="num">{money(s.returned)}</td>
            {s.balance !== undefined && <td className="num"><b>{money(s.balance)}</b>{s.overdue > 0 && <div className="small bad">{money(s.overdue)} overdue</div>}</td>}</tr>)}</tbody></table>
      )}</div>
      {edit && <SupplierForm s={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      {view && <SupplierView id={view} onEdit={(s) => { setView(null); setEdit(s); }} onClose={() => { setView(null); reload(); }} />}
    </>
  );
}

function SupplierForm({ s, onClose, onDone }: { s: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: s.name || '', contactPerson: s.contact_person || '', phone: s.phone || '', email: s.email || '', address: s.address || '', country: s.country || 'Oman', vatNumber: s.vat_number || '', currency: s.currency || 'OMR', paymentTermsDays: s.payment_terms_days ?? 30, notes: s.notes || '', active: s.active !== false });
  const { busy, run } = useAction();
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  return (
    <Modal title={s.id ? 'Edit supplier' : 'New supplier'} onClose={onClose} footer={<button className="btn primary" disabled={busy || !f.name} onClick={() => run(() => (s.id ? api.put(`/suppliers/${s.id}`, f) : api.post('/suppliers', f)), 'Saved').then((r) => r && onDone())}>Save</button>}>
      <div className="grid g2">
        {(['name', 'contactPerson', 'phone', 'email', 'address', 'country', 'vatNumber'] as const).map((k) => <Field key={k} label={k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}><input value={f[k]} onChange={(e) => set(k, e.target.value)} /></Field>)}
        <Field label="Currency"><select value={f.currency} onChange={(e) => set('currency', e.target.value)}>{['OMR', 'USD', 'EUR', 'AED', 'SAR', 'INR'].map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Payment terms (days)"><input value={f.paymentTermsDays} onChange={(e) => set('paymentTermsDays', Number(e.target.value) || 0)} /></Field>
        <Field label="Notes"><input value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Active</label>
      </div>
    </Modal>
  );
}

function SupplierView({ id, onEdit, onClose }: { id: string; onEdit: (s: any) => void; onClose: () => void }) {
  const { can } = useSession();
  const { data: s, reload } = useData<any>(`/suppliers/${id}`);
  const [pay, setPay] = useState(false);
  const [ret, setRet] = useState(false);
  if (!s) return <Modal title="Supplier" onClose={onClose}><Loading /></Modal>;
  return (
    <Modal wide title={s.name} onClose={onClose} footer={<>
      {can('purchases', 'edit') && <button className="btn" onClick={() => onEdit(s)}>Edit</button>}
      {can('purchases', 'edit') && <button className="btn" onClick={() => setRet(true)}>Return goods</button>}
      {s.balance > 0 && (can('finance', 'create') || can('purchases', 'approve')) && <button className="btn primary" onClick={() => setPay(true)}>Pay</button>}
    </>}>
      <div className="grid g3"><Card title="Balance owed"><div className="value" style={{ fontSize: 26, fontFamily: 'var(--serif)' }}>{money(s.balance)} OMR</div></Card><Card title="Contact"><div>{s.contact_person}</div><div>{s.phone}</div><div>{s.email}</div></Card><Card title="Terms"><div>{s.currency} · {s.payment_terms_days} days</div><div className="small muted">VAT {s.vat_number || '—'}</div></Card></div>
      <h3 style={{ marginTop: 12 }}>Bills</h3>
      <table className="t"><tbody>{s.bills.map((b: any) => <tr key={b.id}><td>{b.number}</td><td>{date(b.bill_date)}</td><td><Status s={b.status} /></td><td className="num">{money(b.total)}</td><td className="num">paid {money(b.paid)}</td></tr>)}</tbody></table>
      <h3 style={{ marginTop: 12 }}>Payments</h3>
      {s.payments.length ? <table className="t"><tbody>{s.payments.map((p: any) => <tr key={p.id}><td>{p.number}</td><td>{date(p.date)}</td><td>{p.method} {p.reference}</td><td className="num">{money(p.amount)}</td></tr>)}</tbody></table> : <Empty>No payments</Empty>}
      {s.returns.length > 0 && <><h3 style={{ marginTop: 12 }}>Returns</h3>{s.returns.map((r: any) => <div key={r.id} className="small">{r.number} · {date(r.created_at)} · {money(r.amount + r.vat)} · {r.reason}</div>)}</>}
      {pay && <PaySupplier supplierId={s.id} onClose={() => setPay(false)} onDone={() => { setPay(false); reload(); }} />}
      {ret && <ReturnForm supplierId={s.id} bills={s.bills} onClose={() => setRet(false)} onDone={() => { setRet(false); reload(); }} />}
    </Modal>
  );
}

function ReturnForm({ supplierId, bills, onClose, onDone }: { supplierId: string; bills: any[]; onClose: () => void; onDone: () => void }) {
  const { me } = useSession();
  const [branchId, setBranchId] = useState(me.user.branchId || 'br_main');
  const { data: items } = useData<any[]>('/inventory' + qs({ branchId }), [branchId]);
  const { data: branches } = useData<any[]>('/branches');
  const [lines, setLines] = useState<Record<string, number>>({});
  const [billId, setBillId] = useState('');
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  const [scanMsg, setScanMsg] = useState('');
  const onScan = (code: string) => {
    const v = (items || []).find((x) => x.barcode === code || x.sku.toLowerCase() === code.toLowerCase());
    if (!v) { beep(false); return setScanMsg(`${code}: not found`); }
    const n = (lines[v.id] || 0) + 1;
    if (n > v.qty) { beep(false); return setScanMsg(`${variantName(v)}: only ${v.qty} in stock`); }
    beep(true); setScanMsg(`${variantName(v)} × ${n}`); setLines({ ...lines, [v.id]: n });
  };
  useScanner(onScan);
  return (
    <Modal wide title="Return goods to supplier" onClose={onClose} footer={<button className="btn danger" disabled={busy || !reason} onClick={() => run(() => api.post('/purchase-returns', { supplierId, branchId, billId: billId || undefined, reason, lines: Object.entries(lines).filter(([, q]) => q > 0).map(([variantId, qty]) => ({ variantId, qty })) }), 'Return recorded').then((r) => r && onDone())}>Record return</button>}>
      <div className="grid g3">
        <Field label="From branch"><select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Against bill (optional)"><select value={billId} onChange={(e) => setBillId(e.target.value)}><option value="">—</option>{bills.map((b) => <option key={b.id} value={b.id}>{b.number}</option>)}</select></Field>
        <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <div style={{ marginTop: 10 }}><ScanBox onScan={onScan} placeholder="Scan each bottle going back to the supplier" />{scanMsg && <div className="small muted">{scanMsg}</div>}</div>
      <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 10 }}><table className="t"><tbody>{(items || []).filter((v) => v.qty > 0).map((v) => <tr key={v.id}><td>{variantName(v)}</td><td className="num muted">{v.qty}</td><td><input type="number" min={0} max={v.qty} value={lines[v.id] || ''} onChange={(e) => setLines({ ...lines, [v.id]: Number(e.target.value) })} style={{ width: 70 }} /></td></tr>)}</tbody></table></div>
      <div className="small muted">Returned at average cost; the supplier balance and input VAT are reduced.</div>
    </Modal>
  );
}
