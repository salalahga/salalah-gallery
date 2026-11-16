import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Images, FileText, Table, Globe, Loader2, Search, Crop, Plus, Trash2, CheckSquare, Square } from 'lucide-react';
import { store, useDB } from '../core/store';
import type { CatalogItem } from '../core/types';
import { api } from '../core/api';
import { Modal, Field, Tabs, Badge, Empty, toast } from '../components/ui';
import { compressImage } from '../components/Photos';
import { storePhoto, importImageUrl } from '../core/upload';
import { CATEGORIES, googleImages } from './Catalog';

type Draft = { key: string; code: string; name: string; image?: string; src?: string; on: boolean };
const codeFromFile = (name: string) => name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Import many materials at once into one company's catalogue. */
export function CatalogImport({ brandId: initial, onClose }: { brandId?: string; onClose: () => void }) {
  const db = useDB();
  const [tab, setTab] = useState<'pictures' | 'pdf' | 'sheet' | 'web'>('pictures');
  const [brandId, setBrandId] = useState(initial || db.brands[0]?.id || '');
  const [category, setCategory] = useState('Laminate');
  const brand = db.brands.find((b) => b.id === brandId);
  const exists = (code: string) => db.catalog.some((x) => x.brandId === brandId && x.code.trim().toLowerCase() === code.trim().toLowerCase());
  const addItems = (rows: Partial<CatalogItem>[]) => {
    let n = 0; let skipped = 0;
    for (const r of rows) {
      if (!r.code?.trim()) { skipped++; continue; }
      if (exists(r.code)) { skipped++; continue; }
      store.upsert('catalog', { brandId, category, active: true, ...r, code: r.code.trim(), name: (r.name || '').trim() || r.code.trim() } as CatalogItem); n++;
    }
    toast(`${n} material${n === 1 ? '' : 's'} added to ${brand?.name}${skipped ? ` · ${skipped} skipped (no code or already there)` : ''}`);
    return n;
  };
  return (
    <Modal open wide title="Import catalogue" onClose={onClose} footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Done</button></>}>
      <div className="form" style={{ marginBottom: 12 }}>
        <Field label="Company"><select value={brandId} onChange={(e) => setBrandId(e.target.value)}>{db.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Type of material"><input list="imp-types" value={category} onChange={(e) => setCategory(e.target.value)} /><datalist id="imp-types">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <div className="muted" style={{ alignSelf: 'end' }}>{db.catalog.filter((i) => i.brandId === brandId).length} materials already in {brand?.name}</div>
      </div>
      <div className="toolbar"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'pictures', label: 'Pictures' }, { id: 'pdf', label: 'PDF catalogue' }, { id: 'sheet', label: 'Spreadsheet / list' }, { id: 'web', label: 'From the web' }]} /></div>
      {tab === 'pictures' && <FromPictures addItems={addItems} />}
      {tab === 'pdf' && <FromPdf addItems={addItems} />}
      {tab === 'sheet' && <FromSheet addItems={addItems} />}
      {tab === 'web' && <FromWeb addItems={addItems} brandName={brand?.name || ''} website={brand?.website} />}
    </Modal>
  );
}

function DraftList({ rows, setRows, onImport, busy }: { rows: Draft[]; setRows: (r: Draft[]) => void; onImport: () => void; busy?: boolean }) {
  const on = rows.filter((r) => r.on).length;
  return rows.length ? <>
    <div className="imp-grid">{rows.map((r, i) => <div key={r.key} className={`imp-card ${r.on ? 'on' : ''}`}>
      <div className="cat-img" style={r.image || r.src ? { backgroundImage: `url(${r.image || r.src})` } : undefined} onClick={() => setRows(rows.map((x, k) => (k === i ? { ...x, on: !x.on } : x)))}>
        <span className="cat-check">{r.on ? <CheckSquare size={18} /> : <Square size={18} />}</span></div>
      <input placeholder="Code" value={r.code} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, code: e.target.value } : x)))} />
      <input placeholder="Name / colour" value={r.name} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
    </div>)}</div>
    <div className="flex" style={{ marginTop: 12 }}><button className="btn primary" disabled={busy || !on} onClick={onImport}>{busy ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}Add {on} to the catalogue</button>
      <button className="btn ghost" onClick={() => setRows(rows.map((x) => ({ ...x, on: !rows.every((y) => y.on) })))}>Tick / untick all</button></div>
  </> : null;
}

function FromPictures({ addItems }: { addItems: (r: Partial<CatalogItem>[]) => number }) {
  const ref = useRef<HTMLInputElement>(null); const [rows, setRows] = useState<Draft[]>([]); const [busy, setBusy] = useState(false);
  const pick = async (files: FileList | null) => {
    if (!files?.length) return; setBusy(true);
    try {
      const out: Draft[] = [];
      for (const f of Array.from(files).slice(0, 80)) { const code = codeFromFile(f.name); out.push({ key: f.name + Math.random(), code, name: '', image: await compressImage(f, 1200, 0.8), on: true }); }
      setRows([...rows, ...out]);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  const go = async () => {
    setBusy(true);
    try {
      const items: Partial<CatalogItem>[] = [];
      for (const r of rows.filter((x) => x.on)) items.push({ code: r.code, name: r.name, image: await storePhoto(r.image!) });
      if (addItems(items)) setRows([]);
    } finally { setBusy(false); }
  };
  return <>
    <p className="muted">Choose the swatch / product pictures (from the catalogue CD, WhatsApp from the supplier, or your phone). The file name becomes the code — e.g. <b>W980_ST2.jpg</b> → W980 ST2. Check the codes, then add.</p>
    <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => pick(e.target.files)} />
    <button className="btn" disabled={busy} onClick={() => ref.current?.click()}>{busy ? <Loader2 size={15} className="spin" /> : <Images size={15} />}Choose pictures</button>
    <div style={{ marginTop: 12 }}><DraftList rows={rows} setRows={setRows} onImport={go} busy={busy} /></div>
  </>;
}

type Page = { n: number; url: string; w: number; h: number };
function FromPdf({ addItems }: { addItems: (r: Partial<CatalogItem>[]) => number }) {
  const ref = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<Page[]>([]); const [busy, setBusy] = useState(''); const [cur, setCur] = useState<Page | null>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [code, setCode] = useState(''); const [name, setName] = useState(''); const [added, setAdded] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null); const imgRef = useRef<HTMLImageElement>(null);
  const load = async (f?: File) => {
    if (!f) return; setBusy('Opening the catalogue…'); setPages([]); setCur(null);
    try {
      const pdfjs = await import('pdfjs-dist');
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      const out: Page[] = [];
      for (let n = 1; n <= Math.min(doc.numPages, 150); n++) {
        setBusy(`Reading page ${n} of ${doc.numPages}…`);
        const page = await doc.getPage(n); const vp0 = page.getViewport({ scale: 1 }); const vp = page.getViewport({ scale: Math.min(3, 1800 / vp0.width) });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        await page.render({ canvasContext: c.getContext('2d')!, viewport: vp, canvas: c } as never).promise;
        out.push({ n, url: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height });
        setPages([...out]);
      }
      if (doc.numPages > 150) toast('Only the first 150 pages were opened');
    } catch (e) { toast('Could not read this PDF: ' + (e as Error).message); } finally { setBusy(''); if (ref.current) ref.current.value = ''; }
  };
  const pos = (e: RPointerEvent) => { const r = imgRef.current!.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  const crop = async (whole = false) => {
    if (!cur) return; if (!code.trim()) return toast('Type the code printed under the swatch');
    const b = whole || !box ? { x: 0, y: 0, w: 1, h: 1 } : box;
    if (b.w < 0.02 || b.h < 0.02) return toast('Drag a box around the swatch first');
    setBusy('Saving…');
    try {
      const img = new Image(); img.src = cur.url; await img.decode();
      const c = document.createElement('canvas'); c.width = Math.round(b.w * cur.w); c.height = Math.round(b.h * cur.h);
      c.getContext('2d')!.drawImage(img, b.x * cur.w, b.y * cur.h, c.width, c.height, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob>((res) => c.toBlob((x) => res(x!), 'image/jpeg', 0.9));
      const url = await storePhoto(await compressImage(blob, 1000, 0.82));
      if (addItems([{ code, name, image: url, notes: `Catalogue page ${cur.n}` }])) { setAdded(added + 1); setCode(''); setName(''); setBox(null); }
    } finally { setBusy(''); }
  };
  return <>
    <p className="muted">Open the company's PDF catalogue. Pick a page, <b>drag a box around a swatch</b>, type its code and add it — one by one, as many as you need. The PDF stays on your device; only the pictures you add are saved.</p>
    <input ref={ref} type="file" accept="application/pdf" hidden onChange={(e) => load(e.target.files?.[0])} />
    <div className="flex wrap"><button className="btn" disabled={!!busy} onClick={() => ref.current?.click()}><FileText size={15} />Open PDF catalogue</button>{busy && <span className="muted flex"><Loader2 size={14} className="spin" />{busy}</span>}{added > 0 && <Badge tone="green">{added} added</Badge>}</div>
    {pages.length > 0 && !cur && <div className="pdf-pages">{pages.map((p) => <button key={p.n} type="button" onClick={() => { setCur(p); setBox(null); }}><img src={p.url} alt={`Page ${p.n}`} loading="lazy" /><span>{p.n}</span></button>)}</div>}
    {cur && <div className="pdf-crop">
      <div className="flex wrap" style={{ marginBottom: 8 }}><button className="btn sm" onClick={() => setCur(null)}>← All pages</button><b>Page {cur.n}</b>
        <button className="btn sm ghost" disabled={cur.n <= 1} onClick={() => { setCur(pages[cur.n - 2]); setBox(null); }}>‹</button><button className="btn sm ghost" disabled={cur.n >= pages.length} onClick={() => { setCur(pages[cur.n]); setBox(null); }}>›</button></div>
      <div className="crop-area" onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); const p = pos(e); start.current = p; setBox({ x: p.x, y: p.y, w: 0, h: 0 }); }}
        onPointerMove={(e) => { if (!start.current) return; const p = pos(e); const s0 = start.current; setBox({ x: Math.min(s0.x, p.x), y: Math.min(s0.y, p.y), w: Math.abs(p.x - s0.x), h: Math.abs(p.y - s0.y) }); }}
        onPointerUp={() => (start.current = null)}>
        <img ref={imgRef} src={cur.url} alt="" draggable={false} />
        {box && box.w > 0 && <div className="crop-box" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />}
      </div>
      <div className="crop-bar">
        <input placeholder="Code (e.g. F7912)" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && crop()} />
        <input placeholder="Name / colour" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && crop()} />
        <button className="btn primary" disabled={!!busy} onClick={() => crop()}><Crop size={15} />Add swatch</button>
        <button className="btn ghost" disabled={!!busy} onClick={() => crop(true)}>Add whole page</button>
      </div>
    </div>}
  </>;
}

const HEADS: Record<string, keyof CatalogItem> = { code: 'code', number: 'code', no: 'code', 'item code': 'code', sku: 'code', name: 'name', colour: 'name', color: 'name', description: 'name', type: 'category', category: 'category', finish: 'finish', texture: 'finish', size: 'size', thickness: 'thickness', price: 'price', rate: 'price', unit: 'unit', image: 'image', picture: 'image', photo: 'image', url: 'sourceUrl', link: 'sourceUrl', tags: 'tags', notes: 'notes' };
function parseTable(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const split = (l: string) => { const out: string[] = []; let cur = ''; let q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
  const head = split(lines[0]).map((h) => HEADS[h.toLowerCase()]);
  const hasHead = head.some(Boolean);
  const cols = hasHead ? head : (['code', 'name', 'category', 'size', 'thickness', 'price', 'image'] as (keyof CatalogItem)[]);
  return (hasHead ? lines.slice(1) : lines).map((l) => {
    const v = split(l); const r: Record<string, unknown> = {};
    cols.forEach((c, i) => { if (!c || !v[i]) return; r[c] = c === 'price' ? Number(v[i].replace(/[^0-9.]/g, '')) || undefined : c === 'tags' ? v[i].split(/[|/]/).map((x) => x.trim()) : v[i]; });
    return r as Partial<CatalogItem>;
  });
}
function FromSheet({ addItems }: { addItems: (r: Partial<CatalogItem>[]) => number }) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(''); const [dl, setDl] = useState(true);
  const rows = parseTable(text);
  const go = async () => {
    setBusy('…');
    try {
      const out: Partial<CatalogItem>[] = [];
      let k = 0;
      for (const r of rows) {
        k++; setBusy(`${k} / ${rows.length}`);
        if (dl && r.image && /^https?:/.test(r.image)) { try { r.image = await importImageUrl(r.image); } catch { /* keep the link */ } }
        out.push(r);
      }
      if (addItems(out)) setText('');
    } finally { setBusy(''); }
  };
  return <>
    <p className="muted">Paste rows from Excel / Google Sheets, or open a CSV file. First row can be headings: <code>code, name, type, finish, size, thickness, price, unit, image</code> (image = a picture link). Without headings the order is code, name, type, size, thickness, price, image.</p>
    <div className="flex wrap" style={{ marginBottom: 8 }}><label className="btn sm"><Table size={14} />Open CSV<input type="file" accept=".csv,.txt,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} /></label>
      <label className="flex"><input type="checkbox" checked={dl} onChange={(e) => setDl(e.target.checked)} />Download the pictures into the app</label></div>
    <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={'code\tname\tsize\tprice\timage\nF7912\tGrey Glace\t1220×2440\t14\thttps://…'} style={{ fontFamily: 'monospace' }} />
    {rows.length > 0 && <><div className="table-wrap" style={{ marginTop: 10, maxHeight: 260, overflow: 'auto' }}><table><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Size</th><th className="num">Price</th><th>Picture</th></tr></thead>
      <tbody>{rows.slice(0, 200).map((r, i) => <tr key={i}><td><b>{r.code}</b></td><td>{r.name}</td><td>{r.category}</td><td>{r.size}</td><td className="num">{r.price ?? ''}</td><td>{r.image ? <img src={r.image} alt="" style={{ height: 30 }} /> : '—'}</td></tr>)}</tbody></table></div>
      <button className="btn primary" style={{ marginTop: 10 }} disabled={!!busy} onClick={go}>{busy ? <><Loader2 size={15} className="spin" />{busy}</> : <><Plus size={15} />Add {rows.length} rows</>}</button></>}
  </>;
}

function FromWeb({ addItems, brandName, website }: { addItems: (r: Partial<CatalogItem>[]) => number; brandName: string; website?: string }) {
  const [q, setQ] = useState(''); const [url, setUrl] = useState(''); const [busy, setBusy] = useState('');
  const [rows, setRows] = useState<Draft[]>([]); const [page, setPage] = useState<{ title: string; url: string } | null>(null);
  const scan = async () => {
    if (!url.trim()) return; setBusy('Opening the page…');
    try {
      const r = await api<{ url: string; title: string; images: { src: string; alt: string }[] }>('/api/fetch/scan', { method: 'POST', body: { url: url.trim() } });
      setPage({ title: r.title, url: r.url });
      setRows(r.images.map((im, i) => ({ key: im.src + i, src: im.src, code: '', name: im.alt || codeFromFile(decodeURIComponent(im.src.split('?')[0].split('/').pop() || '')), on: false })));
      if (!r.images.length) toast('No pictures found on that page');
    } catch (e) { toast((e as Error).message); } finally { setBusy(''); }
  };
  const go = async () => {
    const sel = rows.filter((r) => r.on);
    if (sel.some((r) => !r.code.trim())) return toast('Type a code for every ticked picture');
    const out: Partial<CatalogItem>[] = []; let k = 0;
    for (const r of sel) {
      k++; setBusy(`Downloading ${k} / ${sel.length}…`);
      try { out.push({ code: r.code, name: r.name, image: await importImageUrl(r.src!), sourceUrl: page?.url }); } catch (e) { toast(`${r.code}: ${(e as Error).message}`); }
    }
    setBusy(''); if (addItems(out)) setRows(rows.filter((r) => !r.on));
  };
  return <>
    <p className="muted"><b>1.</b> Search for the catalogue or product online. <b>2.</b> Copy the link of the product page (or of one picture) and paste it below. <b>3.</b> Tick the pictures you want, type their codes and add them.</p>
    <div className="flex wrap">
      <input style={{ flex: 1, minWidth: 200 }} placeholder={`e.g. ${brandName} grey oak laminate`} value={q} onChange={(e) => setQ(e.target.value)} />
      <a className="btn" target="_blank" rel="noreferrer" href={googleImages(`${brandName} ${q}`)}><Search size={15} />Search pictures</a>
      <a className="btn ghost" target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${encodeURIComponent(`${brandName} ${q} catalogue pdf`)}`}><FileText size={15} />Find catalogue PDF</a>
      {website && <a className="btn ghost" target="_blank" rel="noreferrer" href={website}><Globe size={15} />{brandName} website</a>}
    </div>
    <div className="flex" style={{ marginTop: 10 }}>
      <input placeholder="Paste a product page or picture link — https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && scan()} />
      <button className="btn primary" disabled={!!busy || !url} onClick={scan}>{busy ? <Loader2 size={15} className="spin" /> : <Globe size={15} />}Get pictures</button>
    </div>
    {busy && <p className="muted">{busy}</p>}
    {page && <p className="muted">{page.title || page.url} — {rows.length} pictures found {rows.length > 0 && <button className="btn sm ghost" onClick={() => setRows([])}><Trash2 size={13} />Clear</button>}</p>}
    {rows.length ? <DraftList rows={rows} setRows={setRows} onImport={go} busy={!!busy} /> : page && <Empty title="No pictures on that page" hint="Try the link of a single product, or open the picture and copy its address." />}
  </>;
}
