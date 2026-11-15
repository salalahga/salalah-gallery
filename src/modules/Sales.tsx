import { useState } from 'react';
import { Minus, Plus, Trash2, ShoppingCart, Printer, Package, TrendingUp } from 'lucide-react';
import { store, useDB, nextNumber, today } from '../core/store';
import type { Sale } from '../core/types';
import { money, fmtDate } from '../core/calc';
import { lookup } from '../core/helpers';
import { PageHeader, Empty, Tabs, SearchBox, Field, Modal, Stat, toast } from '../components/ui';
import { useT } from '../core/i18n';
import { QR, useDocQr } from '../plugins/hooks';

type Line = { itemId: string; name: string; qty: number; price: number };

export default function Sales() {
  const db = useDB(); const s = db.settings; const L = lookup(db); const t = useT(); const qr = useDocQr();
  const [tab, setTab] = useState<'pos' | 'history'>('pos'); const [q, setQ] = useState('');
  const [cart, setCart] = useState<Line[]>([]); const [customerId, setCustomerId] = useState(''); const [discount, setDiscount] = useState(0); const [method, setMethod] = useState('Cash');
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const products = db.items.filter((i) => (i.kind === 'product' || q) && (i.name + i.category).toLowerCase().includes(q.toLowerCase()));
  const add = (id: string) => { const it = L.item(id)!; setCart((c) => c.some((l) => l.itemId === id) ? c.map((l) => (l.itemId === id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { itemId: id, name: it.name, qty: 1, price: it.price }]); };
  const sub = cart.reduce((n, l) => n + l.qty * l.price, 0); const vat = Math.max(0, sub - discount) * (s.vatRate / 100); const total = Math.max(0, sub - discount) + vat;
  const checkout = () => {
    if (!cart.length) return;
    const sale = store.upsert('sales', { number: nextNumber('SL', db.sales.map((x) => x.number)), date: today(), customerId: customerId || undefined, lines: cart, discount, vat: s.vatRate, method }) as Sale;
    cart.forEach((l) => { const it = L.item(l.itemId); if (it) store.upsert('items', { ...it, qty: Math.max(0, it.qty - l.qty) }); });
    store.upsert('txns', { date: today(), kind: 'income', category: 'Product Sale', amount: +total.toFixed(3), method, description: `Sale ${sale.number}${customerId ? ' — ' + L.customer(customerId)?.name : ''}`, ref: sale.number });
    setCart([]); setDiscount(0); setReceipt(sale); toast('Sale completed');
  };
  const saleTotal = (x: Sale) => { const sb = x.lines.reduce((n, l) => n + l.qty * l.price, 0); return Math.max(0, sb - x.discount) * (1 + x.vat / 100); };
  const monthSales = db.sales.filter((x) => x.date.startsWith(today().slice(0, 7)));

  return (
    <>
      <PageHeader title={t('Sales')} sub="Sell ready-made products — stock and accounts update automatically." actions={<Tabs value={tab} onChange={setTab} tabs={[{ id: 'pos', label: 'Point of sale' }, { id: 'history', label: 'History', count: db.sales.length }]} />} />
      {tab === 'pos' ? <div className="pos-grid">
        <div>
          <div className="toolbar"><SearchBox value={q} onChange={setQ} placeholder="Search products (type to include materials)…" /></div>
          {products.length ? <div className="products">{products.map((p) => (
            <button key={p.id} className="product" onClick={() => add(p.id)} disabled={p.qty <= 0}>
              <div className="pimg" style={p.image ? { backgroundImage: `url(${p.image})` } : undefined}>{!p.image && <Package size={30} />}</div>
              <div className="pbody"><b>{p.name}</b><div className="flex between"><span style={{ fontWeight: 600, color: 'var(--wood)' }}>{money(p.price, s)}</span><small>{p.qty} left</small></div></div>
            </button>))}</div> : <div className="card"><Empty title="No products" hint="Add products in Inventory → Products for sale." /></div>}
        </div>
        <div className="card cart">
          <h3><span className="flex"><ShoppingCart size={17} />Cart</span>{cart.length > 0 && <button className="btn sm ghost" onClick={() => setCart([])}>Clear</button>}</h3>
          {cart.length ? <ul className="list">{cart.map((l) => (
            <li key={l.itemId}><div className="grow"><div className="title">{l.name}</div><div className="muted">{money(l.price, s)} each</div></div>
              <button className="icon-btn" onClick={() => setCart(cart.map((x) => x.itemId === l.itemId ? { ...x, qty: x.qty - 1 } : x).filter((x) => x.qty > 0))}><Minus size={14} /></button><b>{l.qty}</b>
              <button className="icon-btn" onClick={() => add(l.itemId)}><Plus size={14} /></button>
              <button className="icon-btn" onClick={() => setCart(cart.filter((x) => x.itemId !== l.itemId))}><Trash2 size={14} /></button></li>))}</ul> : <Empty title="Cart is empty" hint="Tap a product to add it." />}
          <div className="form two" style={{ marginTop: 12 }}>
            <Field label="Customer (optional)" span={3}><select value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Walk-in customer</option>{db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Discount"><input type="number" value={discount} onChange={(e) => setDiscount(+e.target.value)} /></Field>
            <Field label="Payment"><select value={method} onChange={(e) => setMethod(e.target.value)}>{['Cash', 'Card', 'Bank', 'Online'].map((m) => <option key={m}>{m}</option>)}</select></Field>
          </div>
          <div className="totals" style={{ width: '100%', marginTop: 10 }}>
            <div><span>Subtotal</span><span>{money(sub, s)}</span></div><div><span>VAT {s.vatRate}%</span><span>{money(vat, s)}</span></div>
            <div className="grand"><span>Total</span><span>{money(total, s)}</span></div>
          </div>
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12, padding: 13 }} disabled={!cart.length} onClick={checkout}>Complete sale · {money(total, s)}</button>
        </div>
      </div> : <>
        <div className="grid g2 mb">
          <Stat label="Sales this month" value={money(monthSales.reduce((n, x) => n + saleTotal(x), 0), s)} icon={<TrendingUp size={20} />} tone="green" sub={`${monthSales.length} bills`} />
          <Stat label="All-time sales" value={money(db.sales.reduce((n, x) => n + saleTotal(x), 0), s)} icon={<ShoppingCart size={20} />} tone="wood" />
        </div>
        <div className="card">{db.sales.length ? <div className="table-wrap"><table><thead><tr><th>Bill</th><th>Date</th><th>Customer</th><th>Items</th><th>Method</th><th className="num">Total</th><th /></tr></thead>
          <tbody>{db.sales.map((x) => <tr key={x.id}><td><b>{x.number}</b></td><td>{fmtDate(x.date)}</td><td>{L.customer(x.customerId)?.name || 'Walk-in'}</td><td className="muted">{x.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</td><td>{x.method}</td><td className="num"><b>{money(saleTotal(x), s)}</b></td><td><button className="icon-btn" onClick={() => setReceipt(x)}><Printer size={15} /></button></td></tr>)}</tbody></table></div> : <Empty title="No sales yet" />}</div>
      </>}
      {receipt && <Modal open title={`Receipt ${receipt.number}`} onClose={() => setReceipt(null)} footer={<><button className="btn" onClick={() => setReceipt(null)}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print</button></>}>
        <div className="print-area"><div className="doc" style={{ maxWidth: 360, margin: '0 auto', fontFamily: 'monospace' }}>
          <div style={{ textAlign: 'center' }}><b style={{ fontSize: 16 }}>{s.businessName}</b><div>{s.city} · {s.phone}</div>{s.vatNumber && <div>VATIN {s.vatNumber}</div>}<div>{receipt.number} · {fmtDate(receipt.date)}</div></div><hr />
          {receipt.lines.map((l) => <div key={l.itemId} className="flex between"><span>{l.qty}× {l.name}</span><span>{money(l.qty * l.price, s)}</span></div>)}<hr />
          {receipt.discount > 0 && <div className="flex between"><span>Discount</span><span>−{money(receipt.discount, s)}</span></div>}
          <div className="flex between"><b>TOTAL (incl. VAT {receipt.vat}%)</b><b>{money(saleTotal(receipt), s)}</b></div><div>Paid by {receipt.method}</div><hr /><div style={{ textAlign: 'center' }}>Thank you!{qr && <div style={{ marginTop: 8 }}><QR value={qr.url} size={90} caption={qr.caption} /></div>}</div>
        </div></div>
      </Modal>}
    </>
  );
}
