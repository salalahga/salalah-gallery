import { useState } from 'react';
import { Plus, Trash2, Minus, Boxes, AlertTriangle, Package } from 'lucide-react';
import { store, useDB } from '../core/store';
import type { Item } from '../core/types';
import { money } from '../core/calc';
import { Modal, Field, PageHeader, Badge, Empty, Tabs, SearchBox, Stat, toast, confirmDelete } from '../components/ui';
import { useT } from '../core/i18n';
import { useCanWrite } from '../core/session';

export default function Inventory() {
  const db = useDB(); const s = db.settings; const t = useT(); const can = useCanWrite()('items');
  const [tab, setTab] = useState<'material' | 'product'>('material'); const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<Item> | null>(null);
  const list = db.items.filter((i) => i.kind === tab && (i.name + i.category + (i.sku || '')).toLowerCase().includes(q.toLowerCase()));
  const value = db.items.reduce((n, i) => n + i.qty * i.cost, 0);
  const low = db.items.filter((i) => i.qty <= i.reorder);
  const adjust = (i: Item, d: number) => store.upsert('items', { ...i, qty: Math.max(0, i.qty + d) });
  const save = () => { if (!edit?.name) return toast('Enter item name'); store.upsert('items', edit as Item); setEdit(null); toast('Item saved'); };
  const purchase = (i: Item) => {
    const n = Number(prompt(`Purchase quantity for ${i.name} (${i.unit})`, '10')); if (!n) return;
    store.upsert('items', { ...i, qty: i.qty + n });
    store.upsert('txns', { date: new Date().toISOString().slice(0, 10), kind: 'expense', category: i.category === 'Hardware' ? 'Hardware' : 'Boards & Sheets', amount: n * i.cost, method: 'Cash', description: `Purchase ${n} ${i.unit} ${i.name}` });
    toast('Stock added and expense recorded');
  };
  return (
    <>
      <PageHeader title={t('Inventory')} sub="Boards, sheets, hardware and finished products."
        actions={<><SearchBox value={q} onChange={setQ} />{can && <button className="btn primary" onClick={() => setEdit({ kind: tab, unit: tab === 'material' ? 'sheet' : 'pcs', qty: 0, cost: 0, price: 0, reorder: 0, category: tab === 'material' ? 'Boards & Sheets' : 'Furniture', showOnWebsite: tab === 'product' })}><Plus size={16} />Add {tab}</button>}</>} />
      <div className="grid g3 mb">
        <Stat label="Stock value (cost)" value={money(value, s)} icon={<Boxes size={20} />} tone="wood" />
        <Stat label="Items" value={db.items.length} icon={<Package size={20} />} tone="blue" sub={`${db.items.filter((i) => i.kind === 'product').length} products for sale`} />
        <Stat label={t('Low stock')} value={low.length} icon={<AlertTriangle size={20} />} tone="red" />
      </div>
      <div className="toolbar"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'material', label: 'Materials & boards', count: db.items.filter((i) => i.kind === 'material').length }, { id: 'product', label: 'Products for sale', count: db.items.filter((i) => i.kind === 'product').length }]} /></div>
      <div className="card">
        {list.length ? <div className="table-wrap"><table>
          <thead><tr><th>Item</th><th>Category</th><th>Spec</th><th className="num">Cost</th><th className="num">Price</th><th className="num">In stock</th><th /></tr></thead>
          <tbody>{list.map((i) => <tr key={i.id} className={can ? 'click' : ''} onClick={() => can && setEdit({ ...i })}>
            <td><div className="flex">{i.image && <img src={i.image} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: 'cover' }} />}<div><b>{i.name}</b><div className="muted">{i.sku}</div></div></div></td>
            <td>{i.category}</td><td className="muted">{[i.thickness, i.size].filter(Boolean).join(' · ') || '—'}</td>
            <td className="num">{i.cost === undefined ? '—' : money(i.cost, s)}</td><td className="num">{money(i.price, s)}</td>
            <td className="num"><Badge tone={i.qty <= i.reorder ? 'red' : 'green'}>{i.qty} {i.unit}</Badge></td>
            <td onClick={(e) => e.stopPropagation()}>{can && <div className="row-actions">
              <button className="icon-btn" onClick={() => adjust(i, -1)}><Minus size={15} /></button><button className="icon-btn" onClick={() => adjust(i, 1)}><Plus size={15} /></button>
              <button className="btn sm" onClick={() => purchase(i)}>Purchase</button></div>}</td>
          </tr>)}</tbody></table></div> : <Empty title="Nothing here yet" />}
      </div>
      {edit && <Modal open title={edit.id ? 'Edit item' : 'New item'} onClose={() => setEdit(null)} footer={<>
        {edit.id && <button className="btn danger ghost" onClick={() => { if (confirmDelete(edit.name)) { store.remove('items', edit.id!); setEdit(null); } }}><Trash2 size={15} />Delete</button>}
        <span className="spacer" /><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
        <div className="form">
          <Field label="Name" span={2}><input autoFocus value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. MDF Board" /></Field>
          <Field label="Type"><select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Item['kind'] })}><option value="material">Material</option><option value="product">Product for sale</option></select></Field>
          <Field label="Category"><input list="cats" value={edit.category || ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /><datalist id="cats">{[...new Set(db.items.map((i) => i.category))].map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="SKU / code"><input value={edit.sku || ''} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} /></Field>
          <Field label="Unit"><input value={edit.unit || ''} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} placeholder="sheet, pcs, roll, m" /></Field>
          <Field label="Thickness"><input value={edit.thickness || ''} onChange={(e) => setEdit({ ...edit, thickness: e.target.value })} placeholder="18mm" /></Field>
          <Field label="Size"><input value={edit.size || ''} onChange={(e) => setEdit({ ...edit, size: e.target.value })} placeholder="1220×2440" /></Field>
          <Field label="Quantity in stock"><input type="number" value={edit.qty ?? 0} onChange={(e) => setEdit({ ...edit, qty: +e.target.value })} /></Field>
          <Field label={`Cost price (${s.currency})`}><input type="number" value={edit.cost ?? 0} onChange={(e) => setEdit({ ...edit, cost: +e.target.value })} /></Field>
          <Field label={`Selling price (${s.currency})`}><input type="number" value={edit.price ?? 0} onChange={(e) => setEdit({ ...edit, price: +e.target.value })} /></Field>
          <Field label="Reorder level"><input type="number" value={edit.reorder ?? 0} onChange={(e) => setEdit({ ...edit, reorder: +e.target.value })} /></Field>
          <Field label="Image URL" span={2}><input value={edit.image || ''} onChange={(e) => setEdit({ ...edit, image: e.target.value })} placeholder="https://…" /></Field>
          <Field label="Show on website"><select value={edit.showOnWebsite ? '1' : '0'} onChange={(e) => setEdit({ ...edit, showOnWebsite: e.target.value === '1' })}><option value="1">Yes</option><option value="0">No</option></select></Field>
          <Field label="Description" span={3}><textarea value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
        </div>
      </Modal>}
    </>
  );
}
