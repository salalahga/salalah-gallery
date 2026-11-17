import { useState } from 'react';
import { api, qs } from '../core/api';
import { t } from '../core/i18n';
import { money, parseMoney, useSession, dateTime, monthStart, today, variantName } from '../core/session';
import { go } from '../core/router';
import { Card, Empty, Field, Modal, PageHead, Status, TestBadge, useAction, useData, download, Loading } from '../components/ui';
import { Receipt } from './Receipt';
import { CustomerPick } from './POS';

const CHANNELS: [string, string][] = [['', 'All channels'], ['pos', 'Shop (POS)'], ['web', 'Website'], ['whatsapp', 'WhatsApp'], ['instagram', 'Instagram'], ['snapchat', 'Snapchat'], ['facebook', 'Facebook'], ['phone', 'Phone'], ['wholesale', 'Wholesale']];

export default function Sales({ params }: { params: string[] }) {
  const { can } = useSession();
  const [f, setF] = useState({ from: monthStart(), to: today(), channel: '', status: '', search: '' });
  const { data, reload } = useData<any[]>('/sales' + qs(f), [JSON.stringify(f)]);
  const [creating, setCreating] = useState(false);
  if (params[0]) return <SaleDetail id={params[0]} onBack={() => { go('/sales'); reload(); }} />;
  const sum = (data || []).filter((s) => !['cancelled', 'pending'].includes(s.status)).reduce((a, s) => a + s.total - s.refunded, 0);
  return (
    <>
      <PageHead title={t('Sales & orders')} sub="Every channel in one list — shop, website, WhatsApp and social" actions={<>
        {(can('sales', 'create') || can('whatsapp', 'create') || can('online', 'create')) && <button className="btn primary" onClick={() => setCreating(true)}>+ New order (WhatsApp / phone / social)</button>}
        {can('reports', 'export') && <button className="btn" onClick={() => download('/export/sales' + qs({ from: f.from, to: f.to }))}>CSV</button>}
      </>} />
      <div className="card row" style={{ marginBottom: 12 }}>
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={{ width: 'auto' }} />
        <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={{ width: 'auto' }} />
        <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} style={{ width: 'auto' }}>{CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} style={{ width: 'auto' }}>{['', 'pending', 'confirmed', 'completed', 'partially_refunded', 'refunded', 'cancelled'].map((s) => <option key={s} value={s}>{s ? s.replace('_', ' ') : 'Any status'}</option>)}</select>
        <input placeholder="Number" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} style={{ width: 140 }} />
        <div className="grow" /><b>{data?.length ?? 0} · {money(sum)} OMR</b>
      </div>
      <div className="card tablewrap">
        {!data ? <Loading /> : !data.length ? <Empty>No sales in this period</Empty> : (
          <table className="t">
            <thead><tr><th>Number</th><th>Date</th><th>Channel</th><th>Customer</th><th>Cashier</th><th>Status</th><th className="num">Total</th></tr></thead>
            <tbody>{data.map((s) => (
              <tr key={s.id} className="click" onClick={() => go('/sales/' + s.id)}>
                <td>{s.number} <TestBadge on={s.is_test} /></td><td>{dateTime(s.created_at)}</td><td>{CHANNELS.find((c) => c[0] === s.channel)?.[1]}</td><td>{s.customer || '—'}</td><td>{s.cashier || '—'}</td>
                <td><Status s={s.status} /> {s.payment_status !== 'paid' && <Status s={s.payment_status} />} {s.channel !== 'pos' && <Status s={s.fulfilment_status} />}</td>
                <td className="num">{money(s.total)}{s.refunded > 0 && <div className="small bad">−{money(s.refunded)}</div>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {creating && <NewOrder onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); go('/sales/' + id); }} />}
    </>
  );
}

function SaleDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { can } = useSession();
  const { data: s, reload } = useData<any>(`/sales/${id}`);
  const [dlg, setDlg] = useState<'refund' | 'cancel' | 'pay' | 'receipt' | null>(null);
  const { busy, run } = useAction();
  if (!s) return <Loading />;
  const due = s.total - s.paid - s.refunded;
  const remote = s.channel !== 'pos';
  return (
    <>
      <PageHead title={<>{s.number} <TestBadge on={s.is_test} /></>} sub={`${s.channel} · ${s.branch_name} · ${dateTime(s.created_at)}`} actions={<>
        <button className="btn" onClick={onBack}>← All sales</button>
        <button className="btn" onClick={() => setDlg('receipt')}>Receipt / invoice</button>
        {s.status === 'pending' && can('sales', 'edit') && <button className="btn primary" disabled={busy} onClick={() => run(() => api.post(`/orders/${id}/confirm`), 'Order confirmed — stock deducted').then(reload)}>Confirm order</button>}
        {due > 0 && !['cancelled', 'refunded'].includes(s.status) && <button className="btn gold" onClick={() => setDlg('pay')}>Record payment</button>}
        {remote && s.status === 'confirmed' && ['packed', 'shipped', 'delivered'].map((st) => <button key={st} className="btn sm" disabled={busy} onClick={() => run(() => api.post(`/orders/${id}/fulfil`, { status: st }), 'Updated').then(reload)}>Mark {st}</button>)}
        {['completed', 'confirmed', 'partially_refunded'].includes(s.status) && <button className="btn danger" onClick={() => setDlg('refund')}>Refund / return</button>}
        {['pending', 'completed', 'confirmed'].includes(s.status) && s.refunded === 0 && <button className="btn danger" onClick={() => setDlg('cancel')}>Cancel sale</button>}
      </>} />
      <div className="grid g2">
        <Card title="Items">
          <table className="t"><thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Discount</th><th className="num">Total</th></tr></thead>
            <tbody>{s.lines.map((l: any) => <tr key={l.id}><td>{variantName(l)}<div className="small muted">{l.sku}{l.price_overridden && ' · price changed'}</div></td><td className="num">{l.qty}{l.refunded_qty > 0 && <div className="small bad">−{l.refunded_qty} returned</div>}</td><td className="num">{money(l.unit_price)}</td><td className="num">{money(l.discount)}</td><td className="num">{money(l.total)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={4}>Total (VAT {money(s.vat)}{s.delivery_fee ? `, delivery ${money(s.delivery_fee)}` : ''})</td><td className="num">{money(s.total)}</td></tr></tfoot>
          </table>
          {s.cost != null && <div className="small muted" style={{ marginTop: 6 }}>Cost of goods {money(s.cost)} · gross profit {money(s.net - s.cost)}</div>}
        </Card>
        <div className="col">
          <Card title="Status">
            <dl className="kv"><dt>Order</dt><dd><Status s={s.status} /></dd><dt>Payment</dt><dd><Status s={s.payment_status} /> paid {money(s.paid)}{due > 0 && <span className="bad"> · due {money(due)}</span>}</dd>
              {remote && <><dt>Delivery</dt><dd><Status s={s.fulfilment_status} /> {s.delivery?.tracking_no}</dd><dt>Address</dt><dd>{s.shipping_address || '—'}</dd></>}
              <dt>Customer</dt><dd>{s.customer_name ? <a href={`#/customers/${s.customer_id}`}>{s.customer_name}</a> : 'Walk-in'} {s.customer_phone}</dd>
              {s.coupon_code && <><dt>Coupon</dt><dd>{s.coupon_code}</dd></>}{s.notes && <><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{s.notes}</dd></>}</dl>
          </Card>
          <Card title="Payments">{s.payments.length ? <table className="t"><tbody>{s.payments.map((p: any) => <tr key={p.id}><td>{p.direction === 'out' ? 'Refund ' : ''}{p.method.replace('_', ' ')}<div className="small muted">{p.reference}</div></td><td><Status s={p.status} /></td><td className="small">{dateTime(p.at)}</td><td className={'num ' + (p.direction === 'out' ? 'bad' : '')}>{p.direction === 'out' ? '−' : ''}{money(p.amount)}</td></tr>)}</tbody></table> : <Empty>No payments yet</Empty>}</Card>
          {s.refunds.length > 0 && <Card title="Refunds">{s.refunds.map((r: any) => <div key={r.id} className="small">{r.number} · {money(r.amount)} by {r.method} · “{r.reason}” · approved by {r.approved_by_name}</div>)}</Card>}
        </div>
      </div>
      {dlg === 'receipt' && <Receipt saleId={id} onClose={() => setDlg(null)} />}
      {dlg === 'pay' && <PayDlg sale={s} due={due} onClose={() => setDlg(null)} onDone={() => { setDlg(null); reload(); }} />}
      {(dlg === 'refund' || dlg === 'cancel') && <RefundDlg sale={s} cancel={dlg === 'cancel'} onClose={() => setDlg(null)} onDone={() => { setDlg(null); reload(); }} />}
    </>
  );
}

function PayDlg({ sale, due, onClose, onDone }: { sale: any; due: number; onClose: () => void; onDone: () => void }) {
  const [p, setP] = useState({ method: sale.channel === 'pos' ? 'cash' : 'payment_link', amount: money(due), reference: '' });
  const { busy, run } = useAction();
  return (
    <Modal title="Record payment" onClose={onClose} footer={<button className="btn primary" disabled={busy} onClick={() => run(() => api.post(`/sales/${sale.id}/payments`, { ...p, amount: parseMoney(p.amount) }), 'Payment recorded').then((r) => r && onDone())}>Save payment</button>}>
      <div className="grid g2">
        <Field label="Method"><select value={p.method} onChange={(e) => setP({ ...p, method: e.target.value })}>{['cash', 'card', 'bank_transfer', 'wallet', 'payment_link', 'loyalty'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</select></Field>
        <Field label="Amount (OMR)"><input value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} /></Field>
        <Field label="Reference" hint="Bank / gateway reference or card approval code — never a card number"><input value={p.reference} onChange={(e) => setP({ ...p, reference: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function RefundDlg({ sale, cancel, onClose, onDone }: { sale: any; cancel: boolean; onClose: () => void; onDone: () => void }) {
  const { can } = useSession();
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(sale.lines.map((l: any) => [l.id, cancel ? l.qty - l.refunded_qty : 0])));
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState(sale.payments.find((p: any) => p.direction === 'in')?.method || 'cash');
  const [restock, setRestock] = useState(true);
  const { busy, run } = useAction();
  const go2 = () => run(async () => {
    const body = cancel ? { reason, method, restock } : { reason, method, restock, lines: Object.entries(qty).filter(([, n]) => n > 0).map(([saleLineId, n]) => ({ saleLineId, qty: n })) };
    const r = await api.post(`/sales/${sale.id}/${cancel ? 'cancel' : 'refund'}`, body);
    return r;
  }).then((r) => { if (r) { if ((r as any).status === 'pending_approval') alert('Sent for approval by a manager. Nothing changes until it is approved.'); onDone(); } });
  return (
    <Modal title={cancel ? 'Cancel sale' : 'Refund / return'} onClose={onClose} footer={<button className="btn danger" disabled={busy || !reason} onClick={go2}>{can('pos', 'approve') ? (cancel ? 'Cancel sale' : 'Refund now') : 'Request approval'}</button>}>
      <div className="col">
        {!can('pos', 'approve') && <div className="alert">You need a manager's approval. Your request will be listed in Approvals.</div>}
        {!cancel && <table className="t"><tbody>{sale.lines.map((l: any) => <tr key={l.id}><td>{variantName(l)}</td><td className="small muted">sold {l.qty}{l.refunded_qty ? `, returned ${l.refunded_qty}` : ''}</td><td><input type="number" min={0} max={l.qty - l.refunded_qty} value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: Math.max(0, Math.min(l.qty - l.refunded_qty, Number(e.target.value))) })} style={{ width: 70 }} /></td></tr>)}</tbody></table>}
        {sale.status !== 'pending' && <>
          <Field label="Money goes back by"><select value={method} onChange={(e) => setMethod(e.target.value)}>{['cash', 'card', 'bank_transfer', 'wallet', 'payment_link', 'loyalty'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</select></Field>
          <label className="check"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Put the items back into stock (untick if damaged or opened)</label>
        </>}
        <Field label="Reason (required)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/** Turn a WhatsApp / Instagram / phone conversation into a sales order. */
function NewOrder({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { me } = useSession();
  const [channel, setChannel] = useState('whatsapp');
  const [branchId] = useState(me.user.branchId || 'br_main');
  const [customer, setCustomer] = useState<any>(null);
  const [pick, setPick] = useState(false);
  const [lines, setLines] = useState<{ variantId: string; qty: number }[]>([]);
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ address: '', notes: '', coupon: '', delivery: money(me.settings.delivery.defaultFee), externalRef: '' });
  const { data: cat } = useData<any[]>('/inventory' + qs({ branchId }));
  const { busy, run } = useAction();
  const found = search ? (cat || []).filter((v) => variantName(v).toLowerCase().includes(search.toLowerCase())).slice(0, 8) : [];
  const vmap = new Map((cat || []).map((v) => [v.id, v]));
  return (
    <Modal wide title="New remote order" onClose={onClose} footer={<button className="btn primary" disabled={busy || !lines.length} onClick={() => run(() => api.post('/orders', { channel, branchId, customerId: customer?.id, items: lines, couponCode: f.coupon || undefined, deliveryFee: parseMoney(f.delivery) || 0, shippingAddress: f.address, notes: f.notes, externalRef: f.externalRef }), 'Order created').then((r) => r && onDone(r.id))}>Create order</button>}>
      <div className="grid g2">
        <div className="col">
          <Field label="Channel"><div className="pill-group">{CHANNELS.filter(([k]) => k && k !== 'pos').map(([k, l]) => <button key={k} className={channel === k ? 'on' : ''} onClick={() => setChannel(k)}>{l}</button>)}</div></Field>
          <div className="row">{customer ? <b className="grow">{customer.name} · {customer.phone}</b> : <span className="grow muted">No customer selected</span>}<button className="btn sm" onClick={() => setPick(true)}>Choose customer</button></div>
          <Field label="Conversation / reference" hint="e.g. WhatsApp number or chat ID"><input value={f.externalRef} onChange={(e) => setF({ ...f, externalRef: e.target.value })} /></Field>
          <Field label="Delivery address"><textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <div className="row"><Field label="Delivery fee (OMR)"><input value={f.delivery} onChange={(e) => setF({ ...f, delivery: e.target.value })} /></Field><Field label="Coupon"><input value={f.coupon} onChange={(e) => setF({ ...f, coupon: e.target.value.toUpperCase() })} /></Field></div>
          <Field label="Notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <div className="col">
          <input placeholder="Search product to add" value={search} onChange={(e) => setSearch(e.target.value)} />
          {found.map((v) => <button key={v.id} className="pcard" onClick={() => { setLines((l) => (l.some((x) => x.variantId === v.id) ? l.map((x) => (x.variantId === v.id ? { ...x, qty: x.qty + 1 } : x)) : [...l, { variantId: v.id, qty: 1 }])); setSearch(''); }}><div><div className="pn">{variantName(v)}</div><div className="small muted">{v.qty} in stock · {money(v.web_price ?? v.retail_price)}</div></div></button>)}
          <table className="t"><tbody>{lines.map((l) => <tr key={l.variantId}><td>{variantName(vmap.get(l.variantId) || {})}</td><td><input type="number" min={1} value={l.qty} onChange={(e) => setLines(lines.map((x) => (x.variantId === l.variantId ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x)))} style={{ width: 70 }} /></td><td><button className="btn ghost sm" onClick={() => setLines(lines.filter((x) => x !== l))}>✕</button></td></tr>)}</tbody></table>
          <div className="small muted">Prices, offers and VAT are calculated by the system. Stock is deducted when you confirm the order.</div>
        </div>
      </div>
      {pick && <CustomerPick onPick={(c) => { setCustomer(c); setPick(false); }} onClose={() => setPick(false)} />}
    </Modal>
  );
}
