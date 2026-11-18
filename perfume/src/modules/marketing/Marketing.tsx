// Digital marketing: dashboard, approvals, calendar. Studio/website and setup screens live beside this file.
import { useCallback, useMemo, useState } from 'react';
import { api, qs } from '../../core/api';
import { useSession, money, dateTime, monthStart, today } from '../../core/session';
import { go } from '../../core/router';
import { Card, Empty, Field, Loading, Modal, PageHead, Stat, Tabs, toast, useAction, useData, LineChart, Bars } from '../../components/ui';
import { KIND, STATUS_LABEL, LANGS, TONES, fileUrl, PhonePreview, usePoll } from './common';
import { DailyUpload, Studio, Website } from './Studio';
import { Campaigns, Connections, Assistant, Reports } from './Setup';

type Tab = 'overview' | 'upload' | 'content' | 'calendar' | 'studio' | 'campaigns' | 'website' | 'assistant' | 'reports' | 'connections';

export default function Marketing({ params }: { params: string[] }) {
  const { can } = useSession();
  const tabs: [Tab, string][] = [];
  if (can('marketing')) tabs.push(['overview', 'Dashboard']);
  if (can('marketing', 'create') || can('inventory', 'create')) tabs.push(['upload', 'Daily upload']);
  if (can('marketing') || can('website')) tabs.push(['content', 'Content & approvals']);
  if (can('marketing')) tabs.push(['calendar', 'Calendar']);
  if (can('marketing', 'create')) tabs.push(['studio', 'Image & video studio']);
  if (can('marketing')) tabs.push(['campaigns', 'Campaigns']);
  if (can('website') || can('marketing')) tabs.push(['website', 'Website & SEO']);
  if (can('marketing') || can('assistant')) tabs.push(['assistant', 'AI assistant']);
  if (can('marketing')) tabs.push(['reports', 'Performance']);
  if (can('marketing')) tabs.push(['connections', 'Connections']);
  const tab = (tabs.find((t) => t[0] === params[0])?.[0] || tabs[0]?.[0] || 'content') as Tab;
  return (
    <>
      <PageHead title="Marketing" sub="Website, Instagram, Facebook and WhatsApp from your real products and prices. Nothing is published without approval." />
      <Tabs tabs={tabs} value={tab} onChange={(t) => go('/marketing/' + t)} />
      {tab === 'overview' && <Overview />}
      {tab === 'upload' && <DailyUpload />}
      {tab === 'content' && <ContentBoard initial={params[1]} />}
      {tab === 'calendar' && <Calendar />}
      {tab === 'studio' && <Studio />}
      {tab === 'campaigns' && <Campaigns />}
      {tab === 'website' && <Website />}
      {tab === 'assistant' && <Assistant />}
      {tab === 'reports' && <Reports />}
      {tab === 'connections' && <Connections />}
    </>
  );
}

// ---------------------------------------------------------------- dashboard
const RANGES: [string, string, () => [string, string]][] = [
  ['today', 'Today', () => [today(), today()]],
  ['week', 'Last 7 days', () => [new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10), today()]],
  ['month', 'This month', () => [monthStart(), today()]],
  ['30', 'Last 30 days', () => [new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10), today()]],
];
const n = (v: unknown) => (v == null ? '—' : Number(v).toLocaleString('en'));

function Overview() {
  const [r, setR] = useState('month');
  const [from, to] = RANGES.find((x) => x[0] === r)![2]();
  const { data: d, reload } = useData<any>('/marketing/overview' + qs({ from, to }), [from, to]);
  const { data: conns } = useData<any>('/marketing/connections');
  const { busy, run } = useAction();
  const missing = conns?.providers.filter((p: any) => !p.configured && ['anthropic', 'meta', 'website', 'whatsapp'].includes(p.key)) || [];
  if (!d) return <Loading />;
  const conv = d.campaigns.reduce((a: any, c: any) => ({ o: a.o + c.orders, k: a.k + c.clicks }), { o: 0, k: 0 });
  return (
    <div className="col">
      <div className="row">
        <div className="seg">{RANGES.map(([k, l]) => <button key={k} className={k === r ? 'on' : ''} onClick={() => setR(k)}>{l}</button>)}</div>
        <div className="grow" />
        <button className="btn sm" disabled={busy} onClick={() => run(() => api.post('/marketing/metrics/sync'), 'Figures refreshed from Instagram / Facebook').then(reload)}>Refresh from Meta</button>
      </div>
      {missing.length > 0 && <div className="alert warn">Not connected yet: {missing.map((p: any) => p.name).join(' · ')}. Figures from those services stay empty until you connect them in <a href="#/marketing/connections">Connections</a>.</div>}
      <div className="grid g4">
        <Stat dark label="Followers" value={n(d.followers.total)} sub={d.followers.total == null ? 'connect Meta' : `Instagram ${n(d.followers.instagram)} · Facebook ${n(d.followers.facebook)}`} />
        <Stat label="Instagram reach" value={n(d.reach)} sub={d.reach == null ? 'no data from Instagram yet' : 'accounts reached in period'} />
        <Stat label="Instagram engagement" value={n(d.engagement)} sub="likes, comments, saves, shares" />
        <Stat label="Website visitors" value={d.web ? n(d.web.visitors) : '—'} sub={d.web ? `${n(d.web.product_views)} product views` : 'add the tracking code (Website & SEO)'} />
        <Stat label="Published" value={n(d.content.publishedInRange)} sub={`${n(d.content.published || 0)} in total`} />
        <Stat label="Scheduled" value={n(d.scheduled)} sub="waiting for their time" />
        <Stat label="Waiting for approval" value={n(d.pending)} sub={<a href="#/marketing/content/review">review now</a>} />
        <Stat label="AI videos made" value={n(d.content.videos)} sub={`${n(d.content.webUpdates)} website updates`} />
        <Stat label="Social & WhatsApp sales" value={`OMR ${money(d.socialSales.revenue)}`} sub={`${d.socialSales.orders} orders from Instagram, Facebook, WhatsApp`} />
        <Stat label="WhatsApp enquiries" value={n(d.enquiries)} sub="logged on customer records" />
        <Stat label="Campaign conversion" value={conv.k ? `${((conv.o / conv.k) * 100).toFixed(1)} %` : '—'} sub={conv.k ? `${conv.o} orders / ${conv.k} tracked clicks` : 'needs tracked campaign links'} />
        <Stat label="AI & API cost" value={`$ ${d.aiSpendUsd.toFixed(2)}`} sub="approximate, from provider prices" />
      </div>
      <div className="grid g2">
        <Card title="Published content per day"><LineChart points={d.daily.map((x: any) => ({ x: x.day, y: x.published }))} /></Card>
        <Card title="Sales from social channels (OMR)"><LineChart points={d.daily.map((x: any) => ({ x: x.day, y: Number(x.social_sales) / 1000 }))} format={(v) => v.toFixed(0)} /></Card>
        <Card title="Instagram reach per day">{d.daily.some((x: any) => x.reach != null) ? <LineChart points={d.daily.map((x: any) => ({ x: x.day, y: Number(x.reach || 0) }))} /> : <Empty>Instagram has not returned reach data yet</Empty>}</Card>
        <Card title="Campaigns by sales"><Bars items={d.campaigns.slice(0, 6).map((c: any) => ({ label: c.name, value: Number(c.revenue) / 1000 }))} format={(v) => 'OMR ' + v.toFixed(3)} /></Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- content board
const FILTERS: [string, string][] = [['review', 'Needs approval'], ['approved', 'Approved'], ['scheduled', 'Scheduled'], ['published', 'Published'], ['failed', 'Failed'], ['draft', 'Drafts'], ['archived', 'Archived'], ['all', 'All']];
export function ContentBoard({ initial }: { initial?: string }) {
  const { can } = useSession();
  const [f, setF] = useState(initial && FILTERS.some((x) => x[0] === initial) ? initial : 'review');
  const [platform, setPlatform] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const status = f === 'review' ? null : f === 'all' ? null : f;
  const { data, reload } = useData<any[]>('/marketing/content' + qs({ status, platform: platform || null }), [f, platform]);
  const list = (data || []).filter((c) => (f === 'review' ? ['ai_generated', 'under_review'].includes(c.status) : true));
  const processing = list.some((c) => (c.assets || []).some((a: any) => a.status === 'processing'));
  usePoll(processing, useCallback(reload, []), 5000); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="col">
      <div className="row">
        <div className="seg">{FILTERS.map(([k, l]) => <button key={k} className={k === f ? 'on' : ''} onClick={() => setF(k)}>{l}</button>)}</div>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ width: 'auto' }}><option value="">All channels</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="whatsapp">WhatsApp</option><option value="website">Website</option></select>
        <div className="grow" />
        {(can('marketing', 'create') || can('website', 'create')) && <button className="btn primary" onClick={() => setCreate(true)}>+ New content</button>}
      </div>
      {!data ? <Loading /> : !list.length ? <Card><Empty>{f === 'review' ? 'Nothing is waiting for approval.' : 'No content here yet.'} Use <a href="#/marketing/upload">Daily upload</a> to create content from a product.</Empty></Card> : (
        <div className="cgrid">
          {list.map((c) => {
            const a = (c.assets || []).find((x: any) => x.kind === 'image' && x.status === 'ready') || (c.assets || [])[0];
            const thumb = a?.kind === 'video' ? fileUrl(a.thumb) : fileUrl(a?.file_id);
            return (
              <button key={c.id} className="ccard" onClick={() => setOpen(c.id)}>
                <div className={'cthumb' + (['reel', 'story'].includes(c.kind) ? ' tall' : '')}>{thumb ? <img src={thumb} alt="" loading="lazy" /> : <span>{KIND[c.kind]?.icon}</span>}{a?.status === 'processing' && <em>rendering…</em>}{a?.kind === 'video' && a.status === 'ready' && <em>▶ video</em>}</div>
                <div className="cbody">
                  <div className="row" style={{ gap: 6 }}><span className={'badge st-' + c.status}>{STATUS_LABEL[c.status]}</span><span className="small muted">{KIND[c.kind]?.label}</span></div>
                  <div className="ctitle">{c.title || c.number}</div>
                  <div className="small muted">{c.status === 'scheduled' ? `⏱ ${dateTime(c.scheduled_at)}` : c.status === 'published' ? `✓ ${dateTime(c.published_at)}` : c.product || c.number}</div>
                  {c.error && <div className="small bad">{c.error.slice(0, 90)}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {open && <ContentDetail id={open} onClose={() => { setOpen(null); reload(); }} />}
      {create && <NewContent onClose={() => setCreate(false)} onDone={(cid) => { setCreate(false); reload(); setOpen(cid); }} />}
    </div>
  );
}

function NewContent({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { data: products } = useData<any[]>('/marketing/products');
  const [f, setF] = useState<any>({ kind: 'post', title: '', caption: '', productId: '', lang: 'en' });
  const { busy, run } = useAction();
  return (
    <Modal title="New content" onClose={onClose} footer={<button className="btn primary" disabled={busy || !f.title} onClick={() => run(() => api.post('/marketing/content', f)).then((r) => r && onDone(r.id))}>Create draft</button>}>
      <div className="col">
        <Field label="Type"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
        <Field label="Title (internal)"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Product (optional)"><select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}><option value="">—</option>{products?.map((p) => <option key={p.id} value={p.id}>{[p.brand, p.name].filter(Boolean).join(' ')}</option>)}</select></Field>
        <Field label="Language"><select value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })}>{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <div className="small muted">After creating, add images/video and text in the editor. With a product selected, AI can write the text and make the creative for you.</div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- content detail / approval
export function ContentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useSession();
  const { data: c, reload, setData } = useData<any>(`/marketing/content/${id}`);
  const { data: assets } = useData<any[]>(c?.product_id ? `/marketing/assets?productId=${c.product_id}` : null, [c?.product_id]);
  const { data: camps } = useData<any[]>(can('marketing') ? '/marketing/campaigns' : null);
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<any>(null);
  const [sched, setSched] = useState('');
  const [note, setNote] = useState('');
  const [regen, setRegen] = useState<any>(null);
  const waiting = !!c?.pending_assets?.length;
  usePoll(waiting, useCallback(reload, []), 4000); // eslint-disable-line react-hooks/exhaustive-deps
  const allAssets = useMemo(() => [...(c?.assets || []), ...((c?.pending_assets || []).map((p: any) => ({ ...p, kind: 'video' })))], [c]);
  if (!c) return <Modal title="Content" onClose={onClose}><Loading /></Modal>;
  const act = (a: string, body: any = {}, ok?: string) => run(() => api.post(`/marketing/content/${id}/${a}`, body), ok).then((r) => r && setData(r));
  const editable = !['published', 'archived'].includes(c.status);
  const approve = can('marketing', 'approve');
  const web = KIND[c.kind]?.platform === 'website';
  const b = c.body || {};
  return (
    <Modal wide title={<>{KIND[c.kind]?.label} · {c.number} <span className={'badge st-' + c.status}>{STATUS_LABEL[c.status]}</span></>} onClose={onClose} footer={<>
      {editable && can('marketing', 'edit') && ['draft', 'ai_generated', 'under_review', 'failed'].includes(c.status) && <button className="btn ghost danger" disabled={busy} onClick={() => confirm('Delete this draft?') && run(() => api.del(`/marketing/content/${id}`), 'Draft deleted').then((r) => r && onClose())}>Delete draft</button>}
      {c.status !== 'archived' && can('marketing', 'edit') && <button className="btn ghost" disabled={busy} onClick={() => act('archive', {}, 'Archived')}>Archive</button>}
      {c.status === 'archived' && <button className="btn" onClick={() => act('restore')}>Restore</button>}
      {['draft', 'ai_generated', 'failed'].includes(c.status) && !approve && <button className="btn primary" disabled={busy} onClick={() => act('submit', {}, 'Sent to the owner for approval')}>Send for approval</button>}
      {approve && ['ai_generated', 'under_review', 'approved', 'scheduled'].includes(c.status) && <button className="btn danger" disabled={busy} onClick={() => act('reject', { note }, 'Sent back to draft')}>Reject</button>}
      {approve && ['draft', 'ai_generated', 'under_review', 'failed'].includes(c.status) && <button className="btn gold" disabled={busy} onClick={() => act('approve', { note }, 'Approved')}>Approve</button>}
      {approve && ['approved', 'failed'].includes(c.status) && c.kind !== 'banner' && <button className="btn primary" disabled={busy} onClick={() => confirm(`Publish now to ${KIND[c.kind].platform}? This is visible to customers.`) && run(() => api.post(`/marketing/content/${id}/publish`), 'Published').then((r) => { if (r) setData(r); else reload(); })}>Publish now</button>}
    </>}>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(260px, 340px) 1fr', alignItems: 'start' }}>
        <div className="col">
          {web ? <WebPreview c={c} /> : <PhonePreview kind={c.kind} assets={allAssets} caption={c.caption} hashtags={c.hashtags} />}
          {c.status === 'banner' || c.kind === 'banner' ? <div className="alert info small">Banners and homepage sliders belong to your website theme — download the image and upload it in the theme editor. The ERP cannot change them through the API.</div> : null}
          {(c.assets || []).filter((a: any) => a.file_id).map((a: any) => <a key={a.id} className="btn sm ghost" href={fileUrl(a.file_id)} download>Download {a.kind} {a.format ? `(${a.format})` : ''}</a>)}
        </div>
        <div className="col">
          {c.error && <div className="alert bad"><b>Last attempt failed:</b> {c.error}</div>}
          {b.aiNote && <div className="alert warn small">{b.aiNote}</div>}
          {c.external_url && <div className="alert ok">Live: <a href={c.external_url} target="_blank" rel="noreferrer">{c.external_url}</a>{b.stats && <span className="small"> · {b.stats.likes ?? '—'} likes · {b.stats.comments ?? '—'} comments{b.stats.reach != null ? ` · reach ${b.stats.reach}` : ''}</span>}</div>}
          {b.results && <div className="alert info">WhatsApp: {b.results.sent} sent, {b.results.failed} failed{b.results.errors?.length ? <div className="small">{b.results.errors.join(' · ')}</div> : null}</div>}
          {!edit ? (
            <>
              <Card title="Text" actions={editable && (can('marketing', 'edit') || can('marketing', 'create')) && <button className="btn sm" onClick={() => setEdit({ title: c.title, caption: c.caption || '', hashtags: c.hashtags || '', campaignId: c.campaign_id || '', body: { template: b.template || '', templateLang: b.templateLang || 'en', seo_title: b.seo_title || '', seo_description: b.seo_description || '', slug: b.slug || '', maxRecipients: b.maxRecipients || 250 } })}>Edit</button>}>
                <div className="small muted">{c.product || 'No product'}{c.campaign ? ` · campaign ${c.campaign}` : ''} · {LANGS.find((l) => l[0] === c.lang)?.[1]}</div>
                <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }} dir={c.lang === 'ar' ? 'rtl' : undefined}>{c.caption || <span className="muted">No text yet</span>}</div>
                {c.hashtags && <div className="small" style={{ color: 'var(--gold-d, #9a7a2c)', marginTop: 6 }}>{c.hashtags}</div>}
                {c.kind === 'whatsapp' && <div className="small muted" style={{ marginTop: 6 }}>Template: <b>{b.template || 'not chosen'}</b> ({b.templateLang || 'en'}) · goes only to customers who agreed to marketing messages · up to {b.maxRecipients || 250} people</div>}
                {web && c.kind === 'web_product' && <div className="small" style={{ marginTop: 6 }}>SEO title: {b.seo_title || '—'}<br />Meta description: {b.seo_description || '—'}<br />URL: /{b.slug || '—'}</div>}
                {b.script && <div className="small" style={{ marginTop: 6 }}><b>Reel scenes:</b> {b.script.scenes?.join(' → ')}</div>}
              </Card>
              {c.product_id && editable && can('marketing', 'create') && (
                <Card title="Regenerate with AI">
                  <div className="row">
                    <button className="btn sm" disabled={busy} onClick={() => setRegen({ part: 'copy', lang: c.lang, tone: c.tone || 'luxury', instructions: '' })}>New text</button>
                    {!web && c.kind !== 'reel' && <button className="btn sm" disabled={busy} onClick={() => setRegen({ part: 'image', theme: 'noir', badge: '', aiBackground: false })}>New image</button>}
                    {['reel', 'story', 'facebook', 'post'].includes(c.kind) && <button className="btn sm" disabled={busy} onClick={() => setRegen({ part: 'video', format: c.kind === 'facebook' ? 'square' : 'story', theme: 'noir', mode: 'template', seconds: 3.5, voiceover: '', badge: '' })}>New video</button>}
                  </div>
                  {waiting && <div className="small muted" style={{ marginTop: 6 }}>Video is being rendered — this page updates by itself.</div>}
                </Card>
              )}
              {!web && editable && assets && assets.length > 0 && can('marketing', 'edit') && (
                <Card title="Images & videos for this product">
                  <div className="thumbs">{assets.filter((a) => a.status === 'ready').map((a) => {
                    const on = c.asset_ids.includes(a.id);
                    return <button key={a.id} className={'thumb' + (on ? ' on' : '')} title={a.title} onClick={() => run(() => api.put(`/marketing/content/${id}`, { assetIds: on ? c.asset_ids.filter((x: string) => x !== a.id) : [...c.asset_ids, a.id] })).then((r) => r && setData(r))}>
                      <img src={fileUrl(a.kind === 'video' ? a.params?.thumbFileId : a.file_id)} alt="" />{a.kind === 'video' && <em>▶</em>}{on && <b>✓</b>}</button>;
                  })}</div>
                  <div className="small muted">Tap to add or remove. Make new ones in the Image & video studio.</div>
                </Card>
              )}
              {approve && ['approved', 'scheduled', 'failed'].includes(c.status) && c.kind !== 'banner' && (
                <Card title="Schedule">
                  <div className="row"><input type="datetime-local" value={sched} onChange={(e) => setSched(e.target.value)} style={{ width: 'auto' }} />
                    <button className="btn sm primary" disabled={busy || !sched} onClick={() => act('schedule', { scheduledAt: new Date(sched).toISOString() }, 'Scheduled')}>Schedule</button>
                    {c.status === 'scheduled' && <button className="btn sm ghost" onClick={() => act('unschedule', {}, 'Removed from schedule')}>Unschedule</button>}</div>
                  <div className="small muted">Time on this device. It is published automatically at that time; if it fails it is retried up to 3 times and you are notified.</div>
                </Card>
              )}
              {approve && ['ai_generated', 'under_review', 'draft'].includes(c.status) && <Field label="Note to the team (optional, saved with approve / reject)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
            </>
          ) : (
            <Card title="Edit">
              <div className="col">
                <Field label="Title"><input value={edit.title || ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
                <Field label={c.kind === 'web_product' ? 'Product description' : c.kind === 'story' ? 'Story text' : 'Caption / message'}><textarea rows={7} value={edit.caption} onChange={(e) => setEdit({ ...edit, caption: e.target.value })} dir={c.lang === 'ar' ? 'rtl' : undefined} /></Field>
                {!['whatsapp', 'story'].includes(c.kind) && <Field label="Hashtags"><input value={edit.hashtags} onChange={(e) => setEdit({ ...edit, hashtags: e.target.value })} /></Field>}
                {c.kind === 'whatsapp' && <div className="grid g3"><Field label="Approved template name" hint="Exactly as approved in WhatsApp Manager"><input value={edit.body.template} onChange={(e) => setEdit({ ...edit, body: { ...edit.body, template: e.target.value } })} /></Field><Field label="Template language"><input value={edit.body.templateLang} onChange={(e) => setEdit({ ...edit, body: { ...edit.body, templateLang: e.target.value } })} /></Field><Field label="Max recipients"><input type="number" value={edit.body.maxRecipients} onChange={(e) => setEdit({ ...edit, body: { ...edit.body, maxRecipients: Number(e.target.value) } })} /></Field></div>}
                {web && <div className="grid g3"><Field label="SEO title" hint={`${(edit.body.seo_title || '').length}/60`}><input value={edit.body.seo_title} onChange={(e) => setEdit({ ...edit, body: { ...edit.body, seo_title: e.target.value } })} /></Field><Field label="Meta description" hint={`${(edit.body.seo_description || '').length}/155`}><input value={edit.body.seo_description} onChange={(e) => setEdit({ ...edit, body: { ...edit.body, seo_description: e.target.value } })} /></Field><Field label="URL slug"><input value={edit.body.slug} onChange={(e) => setEdit({ ...edit, body: { ...edit.body, slug: e.target.value } })} /></Field></div>}
                {camps && <Field label="Campaign"><select value={edit.campaignId} onChange={(e) => setEdit({ ...edit, campaignId: e.target.value })}><option value="">—</option>{camps.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
                {['approved', 'scheduled'].includes(c.status) && !approve && <div className="alert warn small">Saving changes sends this back for approval.</div>}
                <div className="row"><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => run(() => api.put(`/marketing/content/${id}`, { ...edit, body: { ...edit.body, ...(web ? { description: edit.caption } : {}) } }), 'Saved').then((r) => { if (r) { setData(r); setEdit(null); } })}>Save</button></div>
              </div>
            </Card>
          )}
          <Card title="History"><table className="t"><tbody>{c.history.map((h: any) => <tr key={h.id}><td className="small">{dateTime(h.at)}</td><td>{h.action.replace(/_/g, ' ')}</td><td className="small">{h.user_name}</td><td className="small muted">{h.note}</td></tr>)}</tbody></table></Card>
        </div>
      </div>
      {regen && <Modal title={`Regenerate ${regen.part}`} onClose={() => setRegen(null)} footer={<button className="btn primary" disabled={busy} onClick={() => run(() => api.post(`/marketing/content/${id}/regenerate`, regen), regen.part === 'video' ? 'Video is being made' : 'Done').then((r) => { if (r) { setData(r); setRegen(null); } })}>Generate</button>}>
        <div className="col">
          {regen.part === 'copy' && <><Field label="Language"><select value={regen.lang} onChange={(e) => setRegen({ ...regen, lang: e.target.value })}>{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field><Field label="Tone"><select value={regen.tone} onChange={(e) => setRegen({ ...regen, tone: e.target.value })}>{TONES.map((t) => <option key={t}>{t}</option>)}</select></Field><Field label="Extra instructions / promotion details"><textarea rows={3} value={regen.instructions} onChange={(e) => setRegen({ ...regen, instructions: e.target.value })} placeholder="e.g. mention free gift wrapping this week" /></Field></>}
          {regen.part !== 'copy' && <StudioOptions v={regen} set={setRegen} video={regen.part === 'video'} />}
        </div>
      </Modal>}
    </Modal>
  );
}

export function StudioOptions({ v, set, video }: { v: any; set: (x: any) => void; video?: boolean }) {
  const { data: music } = useData<any[]>(video ? '/marketing/assets?kind=audio' : null);
  return (
    <div className="grid g2">
      <Field label="Style"><select value={v.theme} onChange={(e) => set({ ...v, theme: e.target.value })}><option value="noir">Noir & gold</option><option value="champagne">Champagne</option><option value="rose">Rose gold</option><option value="emerald">Emerald oud</option></select></Field>
      <Field label="Badge (optional)"><input value={v.badge || ''} onChange={(e) => set({ ...v, badge: e.target.value })} placeholder="New arrival / 20% OFF" /></Field>
      {video ? <>
        <Field label="Shape"><select value={v.format} onChange={(e) => set({ ...v, format: e.target.value })}><option value="story">9:16 Reels & Stories</option><option value="square">1:1 square</option><option value="portrait">4:5 portrait</option><option value="landscape">16:9 landscape</option></select></Field>
        <Field label="Seconds per scene"><input type="number" step="0.5" min={2} max={8} value={v.seconds} onChange={(e) => set({ ...v, seconds: Number(e.target.value) })} /></Field>
        <Field label="Video type" hint="AI video needs Runway; prices and texts are always added exactly, never drawn by AI"><select value={v.mode} onChange={(e) => set({ ...v, mode: e.target.value })}><option value="template">Luxury showcase (no AI cost)</option><option value="ai">AI motion from product photo (Runway)</option></select></Field>
        <Field label="Background music" hint="Only music you have the rights to — upload it in the studio"><select value={v.musicAssetId || ''} onChange={(e) => set({ ...v, musicAssetId: e.target.value || null })}><option value="">No music</option>{music?.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select></Field>
        <Field label="Voiceover text (optional, needs OpenAI)"><textarea rows={2} value={v.voiceover || ''} onChange={(e) => set({ ...v, voiceover: e.target.value })} /></Field>
        {v.mode === 'ai' && <Field label="Motion description"><textarea rows={2} value={v.prompt || ''} onChange={(e) => set({ ...v, prompt: e.target.value })} placeholder="Slow push-in, golden light, soft mist" /></Field>}
      </> : <>
        <label className="check"><input type="checkbox" checked={!!v.removeBackground} onChange={(e) => set({ ...v, removeBackground: e.target.checked })} /> Remove photo background (remove.bg)</label>
        <label className="check"><input type="checkbox" checked={!!v.aiBackground} onChange={(e) => set({ ...v, aiBackground: e.target.checked })} /> AI luxury backdrop (OpenAI) — the bottle itself is never redrawn</label>
      </>}
    </div>
  );
}

function WebPreview({ c }: { c: any }) {
  const b = c.body || {};
  return (
    <div className="webprev">
      <div className="webprev-g"><div className="g-url">yourshop.com › {b.slug || 'page'}</div><div className="g-title">{b.seo_title || c.title}</div><div className="g-desc">{b.seo_description || '—'}</div></div>
      <div className="webprev-page"><h3>{c.title}</h3><div style={{ whiteSpace: 'pre-wrap' }}>{c.caption}</div>{b.description_ar && <div dir="rtl" style={{ marginTop: 8 }}>{b.description_ar}</div>}</div>
      <div className="small muted">Google result preview (top) and page text. Prices, sizes, SKUs and barcodes are taken from the ERP when published.</div>
    </div>
  );
}

// ---------------------------------------------------------------- calendar + automation
function Calendar() {
  const { can } = useSession();
  const [month, setMonth] = useState(today().slice(0, 7));
  const first = new Date(month + '-01T00:00:00');
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const { data, reload } = useData<any[]>('/marketing/content' + qs({ from: iso(days[0]), to: iso(days[41]) }), [month]);
  const [open, setOpen] = useState<string | null>(null);
  const items = (data || []).filter((c) => c.scheduled_at || c.published_at);
  const shift = (k: number) => { const d = new Date(first); d.setMonth(d.getMonth() + k); setMonth(iso(d).slice(0, 7)); };
  return (
    <div className="col">
      <Card title={first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} actions={<><button className="btn sm ghost" onClick={() => shift(-1)}>‹</button><button className="btn sm ghost" onClick={() => setMonth(today().slice(0, 7))}>Today</button><button className="btn sm ghost" onClick={() => shift(1)}>›</button></>}>
        <div className="cal">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-h">{d}</div>)}
          {days.map((d) => {
            const k = iso(d);
            const its = items.filter((c) => (c.scheduled_at || c.published_at) && iso(new Date(c.status === 'published' ? c.published_at : c.scheduled_at)) === k);
            return <div key={k} className={'cal-d' + (k.slice(0, 7) !== month ? ' out' : '') + (k === today() ? ' now' : '')}><span className="cal-n">{d.getDate()}</span>
              {its.map((c) => <button key={c.id} className={'cal-i st-' + c.status} onClick={() => setOpen(c.id)} title={c.title}>{new Date(c.status === 'published' ? c.published_at : c.scheduled_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} {KIND[c.kind]?.icon} {c.product || c.title}</button>)}</div>;
          })}
        </div>
      </Card>
      {can('marketing', 'manage') && <Automation />}
      {open && <ContentDetail id={open} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function Automation() {
  const { can } = useSession();
  const { data: s, reload } = useData<any>('/marketing/settings');
  const [f, setF] = useState<any>(null);
  const { busy, run } = useAction();
  if (!s) return <Loading />;
  const a = f || s.automation;
  const set = (patch: any) => setF({ ...a, ...patch });
  const kinds: [string, string][] = [['web_product', 'Website product'], ['post', 'Instagram post'], ['story', 'Instagram Story'], ['reel', 'Instagram Reel'], ['facebook', 'Facebook post'], ['whatsapp', 'WhatsApp promotion']];
  return (
    <Card title="Daily automation" actions={f && <button className="btn sm primary" disabled={busy} onClick={() => run(() => api.put('/marketing/settings', { automation: f }), 'Saved').then(() => { setF(null); reload(); })}>Save</button>}>
      <div className="col">
        <label className="check"><input type="checkbox" checked={a.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Every day, prepare content for products added in the last 24 hours (with a photo and “show on website”)</label>
        <div className="row"><Field label="Prepare at (Oman time)"><input type="time" value={a.time} onChange={(e) => set({ time: e.target.value })} /></Field>
          <Field label="Style"><select value={a.theme} onChange={(e) => set({ theme: e.target.value })}><option value="noir">Noir & gold</option><option value="champagne">Champagne</option><option value="rose">Rose gold</option><option value="emerald">Emerald oud</option></select></Field>
          <Field label="Tone"><select value={a.tone} onChange={(e) => set({ tone: e.target.value })}>{TONES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Main language"><select value={a.langs?.[0] || 'en'} onChange={(e) => set({ langs: [e.target.value] })}>{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <label className="check" style={{ marginTop: 18 }}><input type="checkbox" checked={a.removeBackground} onChange={(e) => set({ removeBackground: e.target.checked })} /> Remove photo backgrounds (remove.bg)</label></div>
        <table className="t"><thead><tr><th>Content</th><th>Make it</th><th>Publish time</th><th>Publish without asking me</th></tr></thead>
          <tbody>{kinds.map(([k, l]) => <tr key={k}><td>{l}</td><td><input type="checkbox" checked={a.kinds.includes(k)} onChange={(e) => set({ kinds: e.target.checked ? [...a.kinds, k] : a.kinds.filter((x: string) => x !== k) })} aria-label={`Make ${l}`} /></td>
            <td><input type="time" value={a.slots?.[k] || ''} onChange={(e) => set({ slots: { ...a.slots, [k]: e.target.value } })} style={{ width: 'auto' }} /></td>
            <td><input type="checkbox" disabled={!can('marketing', 'approve')} checked={!!a.autoPublish?.[k]} onChange={(e) => { if (e.target.checked && !confirm(`Publish ${l} automatically, without your approval? AI-made content goes live directly.`)) return; set({ autoPublish: { ...a.autoPublish, [k]: e.target.checked } }); }} aria-label={`Auto-publish ${l}`} /></td></tr>)}</tbody></table>
        <div className="small muted">By default everything waits in “Content & approvals”. Only the types you tick in the last column are scheduled automatically. The same product never gets the same content twice in a day.</div>
        {s.lastAutoRun && <div className="small">Last run: {s.lastAutoRun}</div>}
      </div>
    </Card>
  );
}
export const toastOk = toast;
