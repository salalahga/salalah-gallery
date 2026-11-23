import { useState } from 'react';
import { api, qs } from '../core/api';
import { t } from '../core/i18n';
import { money, parseMoney, useSession, variantName, dateTime, date } from '../core/session';
import { LabelPrinter, type LabelItem } from '../components/Labels';
import { ScanBox, useScanner, beep } from '../core/scanner';
import { SYMBOLOGIES } from '../../shared/barcode.js';
import { ProductImport } from './ProductImport';
import { Bottle, Card, Empty, Field, Loading, Modal, PageHead, Status, Tabs, TestBadge, toast, useAction, useData, download } from '../components/ui';

type Tab = 'stock' | 'transfers' | 'counts' | 'valuation' | 'expiry';

export default function Inventory() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('stock');
  const tabs: [Tab, string][] = [['stock', 'Stock'], ['transfers', 'Transfers'], ['counts', 'Stock-taking'], ['expiry', 'Batches & expiry']];
  if (can('finance') || can('inventory', 'manage')) tabs.push(['valuation', 'Valuation']);
  return (
    <>
      <PageHead title={t('Inventory')} sub="Stock per branch. Every change is recorded as a movement." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'stock' && <Stock />}
      {tab === 'transfers' && <Transfers />}
      {tab === 'counts' && <Counts />}
      {tab === 'valuation' && <Valuation />}
      {tab === 'expiry' && <Expiry />}
    </>
  );
}

function Stock() {
  const { can, me } = useSession();
  const { data: branches } = useData<any[]>('/branches');
  const [f, setF] = useState({ branchId: '', search: '', low: false });
  const { data, reload } = useData<any[]>('/inventory' + qs({ branchId: f.branchId, search: f.search, low: f.low ? 1 : '' }), [f.branchId, f.search, f.low]);
  const [edit, setEdit] = useState<string | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [adj, setAdj] = useState<any>(null);
  const [moves, setMoves] = useState<any>(null);
  const [labels, setLabels] = useState<LabelItem[] | null>(null);
  const toLabel = (v: any, copies = 1): LabelItem => ({ id: v.id, barcode: v.barcode, symbology: v.symbology, original_price: v.original_price, sku: v.sku, name: v.name, brand: v.brand, label: v.label, size_ml: v.size_ml, retail_price: v.retail_price, copies });
  return (
    <>
      <div className="card row" style={{ marginBottom: 12 }}>
        <input placeholder="Search name, brand, SKU or scan barcode" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} style={{ flex: 2, minWidth: 200 }} />
        {!me.branchScope && <select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })} style={{ width: 'auto' }}><option value="">All branches</option>{branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        <label className="check"><input type="checkbox" checked={f.low} onChange={(e) => setF({ ...f, low: e.target.checked })} /> Low stock only</label>
        <div className="grow" />
        {can('reports', 'export') && <button className="btn" onClick={() => download('/export/inventory')}>CSV</button>}
        {data && data.length > 0 && <button className="btn" onClick={() => setLabels(data.map((v) => toLabel(v, 1)))}>Print barcode labels</button>}
        {can('inventory', 'create') && <button className="btn" onClick={() => setImporting(true)}>Import Excel</button>}
        {can('inventory', 'create') && <button className="btn primary" onClick={() => setEdit('new')}>+ Product</button>}
      </div>
      <div className="card tablewrap">
        {!data ? <Loading /> : !data.length ? <Empty>{f.search || f.low || f.branchId ? 'No products' : <>No products yet — add one with <b>+ Product</b>, or many at once with <b>Import Excel</b>.</>}</Empty> : (
          <table className="t">
            <thead><tr><th></th><th>Product</th><th>SKU / barcode</th><th className="num">Retail</th>{me.seeCost && <th className="num">Avg cost</th>}<th className="num">In stock</th><th className="num">Min</th><th></th></tr></thead>
            <tbody>{data.map((v) => (
              <tr key={v.id}>
                <td><Bottle name={v.brand || v.name} url={v.image_url} /></td>
                <td><b>{variantName(v)}</b> <TestBadge on={v.is_test} /><div className="small muted">{v.category} · {v.concentration}{!v.web_visible && ' · hidden online'}</div></td>
                <td className="small">{v.sku}<div className="muted">{v.barcode}</div></td>
                <td className="num">{money(v.retail_price)}</td>
                {me.seeCost && <td className="num">{money(v.avg_cost)}</td>}
                <td className="num"><b className={v.qty <= 0 ? 'bad' : v.qty <= v.min_stock ? 'warn' : ''}>{v.qty}</b></td>
                <td className="num muted">{v.min_stock}</td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost sm" onClick={() => setLabels([toLabel(v, Math.max(1, v.qty))])}>Label</button>
                  <button className="btn ghost sm" onClick={() => setMoves(v)}>History</button>
                  {can('inventory', 'manage') && <button className="btn ghost sm" onClick={() => setAdj(v)}>Adjust</button>}
                  {can('inventory', 'edit') && <button className="btn ghost sm" onClick={() => setEdit(v.product_id)}>Edit</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {edit && <ProductForm id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      {importing && <ProductImport onClose={() => setImporting(false)} onDone={reload} />}
      {adj && <Adjust v={adj} branches={branches || []} onClose={() => setAdj(null)} onDone={() => { setAdj(null); reload(); }} />}
      {moves && <Movements v={moves} onClose={() => setMoves(null)} />}
      {labels && <LabelPrinter items={labels} onClose={() => setLabels(null)} />}
    </>
  );
}

export function ProductForm({ id, onClose, onDone, barcode }: { id: string | null; onClose: () => void; onDone: () => void; barcode?: string }) {
  const [printItems, setPrintItems] = useState<LabelItem[] | null>(null);
  const { me, can } = useSession();
  const { data: brands, reload: rb } = useData<any[]>('/brands');
  const { data: cats, reload: rc } = useData<any[]>('/categories');
  const { data: existing } = useData<any>(id ? `/products/${id}` : null);
  const [p, setP] = useState<any>(null);
  const { busy, run } = useAction();
  const blankVariant = () => ({ sizeMl: '', label: '', sku: '', barcode: '', symbology: 'auto', comparePrice: '', retailPrice: '', webPrice: '', wholesalePrice: '', vatRateBp: me.settings.tax.defaultRateBp, minStock: 2, openingQty: '', unitCost: '', batchNo: '', expiryDate: '' });
  if (!p) {
    if (id && !existing) return <Modal title="Product" onClose={onClose}><Loading /></Modal>;
    const e = existing;
    setP(e ? {
      name: e.name, nameAr: e.name_ar || '', brandId: e.brand_id || '', categoryId: e.category_id || '', gender: e.gender || '', concentration: e.concentration || '', description: e.description || '', descriptionAr: e.description_ar || '',
      notesTop: e.notes_top || '', notesHeart: e.notes_heart || '', notesBase: e.notes_base || '', imageUrl: e.image_url || '', webVisible: e.web_visible, active: e.active,
      variants: e.variants.map((v: any) => ({ id: v.id, sizeMl: v.size_ml ?? '', label: v.label || '', sku: v.sku, barcode: v.barcode || '', symbology: v.symbology || 'auto', comparePrice: v.compare_price != null ? money(v.compare_price) : '', retailPrice: money(v.retail_price), webPrice: v.web_price != null ? money(v.web_price) : '', wholesalePrice: v.wholesale_price != null ? money(v.wholesale_price) : '', vatRateBp: v.vat_rate_bp, minStock: v.min_stock, active: v.active })),
    } : { name: '', nameAr: '', brandId: '', categoryId: '', gender: 'unisex', concentration: 'Eau de Parfum', description: '', descriptionAr: '', notesTop: '', notesHeart: '', notesBase: '', imageUrl: '', webVisible: true, active: true, variants: [{ ...blankVariant(), barcode: barcode || '' }] });
    return null;
  }
  const set = (k: string, v: unknown) => setP({ ...p, [k]: v });
  const setV = (i: number, k: string, v: unknown) => set('variants', p.variants.map((x: any, j: number) => (j === i ? { ...x, [k]: v } : x)));
  const upload = async (file: File) => {
    const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });
    const r = await api.post('/files', { data }).catch((e) => toast(e.message, true));
    if (r) set('imageUrl', r.url);
  };
  const addBrand = async () => { const n = prompt('Brand name'); if (n) { const r = await api.post('/brands', { name: n }); await rb(); set('brandId', r.id); } };
  const addCat = async () => { const n = prompt('Category name'); if (n) { const r = await api.post('/categories', { name: n }); await rc(); set('categoryId', r.id); } };
  const save = () => run(async () => {
    const body = { ...p, branchId: me.user.branchId || 'br_main', variants: p.variants.map((v: any) => ({ ...v, retailPrice: parseMoney(v.retailPrice), comparePrice: v.comparePrice ? parseMoney(v.comparePrice) : null, webPrice: v.webPrice ? parseMoney(v.webPrice) : null, wholesalePrice: v.wholesalePrice ? parseMoney(v.wholesalePrice) : null, unitCost: v.unitCost ? parseMoney(v.unitCost) : 0, openingQty: v.openingQty ? Number(v.openingQty) : 0, sizeMl: v.sizeMl ? Number(v.sizeMl) : null, vatRateBp: Number(v.vatRateBp), minStock: Number(v.minStock) })) };
    const r = id ? await api.put(`/products/${id}`, body) : await api.post('/products', body);
    // offer barcode labels straight away (copies = opening stock for new products)
    const saved = await api.get(`/products/${id || r.id}`);
    const brand = brands?.find((b) => b.id === p.brandId)?.name;
    setPrintItems(saved.variants.map((v: any) => {
      const typed = p.variants.find((x: any) => x.sku === v.sku);
      return { id: v.id, barcode: v.barcode, symbology: v.symbology, original_price: v.compare_price, sku: v.sku, name: saved.name, brand, label: v.label, size_ml: v.size_ml, retail_price: v.retail_price, copies: Number(typed?.openingQty) || 1 };
    }));
    return r;
  }, 'Product saved');
  const genBarcode = async (i: number) => { const r = await api.post('/barcodes/next').catch((e) => toast(e.message, true)); if (r) setV(i, 'barcode', r.barcode); };
  if (printItems) return <LabelPrinter items={printItems} onClose={() => { setPrintItems(null); onDone(); }} />;
  return (
    <Modal wide title={id ? 'Edit product' : 'New product'} onClose={onClose} footer={<button className="btn primary" disabled={busy || !p.name} onClick={save}>Save</button>}>
      <div className="grid g2">
        <div className="col">
          <div className="row"><Bottle name={p.name} url={p.imageUrl} /><label className="btn sm">Upload photo<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label></div>
          <Field label="Name"><input value={p.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Name (Arabic)"><input value={p.nameAr} onChange={(e) => set('nameAr', e.target.value)} dir="rtl" /></Field>
          <div className="row">
            <Field label="Brand"><select value={p.brandId} onChange={(e) => set('brandId', e.target.value)}><option value="">—</option>{brands?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
            <button className="btn sm" style={{ marginTop: 18 }} onClick={addBrand} title="Add a new brand" aria-label="Add a new brand">+ New</button>
            <Field label="Category"><select value={p.categoryId} onChange={(e) => set('categoryId', e.target.value)}><option value="">—</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <button className="btn sm" style={{ marginTop: 18 }} onClick={addCat} title="Add a new category" aria-label="Add a new category">+ New</button>
          </div>
          <div className="row">
            <Field label="For"><select value={p.gender} onChange={(e) => set('gender', e.target.value)}>{['men', 'women', 'unisex', 'kids'].map((g) => <option key={g}>{g}</option>)}</select></Field>
            <Field label="Type"><select value={p.concentration} onChange={(e) => set('concentration', e.target.value)}>{['Eau de Parfum', 'Eau de Toilette', 'Parfum / Extrait', 'Eau de Cologne', 'Perfume oil', 'Bakhoor', 'Gift set', 'Body mist', 'Other'].map((g) => <option key={g}>{g}</option>)}</select></Field>
          </div>
        </div>
        <div className="col">
          <Field label="Description"><textarea rows={3} value={p.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <Field label="Description (Arabic)"><textarea rows={2} value={p.descriptionAr} onChange={(e) => set('descriptionAr', e.target.value)} dir="rtl" /></Field>
          <div className="row"><Field label="Top notes"><input value={p.notesTop} onChange={(e) => set('notesTop', e.target.value)} /></Field><Field label="Heart"><input value={p.notesHeart} onChange={(e) => set('notesHeart', e.target.value)} /></Field><Field label="Base"><input value={p.notesBase} onChange={(e) => set('notesBase', e.target.value)} /></Field></div>
          <label className="check"><input type="checkbox" checked={p.webVisible} onChange={(e) => set('webVisible', e.target.checked)} /> Show on the website</label>
          <label className="check"><input type="checkbox" checked={p.active} onChange={(e) => set('active', e.target.checked)} /> Active (can be sold)</label>
        </div>
      </div>
      <h3 style={{ marginTop: 14 }}>Sizes & prices (OMR, {me.settings.tax.pricesIncludeVat ? 'VAT included' : 'before VAT'})</h3>
      {p.variants.map((v: any, i: number) => (
        <div key={i} className="card" style={{ padding: 14, marginBottom: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <b>Size {i + 1}</b>
            {!v.id && p.variants.length > 1 && <button className="btn ghost sm" onClick={() => set('variants', p.variants.filter((_: any, j: number) => j !== i))}>Remove</button>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            <Field label="Size (ml)"><input value={v.sizeMl} onChange={(e) => setV(i, 'sizeMl', e.target.value)} inputMode="numeric" placeholder="100" /></Field>
            <Field label="Retail price (OMR) *"><input value={v.retailPrice} onChange={(e) => setV(i, 'retailPrice', e.target.value)} inputMode="decimal" placeholder="15.750" /></Field>
            {!id && can('inventory', 'manage') && <>
              <Field label="Opening stock (qty)"><input value={v.openingQty} onChange={(e) => setV(i, 'openingQty', e.target.value)} inputMode="numeric" placeholder="0" /></Field>
              <Field label="Unit cost (OMR)"><input value={v.unitCost} onChange={(e) => setV(i, 'unitCost', e.target.value)} inputMode="decimal" /></Field>
            </>}
            <Field label="Label"><input value={v.label} onChange={(e) => setV(i, 'label', e.target.value)} placeholder="Standard" /></Field>
            <Field label="Original price (crossed out)"><input value={v.comparePrice} onChange={(e) => setV(i, 'comparePrice', e.target.value)} inputMode="decimal" placeholder="—" /></Field>
            <Field label="Website price"><input value={v.webPrice} onChange={(e) => setV(i, 'webPrice', e.target.value)} inputMode="decimal" placeholder="= retail" /></Field>
            <Field label="Wholesale price"><input value={v.wholesalePrice} onChange={(e) => setV(i, 'wholesalePrice', e.target.value)} inputMode="decimal" /></Field>
            <Field label="Low-stock alert at"><input value={v.minStock} onChange={(e) => setV(i, 'minStock', e.target.value)} inputMode="numeric" /></Field>
            <Field label="VAT (500 = 5 %)"><input value={v.vatRateBp} onChange={(e) => setV(i, 'vatRateBp', e.target.value)} inputMode="numeric" /></Field>
            <Field label="SKU"><input value={v.sku} onChange={(e) => setV(i, 'sku', e.target.value)} placeholder="auto" /></Field>
            <Field label="Barcode">{v.id && !can('barcodes', 'manage') ? <span title="Only the owner/admin can change an existing barcode">{v.barcode} 🔒</span> : <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><input value={v.barcode} onChange={(e) => setV(i, 'barcode', e.target.value)} placeholder="scan / auto" style={{ minWidth: 0 }} /><button className="btn ghost sm" title="Generate an in-store barcode" onClick={() => genBarcode(i)}>Gen</button></div>}</Field>
            <Field label="Barcode type"><select value={v.symbology} disabled={!!v.id && !can('barcodes', 'manage')} onChange={(e) => setV(i, 'symbology', e.target.value)}><option value="auto">Auto</option>{Object.entries(SYMBOLOGIES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
            {!id && can('inventory', 'manage') && <>
              <Field label="Batch no."><input value={v.batchNo} onChange={(e) => setV(i, 'batchNo', e.target.value)} /></Field>
              <Field label="Expiry date"><input type="date" value={v.expiryDate} onChange={(e) => setV(i, 'expiryDate', e.target.value)} /></Field>
            </>}
          </div>
        </div>
      ))}
      <button className="btn sm" onClick={() => set('variants', [...p.variants, blankVariant()])}>+ Size</button>
      <div className="small muted" style={{ marginTop: 6 }}>Barcode: scan the code printed on the perfume box, or leave it empty and an in-store barcode is created automatically. Every size gets its own barcode and SKU; duplicates are refused. Labels can be printed right after saving.</div>
      <div className="small muted" style={{ marginTop: 6 }}>VAT is in basis points: 500 = 5 %. Opening stock goes to your branch and is booked at the unit cost.</div>
    </Modal>
  );
}

function Adjust({ v, branches, onClose, onDone }: { v: any; branches: any[]; onClose: () => void; onDone: () => void }) {
  const { me } = useSession();
  const [f, setF] = useState({ branchId: me.user.branchId || branches[0]?.id, reason: 'damage', qty: '-1', note: '' });
  const { busy, run } = useAction();
  return (
    <Modal title={`Adjust stock — ${variantName(v)}`} onClose={onClose} footer={<button className="btn primary" disabled={busy || !f.note} onClick={() => run(() => api.post('/inventory/adjust', { ...f, variantId: v.id, qty: Number(f.qty) }), 'Stock adjusted').then((r) => r && onDone())}>Save</button>}>
      <div className="col">
        <Field label="Branch"><select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Reason"><select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value, qty: e.target.value === 'adjustment' ? f.qty : String(-Math.abs(Number(f.qty) || 1)) })}><option value="damage">Damaged</option><option value="loss">Lost / stolen</option><option value="expired">Expired</option><option value="adjustment">Correction (+ or −)</option></select></Field>
        <Field label="Quantity (negative removes stock)"><input value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} inputMode="numeric" /></Field>
        <Field label="Note (required)"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div className="small muted">The value at average cost is booked to “Stock shrinkage, damage & loss”.</div>
      </div>
    </Modal>
  );
}

function Movements({ v, onClose }: { v: any; onClose: () => void }) {
  const { data } = useData<any[]>('/inventory/movements' + qs({ variantId: v.id }));
  return (
    <Modal wide title={`Stock history — ${variantName(v)}`} onClose={onClose}>
      {!data ? <Loading /> : !data.length ? <Empty>No movements</Empty> : (
        <table className="t"><thead><tr><th>When</th><th>Branch</th><th>Reason</th><th>Reference</th><th>By</th><th className="num">Qty</th></tr></thead>
          <tbody>{data.map((m) => <tr key={m.id}><td>{dateTime(m.at)}</td><td>{m.branch}</td><td>{m.reason.replace('_', ' ')}</td><td className="small">{m.ref_type} {m.note}</td><td>{m.user_name}</td><td className={'num ' + (m.qty < 0 ? 'bad' : 'ok')}>{m.qty > 0 ? '+' : ''}{m.qty}</td></tr>)}</tbody></table>
      )}
    </Modal>
  );
}

function Transfers() {
  const { can } = useSession();
  const { data, reload } = useData<any[]>('/inventory/transfers');
  const { data: branches } = useData<any[]>('/branches');
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}><div className="grow" />{can('inventory', 'edit') && <button className="btn primary" onClick={() => setOpen(true)}>+ Transfer stock</button>}</div>
      <div className="card tablewrap">{!data ? <Loading /> : !data.length ? <Empty>No transfers yet</Empty> : (
        <table className="t"><thead><tr><th>Number</th><th>Date</th><th>From → To</th><th>Items</th></tr></thead>
          <tbody>{data.map((t) => <tr key={t.id}><td>{t.number}</td><td>{dateTime(t.created_at)}</td><td>{t.from_name} → {t.to_name}</td><td className="small">{(t.lines || []).map((l: any) => `${l.qty} × ${l.name} (${l.sku})`).join(', ')}</td></tr>)}</tbody></table>
      )}</div>
      {open && branches && <TransferForm branches={branches} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
    </>
  );
}

function TransferForm({ branches, onClose, onDone }: { branches: any[]; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState(branches[0]?.id);
  const [to, setTo] = useState(branches[1]?.id || '');
  const [lines, setLines] = useState<Record<string, number>>({});
  const { data: stock } = useData<any[]>('/inventory' + qs({ branchId: from }), [from]);
  const { busy, run } = useAction();
  const [scanMsg, setScanMsg] = useState('');
  const onScan = (code: string) => {
    const s = (stock || []).find((x) => x.barcode === code || x.sku.toLowerCase() === code.toLowerCase());
    if (!s) { beep(false); return setScanMsg(`${code}: not found in this branch`); }
    const n = (lines[s.id] || 0) + 1;
    if (n > s.qty) { beep(false); return setScanMsg(`${variantName(s)}: only ${s.qty} in stock`); }
    beep(true); setScanMsg(`${variantName(s)} × ${n}`); setLines({ ...lines, [s.id]: n });
  };
  useScanner(onScan);
  return (
    <Modal wide title="Transfer stock between branches" onClose={onClose} footer={<button className="btn primary" disabled={busy} onClick={() => run(() => api.post('/inventory/transfer', { fromBranch: from, toBranch: to, lines: Object.entries(lines).filter(([, q]) => q > 0).map(([variantId, qty]) => ({ variantId, qty })) }), 'Transferred').then((r) => r && onDone())}>Transfer</button>}>
      <div className="row"><Field label="From"><select value={from} onChange={(e) => setFrom(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field><Field label="To"><select value={to} onChange={(e) => setTo(e.target.value)}><option value="">—</option>{branches.filter((b) => b.id !== from).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field></div>
      <div style={{ marginTop: 10 }}><ScanBox onScan={onScan} placeholder="Scan each bottle you are sending" />{scanMsg && <div className="small muted">{scanMsg}</div>}</div>
      <div style={{ maxHeight: 360, overflowY: 'auto', marginTop: 10 }}><table className="t"><tbody>{(stock || []).filter((s) => s.qty > 0).map((s) => <tr key={s.id}><td>{variantName(s)}</td><td className="num muted">{s.qty} available</td><td><input type="number" min={0} max={s.qty} value={lines[s.id] || ''} onChange={(e) => setLines({ ...lines, [s.id]: Math.min(s.qty, Number(e.target.value)) })} style={{ width: 80 }} /></td></tr>)}</tbody></table></div>
    </Modal>
  );
}

function Counts() {
  const { can, me } = useSession();
  const { data, reload } = useData<any[]>('/inventory/counts');
  const { data: branches } = useData<any[]>('/branches');
  const [open, setOpen] = useState<string | null>(null);
  const { busy, run } = useAction();
  const [br, setBr] = useState(me.user.branchId || 'br_main');
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}><div className="grow muted">Count the shelves, enter what you find, then post: differences are booked automatically.</div>
        {can('inventory', 'edit') && <><select value={br} onChange={(e) => setBr(e.target.value)} style={{ width: 'auto' }}>{branches?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select><button className="btn primary" disabled={busy} onClick={() => run(() => api.post('/inventory/counts', { branchId: br }), 'Count started').then((r) => { reload(); if (r) setOpen(r.id); })}>Start stock count</button></>}</div>
      <div className="card">{!data ? <Loading /> : !data.length ? <Empty>No stock counts yet</Empty> : <table className="t"><tbody>{data.map((c) => <tr key={c.id} className="click" onClick={() => setOpen(c.id)}><td>{c.number}</td><td>{c.branch}</td><td>{dateTime(c.created_at)}</td><td><Status s={c.status} /></td></tr>)}</tbody></table>}</div>
      {open && <CountSheet id={open} onClose={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function CountSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useSession();
  const { data } = useData<any>(`/inventory/counts/${id}`);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const [scanMsg, setScanMsg] = useState('');
  const onScan = (code: string) => {
    const l = data?.lines.find((x: any) => x.barcode === code || x.sku.toLowerCase() === code.toLowerCase());
    if (!l || data.status !== 'open') { beep(false); return setScanMsg(l ? 'This count is already posted' : `${code}: not part of this count`); }
    const n = Number(counts[l.variant_id] ?? l.counted_qty ?? 0) + 1;
    beep(true); setScanMsg(`${variantName(l)}: counted ${n}`); setCounts({ ...counts, [l.variant_id]: String(n) });
  };
  useScanner(onScan, !!data);
  if (!data) return <Modal title="Stock count" onClose={onClose}><Loading /></Modal>;
  const open = data.status === 'open';
  return (
    <Modal wide title={`Stock count ${data.number}`} onClose={onClose} footer={open && can('inventory', 'manage') ? <button className="btn primary" disabled={busy} onClick={() => run(() => api.post(`/inventory/counts/${id}/post`, { counts }), 'Count posted').then((r) => r && onClose())}>Post differences</button> : <button className="btn" onClick={() => window.print()}>Print</button>}>
      {open && <div style={{ marginBottom: 10 }}><ScanBox onScan={onScan} placeholder="Scan every bottle on the shelf — each scan counts one" />{scanMsg && <div className="small muted">{scanMsg}</div>}</div>}
      <table className="t"><thead><tr><th>Product</th><th>SKU</th><th className="num">System</th><th>Counted</th><th className="num">Difference</th></tr></thead>
        <tbody>{data.lines.map((l: any) => { const c = counts[l.variant_id] ?? (l.counted_qty ?? ''); const d = c === '' ? null : Number(c) - l.system_qty; return (
          <tr key={l.variant_id}><td>{variantName(l)}</td><td className="small">{l.sku}</td><td className="num">{l.system_qty}</td><td>{open ? <input value={c} onChange={(e) => setCounts({ ...counts, [l.variant_id]: e.target.value.replace(/[^\d]/g, '') })} style={{ width: 80 }} inputMode="numeric" /> : l.counted_qty}</td><td className={'num ' + (d ? (d < 0 ? 'bad' : 'ok') : '')}>{d ?? ''}</td></tr>
        ); })}</tbody></table>
    </Modal>
  );
}

function Valuation() {
  const { data } = useData<any[]>('/inventory/valuation');
  const { can } = useSession();
  if (!data) return <Loading />;
  const tot = data.reduce((a, r) => ({ c: a.c + r.cost_value, r: a.r + r.retail_value, u: a.u + r.units }), { c: 0, r: 0, u: 0 });
  return (
    <Card title="Inventory valuation (weighted average cost)" actions={can('reports', 'export') && <button className="btn sm" onClick={() => download('/export/inventory-valuation')}>CSV</button>}>
      <table className="t"><thead><tr><th>Branch</th><th className="num">SKUs</th><th className="num">Units</th><th className="num">At cost</th><th className="num">At retail</th><th className="num">Potential margin</th></tr></thead>
        <tbody>{data.map((r) => <tr key={r.branch}><td>{r.branch}</td><td className="num">{r.skus}</td><td className="num">{r.units}</td><td className="num">{money(r.cost_value)}</td><td className="num">{money(r.retail_value)}</td><td className="num">{money(r.retail_value - r.cost_value)}</td></tr>)}</tbody>
        <tfoot><tr><td>Total</td><td /><td className="num">{tot.u}</td><td className="num">{money(tot.c)}</td><td className="num">{money(tot.r)}</td><td className="num">{money(tot.r - tot.c)}</td></tr></tfoot></table>
      <div className="small muted" style={{ marginTop: 6 }}>Retail values include VAT; cost values exclude it.</div>
    </Card>
  );
}

function Expiry() {
  const { data } = useData<any[]>('/inventory/expiring');
  return <Card title="Batches expiring within 120 days">{!data ? <Loading /> : !data.length ? <Empty>No batch expires soon</Empty> : <table className="t"><tbody>{data.map((b) => <tr key={b.id}><td>{b.name}</td><td>{b.sku}</td><td>Batch {b.batch_no}</td><td className={new Date(b.expiry_date) < new Date() ? 'bad' : 'warn'}>{date(b.expiry_date)}</td></tr>)}</tbody></table>}</Card>;
}
