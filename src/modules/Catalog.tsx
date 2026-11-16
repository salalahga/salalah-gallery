import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Upload, Search, Share2, Building2, Camera, Link2, Loader2, ImageOff, CheckSquare, Square, ExternalLink, Palette } from 'lucide-react';
import { store, useDB } from '../core/store';
import { useRoute, go } from '../core/router';
import type { Brand, CatalogItem } from '../core/types';
import { money } from '../core/calc';
import { Modal, Field, PageHeader, Badge, Empty, SearchBox, toast, confirmDelete } from '../components/ui';
import { compressImage } from '../components/Photos';
import { storePhoto, importImageUrl } from '../core/upload';
import { useCanWrite } from '../core/session';
import { CatalogImport } from './CatalogImport';
import { SelectionList, ShareSelection } from './Selections';

export const CATEGORIES = ['Laminate', 'Board decor', 'Veneer', 'Solid surface', 'Acrylic', 'ACP', 'Edge band', 'Handle', 'Hinge', 'Drawer system', 'Kitchen accessory', 'Paint colour', 'Glass', 'Lighting', 'Other'];
export const googleImages = (q: string) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
export const brandName = (brands: Brand[], id?: string) => brands.find((b) => b.id === id)?.name || '—';

export default function Catalog() {
  const db = useDB(); const s = db.settings; const can = useCanWrite()('catalog'); const { params } = useRoute();
  const [view, setView] = useState<'materials' | 'selections'>('materials');
  const [brand, setBrand] = useState('all'); const [cat, setCat] = useState(''); const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<CatalogItem> | null>(null);
  const [brands, setBrands] = useState(false); const [imp, setImp] = useState(false);
  const [picking, setPicking] = useState(false); const [picked, setPicked] = useState<string[]>([]);
  const [share, setShare] = useState<{ itemIds: string[]; jobId?: string } | null>(null);
  const [big, setBig] = useState<CatalogItem | null>(null);
  useEffect(() => {
    if (params.share) { setPicking(true); setPicked([]); toast('Tick the materials to send, then press Send to customer'); }
    if (params.selections) setView('selections');
    if (params.share || params.selections) go('catalog', params.job ? { job: params.job } : undefined);
  }, [params.share, params.selections]); // eslint-disable-line react-hooks/exhaustive-deps

  const cats = [...new Set([...db.catalog.map((i) => i.category).filter(Boolean)])].sort();
  const list = useMemo(() => db.catalog.filter((i) => (brand === 'all' || i.brandId === brand) && (!cat || i.category === cat)
    && `${i.code} ${i.name} ${i.category} ${i.finish || ''} ${(i.tags || []).join(' ')} ${brandName(db.brands, i.brandId)}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => brandName(db.brands, a.brandId).localeCompare(brandName(db.brands, b.brandId)) || a.code.localeCompare(b.code, undefined, { numeric: true })), [db.catalog, db.brands, brand, cat, q]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const waiting = db.selections.filter((x) => x.status === 'submitted' && !x.quotationId).length;

  return (
    <>
      <PageHeader title="Material catalogue" sub="Laminates, boards, hardware and colours from each company — with pictures and codes. Send a selection link to customers and let them choose."
        actions={<>
          <div className="tabs"><button className={view === 'materials' ? 'on' : ''} onClick={() => setView('materials')}><Palette size={15} />Materials <span className="muted">{db.catalog.length}</span></button>
            <button className={view === 'selections' ? 'on' : ''} onClick={() => setView('selections')}><Share2 size={15} />Customer selections {waiting > 0 && <Badge tone="red">{waiting} new</Badge>}</button></div>
          {can && view === 'materials' && <>
            <button className="btn" onClick={() => setBrands(true)}><Building2 size={16} />Companies</button>
            <button className="btn" onClick={() => { if (!db.brands.length) { toast('Add a company first'); return setBrands(true); } setImp(true); }}><Upload size={16} />Import catalogue</button>
            <button className="btn primary" onClick={() => { if (!db.brands.length) { toast('Add a company first'); return setBrands(true); } setEdit({ brandId: brand !== 'all' ? brand : db.brands[0].id, category: cat || CATEGORIES[0], active: true, unit: 'sheet' }); }}><Plus size={16} />Add material</button>
          </>}
        </>} />

      {view === 'selections' ? <SelectionList /> : <>
        <div className="toolbar">
          <div className="chips">
            <button className={`chip ${brand === 'all' ? 'on' : ''}`} onClick={() => setBrand('all')}>All companies <span className="muted">{db.catalog.length}</span></button>
            {db.brands.map((b) => <button key={b.id} className={`chip ${brand === b.id ? 'on' : ''}`} onClick={() => setBrand(b.id)}>{b.logo && <img src={b.logo} alt="" className="chip-logo" />}{b.name} <span className="muted">{db.catalog.filter((i) => i.brandId === b.id).length}</span></button>)}
          </div>
        </div>
        <div className="toolbar">
          <select style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All types</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
          <SearchBox value={q} onChange={setQ} placeholder="Search code, name, colour…" />
          {can && (picking
            ? <><span className="muted">{picked.length} ticked</span>
              <button className="btn sm" onClick={() => setPicked(picked.length === list.length ? [] : list.map((i) => i.id))}>{picked.length === list.length ? 'Untick all' : 'Tick all shown'}</button>
              <button className="btn sm primary" disabled={!picked.length} onClick={() => setShare({ itemIds: picked, jobId: params.job })}><Share2 size={14} />Send to customer</button>
              <button className="btn sm ghost" onClick={() => { setPicking(false); setPicked([]); }}>Cancel</button></>
            : <button className="btn sm" onClick={() => setPicking(true)}><CheckSquare size={14} />Choose to send</button>)}
        </div>
        {list.length ? <div className="cat-grid">{list.map((i) => { const on = picked.includes(i.id); return (
          <div key={i.id} className={`cat-card ${on ? 'on' : ''} ${i.active === false ? 'off' : ''}`} onClick={() => (picking ? toggle(i.id) : can ? setEdit(structuredClone(i)) : setBig(i))}>
            <div className="cat-img" style={i.image ? { backgroundImage: `url(${i.image})` } : undefined} onClick={(e) => { if (!picking && i.image) { e.stopPropagation(); setBig(i); } }}>{!i.image && <ImageOff size={26} />}
              {picking && <span className="cat-check">{on ? <CheckSquare size={20} /> : <Square size={20} />}</span>}</div>
            <div className="cat-body"><b>{i.code}</b><div className="cat-name">{i.name}</div>
              <div className="muted">{brandName(db.brands, i.brandId)} · {i.category}</div>
              {(i.finish || i.size || i.thickness) && <div className="muted">{[i.finish, i.thickness, i.size].filter(Boolean).join(' · ')}</div>}
              {i.price !== undefined && i.price > 0 && <div className="cat-price">{money(i.price, s)}{i.unit ? ` / ${i.unit}` : ''}</div>}</div>
          </div>); })}</div>
          : <div className="card"><Empty title={db.catalog.length ? 'Nothing matches' : 'No materials yet'} hint={db.brands.length ? 'Add materials one by one, or import a catalogue (pictures, PDF, spreadsheet or a web page).' : 'Start by adding the companies whose materials you use.'} /></div>}
      </>}

      {edit && <ItemForm item={edit} setItem={setEdit} onClose={() => setEdit(null)} />}
      {brands && <BrandsModal onClose={() => setBrands(false)} />}
      {imp && <CatalogImport brandId={brand !== 'all' ? brand : db.brands[0]?.id} onClose={() => setImp(false)} />}
      {share && <ShareSelection itemIds={share.itemIds} jobId={share.jobId} onClose={() => setShare(null)} onDone={() => { setShare(null); setPicking(false); setPicked([]); setView('selections'); }} />}
      {big && <div className="modal-back" onMouseDown={() => setBig(null)}><figure className="cat-big"><img src={big.image} alt={big.name} /><figcaption><b>{big.code}</b> {big.name} · {brandName(db.brands, big.brandId)}</figcaption></figure></div>}
    </>
  );
}

function ItemForm({ item, setItem, onClose }: { item: Partial<CatalogItem>; setItem: (i: Partial<CatalogItem>) => void; onClose: () => void }) {
  const db = useDB(); const s = db.settings;
  const set = (p: Partial<CatalogItem>) => setItem({ ...item, ...p });
  const fileRef = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false); const [url, setUrl] = useState('');
  const brand = db.brands.find((b) => b.id === item.brandId);
  const pick = async (f?: File) => { if (!f) return; setBusy(true); try { set({ image: await storePhoto(await compressImage(f, 1200, 0.8)) }); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  const fromUrl = async () => { if (!url.trim()) return; setBusy(true); try { set({ image: await importImageUrl(url.trim()), sourceUrl: item.sourceUrl || url.trim() }); setUrl(''); toast('Picture added'); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  const save = () => {
    if (!item.brandId) return toast('Choose the company');
    if (!item.code?.trim()) return toast('Enter the material code / number');
    if (db.catalog.some((x) => x.id !== item.id && x.brandId === item.brandId && x.code.trim().toLowerCase() === item.code!.trim().toLowerCase())) return toast(`${brand?.name} ${item.code} is already in the catalogue`);
    store.upsert('catalog', { ...item, code: item.code.trim(), name: (item.name || '').trim() || item.code.trim(), category: item.category || 'Other' } as CatalogItem); onClose(); toast('Material saved');
  };
  const inUse = item.id ? db.selections.filter((x) => x.itemIds.includes(item.id!)).length : 0;
  return (
    <Modal open wide title={item.id ? `${brand?.name || ''} ${item.code}` : 'New material'} onClose={onClose} footer={<>
      {item.id && <button className="btn danger ghost" onClick={() => {
        if (inUse) return toast(`Used in ${inUse} customer selection(s). Set it to Hidden instead.`);
        if (confirmDelete(item.code)) { store.remove('catalog', item.id!); onClose(); } }}><Trash2 size={15} />Delete</button>}
      <a className="btn ghost" target="_blank" rel="noreferrer" href={googleImages(`${brand?.name || ''} ${item.code || ''} ${item.name || ''}`)}><Search size={15} />Find picture online</a>
      <span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="cat-form">
        <div className="cat-form-img">
          <div className="cat-img big" style={item.image ? { backgroundImage: `url(${item.image})` } : undefined}>{busy ? <Loader2 className="spin" /> : !item.image && <ImageOff size={34} />}</div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <div className="flex wrap"><button className="btn sm" type="button" onClick={() => fileRef.current?.click()}><Camera size={14} />Photo / file</button>
            {item.image && <button className="btn sm ghost" type="button" onClick={() => set({ image: undefined })}><Trash2 size={14} />Remove</button>}</div>
          <div className="flex"><input placeholder="…or paste an image link" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fromUrl()} /><button className="btn sm" type="button" disabled={busy || !url} onClick={fromUrl}><Link2 size={14} /></button></div>
        </div>
        <div className="form">
          <Field label="Company"><select value={item.brandId} onChange={(e) => set({ brandId: e.target.value })}>{db.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Code / number"><input autoFocus value={item.code || ''} onChange={(e) => set({ code: e.target.value })} placeholder="e.g. H1145 ST10" /></Field>
          <Field label="Name / colour"><input value={item.name || ''} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Natural Bardolino Oak" /></Field>
          <Field label="Type"><input list="cat-types" value={item.category || ''} onChange={(e) => set({ category: e.target.value })} /><datalist id="cat-types">{[...new Set([...CATEGORIES, ...db.catalog.map((i) => i.category)])].map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Finish / texture"><input value={item.finish || ''} onChange={(e) => set({ finish: e.target.value })} placeholder="Matte, gloss, wood grain…" /></Field>
          <Field label="Thickness"><input value={item.thickness || ''} onChange={(e) => set({ thickness: e.target.value })} placeholder="18mm" /></Field>
          <Field label="Size"><input value={item.size || ''} onChange={(e) => set({ size: e.target.value })} placeholder="1220×2440" /></Field>
          <Field label={`Price (${s.currency}, optional)`}><input type="number" value={item.price ?? ''} onChange={(e) => set({ price: e.target.value === '' ? undefined : +e.target.value })} /></Field>
          <Field label="Per"><input value={item.unit || ''} onChange={(e) => set({ unit: e.target.value })} placeholder="sheet, pcs, m" /></Field>
          <Field label="Tags (comma separated)" span={2}><input value={(item.tags || []).join(', ')} onChange={(e) => set({ tags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="wood, grey, kitchen" /></Field>
          <Field label="Show to customers"><select value={item.active === false ? '0' : '1'} onChange={(e) => set({ active: e.target.value === '1' })}><option value="1">Yes</option><option value="0">Hidden</option></select></Field>
          <Field label="Same as stock item"><select value={item.stockItemId || ''} onChange={(e) => set({ stockItemId: e.target.value || undefined })}><option value="">—</option>{db.items.map((i) => <option key={i.id} value={i.id}>{i.name} {i.thickness || ''}</option>)}</select></Field>
          <Field label="Source / product page" span={2}><div className="flex"><input value={item.sourceUrl || ''} onChange={(e) => set({ sourceUrl: e.target.value })} placeholder="https://…" />{item.sourceUrl && <a className="icon-btn" href={item.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a>}</div></Field>
          <Field label="Notes" span={3}><textarea value={item.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function BrandsModal({ onClose }: { onClose: () => void }) {
  const db = useDB(); const [edit, setEdit] = useState<Partial<Brand> | null>(db.brands.length ? null : {});
  const logoRef = useRef<HTMLInputElement>(null);
  const save = () => {
    if (!edit?.name?.trim()) return toast('Enter the company name');
    if (db.brands.some((b) => b.id !== edit.id && b.name.trim().toLowerCase() === edit.name!.trim().toLowerCase())) return toast('That company is already added');
    store.upsert('brands', { ...edit, name: edit.name.trim() } as Brand); setEdit(null); toast('Company saved');
  };
  return (
    <Modal open title="Material companies" onClose={onClose} footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Close</button>{!edit && <button className="btn primary" onClick={() => setEdit({})}><Plus size={15} />Add company</button>}</>}>
      {edit ? <div className="form two">
        <Field label="Company / brand name" span={2}><input autoFocus value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Egger, Formica, Hettich" /></Field>
        <Field label="Website"><input value={edit.website || ''} onChange={(e) => setEdit({ ...edit, website: e.target.value })} placeholder="https://…" /></Field>
        <Field label="Country"><input value={edit.country || ''} onChange={(e) => setEdit({ ...edit, country: e.target.value })} /></Field>
        <Field label="Bought from (supplier)"><select value={edit.supplierId || ''} onChange={(e) => setEdit({ ...edit, supplierId: e.target.value || undefined })}><option value="">—</option>{db.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Logo"><div className="flex">{edit.logo && <img src={edit.logo} alt="" style={{ height: 32, borderRadius: 6 }} />}
          <input ref={logoRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setEdit({ ...edit, logo: await storePhoto(await compressImage(f, 300, 0.85)) }); }} />
          <button type="button" className="btn sm" onClick={() => logoRef.current?.click()}><Upload size={14} />Upload</button></div></Field>
        <Field label="Notes" span={3}><textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        <div className="span-3 flex"><button className="btn" onClick={() => setEdit(null)}>Back</button><button className="btn primary" onClick={save}>Save</button>
          {edit.id && <button className="btn danger ghost" onClick={() => { const n = db.catalog.filter((i) => i.brandId === edit.id).length; if (n) return toast(`${edit.name} has ${n} materials. Delete or move them first.`); if (confirmDelete(edit.name)) { store.remove('brands', edit.id!); setEdit(null); } }}><Trash2 size={15} />Delete</button>}</div>
      </div> : db.brands.length ? <ul className="list">{db.brands.map((b) => <li key={b.id} style={{ cursor: 'pointer' }} onClick={() => setEdit({ ...b })}>
        {b.logo ? <img src={b.logo} alt="" style={{ height: 30, width: 30, objectFit: 'contain', borderRadius: 6 }} /> : <Building2 size={20} />}
        <div className="grow"><div className="title">{b.name}</div><div className="muted">{[b.country, b.website].filter(Boolean).join(' · ')}</div></div>
        <Badge>{db.catalog.filter((i) => i.brandId === b.id).length} materials</Badge></li>)}</ul> : <Empty title="No companies yet" />}
    </Modal>
  );
}
