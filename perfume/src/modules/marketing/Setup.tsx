// Campaigns, connections & logs, AI assistant, performance reporting.
import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../../core/api';
import { useSession, money, parseMoney, dateTime, date, monthStart, today } from '../../core/session';
import { Card, Empty, Field, Loading, Modal, Stat, useAction, useData, Bars } from '../../components/ui';

// ---------------------------------------------------------------- campaigns
const CKINDS: [string, string][] = [['new_arrivals', 'New arrivals'], ['weekend', 'Weekend offer'], ['monthly', 'Monthly offer'], ['discount', 'Special discount'], ['luxury_collection', 'Luxury collection'], ['seasonal', 'Seasonal'], ['clearance', 'Clearance sale'], ['gifts', 'Gift collection'], ['occasion', 'Special occasion']];
const PLATFORMS = ['instagram', 'facebook', 'whatsapp', 'website', 'snapchat', 'tiktok', 'in-store'];
const roas = (c: any) => (Number(c.spend) > 0 ? Number(c.revenue) / Number(c.spend) : null);

export function Campaigns() {
  const { can } = useSession();
  const { data, reload } = useData<any[]>('/marketing/campaigns');
  const [ed, setEd] = useState<any>(null);
  const tot = (data || []).reduce((a, c) => ({ r: a.r + Number(c.revenue), s: a.s + Number(c.spend), o: a.o + c.orders }), { r: 0, s: 0, o: 0 });
  return (
    <div className="col">
      <div className="grid g4">
        <Stat dark label="Sales from campaigns" value={`OMR ${money(tot.r)}`} sub={`${tot.o} orders`} />
        <Stat label="Campaign spend" value={`OMR ${money(tot.s)}`} sub="entered on each campaign" />
        <Stat label="Return on spend" value={tot.s ? `${(tot.r / tot.s).toFixed(1)} ×` : '—'} sub="sales ÷ spend" />
        <Stat label="Active" value={(data || []).filter((c) => c.status === 'active').length} sub={`${(data || []).length} campaigns`} />
      </div>
      <Card title="Campaigns" actions={can('marketing', 'create') && <button className="btn primary sm" onClick={() => setEd({ name: '', kind: 'new_arrivals', startDate: today(), endDate: '', productIds: [], platforms: ['instagram'], budget: '', spend: '', couponCode: '', promotionId: '', discountText: '', audience: '', notes: '', status: 'draft' })}>+ Campaign</button>}>
        {!data ? <Loading /> : !data.length ? <Empty>No campaigns yet</Empty> : (
          <div className="tablewrap"><table className="t"><thead><tr><th>Campaign</th><th>Dates</th><th>Channels</th><th className="num">Posts</th><th className="num">Clicks</th><th className="num">Orders</th><th className="num">Sales</th><th className="num">Spend</th><th className="num">ROAS</th><th /></tr></thead>
            <tbody>{data.map((c) => <tr key={c.id}>
              <td>{c.name}<div className="small muted">{CKINDS.find((k) => k[0] === c.kind)?.[1]} · <span className={'badge ' + (c.status === 'active' ? 'ok' : '')}>{c.status}</span>{c.coupon_code ? ` · code ${c.coupon_code}` : ''}</div></td>
              <td className="small">{date(c.start_date)} – {date(c.end_date)}</td><td className="small">{(c.platforms || []).join(', ')}</td>
              <td className="num">{c.posts}</td><td className="num">{c.clicks}</td><td className="num">{c.orders}</td><td className="num">{money(c.revenue)}</td><td className="num">{money(c.spend)}</td><td className="num">{roas(c) ? roas(c)!.toFixed(1) + '×' : '—'}</td>
              <td>{can('marketing', 'edit') && <button className="btn sm" onClick={() => setEd({ id: c.id, name: c.name, kind: c.kind, startDate: c.start_date || '', endDate: c.end_date || '', productIds: c.product_ids || [], platforms: c.platforms || [], budget: money(c.budget), spend: money(c.spend), couponCode: c.coupon_code || '', promotionId: c.promotion_id || '', discountText: c.discount_text || '', audience: c.audience || '', notes: c.notes || '', status: c.status, utm: c.utm })}>Edit</button>}</td>
            </tr>)}</tbody></table></div>
        )}
        <div className="small muted" style={{ marginTop: 8 }}>Sales are counted from real ERP orders: orders that used the campaign’s promotion or coupon code within its dates. Each order is counted once and is never duplicated into finance.</div>
      </Card>
      {ed && <CampaignForm c={ed} onClose={() => setEd(null)} onDone={() => { setEd(null); reload(); }} />}
    </div>
  );
}

function CampaignForm({ c, onClose, onDone }: { c: any; onClose: () => void; onDone: () => void }) {
  const { can } = useSession();
  const [f, setF] = useState(c);
  const { data: products } = useData<any[]>('/marketing/products');
  const { data: promos } = useData<any[]>(can('promotions') ? '/promotions' : null);
  const { data: content } = useData<any[]>(c.id ? `/marketing/content?campaignId=${c.id}` : null);
  const { data: s } = useData<any>('/marketing/settings');
  const { busy, run } = useAction();
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const save = () => run(() => { const body = { ...f, budget: f.budget ? parseMoney(f.budget) : 0, spend: f.spend ? parseMoney(f.spend) : 0 }; return c.id ? api.put(`/marketing/campaigns/${c.id}`, body) : api.post('/marketing/campaigns', body); }, 'Saved').then((r) => r && onDone());
  return (
    <Modal wide title={c.id ? `Campaign — ${c.name}` : 'New campaign'} onClose={onClose} footer={<button className="btn primary" disabled={busy || !f.name} onClick={save}>Save</button>}>
      <div className="grid g3">
        <Field label="Name"><input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Type"><select value={f.kind} onChange={(e) => set('kind', e.target.value)}>{CKINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Status"><select value={f.status} disabled={!can('marketing', 'approve')} onChange={(e) => set('status', e.target.value)}><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option></select></Field>
        <Field label="Start"><input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
        <Field label="End"><input type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
        <Field label="Discount (as shown to customers)"><input value={f.discountText} onChange={(e) => set('discountText', e.target.value)} placeholder="20% off all 100 ml" /></Field>
        <Field label="Linked ERP promotion" hint="Sales using this promotion are attributed to the campaign"><select value={f.promotionId} onChange={(e) => set('promotionId', e.target.value)}><option value="">—</option>{promos?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Coupon code"><input value={f.couponCode} onChange={(e) => set('couponCode', e.target.value.toUpperCase())} /></Field>
        <Field label="Target audience"><input value={f.audience} onChange={(e) => set('audience', e.target.value)} placeholder="Women 25–45 in Salalah, VIP customers…" /></Field>
        <Field label="Budget (OMR)"><input inputMode="decimal" value={f.budget} onChange={(e) => set('budget', e.target.value)} /></Field>
        <Field label="Spent so far (OMR)" hint="Ad spend you paid to Meta etc."><input inputMode="decimal" value={f.spend} onChange={(e) => set('spend', e.target.value)} /></Field>
        <Field label="Channels"><div className="row" style={{ gap: 8 }}>{PLATFORMS.map((p) => <label key={p} className="check"><input type="checkbox" checked={f.platforms.includes(p)} onChange={(e) => set('platforms', e.target.checked ? [...f.platforms, p] : f.platforms.filter((x: string) => x !== p))} /> {p}</label>)}</div></Field>
      </div>
      <Field label="Products"><div className="chips">{products?.map((p) => { const on = f.productIds.includes(p.id); return <button key={p.id} className={'chip' + (on ? ' on' : '')} onClick={() => set('productIds', on ? f.productIds.filter((x: string) => x !== p.id) : [...f.productIds, p.id])}>{[p.brand, p.name].filter(Boolean).join(' ')}</button>; })}</div></Field>
      <Field label="Notes"><textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      {c.id && <div className="small">Tracking link code: <code>?utm_campaign={c.utm}</code>{s?.publicUrl ? '' : ''} — add it to links in your posts and bio so website visits count for this campaign.</div>}
      {c.id && <Card title="Creative assets in this campaign">{!content ? <Loading /> : !content.length ? <Empty>No content linked yet — choose this campaign when editing content</Empty> : <table className="t"><tbody>{content.map((x) => <tr key={x.id}><td>{x.number}</td><td>{x.title}</td><td>{x.status}</td><td className="small">{x.external_url ? <a href={x.external_url} target="_blank" rel="noreferrer">live</a> : ''}</td></tr>)}</tbody></table>}</Card>}
    </Modal>
  );
}

// ---------------------------------------------------------------- connections
const HELP: Record<string, string[]> = {
  anthropic: ['Writes descriptions, captions, Arabic/Malayalam text, SEO and runs the AI assistant.', 'Get a key at console.anthropic.com → API keys. Pay per use.'],
  openai: ['Optional: AI luxury backdrops (the bottle is never redrawn) and voiceovers.', 'platform.openai.com → API keys.'],
  removebg: ['Optional: removes the background from product photos.', 'remove.bg → Dashboard → API keys (paid credits).'],
  runway: ['Optional: AI motion video from the product photo (prices are added exactly afterwards).', 'dev.runwayml.com → API keys (paid credits).'],
  meta: ['Instagram posts, Reels, Stories and Facebook Page posts, plus followers/reach.', 'Needs: Instagram Business/Creator account linked to your Facebook Page; a Meta app with instagram_content_publish, instagram_basic, instagram_manage_insights, pages_manage_posts, pages_read_engagement; a long-lived Page access token (best: a System User token from Meta Business Settings). The Instagram account ID is found automatically by “Test connection”.'],
  whatsapp: ['Promotions to customers who agreed to marketing messages, using templates approved by Meta.', 'Meta Business → WhatsApp Manager: phone number ID, WhatsApp Business Account ID, and a permanent System User token with whatsapp_business_messaging.'],
  website: ['Publish product pages, prices, offers, blog posts and landing pages to your website (belleameoman.com runs WordPress + WooCommerce on Hostinger).', 'WooCommerce (your shop): Platform = WooCommerce, Website address = your shop address. In WordPress go to Users → Profile → Application Passwords, create one named “Belle Âme ERP”, then enter your WordPress username in both “WooCommerce consumer key” and “WordPress user”, and the application password in both “consumer secret” and “WordPress application password”. (WooCommerce REST API keys also work for products.) Shopify: Admin API token and https://yourshop.myshopify.com.'],
};
const ORDER = ['website', 'meta', 'anthropic', 'whatsapp', 'removebg', 'openai', 'runway'];
const LABEL: Record<string, string> = { apiKey: 'API key', pageId: 'Facebook Page ID', accessToken: 'Access token', igUserId: 'Instagram account ID (found automatically)', graphVersion: 'Graph API version (default v23.0)', phoneNumberId: 'Phone number ID', wabaId: 'WhatsApp Business Account ID', platform: 'Platform', url: 'Website address', token: 'Shopify Admin API token', key: 'WooCommerce consumer key — or WordPress username', secret: 'WooCommerce consumer secret — or application password', wpUser: 'WordPress user (blog)', wpAppPassword: 'WordPress application password', currency: 'Currency' };

export function Connections() {
  const { can } = useSession();
  const { data, reload } = useData<any>('/marketing/connections');
  const { data: logs, reload: rl } = useData<any>('/marketing/logs');
  const [ed, setEd] = useState<any>(null);
  const [res, setRes] = useState<Record<string, any>>({});
  const [cron, setCron] = useState<string | null>(null);
  const { busy, run } = useAction();
  const manage = can('marketing', 'manage');
  if (!data) return <Loading />;
  return (
    <div className="col">
      <div className="alert info">A service is shown as working only after a real test call succeeds. Keys are stored encrypted and are never shown again in full.</div>
      <div className="grid g2">
        {[...data.providers].sort((a: any, b: any) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key)).map((p: any) => (
          <Card key={p.key} title={<>{p.name} {p.configured ? (p.lastTest?.ok ? <span className="badge ok">tested ✓</span> : p.lastTest ? <span className="badge bad">test failed</span> : <span className="badge warn">not tested</span>) : <span className="badge">not connected</span>}</>}
            actions={manage && <>{p.configured && <button className="btn sm" disabled={busy} onClick={() => run(() => api.post(`/marketing/connections/${p.key}/test`)).then((r) => { if (r) { setRes({ ...res, [p.key]: r }); reload(); rl(); } })}>Test connection</button>}<button className={'btn sm ' + (p.configured ? 'ghost' : 'gold')} onClick={() => setEd({ key: p.key, name: p.name, fields: p.fields, values: { ...(p.values || {}) } })}>{p.configured ? 'Edit' : 'Connect'}</button></>}>
            <div className="small">{HELP[p.key]?.[0]}</div>
            {res[p.key] && <div className={'alert small ' + (res[p.key].ok ? 'ok' : 'bad')} style={{ marginTop: 8 }}>{res[p.key].detail}</div>}
            {!res[p.key] && p.lastTest && <div className="small muted" style={{ marginTop: 6 }}>Last test {dateTime(p.lastTest.at)}: {p.lastTest.detail}</div>}
          </Card>
        ))}
      </div>
      {manage && <Card title="Automatic scheduler">
        <div className="col">
          <div className="small">Scheduled posts, video rendering and the daily automation run inside the app every minute while the server is awake. If your hosting puts the app to sleep when nobody uses it, create a scheduled job (every 5 minutes) that calls:</div>
          <pre className="code">POST {data.publicUrl || 'https://your-app'}/api/marketing/cron{'\n'}Header  x-cron-key: {cron || '•••• (create a key)'}</pre>
          <div className="row"><button className="btn sm" disabled={busy} onClick={() => run(() => api.post('/marketing/settings/cron-key')).then((r) => r && setCron(r.key))}>{cron ? 'Create a new key' : 'Create key'}</button><button className="btn sm ghost" disabled={busy} onClick={() => run(() => api.post('/marketing/tick'), 'Scheduler ran').then(() => rl())}>Run now</button></div>
          {cron && <div className="alert warn small">Copy the key now — it is not shown again.</div>}
        </div>
      </Card>}
      {logs && <>
        <Card title="Usage & cost (approximate)"><table className="t"><thead><tr><th>Month</th><th>Service</th><th className="num">Calls</th><th className="num">Errors</th><th className="num">Cost (USD)</th></tr></thead><tbody>{logs.usage.map((u: any) => <tr key={u.month + u.provider}><td>{u.month}</td><td>{u.provider}</td><td className="num">{u.calls}</td><td className={'num ' + (u.errors ? 'bad' : '')}>{u.errors}</td><td className="num">{Number(u.cost_usd || 0).toFixed(2)}</td></tr>)}</tbody></table>
          <div className="small muted">Storage: {logs.storage.files} files, {(Number(logs.storage.bytes) / 1e6).toFixed(1)} MB. Costs are estimated from list prices; your provider invoice is the final figure.</div></Card>
        <Card title="Background jobs"><table className="t"><tbody>{logs.jobs.map((j: any) => <tr key={j.id}><td className="small">{dateTime(j.created_at)}</td><td>{j.kind.replace('_', ' ')}</td><td><span className={'badge ' + (j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : 'info')}>{j.status}</span></td><td className="small bad">{j.error}</td><td>{j.status === 'failed' && <button className="btn sm" onClick={() => run(() => api.post(`/marketing/jobs/${j.id}/retry`), 'Queued again').then(() => rl())}>Retry</button>}</td></tr>)}</tbody></table></Card>
        <Card title="API & publishing log"><div className="tablewrap" style={{ maxHeight: 360 }}><table className="t"><tbody>{logs.calls.map((c: any) => <tr key={c.id}><td className="small">{dateTime(c.at)}</td><td>{c.provider}</td><td className="small">{c.operation}</td><td>{c.ok ? <span className="ok">ok</span> : <span className="bad">error {c.status || ''}</span>}</td><td className="small">{c.ms ? `${c.ms} ms` : ''}</td><td className="small muted">{c.detail}</td></tr>)}</tbody></table></div></Card>
      </>}
      {ed && <Modal title={`Connect ${ed.name}`} onClose={() => setEd(null)} footer={<button className="btn primary" disabled={busy} onClick={() => run(() => api.put(`/marketing/connections/${ed.key}`, ed.values), 'Saved — now run “Test connection”').then((r) => { if (r) { setEd(null); reload(); } })}>Save</button>}>
        <div className="col">
          <div className="small">{HELP[ed.key]?.[1]}</div>
          {ed.fields.map((k: string) => k === 'platform' ? <Field key={k} label={LABEL[k]}><select value={ed.values[k] || ''} onChange={(e) => setEd({ ...ed, values: { ...ed.values, [k]: e.target.value } })}><option value="">Choose…</option><option value="shopify">Shopify</option><option value="woocommerce">WooCommerce (WordPress)</option></select></Field>
            : <Field key={k} label={LABEL[k] || k}><input value={ed.values[k] || ''} autoComplete="off" type={/key|token|secret|password/i.test(k) && !/^••••/.test(ed.values[k] || '') ? 'password' : 'text'} onChange={(e) => setEd({ ...ed, values: { ...ed.values, [k]: e.target.value } })} onFocus={(e) => /^••••/.test(e.target.value) && setEd({ ...ed, values: { ...ed.values, [k]: '' } })} /></Field>)}
          <div className="small muted">Leave a hidden value (••••) unchanged to keep it. Saving does not test — use “Test connection”.</div>
        </div>
      </Modal>}
    </div>
  );
}

// ---------------------------------------------------------------- assistant
const EXAMPLES = ['Create an Instagram Reel for today’s new perfume', 'Prepare today’s Instagram Story for our best seller', 'Create an Arabic promotional caption for Khamrah', 'Generate a weekend offer campaign for all 100 ml perfumes', 'Which social media campaign generated the most sales?', 'Show my marketing results this month'];
export function Assistant() {
  const [msgs, setMsgs] = useState<{ role: string; content: string; actions?: any[] }[]>([]);
  const [text, setText] = useState('');
  const { busy, run } = useAction();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);
  const send = (t = text) => {
    if (!t.trim()) return;
    const next = [...msgs, { role: 'user', content: t.trim() }];
    setMsgs(next); setText('');
    run(() => api.post('/marketing/assistant', { messages: next.map(({ role, content }) => ({ role, content })) })).then((r) => r && setMsgs([...next, { role: 'assistant', content: r.reply, actions: r.actions }]));
  };
  return (
    <Card title="Marketing assistant" actions={msgs.length > 0 && <button className="btn sm ghost" onClick={() => setMsgs([])}>New chat</button>}>
      <div className="chat">
        {!msgs.length && <div className="col"><div className="muted">Ask in English, Arabic or Malayalam. Answers use your real products, prices, sales and connected accounts. Content it creates waits for your approval.</div><div className="chips">{EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => send(e)}>{e}</button>)}</div></div>}
        {msgs.map((m, i) => <div key={i} className={'msg ' + m.role}><div className="bubble" dir="auto">{m.content}</div>{m.actions?.length ? <div className="small muted">{m.actions.map((a) => `${a.ok ? '✓' : '✕'} ${a.tool.replace(/_/g, ' ')}${a.error ? ` (${a.error})` : ''}`).join(' · ')}</div> : null}</div>)}
        {busy && <div className="msg assistant"><div className="bubble muted">Working…</div></div>}
        <div ref={end} />
      </div>
      <div className="row" style={{ marginTop: 10 }}><input dir="auto" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && send()} placeholder="e.g. Schedule three Instagram posts for the new Lattafa perfumes" className="grow" /><button className="btn gold" disabled={busy || !text.trim()} onClick={() => send()}>Send</button></div>
    </Card>
  );
}

// ---------------------------------------------------------------- performance & money
export function Reports() {
  const [f, setF] = useState({ from: monthStart(), to: today() });
  const { data: d } = useData<any>('/marketing/overview' + qs(f), [f.from, f.to]);
  const { data: logs } = useData<any>('/marketing/logs');
  const { data: channels } = useData<any[]>('/marketing/channels' + qs(f), [f.from, f.to]);
  if (!d) return <Loading />;
  const spend = d.campaigns.reduce((a: number, c: any) => a + Number(c.spend), 0);
  const revenue = d.campaigns.reduce((a: number, c: any) => a + Number(c.revenue), 0);
  const aiUsd = d.aiSpendUsd;
  const leads = d.enquiries || 0;
  const month = f.from.slice(0, 7);
  const aiMonth = (logs?.usage || []).filter((u: any) => u.month === month).reduce((a: number, u: any) => a + Number(u.cost_usd || 0), 0);
  return (
    <div className="col">
      <div className="card row"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={{ width: 'auto' }} /><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={{ width: 'auto' }} /></div>
      <div className="grid g4">
        <Stat dark label="Campaign sales" value={`OMR ${money(revenue)}`} sub="orders using campaign promotion / coupon" />
        <Stat label="Campaign spend" value={`OMR ${money(spend)}`} sub="entered on campaigns" />
        <Stat label="Return on ad spend" value={spend ? `${(revenue / spend).toFixed(1)} ×` : '—'} sub={spend ? 'sales ÷ spend' : 'enter spend on campaigns'} />
        <Stat label="AI & API cost" value={`$ ${aiUsd.toFixed(2)}`} sub={`this month $${aiMonth.toFixed(2)}`} />
        <Stat label="Social & WhatsApp sales" value={`OMR ${money(d.socialSales.revenue)}`} sub={`${d.socialSales.orders} orders`} />
        <Stat label="WhatsApp enquiries" value={leads} sub="logged on customers" />
        <Stat label="Cost per enquiry" value={leads && spend ? `OMR ${money(Math.round(spend / leads))}` : '—'} sub="spend ÷ enquiries" />
        <Stat label="Website visitors" value={d.web ? d.web.visitors : '—'} sub={d.web ? `${d.web.views} page views` : 'tracking code not installed'} />
      </div>
      <div className="grid g2">
        <Card title="Revenue by sales channel (OMR)">{channels ? <Bars items={channels.map((c: any) => ({ label: `${c.channel} (${c.orders})`, value: Number(c.revenue) / 1000 }))} format={(v) => v.toFixed(3)} /> : <Loading />}</Card>
        <Card title="Campaign return"><table className="t"><thead><tr><th>Campaign</th><th className="num">Sales</th><th className="num">Spend</th><th className="num">ROAS</th></tr></thead><tbody>{d.campaigns.map((c: any) => <tr key={c.id}><td>{c.name}</td><td className="num">{money(c.revenue)}</td><td className="num">{money(c.spend)}</td><td className="num">{Number(c.spend) ? (Number(c.revenue) / Number(c.spend)).toFixed(1) + '×' : '—'}</td></tr>)}</tbody></table></Card>
      </div>
      <div className="small muted">These figures read the same sales the finance module uses; nothing is copied or double-counted. Advertising spend paid directly to Meta is not imported automatically — enter it on each campaign (or ask for the Meta Ads integration).</div>
    </div>
  );
}
