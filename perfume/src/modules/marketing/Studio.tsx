// Daily product upload, image & video studio, website CMS & SEO.
import { useCallback, useState } from 'react';
import { api, qs } from '../../core/api';
import { useSession, money, parseMoney, dateTime } from '../../core/session';
import { go } from '../../core/router';
import { Card, Empty, Field, Loading, Modal, toast, toastError, useAction, useData } from '../../components/ui';
import { KIND, STATUS_LABEL, LANGS, TONES, fileUrl, shrinkImage, uploadMedia, usePoll } from './common';
import { StudioOptions, ContentDetail } from './Marketing';

// ---------------------------------------------------------------- daily upload
const blankSize = () => ({ sizeMl: '', retailPrice: '', comparePrice: '' });
export function DailyUpload() {
  const { data: brands, reload: rb } = useData<any[]>('/brands');
  const { data: cats } = useData<any[]>('/categories');
  const { data: camps } = useData<any[]>('/marketing/campaigns');
  const [photos, setPhotos] = useState<string[]>([]);
  const [f, setF] = useState<any>({ name: '', nameAr: '', brandId: '', categoryId: '', gender: 'unisex', concentration: 'Eau de Parfum', description: '', notesTop: '', notesHeart: '', notesBase: '', features: '', promo: '', badge: 'New arrival', lang: 'en', tone: 'luxury', campaignId: '', generate: true, kinds: ['web_product', 'post', 'story', 'reel', 'whatsapp'] });
  const [sizes, setSizes] = useState<any[]>([blankSize()]);
  const [done, setDone] = useState<any>(null);
  const { busy, run } = useAction();
  const [uploading, setUploading] = useState(false);
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 8)) {
        const data = await shrinkImage(file);
        const r = await api.post('/files', { data });
        setPhotos((p) => [...p, r.url]);
      }
    } catch (e) { toastError(e); } finally { setUploading(false); }
  };
  const addBrand = async () => { const n = prompt('Brand name'); if (n) { const r = await api.post('/brands', { name: n }).catch(toastError); if (r) { await rb(); set('brandId', r.id); } } };
  const submit = () => run(async () => {
    const variants = sizes.filter((s) => s.retailPrice).map((s) => ({ sizeMl: s.sizeMl ? Number(s.sizeMl) : null, retailPrice: parseMoney(s.retailPrice), comparePrice: s.comparePrice ? parseMoney(s.comparePrice) : null, vatRateBp: 500, minStock: 2 }));
    if (variants.some((v) => isNaN(v.retailPrice) || (v.comparePrice != null && isNaN(v.comparePrice)))) throw new Error('Check the prices (e.g. 25.500)');
    return api.post('/marketing/products', { ...f, photos, variants, campaignId: f.campaignId || undefined });
  });
  if (done) return (
    <Card title="Product added">
      <div className="col">
        <div className="alert ok">“{f.name}” is now in the catalogue with its sizes, SKUs and barcodes.</div>
        {done.package?.error && <div className="alert bad">Content could not be prepared: {done.package.error}</div>}
        {done.package?.aiNote && <div className="alert warn">{done.package.aiNote}</div>}
        {done.package?.created && <div>{done.package.created.length} content items were prepared for your review{f.kinds.includes('reel') ? ' (the Reel video is rendering in the background)' : ''}.</div>}
        <div className="row"><button className="btn gold" onClick={() => go('/marketing/content/review')}>Review content</button><button className="btn" onClick={() => { setDone(null); setPhotos([]); setSizes([blankSize()]); setF({ ...f, name: '', nameAr: '', description: '', notesTop: '', notesHeart: '', notesBase: '', features: '', promo: '' }); }}>Upload another product</button></div>
        <div className="small muted">Stock is not changed here — receive the bottles through Purchases so cost and stock stay correct.</div>
      </div>
    </Card>
  );
  const kinds: [string, string][] = [['web_product', 'Website product page'], ['post', 'Instagram post'], ['story', 'Instagram Story'], ['reel', 'Instagram Reel (video)'], ['facebook', 'Facebook post'], ['whatsapp', 'WhatsApp promotion']];
  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <Card title="1 · Product">
        <div className="col">
          <Field label="Product photos" hint="The first photo is the main image. AI never changes the bottle, label or logo — it is only placed on a background.">
            <div className="thumbs">{photos.map((u, i) => <div key={u} className="thumb on"><img src={u} alt="" />{i === 0 && <b>main</b>}<button className="x" aria-label="Remove photo" onClick={() => setPhotos(photos.filter((x) => x !== u))}>✕</button></div>)}
              <label className="thumb add">{uploading ? '…' : '+ photo'}<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => addPhotos(e.target.files)} /></label></div>
          </Field>
          <Field label="Product name"><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Sauvage Elixir" /></Field>
          <Field label="Name in Arabic (optional)"><input dir="rtl" value={f.nameAr} onChange={(e) => set('nameAr', e.target.value)} /></Field>
          <div className="row"><Field label="Brand"><select value={f.brandId} onChange={(e) => set('brandId', e.target.value)}><option value="">—</option>{brands?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field><button className="btn sm" style={{ marginTop: 18 }} onClick={addBrand}>+</button>
            <Field label="Category"><select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}><option value="">—</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></div>
          <div className="row"><Field label="For"><select value={f.gender} onChange={(e) => set('gender', e.target.value)}>{['men', 'women', 'unisex', 'kids'].map((g) => <option key={g}>{g}</option>)}</select></Field>
            <Field label="Type"><select value={f.concentration} onChange={(e) => set('concentration', e.target.value)}>{['Eau de Parfum', 'Eau de Toilette', 'Parfum / Extrait', 'Eau de Cologne', 'Perfume oil', 'Bakhoor', 'Gift set', 'Body mist', 'Other'].map((g) => <option key={g}>{g}</option>)}</select></Field></div>
          <Field label="Sizes & prices (OMR)">
            <table className="t"><thead><tr><th>Size ml</th><th>Selling price</th><th>Original price (if discounted)</th><th /></tr></thead>
              <tbody>{sizes.map((s, i) => <tr key={i}><td><input inputMode="numeric" value={s.sizeMl} onChange={(e) => setSizes(sizes.map((x, j) => (j === i ? { ...x, sizeMl: e.target.value } : x)))} style={{ width: 70 }} /></td>
                <td><input inputMode="decimal" value={s.retailPrice} onChange={(e) => setSizes(sizes.map((x, j) => (j === i ? { ...x, retailPrice: e.target.value } : x)))} placeholder="25.500" style={{ width: 100 }} /></td>
                <td><input inputMode="decimal" value={s.comparePrice} onChange={(e) => setSizes(sizes.map((x, j) => (j === i ? { ...x, comparePrice: e.target.value } : x)))} style={{ width: 100 }} /></td>
                <td>{sizes.length > 1 && <button className="btn ghost sm" aria-label="Remove size" onClick={() => setSizes(sizes.filter((_, j) => j !== i))}>✕</button>}</td></tr>)}</tbody></table>
            <button className="btn sm" onClick={() => setSizes([...sizes, blankSize()])}>+ Size</button>
          </Field>
          <Field label="Description (optional — AI writes one if empty)"><textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <div className="row"><Field label="Top notes"><input value={f.notesTop} onChange={(e) => set('notesTop', e.target.value)} /></Field><Field label="Heart"><input value={f.notesHeart} onChange={(e) => set('notesHeart', e.target.value)} /></Field><Field label="Base"><input value={f.notesBase} onChange={(e) => set('notesBase', e.target.value)} /></Field></div>
          <Field label="Features / specifications" hint="Only facts — AI is instructed never to invent claims"><textarea rows={2} value={f.features} onChange={(e) => set('features', e.target.value)} placeholder="e.g. made in France, gift box included" /></Field>
        </div>
      </Card>
      <Card title="2 · Marketing">
        <div className="col">
          <label className="check"><input type="checkbox" checked={f.generate} onChange={(e) => set('generate', e.target.checked)} /> Prepare marketing content with AI after saving</label>
          {f.generate && <>
            <div className="col" style={{ gap: 4 }}>{kinds.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={f.kinds.includes(k)} onChange={(e) => set('kinds', e.target.checked ? [...f.kinds, k] : f.kinds.filter((x: string) => x !== k))} /> {l}</label>)}</div>
            <div className="row"><Field label="Language"><select value={f.lang} onChange={(e) => set('lang', e.target.value)}>{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Tone"><select value={f.tone} onChange={(e) => set('tone', e.target.value)}>{TONES.map((t) => <option key={t}>{t}</option>)}</select></Field>
              <Field label="Badge"><input value={f.badge} onChange={(e) => set('badge', e.target.value)} /></Field></div>
            <Field label="Promotion details (optional)"><input value={f.promo} onChange={(e) => set('promo', e.target.value)} placeholder="e.g. 10% off this weekend with code EID10" /></Field>
            <Field label="Campaign (optional)"><select value={f.campaignId} onChange={(e) => set('campaignId', e.target.value)}><option value="">—</option>{camps?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          </>}
          <div className="alert info small">Everything prepared here waits for approval in “Content & approvals” — nothing is posted automatically unless you switched that on for a content type in the Calendar settings.</div>
          <button className="btn gold" disabled={busy || uploading || !f.name || !photos.length || !sizes.some((s) => s.retailPrice)} onClick={() => submit().then((r) => r && setDone(r))}>{busy ? 'Saving & preparing content…' : 'Save product' + (f.generate ? ' & prepare content' : '')}</button>
          {(!photos.length || !f.name) && <div className="small muted">Add at least one photo, a name and a price.</div>}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- studio
export function Studio() {
  const { data: products } = useData<any[]>('/marketing/products');
  const [pid, setPid] = useState('');
  const { data: assets, reload } = useData<any[]>('/marketing/assets' + qs({ productId: pid || null }), [pid]);
  const [img, setImg] = useState<any>({ format: 'portrait', theme: 'noir', layout: 'hero', lang: 'en', badge: '', removeBackground: false, aiBackground: false });
  const [vid, setVid] = useState<any>({ format: 'story', theme: 'noir', mode: 'template', seconds: 3.5, badge: '', voiceover: '', lang: 'en' });
  const [view, setView] = useState<any>(null);
  const { busy, run } = useAction();
  const processing = (assets || []).some((a) => a.status === 'processing');
  usePoll(processing, useCallback(reload, []), 4000); // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) { try { await uploadMedia(f, pid || undefined); toast(`${f.name} uploaded`); } catch (e) { toastError(e); } }
    reload();
  };
  return (
    <div className="col">
      <Card>
        <div className="row">
          <Field label="Product"><select value={pid} onChange={(e) => setPid(e.target.value)} style={{ minWidth: 260 }}><option value="">Choose a product…</option>{products?.map((p) => <option key={p.id} value={p.id} disabled={!p.image_url}>{[p.brand, p.name].filter(Boolean).join(' ')}{p.image_url ? '' : ' (no photo)'}</option>)}</select></Field>
          <div className="grow" />
          <label className="btn">Upload image / video / music<input type="file" hidden multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav" onChange={(e) => upload(e.target.files)} /></label>
        </div>
      </Card>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Card title="Image studio" actions={<button className="btn sm gold" disabled={busy || !pid} onClick={() => run(() => api.post('/marketing/assets/creative', { productId: pid, ...img }), 'Image created').then((r) => { if (r) { reload(); setView(r); } })}>Create image</button>}>
          <div className="col">
            <div className="grid g3">
              <Field label="Size"><select value={img.format} onChange={(e) => setImg({ ...img, format: e.target.value })}><option value="square">1:1 Instagram / Facebook</option><option value="portrait">4:5 Instagram feed</option><option value="story">9:16 Story</option><option value="landscape">16:9 Facebook / YouTube</option><option value="banner">3:1 Website banner / slider</option></select></Field>
              <Field label="Layout"><select value={img.layout} onChange={(e) => setImg({ ...img, layout: e.target.value })}><option value="hero">Product + name + price</option><option value="offer">Offer (big price)</option><option value="detail">Large product</option><option value="cta">Shop sign-off</option></select></Field>
              <Field label="Text language"><select value={img.lang} onChange={(e) => setImg({ ...img, lang: e.target.value })}>{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            </div>
            <StudioOptions v={img} set={setImg} />
          </div>
        </Card>
        <Card title="Video studio" actions={<button className="btn sm gold" disabled={busy || !pid} onClick={() => run(() => api.post('/marketing/assets/video', { productId: pid, ...vid }), 'Video is being made — it appears below when ready').then(() => reload())}>Create video</button>}>
          <div className="col">
            <Field label="Text language"><select value={vid.lang} onChange={(e) => setVid({ ...vid, lang: e.target.value })}>{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <StudioOptions v={vid} set={setVid} video />
          </div>
        </Card>
      </div>
      <Card title={`Media library${pid ? '' : ' (all products)'}`}>
        {!assets ? <Loading /> : !assets.length ? <Empty>No images or videos yet</Empty> : (
          <div className="thumbs big">{assets.map((a) => (
            <button key={a.id} className="thumb" onClick={() => a.status === 'ready' && setView(a)} title={a.title}>
              {a.kind === 'audio' ? <span className="aud">♪ {a.title}</span> : a.status === 'ready' ? <img src={fileUrl(a.kind === 'video' ? a.params?.thumbFileId : a.file_id)} alt="" loading="lazy" /> : <span className={'aud ' + (a.status === 'failed' ? 'bad' : '')}>{a.status === 'failed' ? `failed: ${a.detail || ''}` : 'rendering…'}</span>}
              {a.kind === 'video' && <em>▶ {a.duration_s ? `${a.duration_s}s` : ''}</em>}<i>{a.format || a.kind}</i>
            </button>
          ))}</div>
        )}
      </Card>
      {view && <Modal wide title={view.title || 'Media'} onClose={() => setView(null)} footer={<><a className="btn" href={fileUrl(view.file_id)} download>Download</a><button className="btn ghost danger" onClick={() => run(() => api.del(`/marketing/assets/${view.id}`), 'Deleted').then((r) => { if (r) { setView(null); reload(); } })}>Delete</button></>}>
        <div style={{ textAlign: 'center' }}>{view.kind === 'video' ? <video src={fileUrl(view.file_id)} controls autoPlay playsInline style={{ maxHeight: '70vh', maxWidth: '100%' }} /> : view.kind === 'audio' ? <audio src={fileUrl(view.file_id)} controls /> : <img src={fileUrl(view.file_id)} alt="" style={{ maxHeight: '70vh', maxWidth: '100%' }} />}</div>
        <div className="small muted">{view.width}×{view.height}{view.duration_s ? ` · ${view.duration_s} s` : ''} · {view.provider}{Number(view.cost_usd) ? ` · ≈ $${Number(view.cost_usd).toFixed(2)}` : ''} · {dateTime(view.created_at)}</div>
      </Modal>}
    </div>
  );
}

// ---------------------------------------------------------------- website CMS & SEO
export function Website() {
  const { can } = useSession();
  const { data: st } = useData<any>('/website/status');
  const [tab, setTab] = useState<'products' | 'pages' | 'tracking'>('products');
  return (
    <div className="col">
      <Card>
        <div className="row">
          {st ? (st.connected ? <span className="badge ok">Connected: {st.platform} · {st.url}</span> : <span className="badge warn">Website not connected — content is prepared here and published once you connect Shopify or WooCommerce</span>) : null}
          <div className="grow" />
          <div className="seg"><button className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>Products & SEO</button><button className={tab === 'pages' ? 'on' : ''} onClick={() => setTab('pages')}>Blog, pages, offers, banners</button><button className={tab === 'tracking' ? 'on' : ''} onClick={() => setTab('tracking')}>Traffic tracking & sitemap</button></div>
        </div>
      </Card>
      {tab === 'products' && can('marketing', 'approve') && <WebGallery connected={!!st?.connected} />}
      {tab === 'products' && <WebProducts canEdit={can('website', 'edit') || can('marketing', 'edit')} />}
      {tab === 'pages' && <WebPages />}
      {tab === 'tracking' && st && <Card title="Website traffic & search">
        <div className="col">
          <div>Paste this line into your website’s theme, just before <code>&lt;/head&gt;</code> (Shopify: Online Store → Themes → Edit code → theme.liquid; WordPress: a header-scripts plugin). It counts page visits and product views for the Marketing dashboard. No personal data is collected — visitors get a random ID.</div>
          <pre className="code">{st.trackerUrl ? `<script async src="${st.trackerUrl}"></script>` : 'Open this page from the live app address to get the code.'}</pre>
          <div className="small">Tracking status: {st.tracking ? <span className="ok">visits are arriving</span> : <span className="warn">no visits received yet</span>}</div>
          <div>Campaign links: add <code>?utm_campaign=CODE</code> to links in posts (each campaign shows its code) so visits and conversions are counted per campaign.</div>
          <div>Sitemap: {st.sitemap ? <a href={st.sitemap} target="_blank" rel="noreferrer">{st.sitemap}</a> : '—'} — {st.platform === 'shopify' ? 'Shopify' : 'WordPress'} updates it automatically when products and posts are published. Submit it once in Google Search Console; indexing status is shown there (Google does not offer it to this app without a Search Console connection).</div>
        </div>
      </Card>}
    </div>
  );
}

/** Every finished Studio image → website media library + a "Gallery" page (only new images upload each time). */
function WebGallery({ connected }: { connected: boolean }) {
  const { busy, run } = useAction();
  const [res, setRes] = useState<any>(null);
  const publishNow = () => run(() => api.post('/marketing/website/gallery'), 'Gallery page updated').then((r) => r && setRes(r));
  return (
    <Card title="Website gallery" actions={<button className="btn sm gold" disabled={busy || !connected} onClick={publishNow}>{busy ? 'Uploading…' : 'Publish Studio gallery to website'}</button>}>
      <div className="small">Puts every finished image from the Studio gallery on the website’s “Gallery” page. Images already on the website are not uploaded again.</div>
      {res && <div className="small" style={{ marginTop: 8 }}>{res.total} images on the page · {res.uploaded} new{res.failed?.length ? <span className="warn"> · {res.failed.length} could not upload: {res.failed[0].error}</span> : null}{res.url ? <> · <a href={res.url} target="_blank" rel="noreferrer">Open the Gallery page</a></> : null}</div>}
    </Card>
  );
}

function WebProducts({ canEdit }: { canEdit: boolean }) {
  const [search, setSearch] = useState('');
  const { data, reload } = useData<any[]>('/marketing/products' + qs({ search }), [search]);
  const [ed, setEd] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { busy, run } = useAction();
  const prepare = (p: any) => run(() => api.post('/marketing/packages', { productId: p.id, kinds: ['web_product'] }), 'Website content prepared for approval').then((r) => { if (r?.created?.[0]) setOpen(r.created[0]); else if (r) toast('Already prepared today — see Content & approvals'); reload(); });
  return (
    <Card title="Products on the website" actions={<input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200 }} />}>
      {!data ? <Loading /> : (
        <div className="tablewrap"><table className="t"><thead><tr><th /><th>Product</th><th>Prices</th><th>SEO</th><th>Website</th><th /></tr></thead>
          <tbody>{data.map((p) => {
            const issues = [!p.seo_title && 'no SEO title', !p.seo_description && 'no meta description', !p.description && 'no description', !p.image_url && 'no photo', (p.images?.length || 0) < 1 && 'only one photo'].filter(Boolean);
            return <tr key={p.id}>
              <td style={{ width: 54 }}>{p.image_url ? <img src={p.image_url} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8 }} /> : '—'}</td>
              <td>{[p.brand, p.name].filter(Boolean).join(' ')}<div className="small muted">{p.category || ''}{p.web_visible ? '' : ' · hidden from website'}</div></td>
              <td className="small">{(p.variants || []).map((v: any) => <div key={v.id}>{v.size_ml ? `${v.size_ml} ml` : v.label} · {money(v.web_price ?? v.retail_price)}{v.compare_price ? <s className="muted"> {money(v.compare_price)}</s> : null}</div>)}</td>
              <td className="small">{issues.length ? <span className="warn">{issues.join(', ')}</span> : <span className="ok">complete</span>}</td>
              <td className="small">{p.web_external_id ? <span className="badge ok">on website</span> : <span className="badge">not yet</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{canEdit && <><button className="btn sm" onClick={() => setEd({ id: p.id, name: p.name, seoTitle: p.seo_title || '', seoDescription: p.seo_description || '', slug: p.slug || '' })}>SEO</button> <button className="btn sm gold" disabled={busy} onClick={() => prepare(p)}>{p.web_external_id ? 'Update website' : 'Add to website'}</button></>}</td>
            </tr>;
          })}</tbody></table></div>
      )}
      {ed && <Modal title={`SEO — ${ed.name}`} onClose={() => setEd(null)} footer={<><button className="btn" disabled={busy} onClick={() => run(() => api.post('/marketing/copy', { productId: ed.id, lang: 'en', tone: 'professional' })).then((c) => c && setEd({ ...ed, seoTitle: c.seo_title, seoDescription: c.seo_description, slug: c.slug }))}>Suggest with AI</button><button className="btn primary" disabled={busy} onClick={() => run(() => api.put(`/website/products/${ed.id}/seo`, ed), 'Saved — publish a website update to send it live').then((r) => { if (r) { setEd(null); reload(); } })}>Save</button></>}>
        <div className="col">
          <Field label="SEO title" hint={`${ed.seoTitle.length}/60 characters`}><input value={ed.seoTitle} onChange={(e) => setEd({ ...ed, seoTitle: e.target.value })} /></Field>
          <Field label="Meta description" hint={`${ed.seoDescription.length}/155 characters`}><textarea rows={3} value={ed.seoDescription} onChange={(e) => setEd({ ...ed, seoDescription: e.target.value })} /></Field>
          <Field label="URL slug"><input value={ed.slug} onChange={(e) => setEd({ ...ed, slug: e.target.value })} /></Field>
          <div className="webprev-g"><div className="g-url">yourshop.com › products › {ed.slug || '…'}</div><div className="g-title">{ed.seoTitle || ed.name}</div><div className="g-desc">{ed.seoDescription || '—'}</div></div>
          <div className="small muted">AI suggestions use only the product’s real data. Check them before saving — never publish unverified claims.</div>
        </div>
      </Modal>}
      {open && <ContentDetail id={open} onClose={() => { setOpen(null); reload(); }} />}
    </Card>
  );
}

function WebPages() {
  const { data, reload } = useData<any[]>('/marketing/content' + qs({ platform: 'website' }));
  const [neu, setNeu] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { data: stock } = useData<any[]>(neu?.kind === 'offer' ? '/inventory' : null, [neu?.kind]);
  const { busy, run } = useAction();
  const list = (data || []).filter((c) => c.kind !== 'web_product');
  const create = () => run(() => api.post('/marketing/content', { kind: neu.kind, title: neu.title, caption: neu.text, productId: neu.productId || null, body: { slug: neu.slug, seo_title: neu.seoTitle, seo_description: neu.seoDescription, items: neu.items?.filter((i: any) => i.price).map((i: any) => ({ variantId: i.variantId, price: parseMoney(i.price), comparePrice: i.comparePrice ? parseMoney(i.comparePrice) : null })) } }), 'Draft created').then((r) => { if (r) { setNeu(null); reload(); setOpen(r.id); } });
  return (
    <Card title="Blog articles, landing pages, offers & banners" actions={<div className="row"><button className="btn sm" onClick={() => setNeu({ kind: 'blog', title: '', text: '', slug: '', seoTitle: '', seoDescription: '' })}>+ Blog article</button><button className="btn sm" onClick={() => setNeu({ kind: 'landing', title: '', text: '', slug: '', seoTitle: '', seoDescription: '' })}>+ Landing page</button><button className="btn sm" onClick={() => setNeu({ kind: 'offer', title: '', items: [] })}>+ Offer prices</button><button className="btn sm" onClick={() => go('/marketing/studio')}>Banner / slider image</button></div>}>
      {!data ? <Loading /> : !list.length ? <Empty>No website pages yet</Empty> : (
        <table className="t"><tbody>{list.map((c) => <tr key={c.id} className="click" onClick={() => setOpen(c.id)}><td>{KIND[c.kind]?.label}</td><td>{c.title}</td><td><span className={'badge st-' + c.status}>{STATUS_LABEL[c.status]}</span></td><td className="small">{c.external_url ? <a href={c.external_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>view live</a> : dateTime(c.updated_at)}</td></tr>)}</tbody></table>
      )}
      <div className="small muted" style={{ marginTop: 8 }}>Homepage sliders and banners are part of your website theme; the Shopify and WooCommerce APIs cannot change them. Create the banner image in the studio (3:1) and upload it in the theme editor. Blog posts, landing pages, product pages and prices are published directly.</div>
      {neu && <Modal wide title={`New ${KIND[neu.kind].label.toLowerCase()}`} onClose={() => setNeu(null)} footer={<button className="btn primary" disabled={busy || !neu.title} onClick={create}>Create draft</button>}>
        <div className="col">
          <Field label="Title"><input value={neu.title} onChange={(e) => setNeu({ ...neu, title: e.target.value, slug: neu.slugTouched ? neu.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} /></Field>
          {neu.kind !== 'offer' ? <>
            <Field label="Text" hint="Plain paragraphs; blank line = new paragraph"><textarea rows={10} value={neu.text} onChange={(e) => setNeu({ ...neu, text: e.target.value })} /></Field>
            <div className="grid g3"><Field label="URL slug"><input value={neu.slug} onChange={(e) => setNeu({ ...neu, slug: e.target.value, slugTouched: true })} /></Field><Field label="SEO title" hint={`${neu.seoTitle.length}/60`}><input value={neu.seoTitle} onChange={(e) => setNeu({ ...neu, seoTitle: e.target.value })} /></Field><Field label="Meta description" hint={`${neu.seoDescription.length}/155`}><input value={neu.seoDescription} onChange={(e) => setNeu({ ...neu, seoDescription: e.target.value })} /></Field></div>
          </> : <>
            <div className="small muted">Choose sizes and their offer price. The original price is shown crossed out on the website. Only products already on the website can be changed.</div>
            <div style={{ maxHeight: 340, overflowY: 'auto' }}><table className="t"><thead><tr><th>Product</th><th>Now</th><th>Offer price</th><th>Show as original</th></tr></thead><tbody>{(stock || []).map((v) => {
              const it = neu.items.find((x: any) => x.variantId === v.id) || { variantId: v.id, price: '', comparePrice: '' };
              const upd = (patch: any) => setNeu({ ...neu, items: [...neu.items.filter((x: any) => x.variantId !== v.id), { ...it, ...patch }] });
              return <tr key={v.id}><td>{[v.brand, v.name, v.size_ml ? `${v.size_ml}ml` : ''].filter(Boolean).join(' ')}</td><td>{money(v.retail_price)}</td><td><input inputMode="decimal" value={it.price} onChange={(e) => upd({ price: e.target.value, comparePrice: it.comparePrice || money(v.retail_price) })} style={{ width: 90 }} /></td><td><input inputMode="decimal" value={it.comparePrice} onChange={(e) => upd({ comparePrice: e.target.value })} style={{ width: 90 }} /></td></tr>;
            })}</tbody></table></div>
          </>}
          <div className="small muted">It is saved as a draft. Preview it, get it approved, then publish or schedule it.</div>
        </div>
      </Modal>}
      {open && <ContentDetail id={open} onClose={() => { setOpen(null); reload(); }} />}
    </Card>
  );
}
