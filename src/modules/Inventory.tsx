import { useState } from 'react';
import { Plus, Trash2, Boxes, AlertTriangle, Package, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Recycle, ClipboardCheck, Printer } from 'lucide-react';
import { store, useDB, today } from '../core/store';
import type { Item, StockMove } from '../core/types';
import { money, fmtDate } from '../core/calc';
import { lookup } from '../core/helpers';
import { STOCK_CATEGORIES, MOVE_LABEL, locations, locQty, moveStock, stockSummary } from '../core/stock';
import { Modal, Field, PageHeader, Badge, Empty, Tabs, SearchBox, Stat, toast, confirmDelete } from '../components/ui';
import { useT } from '../core/i18n';
import { useCanWrite, useUser } from '../core/session';
import { ExportButtons } from '../components/Export';

type Tab = 'material' | 'product' | 'moves' | 'usage' | 'value' | 'low';
const MOVE_TONE: Record<StockMove['kind'], string> = { in: 'green', out: 'blue', transfer: 'gray', waste: 'red', adjust: 'amber', return: 'amber', sale: 'blue', saleReturn: 'green' };

export default function Inventory() {
  const db = useDB(); const s = db.settings; const t = useT(); const can = useCanWrite()('items'); const user = useUser(); const L = lookup(db);
  const [tab, setTab] = useState<Tab>('material'); const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<Item> | null>(null);
  const [mv, setMv] = useState<Partial<StockMove> | null>(null);
  const [from, setFrom] = useState(''); const [to, setTo] = useState(today());
  const locs = locations(db);
  const sum = stockSummary(db, from, to);
  const list = db.items.filter((i) => i.kind === tab && (i.name + i.category + (i.sku || '')).toLowerCase().includes(q.toLowerCase()));
  const save = () => { if (!edit?.name) return toast('Enter item name'); store.upsert('items', edit as Item); setEdit(null); toast('Item saved'); };
  const doMove = () => {
    if (!mv) return;
    if (mv.kind === 'out' && !mv.jobId) return toast('Choose the project the material is for');
    const err = moveStock(store.get(), { date: mv.date || today(), itemId: mv.itemId!, kind: mv.kind!, qty: Number(mv.qty) || 0, cost: mv.cost, jobId: mv.jobId, from: mv.from, to: mv.to, note: mv.note }, user?.name);
    if (err) return toast(err);
    toast(`${MOVE_LABEL[mv.kind!]} saved`); setMv(null);
  };
  const open = (kind: StockMove['kind'], itemId?: string) => setMv({ kind, itemId: itemId || list[0]?.id || db.items[0]?.id, qty: undefined, date: today(), from: locs[0], to: kind === 'transfer' ? locs[1] || locs[0] : locs[0] });
  const moves = sum.moves.filter((m) => (L.item(m.itemId)?.name || '').toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const usage = Object.entries(sum.usage).map(([jobId, v]) => ({ job: L.job(jobId), v })).sort((a, b) => b.v - a.v);
  const cats = [...new Set([...STOCK_CATEGORIES, ...db.items.map((i) => i.category)])];
  return (
    <>
      <PageHeader title={t('Inventory')} sub="Timber, boards, laminates, hardware, paints and finished products — with every movement recorded."
        actions={<><SearchBox value={q} onChange={setQ} />{can && <><button className="btn" onClick={() => open('in')}><ArrowDownToLine size={16} />Stock in</button><button className="btn" onClick={() => open('out')}><ArrowUpFromLine size={16} />Issue to project</button>
          <button className="btn primary" onClick={() => setEdit({ kind: tab === 'product' ? 'product' : 'material', unit: tab === 'product' ? 'pcs' : 'sheet', qty: 0, cost: 0, price: 0, reorder: 0, category: tab === 'product' ? 'Furniture' : 'Plywood', showOnWebsite: tab === 'product' })}><Plus size={16} />Add item</button></>}</>} />
      <div className="grid g4 mb">
        <Stat label="Stock value (cost)" value={money(sum.value, s)} icon={<Boxes size={20} />} tone="wood" />
        <Stat label="Items" value={db.items.length} icon={<Package size={20} />} tone="blue" sub={`${db.items.filter((i) => i.kind === 'product').length} products for sale`} />
        <Stat label={t('Low stock')} value={<span className={sum.low.length ? 'neg' : ''}>{sum.low.length}</span>} icon={<AlertTriangle size={20} />} tone="red" sub="at or below minimum" />
        <Stat label="Wastage (period)" value={money(sum.waste, s)} icon={<Recycle size={20} />} tone="amber" />
      </div>
      <div className="toolbar"><Tabs value={tab} onChange={setTab} tabs={[
        { id: 'material', label: 'Materials', count: db.items.filter((i) => i.kind === 'material').length }, { id: 'product', label: 'Products for sale', count: db.items.filter((i) => i.kind === 'product').length },
        { id: 'moves', label: 'Stock movements', count: sum.moves.length }, { id: 'usage', label: 'Usage per project' }, { id: 'value', label: 'Valuation' }, { id: 'low', label: 'Low stock', count: sum.low.length }]} />
        {['moves', 'usage'].includes(tab) && <><input type="date" style={{ width: 'auto' }} value={from} onChange={(e) => setFrom(e.target.value)} /> → <input type="date" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)} /></>}
      </div>

      {(tab === 'material' || tab === 'product') && <div className="card">
        {list.length ? <div className="table-wrap"><table>
          <thead><tr><th>Item</th><th>Category</th><th>Spec</th>{locs.length > 1 && <th>Where</th>}<th className="num">Cost</th><th className="num">Price</th><th className="num">In stock</th><th /></tr></thead>
          <tbody>{list.map((i) => { const lq = locQty(db, i); return <tr key={i.id} className={can ? 'click' : ''} onClick={() => can && setEdit({ ...i })}>
            <td><div className="flex">{i.image && <img src={i.image} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: 'cover' }} />}<div><b>{i.name}</b><div className="muted">{i.sku}</div></div></div></td>
            <td>{i.category}</td><td className="muted">{[i.thickness, i.size].filter(Boolean).join(' · ') || '—'}</td>
            {locs.length > 1 && <td className="muted" style={{ fontSize: 12 }}>{Object.entries(lq).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}</td>}
            <td className="num">{i.cost === undefined ? '—' : money(i.cost, s)}</td><td className="num">{money(i.price, s)}</td>
            <td className="num"><Badge tone={i.reorder > 0 && i.qty <= i.reorder ? 'red' : 'green'}>{i.qty} {i.unit}</Badge>{i.reorder > 0 && <div className="muted" style={{ fontSize: 11 }}>min {i.reorder}</div>}</td>
            <td onClick={(e) => e.stopPropagation()}>{can && <div className="row-actions">
              <button className="icon-btn" title="Stock in" onClick={() => open('in', i.id)}><ArrowDownToLine size={15} /></button>
              <button className="icon-btn" title="Issue to project" onClick={() => open('out', i.id)}><ArrowUpFromLine size={15} /></button>
              {locs.length > 1 && <button className="icon-btn" title="Transfer" onClick={() => open('transfer', i.id)}><ArrowLeftRight size={15} /></button>}
              <button className="icon-btn" title="Wastage" onClick={() => open('waste', i.id)}><Recycle size={15} /></button>
              <button className="icon-btn" title="Stock count" onClick={() => open('adjust', i.id)}><ClipboardCheck size={15} /></button></div>}</td>
          </tr>; })}</tbody></table></div> : <Empty title="Nothing here yet" />}
      </div>}

      {tab === 'moves' && <div className="card">
        <div className="flex between"><h3>Stock movements</h3><ExportButtons name="stock-movements" head={['Date', 'Item', 'Type', 'Qty', 'Unit', 'Value', 'Project', 'From', 'To', 'Note', 'By']}
          rows={moves.map((m) => { const it = L.item(m.itemId); return [m.date, it?.name || '', MOVE_LABEL[m.kind], m.qty, it?.unit || '', +(m.qty * (Number(m.cost) || 0)).toFixed(3), L.job(m.jobId)?.code || '', m.from || '', m.to || '', m.note || '', m.by || '']; })} /></div>
        {moves.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>Type</th><th className="num">Qty</th><th className="num">Value</th><th>Project / place</th><th>Note</th></tr></thead>
          <tbody>{moves.map((m) => { const it = L.item(m.itemId); return <tr key={m.id}><td>{fmtDate(m.date)}</td><td><b>{it?.name || '—'}</b> <span className="muted">{it?.thickness}</span></td><td><Badge tone={MOVE_TONE[m.kind]}>{MOVE_LABEL[m.kind]}</Badge></td>
            <td className="num">{['out', 'waste', 'return', 'sale'].includes(m.kind) ? '−' : ['in', 'saleReturn'].includes(m.kind) ? '+' : ''}{m.qty} {it?.unit}</td><td className="num">{money(m.qty * (Number(m.cost) || 0), s)}</td>
            <td>{m.jobId ? <><span className="code-tag">{L.job(m.jobId)?.code}</span> {L.job(m.jobId)?.title}</> : m.kind === 'transfer' ? `${m.from} → ${m.to}` : m.to || m.from || ''}</td><td className="muted">{m.note}{m.by ? ` · ${m.by}` : ''}</td></tr>; })}</tbody></table></div>
          : <Empty title="No movements in this period" hint="Stock in, issues to projects, transfers, wastage and counts are listed here." />}
      </div>}

      {tab === 'usage' && <div className="card">
        <div className="flex between"><h3>Material used per project</h3><ExportButtons name="material-usage" head={['Project', 'Title', 'Value']} rows={usage.map((u) => [u.job?.code || '', u.job?.title || '', +u.v.toFixed(3)])} /></div>
        {usage.length ? <div className="table-wrap"><table><thead><tr><th>Project</th><th>Materials issued</th><th className="num">Value</th></tr></thead>
          <tbody>{usage.map(({ job, v }) => <tr key={job?.id || 'x'}><td><span className="code-tag">{job?.code}</span> {job?.title}</td>
            <td className="muted">{sum.moves.filter((m) => m.kind === 'out' && m.jobId === job?.id).map((m) => `${L.item(m.itemId)?.name} × ${m.qty}`).join(', ')}</td><td className="num"><b>{money(v, s)}</b></td></tr>)}</tbody></table></div>
          : <Empty title="No material issued to projects in this period" />}
      </div>}

      {tab === 'value' && <div className="card">
        <div className="flex between"><h3>Stock valuation (at cost)</h3><span className="flex"><ExportButtons name="stock-valuation" head={['Item', 'Category', 'Qty', 'Unit', 'Cost', 'Value']} rows={db.items.map((i) => [i.name, i.category, i.qty, i.unit, i.cost, +(i.qty * i.cost).toFixed(3)])} /></span></div>
        <div className="table-wrap"><table><thead><tr><th>Category</th><th className="num">Items</th><th className="num">Quantity</th><th className="num">Value</th></tr></thead>
          <tbody>{Object.entries(sum.byCat).sort((a, b) => b[1].value - a[1].value).map(([c, v]) => <tr key={c}><td>{c}</td><td className="num">{v.items}</td><td className="num">{+v.qty.toFixed(2)}</td><td className="num">{money(v.value, s)}</td></tr>)}
            <tr className="total-row"><td>Total</td><td /><td /><td className="num">{money(sum.value, s)}</td></tr></tbody></table></div>
      </div>}

      {tab === 'low' && <div className="card">
        <div className="flex between"><h3>Below minimum stock</h3><button className="btn sm" onClick={() => window.print()}><Printer size={14} />Print</button></div>
        {sum.low.length ? <ul className="list">{sum.low.map((i) => <li key={i.id}><AlertTriangle size={16} color="#c0392b" /><div className="grow"><div className="title">{i.name} {i.thickness}</div><div className="muted">{i.category}</div></div><Badge tone="red">{i.qty} {i.unit} left · min {i.reorder}</Badge></li>)}</ul>
          : <Empty title="All stock above minimum 👍" hint="Set a minimum (reorder level) on each item to get alerts." />}
      </div>}

      {mv && <Modal open title={MOVE_LABEL[mv.kind!]} onClose={() => setMv(null)} footer={<><span className="spacer" /><button className="btn" onClick={() => setMv(null)}>Cancel</button><button className="btn primary" onClick={doMove}>Save</button></>}>
        <div className="form two">
          <Field label="Type"><select value={mv.kind} onChange={(e) => setMv({ ...mv, kind: e.target.value as StockMove['kind'] })}>{(['in', 'out', 'transfer', 'waste', 'adjust'] as const).map((k) => <option key={k} value={k}>{MOVE_LABEL[k]}</option>)}</select></Field>
          <Field label="Date"><input type="date" value={mv.date} onChange={(e) => setMv({ ...mv, date: e.target.value })} /></Field>
          <Field label="Item" span={3}><select value={mv.itemId || ''} onChange={(e) => setMv({ ...mv, itemId: e.target.value })}>{db.items.map((i) => <option key={i.id} value={i.id}>{i.name} {i.thickness || ''} — {i.qty} {i.unit}</option>)}</select></Field>
          <Field label={mv.kind === 'adjust' ? 'Counted quantity' : 'Quantity'}><input type="number" autoFocus value={mv.qty ?? ''} onChange={(e) => setMv({ ...mv, qty: +e.target.value })} /></Field>
          {mv.kind === 'in' && <Field label={`Cost per unit (${s.currency})`}><input type="number" value={mv.cost ?? ''} placeholder={String(L.item(mv.itemId)?.cost ?? '')} onChange={(e) => setMv({ ...mv, cost: e.target.value === '' ? undefined : +e.target.value })} /></Field>}
          {mv.kind === 'out' && <Field label="For project"><select value={mv.jobId || ''} onChange={(e) => setMv({ ...mv, jobId: e.target.value || undefined })}><option value="">— choose —</option>{db.jobs.filter((j) => !['completed', 'cancelled'].includes(j.status)).map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>}
          {mv.kind !== 'in' && locs.length > 1 && <Field label={mv.kind === 'transfer' ? 'From' : 'Location'}><select value={mv.from} onChange={(e) => setMv({ ...mv, from: e.target.value })}>{locs.map((l) => <option key={l}>{l}</option>)}</select></Field>}
          {['in', 'transfer'].includes(mv.kind!) && locs.length > 1 && <Field label="To"><select value={mv.to} onChange={(e) => setMv({ ...mv, to: e.target.value })}>{locs.map((l) => <option key={l}>{l}</option>)}</select></Field>}
          <Field label="Note" span={3}><input value={mv.note || ''} onChange={(e) => setMv({ ...mv, note: e.target.value })} placeholder={mv.kind === 'waste' ? 'Offcuts, damaged sheet…' : ''} /></Field>
        </div>
        {mv.kind === 'out' && <p className="muted">The value is added to the project’s material cost.</p>}
        {locs.length < 2 && <p className="muted">Add store locations (Main store, Workshop, Site…) in Settings to use transfers.</p>}
      </Modal>}

      {edit && <Modal open title={edit.id ? 'Edit item' : 'New item'} onClose={() => setEdit(null)} footer={<>
        {edit.id && <button className="btn danger ghost" onClick={() => { if (db.stockMoves.some((m) => m.itemId === edit.id)) return toast('This item has stock movements and cannot be deleted. Set its quantity to 0 instead.'); if (confirmDelete(edit.name)) { store.remove('items', edit.id!); setEdit(null); } }}><Trash2 size={15} />Delete</button>}
        <span className="spacer" /><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
        <div className="form">
          <Field label="Name" span={2}><input autoFocus value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Marine plywood" /></Field>
          <Field label="Type"><select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Item['kind'] })}><option value="material">Material</option><option value="product">Product for sale</option></select></Field>
          <Field label="Category"><input list="cats" value={edit.category || ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /><datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="SKU / code"><input value={edit.sku || ''} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} /></Field>
          <Field label="Unit"><input value={edit.unit || ''} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} placeholder="sheet, pcs, cft, litre, box" /></Field>
          <Field label="Thickness"><input value={edit.thickness || ''} onChange={(e) => setEdit({ ...edit, thickness: e.target.value })} placeholder="18mm" /></Field>
          <Field label="Size"><input value={edit.size || ''} onChange={(e) => setEdit({ ...edit, size: e.target.value })} placeholder="1220×2440" /></Field>
          <Field label={edit.id ? 'Quantity (use Stock count to change)' : 'Opening quantity'}><input type="number" disabled={!!edit.id} value={edit.qty ?? 0} onChange={(e) => setEdit({ ...edit, qty: +e.target.value })} /></Field>
          <Field label={`Cost price (${s.currency})`}><input type="number" value={edit.cost ?? 0} onChange={(e) => setEdit({ ...edit, cost: +e.target.value })} /></Field>
          <Field label={`Selling price (${s.currency})`}><input type="number" value={edit.price ?? 0} onChange={(e) => setEdit({ ...edit, price: +e.target.value })} /></Field>
          <Field label="Minimum stock (alert)"><input type="number" value={edit.reorder ?? 0} onChange={(e) => setEdit({ ...edit, reorder: +e.target.value })} /></Field>
          <Field label="Image URL" span={2}><input value={edit.image || ''} onChange={(e) => setEdit({ ...edit, image: e.target.value })} placeholder="https://…" /></Field>
          <Field label="Show on website"><select value={edit.showOnWebsite ? '1' : '0'} onChange={(e) => setEdit({ ...edit, showOnWebsite: e.target.value === '1' })}><option value="1">Yes</option><option value="0">No</option></select></Field>
          <Field label="Description" span={3}><textarea value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
        </div>
      </Modal>}
    </>
  );
}
