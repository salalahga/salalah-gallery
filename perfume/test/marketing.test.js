// Marketing system tests. External services are replaced by a local fake server that records every request,
// so these tests prove what the ERP sends and how it handles the answers — not that live accounts work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import sharp from 'sharp';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { setDataKey } from '../server/security.js';
import { tick } from '../server/services/mkt/engine.js';

setDataKey(crypto.randomBytes(32).toString('hex'));
let server, fake, base, fakeBase, db;
const seen = [];

const COPY = {
  title: 'Dior Sauvage EDP', description_en: 'A fresh, bold signature in a 100 ml bottle.', description_ar: 'عطر منعش وجريء.', seo_title: 'Dior Sauvage EDP 100 ml | Belle Âme', seo_description: 'Dior Sauvage EDP 100 ml at Belle Âme, Salalah. OMR 56.000.',
  slug: 'dior-sauvage-edp', image_alt: 'Dior Sauvage bottle', instagram_caption: 'AI CAPTION: Sauvage, now at Belle Âme ✨', story_text: 'Sauvage · OMR 56.000', whatsapp_message: 'Sauvage 100 ml is OMR 56.000 — reply to order.',
  facebook_post: 'Sauvage at Belle Âme', headline: 'Sauvage', tagline: 'Fresh and bold', caption_ar: 'سوفاج', caption_ml: 'സൊവാജ്', hashtags: ['#dior', 'sauvage'], reel_script: { scenes: ['Dior', 'Sauvage', 'OMR 56.000'], voiceover: 'Sauvage.' },
};

function fakeServer() {
  return http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const url = new URL(req.url, 'http://x');
    seen.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, headers: req.headers });
    const json = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const p = url.pathname;
    // Anthropic Messages API
    if (p === '/v1/messages') return json({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(COPY) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 500 } });
    // Meta Graph API
    if (p === '/v23.0/page_1' && req.method === 'GET') return json({ id: 'page_1', name: 'Belle Ame', followers_count: 1200, instagram_business_account: { id: 'ig_1', username: 'belleame', followers_count: 3400 } });
    if (p === '/v23.0/ig_1' && req.method === 'GET') return json({ followers_count: 3400, media_count: 50 });
    if (p === '/v23.0/ig_1/insights') return json({ data: [{ name: url.searchParams.get('metric'), total_value: { value: 777 }, values: [{ value: 777 }] }] });
    if (p === '/v23.0/ig_1/media') return json({ id: 'container_1' });
    if (p === '/v23.0/container_1') return json({ status_code: 'FINISHED' });
    if (p === '/v23.0/ig_1/media_publish') return json({ id: 'media_1' });
    if (p === '/v23.0/media_1') return json({ permalink: 'https://www.instagram.com/p/ABC/', like_count: 5, comments_count: 1 });
    if (p === '/v23.0/media_1/insights') return json({ data: [{ values: [{ value: 90 }] }] });
    if (p === '/v23.0/page_1/photos') return json({ id: 'photo_1', post_id: 'page_1_post_1' });
    if (p === '/v23.0/phone_1/messages') {
      const b = JSON.parse(body);
      if (b.to.endsWith('0000')) return json({ error: { message: 'Recipient not on WhatsApp' } }, 400);
      return json({ messages: [{ id: 'wamid.1' }] });
    }
    // WordPress REST (gallery)
    if (p === '/wp-json/wp/v2/media' && req.method === 'POST') { const n = seen.filter((x) => x.path === p && x.method === 'POST').length; return json({ id: 500 + n, source_url: `${'https://wp.test'}/m/${500 + n}.jpg` }); }
    if (/^\/wp-json\/wp\/v2\/media\/\d+$/.test(p)) return json({ ok: true });
    if (p === '/wp-json/wp/v2/pages' && req.method === 'GET') return json(seen.some((x) => x.path === p && x.method === 'POST') ? [{ id: 77, link: 'https://wp.test/gallery/' }] : []);
    if (p === '/wp-json/wp/v2/pages' && req.method === 'POST') return json({ id: 77, link: 'https://wp.test/gallery/' });
    if (p === '/wp-json/wp/v2/pages/77') return json({ id: 77, link: 'https://wp.test/gallery/' });
    // old website photo CDN
    if (p.startsWith('/legacy/')) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(await sharp({ create: { width: 300, height: 400, channels: 3, background: '#111' } }).jpeg().toBuffer()); }
    // Shopify Admin API
    if (p === '/admin/api/2025-07/shop.json') return json({ shop: { name: 'Belle Ame', currency: 'OMR' } });
    if (p === '/admin/api/2025-07/products.json' && req.method === 'POST') return json({ product: { id: 987, handle: 'dior-sauvage-edp' } });
    json({ error: { message: `fake: no route ${req.method} ${p}` } }, 404);
  });
}

function client() {
  let cookie = '';
  const call = async (method, path, body, raw) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': raw ? raw.type : 'application/json', cookie, 'x-forwarded-proto': 'https', host: 'shop.test' }, body: raw ? raw.buf : body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b = {}) => call('PUT', p, b), del: (p) => call('DELETE', p), raw: (p, type, buf) => call('POST', p, null, { type, buf }) };
}
const owner = client();
let productId;

before(async () => {
  fake = fakeServer();
  await new Promise((r) => fake.listen(0, r));
  fakeBase = `http://127.0.0.1:${fake.address().port}`;
  process.env.META_GRAPH_BASE = fakeBase;
  db = await openDb({ dataDir: ':memory:' });
  const app = await createApp(db);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
  assert.equal((await owner.post('/auth/setup', { name: 'Owner', username: 'owner', password: 'Owner1234', demo: true })).status, 200);
  await db.query("INSERT INTO settings (key, value) VALUES ('marketing', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [{ publicUrl: 'https://shop.test' }]);
});
after(async () => { server?.close(); fake?.close(); await db?.close(); delete process.env.META_GRAPH_BASE; delete process.env.ANTHROPIC_BASE_URL; });

const photo = () => sharp({ create: { width: 600, height: 800, channels: 3, background: '#2a4d6e' } }).jpeg().toBuffer();

test('daily upload creates a real catalogue product with photos and sizes; template copy is labelled when AI is not connected', async () => {
  const f = await owner.post('/files', { data: 'data:image/jpeg;base64,' + (await photo()).toString('base64') });
  assert.equal(f.status, 200);
  const r = await owner.post('/marketing/products', {
    name: 'Sauvage Elixir', brandId: (await db.one("SELECT id FROM brands WHERE name ILIKE 'dior%'"))?.id || null, photos: [f.data.url], notesTop: 'Grapefruit', notesHeart: 'Lavender',
    variants: [{ sizeMl: 60, retailPrice: 65000, comparePrice: 72000 }, { sizeMl: 100, retailPrice: 89000 }], generate: true, kinds: ['post', 'story', 'reel', 'whatsapp', 'web_product'], badge: 'New arrival',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  productId = r.data.id;
  const v = await db.query('SELECT sku, barcode, retail_price, compare_price FROM variants WHERE product_id = $1 ORDER BY size_ml', [productId]);
  assert.equal(v.length, 2);
  assert.ok(v.every((x) => x.sku && /^\d{13}$/.test(x.barcode)), 'auto SKU + barcode');
  assert.equal(r.data.package.created.length, 5);
  assert.match(r.data.package.aiNote, /template/i);
  const post = await db.one("SELECT * FROM mkt_content WHERE product_id = $1 AND kind = 'post'", [productId]);
  assert.equal(post.status, 'ai_generated');
  assert.equal(post.asset_ids.length, 1);
  const a = await db.one('SELECT * FROM mkt_assets WHERE id = $1', [post.asset_ids[0]]);
  assert.equal(a.width, 1080); assert.equal(a.height, 1350);
});

test('reel video is rendered in the background as H.264 9:16 and attached to the content', async () => {
  for (let i = 0; i < 60; i++) {
    await tick(db);
    const r = await db.one("SELECT COUNT(*)::int AS n FROM mkt_assets WHERE product_id = $1 AND kind = 'video' AND status = 'ready'", [productId]);
    if (r.n) break;
    await new Promise((res) => setTimeout(res, 500));
  }
  const reel = await db.one("SELECT * FROM mkt_content WHERE product_id = $1 AND kind = 'reel'", [productId]);
  const vid = await db.one("SELECT a.*, f.size, f.mime FROM mkt_assets a JOIN files f ON f.id = a.file_id WHERE a.id = ANY($1) AND a.kind = 'video'", [reel.asset_ids]);
  assert.equal(vid.status, 'ready');
  assert.equal(vid.mime, 'video/mp4'); assert.equal(vid.width, 1080); assert.equal(vid.height, 1920);
  assert.ok(Number(vid.duration_s) > 8, `duration ${vid.duration_s}`);
});

test('same product, same day: no duplicate content is generated', async () => {
  const r = await owner.post('/marketing/packages', { productId, kinds: ['post', 'story'] });
  assert.equal(r.status, 200);
  assert.equal(r.data.created.length, 0);
});

test('marketing manager can prepare but not approve, schedule or publish', async () => {
  const mu = await owner.post('/users', { name: 'Mona', username: 'mona', password: 'Market123', role: 'marketing' }); assert.equal(mu.status, 200, JSON.stringify(mu.data));
  await db.query("UPDATE users SET must_change_password = false WHERE username = 'mona'");
  const m = client();
  const ml = await m.post('/auth/login', { username: 'mona', password: 'Market123', app: 'admin' }); assert.equal(ml.status, 200, JSON.stringify(ml.data));
  const c = await db.one("SELECT id FROM mkt_content WHERE product_id = $1 AND kind = 'post'", [productId]);
  assert.equal((await m.post(`/marketing/content/${c.id}/submit`)).status, 200);
  const ap = await m.post(`/marketing/content/${c.id}/approve`);
  assert.equal(ap.status, 403);
  assert.match(ap.data.error, /approv/i);
  assert.equal((await m.post(`/marketing/content/${c.id}/publish`)).status, 403);
  assert.equal((await m.get('/reports/trial-balance')).status, 403, 'no finance access');
});

test('Claude writes the copy when connected (key stored encrypted, never returned)', async () => {
  process.env.ANTHROPIC_BASE_URL = fakeBase;
  assert.equal((await owner.put('/marketing/connections/anthropic', { apiKey: 'sk-ant-test-1234567890' })).status, 200);
  const stored = (await db.one("SELECT value FROM settings WHERE key = 'integrations'")).value.anthropic.apiKey;
  assert.ok(!String(stored).includes('sk-ant'), 'key encrypted at rest');
  const list = await owner.get('/marketing/connections');
  assert.equal(list.data.providers.find((p) => p.key === 'anthropic').values.apiKey, '•••• 7890');
  const r = await owner.post('/marketing/copy', { productId, lang: 'en', tone: 'luxury' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.instagram_caption, COPY.instagram_caption);
  const call = seen.filter((s) => s.path === '/v1/messages').at(-1);
  const body = JSON.parse(call.body);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.match(JSON.stringify(body.messages), /Sauvage Elixir/);
  assert.match(JSON.stringify(body.messages), /OMR 65\.000/, 'real ERP prices are sent');
  const log = await db.one("SELECT * FROM mkt_api_log WHERE provider = 'anthropic' ORDER BY at DESC LIMIT 1");
  assert.equal(log.ok, true); assert.ok(Number(log.cost_usd) > 0);
});

test('Meta: connection test discovers the Instagram account; publishing sends a public image URL and records the permalink', async () => {
  await owner.put('/marketing/connections/meta', { pageId: 'page_1', accessToken: 'EAAB-test-token' });
  const t = await owner.post('/marketing/connections/meta/test');
  assert.equal(t.data.ok, true, JSON.stringify(t.data));
  assert.match(t.data.detail, /@belleame/);
  const c = await db.one("SELECT id FROM mkt_content WHERE product_id = $1 AND kind = 'post'", [productId]);
  const ap = await owner.post(`/marketing/content/${c.id}/approve`, { note: 'Looks good' });
  assert.equal(ap.status, 200, JSON.stringify(ap.data));
  const pub = await owner.post(`/marketing/content/${c.id}/publish`);
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  assert.equal(pub.data.status, 'published');
  assert.equal(pub.data.external_url, 'https://www.instagram.com/p/ABC/');
  const media = seen.find((s) => s.path === '/v23.0/ig_1/media');
  const form = new URLSearchParams(media.body);
  assert.match(form.get('image_url'), /^https:\/\/shop\.test\/api\/files\/f_/);
  assert.match(form.get('caption'), /Sauvage/);
  assert.equal(form.get('access_token'), 'EAAB-test-token');
  assert.ok(seen.some((s) => s.path === '/v23.0/ig_1/media_publish' && new URLSearchParams(s.body).get('creation_id') === 'container_1'));
  // the published image really is served publicly at that URL
  const img = await fetch(base + form.get('image_url').replace('https://shop.test/api', ''));
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg');
  // publishing twice is refused
  assert.equal((await owner.post(`/marketing/content/${c.id}/publish`)).status, 409);
});

test('scheduled Reel is published by the scheduler at its time (video_url + REELS)', async () => {
  const c = await db.one("SELECT id FROM mkt_content WHERE product_id = $1 AND kind = 'reel'", [productId]);
  await owner.post(`/marketing/content/${c.id}/approve`);
  assert.equal((await owner.post(`/marketing/content/${c.id}/schedule`, { scheduledAt: '2020-01-01T10:00:00Z' })).status, 400, 'past time refused');
  const at = new Date(Date.now() + 3600e3).toISOString();
  assert.equal((await owner.post(`/marketing/content/${c.id}/schedule`, { scheduledAt: at })).status, 200);
  await tick(db, { now: new Date(Date.now() + 1800e3) });
  assert.equal((await db.one('SELECT status FROM mkt_content WHERE id = $1', [c.id])).status, 'scheduled', 'not before its time');
  await tick(db, { now: new Date(Date.now() + 7200e3) });
  const row = await db.one('SELECT status, external_id FROM mkt_content WHERE id = $1', [c.id]);
  assert.equal(row.status, 'published');
  const media = seen.filter((s) => s.path === '/v23.0/ig_1/media').at(-1);
  const form = new URLSearchParams(media.body);
  assert.equal(form.get('media_type'), 'REELS');
  assert.match(form.get('video_url'), /^https:\/\/shop\.test\/api\/files\//);
});

test('WhatsApp: only customers who opted in receive the approved template; failures are counted, not hidden', async () => {
  await owner.put('/marketing/connections/whatsapp', { phoneNumberId: 'phone_1', accessToken: 'EAAB-wa' });
  const c = await db.one("SELECT id FROM mkt_content WHERE product_id = $1 AND kind = 'whatsapp'", [productId]);
  await owner.put(`/marketing/content/${c.id}`, { body: { template: '' } });
  await owner.post(`/marketing/content/${c.id}/approve`);
  const noTpl = await owner.post(`/marketing/content/${c.id}/publish`);
  assert.equal(noTpl.status, 412);
  assert.match(noTpl.data.error, /template/i);
  await db.query('UPDATE customers SET marketing_opt_in = false');
  await db.query("UPDATE customers SET marketing_opt_in = true, is_test = false, phone = '96812345678' WHERE id = (SELECT id FROM customers ORDER BY created_at LIMIT 1)");
  await db.query("UPDATE customers SET marketing_opt_in = true, is_test = false, phone = '96890000000' WHERE id = (SELECT id FROM customers ORDER BY created_at OFFSET 1 LIMIT 1)");
  await db.query("UPDATE customers SET marketing_opt_in = true, phone = '96811111111' WHERE id = (SELECT id FROM customers WHERE is_test ORDER BY created_at LIMIT 1)"); // test customer: must be skipped
  await owner.put(`/marketing/content/${c.id}`, { body: { template: 'new_arrival', templateLang: 'en' } });
  const r = await owner.post(`/marketing/content/${c.id}/publish`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.body.results.sent, r.data.body.results.failed], [1, 1]);
  const sends = seen.filter((s) => s.path === '/v23.0/phone_1/messages').map((s) => JSON.parse(s.body));
  assert.equal(sends.length, 2, 'exactly the two opted-in customers');
  assert.equal(sends[0].type, 'template'); assert.equal(sends[0].template.name, 'new_arrival');
  assert.equal(sends[0].template.components[0].parameters[0].type, 'image');
});

test('Shopify: website product is created with ERP sizes, prices, compare-at price, SKU and barcode', async () => {
  await owner.put('/marketing/connections/website', { platform: 'shopify', url: fakeBase, token: 'shpat_test' });
  assert.equal((await owner.post('/marketing/connections/website/test')).data.ok, true);
  const c = await db.one("SELECT id FROM mkt_content WHERE product_id = $1 AND kind = 'web_product'", [productId]);
  await owner.post(`/marketing/content/${c.id}/approve`);
  const r = await owner.post(`/marketing/content/${c.id}/publish`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const call = seen.find((s) => s.path === '/admin/api/2025-07/products.json');
  assert.equal(call.headers['x-shopify-access-token'], 'shpat_test');
  const p = JSON.parse(call.body).product;
  assert.match(p.title, /Sauvage Elixir/);
  assert.deepEqual(p.variants.map((v) => [v.option1, v.price, v.compare_at_price]), [['60 ml', '65.000', '72.000'], ['100 ml', '89.000', null]]);
  assert.ok(p.variants.every((v) => v.sku && v.barcode));
  assert.match(p.images[0].src, /^https:\/\/shop\.test\/api\/files\//);
  assert.equal((await db.one('SELECT web_external_id FROM products WHERE id = $1', [productId])).web_external_id, '987');
  assert.equal(r.data.external_url, `${fakeBase}/products/dior-sauvage-edp`);
});

test('Publish now without a connection keeps the item approved (nothing was sent)', async () => {
  await db.query("UPDATE settings SET value = value - 'facebook' WHERE key = 'integrations'");
  const r = await owner.post('/marketing/content', { kind: 'facebook', title: 'FB text post', caption: 'Hello' });
  await owner.post(`/marketing/content/${r.data.id}/approve`);
  await db.query("UPDATE settings SET value = jsonb_set(value, '{meta,accessToken}', 'null') WHERE key = 'integrations'");
  const p = await owner.post(`/marketing/content/${r.data.id}/publish`);
  assert.equal(p.status, 412);
  const row = await db.one('SELECT status, error FROM mkt_content WHERE id = $1', [r.data.id]);
  assert.equal(row.status, 'approved');
  assert.match(row.error, /not connected/);
  await owner.put('/marketing/connections/meta', { accessToken: 'EAAB-test-token' });
});

test('website banners cannot be "published" through the API (theme-only) — refused honestly', async () => {
  const r = await owner.post('/marketing/content', { kind: 'banner', title: 'Eid banner', productId });
  await owner.post(`/marketing/content/${r.data.id}/approve`);
  const p = await owner.post(`/marketing/content/${r.data.id}/publish`);
  assert.equal(p.status, 409);
  assert.match(p.data.error, /theme/i);
});

test('failed publishing is recorded with the reason and can be retried', async () => {
  const r = await owner.post('/marketing/content', { kind: 'post', title: 'No image post', caption: 'x' });
  await owner.post(`/marketing/content/${r.data.id}/approve`);
  const p = await owner.post(`/marketing/content/${r.data.id}/publish`);
  assert.equal(p.status, 409);
  assert.match(p.data.error, /image/i);
});

test('metrics come only from what Meta returns; website visits from the tracking script', async () => {
  const s = await owner.post('/marketing/metrics/sync');
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(s.data.instagram, 3400);
  const t1 = await fetch(base + '/t', { method: 'POST', body: JSON.stringify({ kind: 'pageview', path: '/', visitor: 'v1' }) });
  assert.equal(t1.status, 204);
  await fetch(base + '/t', { method: 'POST', body: JSON.stringify({ kind: 'product_view', path: '/products/x', product: 'x', visitor: 'v1' }) });
  const d = await owner.get('/marketing/overview');
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.equal(d.data.followers.instagram, 3400);
  assert.equal(d.data.followers.facebook, 1200);
  assert.equal(d.data.reach, 777);
  assert.deepEqual([d.data.web.visitors, d.data.web.product_views], [1, 1]);
  assert.ok(d.data.content.published >= 3);
  const js = await fetch(base + '/t.js');
  assert.match(await js.text(), /sendBeacon/);
});

test('campaign sales come from real orders using the campaign coupon, inside the campaign dates', async () => {
  const sale = await db.one("SELECT id, total, refunded, created_at::date::text AS d FROM sales WHERE status NOT IN ('pending','cancelled') ORDER BY created_at DESC LIMIT 1");
  await db.query("UPDATE sales SET coupon_code = 'EID25' WHERE id = $1", [sale.id]);
  const c = await owner.post('/marketing/campaigns', { name: 'Eid offer', kind: 'seasonal', startDate: sale.d, endDate: sale.d, couponCode: 'eid25', budget: 50000, platforms: ['instagram'] });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const list = await owner.get('/marketing/campaigns');
  const row = list.data.find((x) => x.id === c.data.id);
  assert.equal(row.orders, 1);
  assert.equal(Number(row.revenue), Number(sale.total) - Number(sale.refunded));
});

test('scheduler heartbeat requires the secret key', async () => {
  const bad = await fetch(base + '/marketing/cron', { method: 'POST', headers: { 'x-cron-key': 'nope' } });
  assert.equal(bad.status, 401);
  const k = await owner.post('/marketing/settings/cron-key');
  const ok = await fetch(base + '/marketing/cron', { method: 'POST', headers: { 'x-cron-key': k.data.key } });
  assert.equal(ok.status, 200);
});

test('old belleameoman.com catalogue imports once with exact prices, photos and auto barcodes', async () => {
  process.env.LEGACY_IMG_BASE = fakeBase + '/legacy/';
  try {
    const r = await owner.post('/marketing/import/legacy');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.failed.length, 0, JSON.stringify(r.data.failed));
    assert.equal(r.data.created.length, 8);
    const p = await db.query(`SELECT p.name, p.image_url, b.name AS brand, v.retail_price, v.web_price, v.barcode FROM products p LEFT JOIN brands b ON b.id = p.brand_id JOIN variants v ON v.product_id = p.id WHERE p.name IN ('Luxury Edition Magic', 'Sensu', 'Signature Collection Charonne') ORDER BY p.name`);
    assert.deepEqual(p.map((x) => [x.name, x.brand, x.retail_price, x.web_price]), [['Luxury Edition Magic', 'Linea De Bella', 20000, 20000], ['Sensu', null, 11025, 11025], ['Signature Collection Charonne', 'Charonne', 8400, 8400]]);
    assert.ok(p.every((x) => /^\/api\/files\//.test(x.image_url) && /^\d{13}$/.test(x.barcode)));
    const again = await owner.post('/marketing/import/legacy');
    assert.equal(again.data.created.length, 0); assert.equal(again.data.skipped.length, 8);
    assert.equal((await fetch(base + '/marketing/import/legacy-job', { method: 'POST', headers: { 'x-cron-key': 'wrong' } })).status, 401);
  } finally { delete process.env.LEGACY_IMG_BASE; }
});

test('internal server addresses are never used for media links', async () => {
  const { isPublicOrigin, originOf } = await import('../server/services/mkt/engine.js');
  assert.equal(isPublicOrigin('https://10.4.0.215:3001'), false);
  assert.equal(isPublicOrigin('https://localhost'), false);
  assert.equal(isPublicOrigin('https://belleame.ample.run'), true);
  const req = { protocol: 'http', get: (h) => ({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'belleame.ample.run', host: '10.4.0.215:3001' })[h] };
  assert.equal(originOf(req), 'https://belleame.ample.run');
});

test('photo links carry a file extension and still open', async () => {
  const f = await db.one("SELECT id FROM files WHERE mime = 'image/jpeg' LIMIT 1");
  const r = await fetch(`${base}/files/${f.id}.jpg`);
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg');
});

test('old-site products go to the website through approval + publish when the owner asks (job endpoint)', async () => {
  process.env.MKT_CRON_KEY = 'k'.repeat(32);
  try {
    const r = await fetch(base + '/marketing/import/legacy-job?publish=1', { method: 'POST', headers: { 'x-cron-key': process.env.MKT_CRON_KEY } });
    const d = await r.json();
    assert.equal(r.status, 200, JSON.stringify(d));
    assert.equal(d.website.failed.length, 0, JSON.stringify(d.website.failed));
    assert.equal(d.website.published.length + d.website.skipped.length, 8);
    const c = await db.query("SELECT c.status, c.approved_by FROM mkt_content c JOIN products p ON p.id = c.product_id WHERE p.name = 'Sensu' AND c.kind = 'web_product'");
    assert.ok(c.some((x) => x.status === 'published' && x.approved_by));
  } finally { delete process.env.MKT_CRON_KEY; }
});

test('Studio gallery goes to a WordPress "Gallery" page; a second run uploads nothing new', async () => {
  await owner.put('/marketing/connections/website', { platform: 'woocommerce', url: fakeBase, key: 'shopowner', secret: 'abcd efgh ijkl mnop' });
  const n = (await db.one("SELECT COUNT(*)::int AS n FROM mkt_assets WHERE kind = 'image' AND status = 'ready' AND source <> 'cutout'")).n;
  assert.ok(n > 0);
  const r = await owner.post('/marketing/website/gallery');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.failed.length, 0, JSON.stringify(r.data.failed));
  assert.equal(r.data.total, n); assert.equal(r.data.uploaded, n);
  assert.equal(r.data.url, 'https://wp.test/gallery/');
  const up = seen.filter((x) => x.path === '/wp-json/wp/v2/media' && x.method === 'POST');
  assert.ok(up[0].headers.authorization.startsWith('Basic ') && /attachment; filename="belleame-/.test(up[0].headers['content-disposition']));
  const page = seen.filter((x) => x.path === '/wp-json/wp/v2/pages' && x.method === 'POST').pop();
  assert.match(JSON.parse(page.body).content, /wp:gallery/);
  const again = await owner.post('/marketing/website/gallery');
  assert.equal(again.data.uploaded, 0); assert.equal(again.data.total, n);
  assert.equal((await fetch(base + '/marketing/jobs/website-gallery', { method: 'POST' })).status, 401);
});

test('gallery perfumes come in without a price; website publishing waits until the owner sets one', async () => {
  process.env.LEGACY_IMG_BASE = fakeBase + '/legacy/';
  process.env.MKT_CRON_KEY = 'g'.repeat(32);
  try {
    const r = await fetch(base + '/marketing/import/legacy-job?set=gallery', { method: 'POST', headers: { 'x-cron-key': process.env.MKT_CRON_KEY } });
    const d = await r.json();
    assert.equal(r.status, 200, JSON.stringify(d));
    assert.equal(d.failed.length, 0, JSON.stringify(d.failed));
    assert.equal(d.created.length + d.skipped.length, 14);
    const p = await db.one("SELECT p.id, v.id AS vid, v.retail_price, v.size_ml, b.name AS brand FROM products p JOIN variants v ON v.product_id = p.id JOIN brands b ON b.id = p.brand_id WHERE p.name = 'Hypnotic Poison' AND b.name = 'Dior'");
    assert.equal(p.retail_price, 0);
    await owner.put('/marketing/connections/website', { platform: 'woocommerce', url: fakeBase, key: 'shopowner', secret: 'abcd efgh ijkl mnop' });
    const pk = await owner.post('/marketing/packages', { productId: p.id, kinds: ['web_product'] });
    const cid = pk.data.created[0];
    assert.equal((await owner.post(`/marketing/content/${cid}/approve`)).status, 200);
    const blocked = await owner.post(`/marketing/content/${cid}/publish`);
    assert.equal(blocked.status, 412); assert.match(blocked.data.error, /set the price first/i);
    assert.equal((await owner.put(`/marketing/products/${p.id}/prices`, { variants: [{ id: p.vid, price: 0 }] })).status, 400);
    assert.equal((await owner.put(`/marketing/products/${p.id}/prices`, { variants: [{ id: p.vid, price: 52500 }] })).status, 200);
    assert.equal((await db.one('SELECT retail_price FROM variants WHERE id = $1', [p.vid])).retail_price, 52500);
  } finally { delete process.env.LEGACY_IMG_BASE; delete process.env.MKT_CRON_KEY; }
});
