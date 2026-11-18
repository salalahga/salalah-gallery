// Marketing, website CMS and social automation API.
import express from 'express';
import crypto from 'node:crypto';
import { id, fail, must, str, money, today } from '../util.js';
import { can } from '../rbac.js';
import * as P from '../services/mkt/providers.js';
import * as E from '../services/mkt/engine.js';
import * as S from '../services/mkt/studio.js';
import { chat } from '../services/mkt/assistant.js';

const MEDIA = /^(image\/(jpeg|png|webp)|video\/(mp4|quicktime)|audio\/(mpeg|mp4|aac|wav|x-wav|x-m4a))$/;

/** Routes that must work without a login: website visit tracking and the scheduler heartbeat. */
export function mountPublic(api, { db, wrap }) {
  const q = db.query;
  api.get('/t.js', (req, res) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    res.type('application/javascript').set('Cache-Control', 'public, max-age=3600').send(`(function(){try{var k='ba_vid',v=localStorage.getItem(k);if(!v){v=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem(k,v)}
var u=new URL(location.href),utm=u.searchParams.get('utm_campaign')||'',m=document.querySelector('meta[name="product-id"]'),p=m?m.content:(location.pathname.match(/\\/products?\\/([^\\/?#]+)/)||[])[1]||'';
function s(kind){navigator.sendBeacon&&navigator.sendBeacon('${origin}/api/t',new Blob([JSON.stringify({kind:kind,path:location.pathname,product:p,visitor:v,utm:utm,ref:document.referrer})],{type:'text/plain'}))}
s('pageview');if(p)s('product_view')}catch(e){}})();`);
  });
  api.post('/t', express.text({ type: '*/*', limit: '4kb' }), wrap(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    let b = {};
    try { b = JSON.parse(req.body || '{}'); } catch { /* ignore */ }
    if (['pageview', 'product_view'].includes(b.kind)) {
      await q('INSERT INTO mkt_web_events (kind, path, product_ref, visitor, utm, referrer) VALUES ($1,$2,$3,$4,$5,$6)',
        [b.kind, str(b.path, 300), str(b.product, 200), crypto.createHash('sha256').update(String(b.visitor || req.ip)).digest('hex').slice(0, 24), str(b.utm, 80), str(b.ref, 300)]);
    }
    res.status(204).end();
  }));
  // Scheduler heartbeat for hosts that sleep when idle (called by a scheduled job with the cron key).
  api.post('/marketing/cron', wrap(async (req, res) => {
    const key = (await E.mktSettings(q)).cronKey;
    const given = String(req.get('x-cron-key') || '');
    must(key && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key)), 401, 'Wrong key');
    res.json(await E.tick(db));
  }));
}

export function mountPrivate(api, { db, wrap, need, needAny, audit, saveVariant, productFields }) {
  const q = db.query;
  const ctxOf = (req) => ({ user: req.user, can: (m, l) => can(req.perms, m, l) });
  const range = (req) => {
    const t = today();
    return { from: req.query.from || t.slice(0, 8) + '01', to: req.query.to || t };
  };
  // remember this app's public address (media links for Instagram/WhatsApp must be absolute https URLs)
  const rememberUrl = async (req) => {
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const url = `${proto}://${req.get('host')}`;
    if (/^https:\/\//.test(url) && !/localhost|127\.0\.0\.1/.test(url)) {
      const s = await E.mktSettings(q);
      if (s.publicUrl !== url) await E.saveMktSettings(q, { publicUrl: url });
    }
  };

  // ---------- dashboard ----------
  api.get('/marketing/overview', needAny(['marketing', 'view'], ['website', 'view']), wrap(async (req, res) => {
    await rememberUrl(req);
    res.json(await E.dashboard(q, range(req)));
  }));
  api.post('/marketing/metrics/sync', need('marketing', 'view'), wrap(async (_req, res) => res.json(await E.syncMetrics(q))));

  // ---------- settings ----------
  api.get('/marketing/settings', need('marketing', 'view'), wrap(async (_req, res) => {
    const s = await E.mktSettings(q);
    res.json({ ...s, cronKey: s.cronKey ? '•••• ' + s.cronKey.slice(-4) : null });
  }));
  api.put('/marketing/settings', need('marketing', 'manage'), wrap(async (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (b.automation) {
      const a = b.automation;
      if (a.autoPublish) must(can(req.perms, 'marketing', 'approve'), 403, 'Only someone who can approve content may switch on automatic publishing');
      patch.automation = {
        ...(a.enabled != null ? { enabled: !!a.enabled } : {}), ...(a.time ? { time: String(a.time).slice(0, 5) } : {}),
        ...(Array.isArray(a.kinds) ? { kinds: a.kinds.filter((k) => E.KINDS[k]) } : {}), ...(a.autoPublish ? { autoPublish: Object.fromEntries(Object.entries(a.autoPublish).filter(([k]) => E.KINDS[k]).map(([k, v]) => [k, !!v])) } : {}),
        ...(a.slots ? { slots: a.slots } : {}), ...(a.theme ? { theme: a.theme } : {}), ...(a.removeBackground != null ? { removeBackground: !!a.removeBackground } : {}),
        ...(a.langs ? { langs: a.langs } : {}), ...(a.tone ? { tone: a.tone } : {}), ...(a.reelSeconds ? { reelSeconds: Math.min(8, Math.max(2, Number(a.reelSeconds))) } : {}),
      };
    }
    if (b.brand) patch.brand = Object.fromEntries(Object.entries(b.brand).map(([k, v]) => [k, str(v, 500) || '']));
    const s = await E.saveMktSettings(q, patch);
    await audit(req, 'marketing_settings', 'settings', 'marketing', patch);
    res.json(s);
  }));
  api.post('/marketing/settings/cron-key', need('marketing', 'manage'), wrap(async (req, res) => {
    const key = crypto.randomBytes(24).toString('base64url');
    await E.saveMktSettings(q, { cronKey: key });
    await audit(req, 'marketing_cron_key', 'settings', 'marketing');
    res.json({ key }); // shown once
  }));

  // ---------- connections ----------
  api.get('/marketing/connections', need('marketing', 'view'), wrap(async (req, res) => {
    await rememberUrl(req);
    const out = [];
    for (const [key, p] of Object.entries(P.PROVIDERS)) {
      const creds = await P.loadCreds(q, key);
      const last = await q.one("SELECT ok, at, detail, operation FROM mkt_api_log WHERE provider = $1 AND operation LIKE 'test%' ORDER BY at DESC LIMIT 1", [key]);
      out.push({ key, name: p.name, fields: p.fields, configured: P.configured(key, creds), values: can(req.perms, 'marketing', 'manage') ? await P.publicCreds(q, key) : null, lastTest: last || null });
    }
    res.json({ providers: out, publicUrl: (await E.mktSettings(q)).publicUrl || null });
  }));
  api.put('/marketing/connections/:provider', need('marketing', 'manage'), wrap(async (req, res) => {
    must(P.PROVIDERS[req.params.provider], 404, 'Unknown service');
    if (req.params.provider === 'website' && req.body.platform) must(['shopify', 'woocommerce'].includes(req.body.platform), 400, 'Website platform must be Shopify or WooCommerce');
    await P.saveCreds(q, req.params.provider, req.body || {});
    await audit(req, 'marketing_connection_saved', 'integration', req.params.provider, { fields: Object.keys(req.body || {}) });
    res.json({ ok: true });
  }));
  /** A real call to each service. Success means the service accepted our credentials — nothing is assumed. */
  api.post('/marketing/connections/:provider/test', need('marketing', 'manage'), wrap(async (req, res) => {
    const p = req.params.provider;
    const creds = await P.loadCreds(q, p);
    must(P.PROVIDERS[p], 404, 'Unknown service');
    must(P.configured(p, creds), 412, 'Add the credentials first');
    const log = (ok, detail) => P.logCall(q, p, 'test_connection', { ok, detail });
    try {
      let detail;
      if (p === 'anthropic') { const r = await P.claude(q, { messages: [{ role: 'user', content: 'Reply with the single word: connected' }], maxTokens: 300, effort: 'low' }); detail = `Claude replied: ${P.textOf(r).slice(0, 40)}`; }
      else if (p === 'openai') { const r = await fetch('https://api.openai.com/v1/models/gpt-image-1', { headers: { Authorization: `Bearer ${creds.apiKey}` } }); if (!r.ok) fail(424, `OpenAI rejected the key (HTTP ${r.status})`); detail = 'OpenAI key accepted; image model available'; }
      else if (p === 'removebg') { const r = await fetch('https://api.remove.bg/v1.0/account', { headers: { 'X-Api-Key': creds.apiKey } }); if (!r.ok) fail(424, `remove.bg rejected the key (HTTP ${r.status})`); const j = await r.json(); detail = `remove.bg credits: ${j.data?.attributes?.credits?.total ?? 'unknown'}`; }
      else if (p === 'runway') { const r = await fetch('https://api.dev.runwayml.com/v1/organization', { headers: { Authorization: `Bearer ${creds.apiKey}`, 'X-Runway-Version': '2024-11-06' } }); if (!r.ok) fail(424, `Runway rejected the key (HTTP ${r.status})`); const j = await r.json(); detail = `Runway credits: ${j.creditBalance ?? 'unknown'}`; }
      else if (p === 'meta') { const r = await P.metaTest(q); detail = `Page "${r.page.name}" (${r.page.followers ?? '?'} followers)` + (r.instagram ? `; Instagram @${r.instagram.username} (${r.instagram.followers ?? '?'} followers)` : '; NO Instagram professional account linked to this Page'); res.locals.result = r; }
      else if (p === 'whatsapp') { const r = await P.whatsappTest(q); detail = `${r.name || ''} ${r.phone || ''} · quality ${r.quality || '?'} · ${r.templates.filter((t) => t.status === 'APPROVED').length} approved templates`; res.locals.result = r; }
      else if (p === 'website') {
        if (creds.platform === 'shopify') { const r = await P.website(q, 'test_shop', 'GET', 'shop.json'); detail = `Shopify store "${r.shop?.name}" (${r.shop?.currency})`; }
        else { const r = await P.website(q, 'test_products', 'GET', 'products?per_page=1'); detail = `WooCommerce reachable (${Array.isArray(r) ? 'products API OK' : 'unexpected answer'})`; }
      }
      await log(true, detail);
      res.json({ ok: true, detail, result: res.locals.result || null });
    } catch (e) {
      await log(false, e.message);
      res.json({ ok: false, detail: e.message });
    }
  }));
  api.get('/marketing/logs', need('marketing', 'view'), wrap(async (req, res) => {
    const [calls, jobs, usage] = await Promise.all([
      q('SELECT * FROM mkt_api_log ORDER BY at DESC LIMIT 200'),
      q('SELECT id, kind, ref_id, status, attempts, max_attempts, run_after, error, created_at, finished_at FROM mkt_jobs ORDER BY created_at DESC LIMIT 100'),
      q(`SELECT provider, to_char(at, 'YYYY-MM') AS month, COUNT(*)::int AS calls, COUNT(*) FILTER (WHERE NOT ok)::int AS errors, SUM(cost_usd)::float AS cost_usd FROM mkt_api_log GROUP BY 1, 2 ORDER BY 2 DESC, 1`),
    ]);
    const storage = await q.one(`SELECT COUNT(*)::int AS files, COALESCE(SUM(f.size),0)::bigint AS bytes FROM mkt_assets a JOIN files f ON f.id = a.file_id`);
    res.json({ calls, jobs, usage, storage });
  }));
  api.post('/marketing/jobs/:id/retry', need('marketing', 'edit'), wrap(async (req, res) => {
    const j = await q.one("UPDATE mkt_jobs SET status = 'queued', attempts = 0, run_after = now(), error = NULL WHERE id = $1 AND status = 'failed' RETURNING ref_id, kind", [req.params.id]);
    must(j, 409, 'Only failed jobs can be retried');
    if (j.kind === 'render_video') await q("UPDATE mkt_assets SET status = 'processing', detail = NULL WHERE id = $1", [j.ref_id]);
    res.json({ ok: true });
  }));
  api.post('/marketing/tick', need('marketing', 'edit'), wrap(async (_req, res) => res.json(await E.tick(db))));

  // ---------- products (daily upload) ----------
  api.get('/marketing/products', needAny(['marketing', 'view'], ['website', 'view']), wrap(async (req, res) => {
    const s = String(req.query.search || '').toLowerCase();
    res.json(await q(`SELECT p.id, p.name, p.name_ar, b.name AS brand, c.name AS category, p.image_url, p.images, p.web_visible, p.active, p.created_at, p.seo_title, p.seo_description, p.slug, p.web_external_id, p.description,
        (SELECT json_agg(json_build_object('id', v.id, 'sku', v.sku, 'size_ml', v.size_ml, 'label', v.label, 'retail_price', v.retail_price, 'web_price', v.web_price, 'compare_price', v.compare_price, 'stock', COALESCE((SELECT SUM(qty) FROM stock_levels sl WHERE sl.variant_id = v.id),0)) ORDER BY v.size_ml) FROM variants v WHERE v.product_id = p.id AND v.active) AS variants,
        (SELECT COUNT(*) FROM mkt_content m WHERE m.product_id = p.id)::int AS content,
        (SELECT COUNT(*) FROM mkt_content m WHERE m.product_id = p.id AND m.status = 'published')::int AS published
      FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.active AND ($1 = '' OR lower(p.name) LIKE '%' || $1 || '%' OR lower(COALESCE(b.name,'')) LIKE '%' || $1 || '%') ORDER BY p.created_at DESC LIMIT 200`, [s]));
  }));
  /** Daily upload: a new product (photos, sizes, prices) in the ERP catalogue, then optionally its AI content package. */
  api.post('/marketing/products', needAny(['inventory', 'create'], ['marketing', 'create']), wrap(async (req, res) => {
    const b = req.body || {};
    must(str(b.name), 400, 'Product name is required');
    must(Array.isArray(b.variants) && b.variants.length, 400, 'Add at least one size with a price');
    const photos = (b.photos || []).filter((u) => /^\/api\/files\/[\w-]+$/.test(u));
    must(photos.length, 400, 'Upload at least one product photo');
    const out = await db.tx(async (tq) => {
      const pid = id('prd_');
      await tq(`INSERT INTO products (name, name_ar, brand_id, category_id, description, description_ar, gender, concentration, notes_top, notes_heart, notes_base, image_url, web_visible, active, id, is_test)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false)`, [...productFields({ ...b, imageUrl: photos[0], webVisible: b.webVisible !== false, active: true }), pid]);
      await tq('UPDATE products SET images = $2 WHERE id = $1', [pid, photos.slice(1)]);
      for (const v of b.variants) await saveVariant(tq, pid, { ...v, openingQty: 0 }, null, req, b);
      return pid;
    });
    await audit(req, 'marketing_product_created', 'products', out, { name: b.name });
    let pack = null;
    if (b.generate) {
      try { pack = await E.buildPackage(q, { productId: out, kinds: b.kinds, lang: b.lang || 'en', tone: b.tone, badge: b.badge, promo: b.promo, extra: b.features, campaignId: b.campaignId, user: req.user }); }
      catch (e) { pack = { error: e.message }; }
    }
    res.json({ id: out, package: pack });
  }));

  // ---------- AI copywriter ----------
  api.post('/marketing/copy', need('marketing', 'create'), wrap(async (req, res) => {
    const p = await E.productInfo(q, req.body.productId);
    res.json(await E.writeCopy(q, p, { lang: req.body.lang, tone: req.body.tone, promo: req.body.promo, extra: req.body.extra }, p.id));
  }));
  api.post('/marketing/packages', need('marketing', 'create'), wrap(async (req, res) => {
    const b = req.body || {};
    const r = await E.buildPackage(q, { productId: b.productId, kinds: b.kinds, lang: b.lang, tone: b.tone, badge: b.badge, promo: b.promo, extra: b.extra, theme: b.theme, campaignId: b.campaignId, user: req.user });
    await audit(req, 'marketing_package', 'products', b.productId, { kinds: b.kinds, created: r.created.length });
    res.json(r);
  }));

  // ---------- assets / studio ----------
  api.get('/marketing/assets', need('marketing', 'view'), wrap(async (req, res) => {
    res.json(await q(`SELECT a.*, p.name AS product FROM mkt_assets a LEFT JOIN products p ON p.id = a.product_id
      WHERE ($1::text IS NULL OR a.product_id = $1) AND ($2::text IS NULL OR a.kind = $2) AND a.source <> 'cutout' ORDER BY a.created_at DESC LIMIT 200`, [req.query.productId || null, req.query.kind || null]));
  }));
  api.post('/marketing/assets/upload', need('marketing', 'create'), express.raw({ type: () => true, limit: '60mb' }), wrap(async (req, res) => {
    const mime = String(req.get('content-type') || '').split(';')[0];
    must(MEDIA.test(mime), 400, 'Upload a JPEG/PNG/WebP image, an MP4/MOV video or an MP3/M4A/WAV audio file');
    must(Buffer.isBuffer(req.body) && req.body.length > 0, 400, 'Empty file');
    const aid = await E.uploadAsset(q, { buf: req.body, mime, name: str(req.query.name, 120), productId: req.query.productId || null, userId: req.user.id });
    res.json(await q.one('SELECT * FROM mkt_assets WHERE id = $1', [aid]));
  }));
  api.post('/marketing/assets/creative', need('marketing', 'create'), wrap(async (req, res) => {
    const aid = await E.makeCreative(q, { ...req.body, userId: req.user.id });
    res.json(await q.one('SELECT * FROM mkt_assets WHERE id = $1', [aid]));
  }));
  api.post('/marketing/assets/video', need('marketing', 'create'), wrap(async (req, res) => {
    const aid = await E.queueVideo(q, { ...req.body, userId: req.user.id });
    E.tick(db).catch(() => {}); // start rendering right away
    res.json(await q.one('SELECT * FROM mkt_assets WHERE id = $1', [aid]));
  }));
  api.delete('/marketing/assets/:id', need('marketing', 'edit'), wrap(async (req, res) => {
    const used = await q.one("SELECT number FROM mkt_content WHERE $1 = ANY(asset_ids) AND status IN ('scheduled','published')", [req.params.id]);
    must(!used, 409, `Used by ${used?.number} — archive that content first`);
    await q("UPDATE mkt_content SET asset_ids = array_remove(asset_ids, $1) WHERE $1 = ANY(asset_ids)", [req.params.id]);
    await q('DELETE FROM mkt_assets WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  }));
  api.get('/marketing/studio/options', need('marketing', 'view'), (_req, res) => res.json({ formats: S.FORMATS, themes: Object.fromEntries(Object.entries(S.THEMES).map(([k, v]) => [k, v.label])) }));

  // ---------- content & approvals ----------
  const contentRow = async (cid) => {
    const c = await q.one(`SELECT c.*, p.name AS product, cp.name AS campaign, u.name AS created_by_name, a.name AS approved_by_name FROM mkt_content c LEFT JOIN products p ON p.id = c.product_id
      LEFT JOIN mkt_campaigns cp ON cp.id = c.campaign_id LEFT JOIN users u ON u.id = c.created_by LEFT JOIN users a ON a.id = c.approved_by WHERE c.id = $1`, [cid]);
    must(c, 404, 'Content not found');
    c.assets = c.asset_ids.length ? await q('SELECT * FROM mkt_assets WHERE id = ANY($1)', [c.asset_ids]) : [];
    c.pending_assets = await q("SELECT id, status, detail FROM mkt_assets WHERE params->>'contentId' = $1 AND status <> 'ready'", [cid]);
    c.history = await q('SELECT * FROM mkt_content_history WHERE content_id = $1 ORDER BY at DESC', [cid]);
    return c;
  };
  api.get('/marketing/content', needAny(['marketing', 'view'], ['website', 'view']), wrap(async (req, res) => {
    const f = req.query;
    res.json(await q(`SELECT c.id, c.number, c.kind, c.platform, c.title, c.caption, c.status, c.lang, c.scheduled_at, c.published_at, c.external_url, c.error, c.auto_generated, c.updated_at, c.asset_ids, c.product_id,
        p.name AS product, cp.name AS campaign,
        (SELECT json_agg(json_build_object('id', a.id, 'kind', a.kind, 'file_id', a.file_id, 'status', a.status, 'thumb', a.params->>'thumbFileId', 'format', a.format)) FROM mkt_assets a WHERE a.id = ANY(c.asset_ids) OR a.params->>'contentId' = c.id) AS assets
      FROM mkt_content c LEFT JOIN products p ON p.id = c.product_id LEFT JOIN mkt_campaigns cp ON cp.id = c.campaign_id
      WHERE ($1::text IS NULL OR c.status = $1) AND ($2::text IS NULL OR c.kind = ANY(string_to_array($2, ','))) AND ($3::text IS NULL OR c.product_id = $3)
        AND ($4::text IS NULL OR c.platform = $4) AND ($5::text IS NULL OR c.campaign_id = $5)
        AND ($6::date IS NULL OR COALESCE(c.scheduled_at, c.published_at, c.created_at)::date >= $6) AND ($7::date IS NULL OR COALESCE(c.scheduled_at, c.published_at, c.created_at)::date <= $7)
      ORDER BY COALESCE(c.scheduled_at, c.published_at, c.updated_at) DESC LIMIT 300`,
    [f.status || null, f.kind || null, f.productId || null, f.platform || null, f.campaignId || null, f.from || null, f.to || null]));
  }));
  api.get('/marketing/content/:id', needAny(['marketing', 'view'], ['website', 'view']), wrap(async (req, res) => res.json(await contentRow(req.params.id))));
  api.post('/marketing/content', needAny(['marketing', 'create'], ['website', 'create']), wrap(async (req, res) => {
    const b = req.body || {};
    must(E.KINDS[b.kind], 400, 'Choose a content type');
    if (E.KINDS[b.kind].platform === 'website') must(can(req.perms, 'website', 'create') || can(req.perms, 'marketing', 'create'), 403, 'No permission for website content');
    const cid = await E.createContent(q, { kind: b.kind, title: b.title, caption: b.caption, hashtags: b.hashtags, body: b.body || {}, lang: b.lang, tone: b.tone, productId: b.productId || null, campaignId: b.campaignId || null, assetIds: b.assetIds || [], status: 'draft' }, req.user);
    await audit(req, 'marketing_content_created', 'mkt_content', cid, { kind: b.kind });
    res.json(await contentRow(cid));
  }));
  api.put('/marketing/content/:id', needAny(['marketing', 'edit'], ['marketing', 'create'], ['website', 'edit']), wrap(async (req, res) => {
    const c = await q.one('SELECT * FROM mkt_content WHERE id = $1', [req.params.id]); must(c, 404, 'Content not found');
    must(!['published', 'archived'].includes(c.status), 409, 'Published or archived content cannot be edited — duplicate it instead');
    const b = req.body || {};
    // edits by someone who cannot approve send approved/scheduled content back for review
    const back = ['approved', 'scheduled'].includes(c.status) && !can(req.perms, 'marketing', 'approve');
    await q(`UPDATE mkt_content SET title = COALESCE($2, title), caption = COALESCE($3, caption), hashtags = COALESCE($4, hashtags), body = body || $5, asset_ids = COALESCE($6, asset_ids),
        campaign_id = CASE WHEN $7::boolean THEN $8 ELSE campaign_id END, lang = COALESCE($9, lang), status = CASE WHEN $10 THEN 'under_review' ELSE status END,
        scheduled_at = CASE WHEN $10 THEN NULL ELSE scheduled_at END, updated_at = now() WHERE id = $1`,
    [c.id, b.title ?? null, b.caption ?? null, b.hashtags ?? null, b.body || {}, Array.isArray(b.assetIds) ? b.assetIds : null, 'campaignId' in b, b.campaignId || null, b.lang || null, back]);
    await q('INSERT INTO mkt_content_history (content_id, action, from_status, to_status, note, user_id, user_name) VALUES ($1,$2,$3,$4,$5,$6,$7)', [c.id, 'edited', c.status, back ? 'under_review' : c.status, back ? 'Edited after approval — needs approval again' : null, req.user.id, req.user.name]);
    res.json(await contentRow(c.id));
  }));
  api.delete('/marketing/content/:id', need('marketing', 'edit'), wrap(async (req, res) => {
    const c = await q.one('SELECT status, number FROM mkt_content WHERE id = $1', [req.params.id]); must(c, 404, 'Content not found');
    must(['draft', 'ai_generated', 'under_review', 'failed'].includes(c.status), 409, 'Only drafts can be deleted — archive published or approved content');
    await q('DELETE FROM mkt_content_history WHERE content_id = $1', [req.params.id]);
    await q('DELETE FROM mkt_content WHERE id = $1', [req.params.id]);
    await audit(req, 'marketing_draft_deleted', 'mkt_content', req.params.id, { number: c.number });
    res.json({ ok: true });
  }));
  api.post('/marketing/content/:id/publish', need('marketing', 'approve'), wrap(async (req, res) => {
    await rememberUrl(req);
    try {
      const r = await E.publish(q, req.params.id, ctxOf(req));
      await audit(req, 'marketing_published', 'mkt_content', req.params.id, { url: r.external_url });
      res.json(await contentRow(req.params.id));
    } catch (e) {
      await audit(req, 'marketing_publish_failed', 'mkt_content', req.params.id, { error: e.message });
      throw e;
    }
  }));
  api.post('/marketing/content/:id/regenerate', need('marketing', 'create'), wrap(async (req, res) => {
    const c = await q.one('SELECT * FROM mkt_content WHERE id = $1', [req.params.id]); must(c, 404, 'Content not found');
    must(!['published', 'archived'].includes(c.status), 409, 'Cannot change published content');
    must(c.product_id, 400, 'Only product content can be regenerated');
    const part = req.body.part || 'copy';
    const s = await E.mktSettings(q);
    if (part === 'copy') {
      const p = await E.productInfo(q, c.product_id);
      const copy = await E.writeCopy(q, p, { lang: req.body.lang || c.lang, tone: req.body.tone || c.tone || s.automation.tone, promo: req.body.promo, extra: req.body.instructions }, p.id);
      const pick = { post: copy[{ en: 'instagram_caption', ar: 'caption_ar', ml: 'caption_ml' }[req.body.lang || c.lang]] || copy.instagram_caption, reel: copy.instagram_caption, story: copy.story_text, facebook: copy.facebook_post, whatsapp: copy.whatsapp_message, web_product: copy.description_en }[c.kind] || copy.instagram_caption;
      await q("UPDATE mkt_content SET caption = $2, hashtags = $3, body = body || $4, status = CASE WHEN status IN ('approved','scheduled') THEN 'under_review' ELSE 'ai_generated' END, updated_at = now() WHERE id = $1",
        [c.id, pick, (copy.hashtags || []).map((h) => (h.startsWith('#') ? h : '#' + h)).join(' '), { copy, ...(c.kind === 'web_product' ? { description: copy.description_en, description_ar: copy.description_ar, seo_title: copy.seo_title, seo_description: copy.seo_description, slug: copy.slug, image_alt: copy.image_alt } : {}) }]);
    } else if (part === 'image') {
      const fmt = { post: 'portrait', story: 'story', facebook: 'square', whatsapp: 'square', banner: 'banner' }[c.kind] || 'square';
      const aid = await E.makeCreative(q, { productId: c.product_id, format: req.body.format || fmt, theme: req.body.theme, layout: req.body.layout || (c.kind === 'story' ? 'offer' : 'hero'), lang: c.lang, badge: req.body.badge, aiBackground: !!req.body.aiBackground, removeBackground: req.body.removeBackground, userId: req.user.id });
      await q("UPDATE mkt_content SET asset_ids = ARRAY[$2]::text[], status = CASE WHEN status IN ('approved','scheduled') THEN 'under_review' ELSE status END, updated_at = now() WHERE id = $1", [c.id, aid]);
    } else if (part === 'video') {
      await q("UPDATE mkt_content SET asset_ids = ARRAY(SELECT x FROM unnest(asset_ids) x WHERE x NOT IN (SELECT id FROM mkt_assets WHERE kind = 'video')), status = CASE WHEN status IN ('approved','scheduled') THEN 'under_review' ELSE status END WHERE id = $1", [c.id]);
      await E.queueVideo(q, { productId: c.product_id, format: req.body.format || 'story', theme: req.body.theme, lang: c.lang, badge: req.body.badge, seconds: req.body.seconds, musicAssetId: req.body.musicAssetId, voiceover: req.body.voiceover, mode: req.body.mode, prompt: req.body.prompt, contentId: c.id, userId: req.user.id });
      E.tick(db).catch(() => {});
    } else fail(400, 'Choose copy, image or video');
    await q('INSERT INTO mkt_content_history (content_id, action, from_status, to_status, note, user_id, user_name) VALUES ($1,$2,$3,$3,$4,$5,$6)', [c.id, 'regenerated', c.status, part, req.user.id, req.user.name]);
    res.json(await contentRow(c.id));
  }));
  api.post('/marketing/content/:id/:action', need('marketing', 'view'), wrap(async (req, res) => {
    must(['submit', 'approve', 'reject', 'schedule', 'unschedule', 'archive', 'restore'].includes(req.params.action), 404, 'Unknown action');
    await rememberUrl(req);
    await E.transition(q, req.params.id, req.params.action, { ...ctxOf(req), note: str(req.body.note, 500), scheduledAt: req.body.scheduledAt });
    await audit(req, `marketing_${req.params.action}`, 'mkt_content', req.params.id, { note: req.body.note, at: req.body.scheduledAt });
    res.json(await contentRow(req.params.id));
  }));

  // ---------- campaigns ----------
  const campaignFields = (b) => [str(b.name, 120), b.kind || 'discount', b.startDate || null, b.endDate || null, Array.isArray(b.productIds) ? b.productIds : [], b.promotionId || null, str(b.couponCode, 40), str(b.discountText, 200), str(b.audience, 300), Array.isArray(b.platforms) ? b.platforms : [], b.budget == null || b.budget === '' ? 0 : money(b.budget, 'budget'), b.spend == null || b.spend === '' ? 0 : money(b.spend, 'spend'), str(b.notes, 2000)];
  api.get('/marketing/campaigns', need('marketing', 'view'), wrap(async (req, res) => {
    const perf = await E.campaignPerformance(q, {});
    const extra = await q('SELECT id, product_ids, promotion_id, coupon_code, discount_text, audience, utm, notes FROM mkt_campaigns');
    res.json(perf.map((c) => ({ ...c, ...extra.find((x) => x.id === c.id) })));
  }));
  api.post('/marketing/campaigns', need('marketing', 'create'), wrap(async (req, res) => {
    const f = campaignFields(req.body || {});
    must(f[0], 400, 'Campaign name is required');
    const cid = id('cmp_');
    await q(`INSERT INTO mkt_campaigns (name, kind, start_date, end_date, product_ids, promotion_id, coupon_code, discount_text, audience, platforms, budget, spend, notes, id, utm, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [...f, cid, cid.slice(4, 12).toLowerCase(), req.user.id]);
    await audit(req, 'campaign_created', 'mkt_campaigns', cid, { name: f[0] });
    res.json({ id: cid });
  }));
  api.put('/marketing/campaigns/:id', need('marketing', 'edit'), wrap(async (req, res) => {
    const f = campaignFields(req.body || {});
    must(f[0], 400, 'Campaign name is required');
    const status = req.body.status;
    if (status && status !== 'draft') must(can(req.perms, 'marketing', 'approve'), 403, 'Starting or stopping a campaign needs approval permission');
    await q(`UPDATE mkt_campaigns SET name=$1, kind=$2, start_date=$3, end_date=$4, product_ids=$5, promotion_id=$6, coupon_code=$7, discount_text=$8, audience=$9, platforms=$10, budget=$11, spend=$12, notes=$13, status = COALESCE($15, status), updated_at = now() WHERE id = $14`, [...f, req.params.id, status || null]);
    await audit(req, 'campaign_updated', 'mkt_campaigns', req.params.id, { status });
    res.json({ ok: true });
  }));

  // ---------- website CMS & SEO ----------
  api.get('/website/status', needAny(['website', 'view'], ['marketing', 'view']), wrap(async (_req, res) => {
    const c = await P.loadCreds(q, 'website');
    const s = await E.mktSettings(q);
    res.json({ connected: P.configured('website', c), platform: c.platform, url: c.url, sitemap: c.url ? `${c.url.replace(/\/+$/, '')}/${c.platform === 'shopify' ? 'sitemap.xml' : 'wp-sitemap.xml'}` : null, tracking: !!(await q.one('SELECT 1 AS x FROM mkt_web_events LIMIT 1')), trackerUrl: s.publicUrl ? `${s.publicUrl}/api/t.js` : null });
  }));
  /** SEO fields saved in the ERP; pushed to the website by publishing a "Website product" item. */
  api.put('/website/products/:id/seo', needAny(['website', 'edit'], ['marketing', 'edit']), wrap(async (req, res) => {
    const b = req.body || {};
    const slug = b.slug ? String(b.slug).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 80) : null;
    await q('UPDATE products SET seo_title = $2, seo_description = $3, slug = $4, updated_at = now() WHERE id = $1', [req.params.id, str(b.seoTitle, 70), str(b.seoDescription, 170), slug]);
    res.json({ ok: true, slug });
  }));

  // ---------- AI assistant ----------
  api.post('/marketing/assistant', needAny(['marketing', 'view'], ['assistant', 'view']), wrap(async (req, res) => {
    const r = await chat(q, Array.isArray(req.body.messages) ? req.body.messages : [], ctxOf(req));
    res.json(r);
  }));
}
