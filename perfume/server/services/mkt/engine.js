// Marketing engine: AI copy, daily product packages, approval workflow, publishing, scheduler, metrics.
import { id, fail, must, nextNumber, str } from '../../util.js';
import { notify } from '../notify.js';
import { getSettings } from '../settings.js';
import * as P from './providers.js';
import * as S from './studio.js';

export const STATUSES = ['draft', 'ai_generated', 'under_review', 'approved', 'scheduled', 'published', 'failed', 'archived'];
export const KINDS = {
  post: { label: 'Instagram post', platform: 'instagram', format: 'portrait' },
  reel: { label: 'Instagram Reel', platform: 'instagram', format: 'story', video: true },
  story: { label: 'Instagram Story', platform: 'instagram', format: 'story' },
  facebook: { label: 'Facebook post', platform: 'facebook', format: 'square' },
  whatsapp: { label: 'WhatsApp promotion', platform: 'whatsapp', format: 'square' },
  web_product: { label: 'Website product', platform: 'website' },
  blog: { label: 'Blog article', platform: 'website' },
  banner: { label: 'Website banner', platform: 'website', format: 'banner' },
  landing: { label: 'Landing page', platform: 'website' },
  offer: { label: 'Website offer (prices)', platform: 'website' },
};
export const DEFAULT_MKT = {
  automation: { enabled: false, time: '09:00', kinds: ['post', 'story', 'reel', 'whatsapp', 'web_product'], autoPublish: {}, slots: { post: '10:00', story: '13:00', reel: '18:00', facebook: '11:00', whatsapp: '16:00', web_product: '09:30' }, theme: 'noir', removeBackground: false, aiBackground: false, langs: ['en', 'ar'], tone: 'luxury', reelSeconds: 3.5 },
  brand: { hashtags: '#perfume #oman #salalah #luxuryperfume #عطور', contact: '', website: '', whatsappTemplate: '', whatsappTemplateLang: 'en' },
  publicUrl: '',
};
const omr = (baisa) => (baisa == null ? '' : `OMR ${(Number(baisa) / 1000).toFixed(3)}`);
const tz = 'Asia/Muscat';
export const localDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const localTime = (d = new Date()) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
/** "YYYY-MM-DD" + "HH:MM" in Oman time → Date */
export const omanAt = (day, hhmm) => new Date(`${day}T${hhmm}:00+04:00`);

export async function mktSettings(q) {
  const r = await q.one("SELECT value FROM settings WHERE key = 'marketing'");
  const v = r?.value || {};
  return { ...DEFAULT_MKT, ...v, automation: { ...DEFAULT_MKT.automation, ...(v.automation || {}) }, brand: { ...DEFAULT_MKT.brand, ...(v.brand || {}) } };
}
export async function saveMktSettings(q, patch) {
  const cur = await mktSettings(q);
  const next = { ...cur, ...patch, automation: { ...cur.automation, ...(patch.automation || {}) }, brand: { ...cur.brand, ...(patch.brand || {}) } };
  await q(`INSERT INTO settings (key, value, updated_at) VALUES ('marketing', $1, now()) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`, [next]);
  return next;
}
/** The address the visitor used: the proxy's forwarded host, not the server's internal one. */
export const originOf = (req) => {
  const proto = String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}`;
};
/** Only a real https domain works for links other services fetch (no IPs, localhost or ports). */
export const isPublicOrigin = (u) => /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(String(u || ''));

async function publicUrl(q) {
  const s = await mktSettings(q);
  const env = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  const u = isPublicOrigin(env) ? env : isPublicOrigin(s.publicUrl) ? s.publicUrl : '';
  must(u, 412, 'The public web address of this app is unknown. Open Marketing → Connections once (it is saved automatically) or set PUBLIC_URL.');
  return u;
}
const fileUrl = async (q, fileId) => `${await publicUrl(q)}/api/files/${fileId}`;

// ---------------------------------------------------------------- products
export async function productInfo(q, productId) {
  const p = await q.one(`SELECT p.*, b.name AS brand, c.name AS category FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = $1`, [productId]);
  must(p, 404, 'Product not found');
  p.variants = await q(`SELECT v.id, v.sku, v.barcode, v.size_ml, v.label, v.retail_price, v.web_price, v.compare_price, v.active, COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.variant_id = v.id),0)::int AS stock FROM variants v WHERE v.product_id = $1 ORDER BY v.size_ml NULLS LAST`, [productId]);
  p.photos = [...new Set([p.image_url, ...(p.images || [])].filter(Boolean))];
  return p;
}
const mainVariant = (p) => p.variants.filter((v) => v.active).sort((a, b) => (b.size_ml || 0) - (a.size_ml || 0))[0] || p.variants[0];
export function posterText(p, s, lang = 'en', extra = {}) {
  const v = mainVariant(p) || {};
  const price = v.web_price ?? v.retail_price;
  const ar = lang === 'ar';
  return {
    brand: p.brand || '', name: ar && p.name_ar ? p.name_ar : p.name, size: v.size_ml ? `${v.size_ml} ml` : v.label || '',
    price: omr(price), oldPrice: v.compare_price && v.compare_price > price ? omr(v.compare_price) : '',
    badge: extra.badge || '', tagline: extra.tagline || [p.notes_top, p.notes_heart].filter(Boolean).join(' · ').slice(0, 60),
    cta: extra.cta || (ar ? 'تسوّق الآن' : 'Shop now'), shop: (s.shopName || 'Belle Âme').toUpperCase() + (s.city ? ` · ${s.city.toUpperCase()}` : ''), contact: extra.contact || '',
  };
}

// ---------------------------------------------------------------- AI copy
const COPY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'description_en', 'description_ar', 'seo_title', 'seo_description', 'slug', 'image_alt', 'instagram_caption', 'story_text', 'reel_script', 'whatsapp_message', 'facebook_post', 'headline', 'hashtags', 'tagline', 'caption_ar', 'caption_ml'],
  properties: {
    title: { type: 'string' }, description_en: { type: 'string' }, description_ar: { type: 'string' },
    seo_title: { type: 'string' }, seo_description: { type: 'string' }, slug: { type: 'string' }, image_alt: { type: 'string' },
    instagram_caption: { type: 'string' }, story_text: { type: 'string' }, whatsapp_message: { type: 'string' }, facebook_post: { type: 'string' },
    headline: { type: 'string' }, tagline: { type: 'string' }, caption_ar: { type: 'string' }, caption_ml: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    reel_script: { type: 'object', additionalProperties: false, required: ['scenes', 'voiceover'], properties: { scenes: { type: 'array', items: { type: 'string' } }, voiceover: { type: 'string' } } },
  },
};
const COPY_SYSTEM = `You write marketing copy for Belle Âme, a luxury perfume shop in Salalah, Oman. Prices are in Omani rials (OMR, three decimals).
Rules you must follow:
- Use ONLY facts given in the product data. Never invent notes, ingredients, longevity hours, awards, origins, "original/authentic" claims, stock levels or discounts that are not stated.
- If a fact is missing, write around it elegantly instead of guessing.
- Prices and discounts must match the data exactly.
- Arabic must be natural Gulf-market Arabic; Malayalam must be natural Kerala Malayalam.
- Instagram captions: 2-4 short lines, tasteful emoji at most 3, a clear call to action, no hashtags inside the caption (hashtags go in the hashtags list, 8-15 items, include the brand).
- Story text: under 12 words. Reel script: 3-5 scenes of on-screen text (under 7 words each) plus a voiceover under 35 words.
- WhatsApp message: under 400 characters, friendly, includes price and how to order; no hashtags.
- SEO title under 60 characters, meta description under 155 characters, slug lowercase with hyphens.`;

export async function writeCopy(q, p, { tone = 'luxury', lang = 'en', promo = '', extra = '' } = {}, ref) {
  const data = {
    name: p.name, name_ar: p.name_ar, brand: p.brand, category: p.category, gender: p.gender, concentration: p.concentration,
    notes: { top: p.notes_top, heart: p.notes_heart, base: p.notes_base }, description: p.description, description_ar: p.description_ar,
    sizes: p.variants.filter((v) => v.active).map((v) => ({ size: v.size_ml ? `${v.size_ml} ml` : v.label, price: omr(v.web_price ?? v.retail_price), original_price: v.compare_price ? omr(v.compare_price) : null })),
    promotion: promo || null, extra_details_from_owner: extra || null,
  };
  return P.claudeJson(q, {
    system: COPY_SYSTEM, schema: COPY_SCHEMA, effort: 'low', maxTokens: 8000, ref,
    messages: [{ role: 'user', content: `Tone: ${tone}. Main caption language: ${lang === 'ar' ? 'Arabic' : lang === 'ml' ? 'Malayalam' : 'English'} (also fill caption_ar and caption_ml).\nProduct data (JSON):\n${JSON.stringify(data, null, 1)}` }],
  });
}

/** Plain template copy, used only when no AI service is connected — clearly marked as such. */
export function templateCopy(p, s) {
  const v = mainVariant(p) || {};
  const price = omr(v.web_price ?? v.retail_price);
  const size = v.size_ml ? `${v.size_ml} ml` : '';
  const notes = [p.notes_top, p.notes_heart, p.notes_base].filter(Boolean).join(', ');
  const name = [p.brand, p.name].filter(Boolean).join(' ');
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 70);
  const tag = (x) => '#' + String(x || '').replace(/[^\p{L}\p{N}]/gu, '');
  return {
    title: name, description_en: p.description || `${name}${size ? ' ' + size : ''}${notes ? ' — notes of ' + notes : ''}.`, description_ar: p.description_ar || '',
    seo_title: `${name}${size ? ' ' + size : ''} | ${s.shopName || 'Belle Âme'}`.slice(0, 60), seo_description: `${name}${notes ? ', notes of ' + notes : ''}. ${price}. Available at ${s.shopName || 'Belle Âme'}, ${s.city || 'Salalah'}.`.slice(0, 155),
    slug, image_alt: `${name} ${size} bottle`, instagram_caption: `${name}${size ? ' · ' + size : ''}\n${notes ? notes + '\n' : ''}${price}\nOrder on WhatsApp or visit us in ${s.city || 'Salalah'}.`,
    story_text: `${p.name} · ${price}`, whatsapp_message: `${name}${size ? ' ' + size : ''} — ${price}. Reply to this message to order or reserve.`, facebook_post: `${name}${size ? ' ' + size : ''}\n${notes}\n${price}`,
    headline: name, tagline: notes.slice(0, 60), caption_ar: '', caption_ml: '', hashtags: [tag(p.brand), tag(p.name), '#perfume', '#oman'].filter((x) => x.length > 1),
    reel_script: { scenes: [p.brand || '', p.name, price, 'Shop now'].filter(Boolean), voiceover: '' }, _template: true,
  };
}

// ---------------------------------------------------------------- assets
async function addAsset(q, a) {
  const aid = id('ast_');
  await q(`INSERT INTO mkt_assets (id, kind, source, file_id, product_id, format, width, height, duration_s, title, status, provider, job_ref, detail, cost_usd, params, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
  [aid, a.kind, a.source, a.fileId || null, a.productId || null, a.format || null, a.w || null, a.h || null, a.duration || null, a.title || null, a.status || 'ready', a.provider || null, a.jobRef || null, a.detail || null, a.cost || 0, a.params || null, a.userId || null]);
  return aid;
}
export async function uploadAsset(q, { buf, mime, name, productId, userId }) {
  const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image';
  let w = null, h = null;
  if (kind === 'image') { const m = await (await import('sharp')).default(buf).metadata(); w = m.width; h = m.height; }
  const fid = await S.saveFile(q, buf, mime, name, userId);
  return addAsset(q, { kind, source: 'upload', fileId: fid, productId, title: name, w, h, userId });
}

/** The product photo used for creatives (cutout via remove.bg when requested and connected). */
async function productPhoto(q, p, { removeBackground }) {
  must(p.photos.length, 400, `${p.name} has no photo. Upload a product photo first.`);
  const orig = await S.loadImageUrl(q, p.photos[0]);
  if (!removeBackground) return { buf: orig, cutout: false };
  const cached = await q.one(`SELECT a.file_id FROM mkt_assets a WHERE a.product_id = $1 AND a.source = 'cutout' AND a.params->>'from' = $2 AND a.status = 'ready' ORDER BY a.created_at DESC LIMIT 1`, [p.id, p.photos[0]]);
  if (cached) return { buf: (await S.loadFile(q, cached.file_id)).buf, cutout: true };
  const png = await P.removeBackground(q, orig, p.id);
  const fid = await S.saveFile(q, png, 'image/png', `${p.name} cutout.png`);
  await addAsset(q, { kind: 'image', source: 'cutout', fileId: fid, productId: p.id, params: { from: p.photos[0] }, provider: 'removebg', cost: 0.2, title: `${p.name} — background removed` });
  return { buf: png, cutout: true };
}

const AI_BG_PROMPT = {
  noir: 'Empty luxury perfume photography set: black polished marble plinth in the centre, soft warm gold rim light, subtle smoke, dark background, no bottle, no product, no text, no logo, photorealistic, studio lighting',
  champagne: 'Empty luxury product stage: champagne-gold silk drapery, soft bokeh, warm light, centre plinth, no bottle, no text, photorealistic',
  rose: 'Empty luxury product stage: rose-gold satin, dried rose petals at the edges, soft glow, dark background, no bottle, no text, photorealistic',
  emerald: 'Empty luxury product stage: deep emerald velvet, oud wood pieces at the edges, gold light, no bottle, no text, photorealistic',
};
const OPENAI_SIZE = (w, h) => (w / h > 1.2 ? '1536x1024' : h / w > 1.2 ? '1024x1536' : '1024x1024');

/** Render a creative (poster/banner/story image) for a product; returns asset id. */
export async function makeCreative(q, { productId, format = 'square', theme, layout = 'hero', lang = 'en', badge, tagline, removeBackground, aiBackground, prompt, userId }) {
  const s = await mktSettings(q);
  const biz = (await getSettings(q)).business || {};
  const p = await productInfo(q, productId);
  const F = S.FORMATS[format]; must(F, 400, 'Unknown format');
  theme = theme || s.automation.theme;
  const photo = await productPhoto(q, p, { removeBackground: removeBackground ?? s.automation.removeBackground });
  let background = null, cost = 0, provider = 'studio';
  if (aiBackground ?? false) {
    background = await P.generateBackground(q, prompt || AI_BG_PROMPT[theme] || AI_BG_PROMPT.noir, OPENAI_SIZE(F.w, F.h), p.id);
    cost = 0.06; provider = 'openai';
  }
  const t = posterText(p, { shopName: biz.name, city: biz.city || 'Salalah' }, lang, { badge, tagline, contact: s.brand.contact });
  const png = await S.composePoster({ w: F.w, h: F.h, product: photo.buf, background, theme, t, layout });
  const jpg = await (await import('sharp')).default(png).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
  const fid = await S.saveFile(q, jpg, 'image/jpeg', `${p.name} ${format}.jpg`, userId);
  return addAsset(q, { kind: 'image', source: aiBackground ? 'ai_image' : 'studio', fileId: fid, productId, format, w: F.w, h: F.h, title: `${p.name} — ${F.label}`, provider, cost, params: { theme, layout, lang, badge, cutout: photo.cutout }, userId });
}

/** Queue a promotional video (rendered in the background). mode: 'template' | 'ai' (Runway clip + exact price/CTA slides). */
export async function queueVideo(q, { productId, format = 'story', theme, lang = 'en', badge, tagline, seconds, musicAssetId, voiceover, mode = 'template', prompt, userId, contentId }) {
  const p = await productInfo(q, productId);
  const F = S.FORMATS[format]; must(F && ['story', 'square', 'landscape', 'portrait'].includes(format), 400, 'Video formats: 9:16, 1:1, 4:5 or 16:9');
  const aid = await addAsset(q, { kind: 'video', source: mode === 'ai' ? 'ai_video' : 'template_video', productId, format, w: F.w, h: F.h, status: 'processing', title: `${p.name} — video ${F.label}`, provider: mode === 'ai' ? 'runway' : 'studio', params: { theme, lang, badge, tagline, seconds, musicAssetId, voiceover, mode, prompt, contentId }, userId });
  await enqueue(q, 'render_video', aid, {}, userId);
  return aid;
}

// ---------------------------------------------------------------- jobs
export async function enqueue(q, kind, refId, payload = {}, userId, runAfter) {
  const jid = id('job_');
  await q('INSERT INTO mkt_jobs (id, kind, ref_id, payload, created_by, run_after) VALUES ($1,$2,$3,$4,$5,COALESCE($6, now()))', [jid, kind, refId || null, payload, userId || null, runAfter || null]);
  return jid;
}

async function runRenderVideo(q, assetId) {
  const a = await q.one('SELECT * FROM mkt_assets WHERE id = $1', [assetId]);
  if (!a || a.status !== 'processing') return { skipped: true };
  const prm = a.params || {};
  const s = await mktSettings(q);
  const biz = (await getSettings(q)).business || {};
  const p = await productInfo(q, a.product_id);
  const F = S.FORMATS[a.format];
  const photo = await productPhoto(q, p, { removeBackground: s.automation.removeBackground });
  const t = posterText(p, { shopName: biz.name, city: biz.city || 'Salalah' }, prm.lang, { badge: prm.badge, tagline: prm.tagline, contact: s.brand.contact || s.brand.website });
  const theme = prm.theme || s.automation.theme;
  const clips = [];
  let cost = 0;
  if (prm.mode === 'ai') {
    // Runway animates the original product photo; exact prices/CTA are added as rendered slides afterwards (AI video must not draw prices).
    if (!prm.runwayTask) {
      const hero = await S.composePoster({ w: F.w, h: F.h, product: photo.buf, theme, t: { ...t, price: '', oldPrice: '', tagline: '' }, layout: 'detail', logo: false });
      const heroId = await S.saveFile(q, await (await import('sharp')).default(hero).jpeg({ quality: 92 }).toBuffer(), 'image/jpeg', 'runway-input.jpg');
      const ratio = a.format === 'landscape' ? '1280:720' : a.format === 'square' ? '960:960' : '720:1280';
      const task = await P.runwayStart(q, { imageUrl: await fileUrl(q, heroId), prompt: prm.prompt || 'Slow cinematic camera push-in on the perfume bottle, soft drifting golden light and gentle mist, luxury commercial, the bottle and its label stay exactly the same, no text', ratio, duration: 5 }, a.id);
      await q("UPDATE mkt_assets SET params = params || $2, job_ref = $3, cost_usd = cost_usd + $4 WHERE id = $1", [a.id, { runwayTask: task }, task, 0.25]);
      return { retryIn: 20, note: 'AI video started' };
    }
    const st = await P.runwayStatus(q, prm.runwayTask, a.id);
    if (st.status === 'FAILED' || st.status === 'CANCELLED') throw new Error(`Runway: ${st.failure || st.status}`);
    if (st.status !== 'SUCCEEDED') return { retryIn: 20, note: `AI video ${String(st.status).toLowerCase()}` };
    clips.push(await P.download(q, 'runway', st.output[0], a.id));
  }
  const layouts = prm.mode === 'ai' ? ['offer', 'cta'] : ['hero', 'detail', 'offer', 'cta'];
  const slides = [];
  for (const layout of layouts) slides.push(await S.composePoster({ w: F.w, h: F.h, product: photo.buf, theme, t, layout }));
  const music = prm.musicAssetId ? (await S.loadFile(q, (await q.one('SELECT file_id FROM mkt_assets WHERE id = $1', [prm.musicAssetId])).file_id)).buf : null;
  let voice = null;
  if (prm.voiceover) { voice = await P.textToSpeech(q, prm.voiceover, prm.lang === 'ar' ? 'shimmer' : 'nova', a.id); cost += 0.015; }
  const v = await S.renderVideo({ w: F.w, h: F.h, slides, seconds: Number(prm.seconds) || s.automation.reelSeconds, music, voice, clips });
  const fid = await S.saveFile(q, v.buf, 'video/mp4', `${p.name} ${a.format}.mp4`, a.created_by);
  const thumb = await S.saveFile(q, await S.videoThumb(v.buf), 'image/jpeg', 'cover.jpg', a.created_by);
  await q("UPDATE mkt_assets SET status = 'ready', file_id = $2, duration_s = $3, cost_usd = cost_usd + $4, params = params || $5 WHERE id = $1", [a.id, fid, v.duration, cost, { thumbFileId: thumb }]);
  if (prm.contentId) await q("UPDATE mkt_content SET asset_ids = array_append(asset_ids, $2), updated_at = now() WHERE id = $1 AND NOT ($2 = ANY(asset_ids))", [prm.contentId, a.id]);
  return { fileId: fid, duration: v.duration };
}

// ---------------------------------------------------------------- content
async function history(q, contentId, action, from, to, user, note) {
  await q('INSERT INTO mkt_content_history (content_id, action, from_status, to_status, note, user_id, user_name) VALUES ($1,$2,$3,$4,$5,$6,$7)', [contentId, action, from || null, to || null, note || null, user?.id || null, user?.name || 'Automation']);
}
export async function createContent(q, c, user) {
  must(KINDS[c.kind], 400, 'Unknown content type');
  const cid = id('cnt_');
  const number = await nextNumber(q, 'mkt_content', 'MKT');
  await q(`INSERT INTO mkt_content (id, number, kind, platform, title, caption, hashtags, body, lang, tone, product_id, campaign_id, asset_ids, status, scheduled_at, auto_generated, fingerprint, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
  [cid, number, c.kind, KINDS[c.kind].platform, str(c.title, 200), c.caption || null, c.hashtags || null, c.body || {}, c.lang || 'en', c.tone || null, c.productId || null, c.campaignId || null, c.assetIds || [], c.status || 'draft', c.scheduledAt || null, !!c.auto, c.fingerprint || null, user?.id || null]);
  await history(q, cid, 'created', null, c.status || 'draft', user, c.auto ? 'Generated automatically' : null);
  return cid;
}

/** Workflow transitions with permission rules: preparing ≠ approving ≠ publishing. */
const TRANSITIONS = {
  submit: { from: ['draft', 'ai_generated', 'failed'], to: 'under_review', level: 'create' },
  approve: { from: ['draft', 'ai_generated', 'under_review', 'failed'], to: 'approved', level: 'approve' },
  reject: { from: ['ai_generated', 'under_review', 'approved', 'scheduled'], to: 'draft', level: 'approve' },
  schedule: { from: ['approved', 'scheduled', 'failed'], to: 'scheduled', level: 'approve' },
  unschedule: { from: ['scheduled'], to: 'approved', level: 'approve' },
  archive: { from: STATUSES.filter((x) => x !== 'archived'), to: 'archived', level: 'edit' },
  restore: { from: ['archived'], to: 'draft', level: 'edit' },
};
export async function transition(q, contentId, action, { user, can, note, scheduledAt }) {
  const t = TRANSITIONS[action]; must(t, 400, 'Unknown action');
  must(can('marketing', t.level), 403, action === 'approve' || action === 'schedule' ? 'Approving and scheduling content needs the owner\'s approval permission (Marketing → approve).' : 'You do not have permission for this');
  const c = await q.one('SELECT * FROM mkt_content WHERE id = $1', [contentId]); must(c, 404, 'Content not found');
  must(t.from.includes(c.status), 409, `Cannot ${action} content that is ${c.status.replace('_', ' ')}`);
  if (action === 'schedule') {
    const at = new Date(scheduledAt);
    must(!isNaN(at), 400, 'Choose a date and time');
    must(at > new Date(Date.now() - 60000), 400, 'The time is in the past');
    await checkPublishable(q, c);
    await q("UPDATE mkt_content SET status = 'scheduled', scheduled_at = $2, error = NULL, attempts = 0, updated_at = now() WHERE id = $1", [contentId, at]);
  } else if (action === 'approve') {
    await q("UPDATE mkt_content SET status = 'approved', approved_by = $2, approved_at = now(), review_note = COALESCE($3, review_note), updated_at = now() WHERE id = $1", [contentId, user.id, note || null]);
  } else {
    await q('UPDATE mkt_content SET status = $2, review_note = COALESCE($3, review_note), scheduled_at = CASE WHEN $2 = \'scheduled\' THEN scheduled_at ELSE NULL END, updated_at = now() WHERE id = $1', [contentId, t.to, note || null]);
  }
  await history(q, contentId, action, c.status, t.to, user, note || (scheduledAt ? `for ${new Date(scheduledAt).toISOString()}` : null));
  if (action === 'submit') await notify(q, { kind: 'marketing_review', title: `Content waiting for approval: ${c.title || c.number}`, roles: ['owner', 'admin'], entity: 'mkt_content', entityId: contentId });
}

async function checkPublishable(q, c) {
  if (['post', 'story', 'facebook'].includes(c.kind) || c.kind === 'reel') {
    const assets = c.asset_ids.length ? await q('SELECT kind, status FROM mkt_assets WHERE id = ANY($1)', [c.asset_ids]) : [];
    if (c.kind === 'reel') must(assets.some((a) => a.kind === 'video' && a.status === 'ready'), 409, 'The Reel video is not ready yet');
    else if (c.kind !== 'facebook') must(assets.some((a) => a.status === 'ready'), 409, 'Add an image or video first');
  }
  if (c.kind === 'banner') fail(409, 'Website banners and homepage sliders cannot be changed through the Shopify/WooCommerce APIs (they belong to the theme). Download the banner and upload it in your theme editor.');
}

// ---------------------------------------------------------------- publishing
async function readyAssets(q, c) {
  return c.asset_ids.length ? q("SELECT * FROM mkt_assets WHERE id = ANY($1) AND status = 'ready' ORDER BY array_position($1::text[], id)", [c.asset_ids]) : [];
}
const fullCaption = (c) => [c.caption, c.hashtags].filter(Boolean).join('\n\n').slice(0, 2200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function igPublish(q, c, assets) {
  const creds = await P.metaCreds(q);
  must(creds.igUserId, 412, 'No Instagram professional account is linked to the Facebook Page. Run "Test connection" in Marketing → Connections.');
  const ig = creds.igUserId;
  const video = assets.find((a) => a.kind === 'video');
  const image = assets.find((a) => a.kind === 'image');
  const params = {};
  if (c.kind === 'reel') { must(video, 409, 'A Reel needs a video'); Object.assign(params, { media_type: 'REELS', video_url: await fileUrl(q, video.file_id), caption: fullCaption(c), share_to_feed: true }); if (video.params?.thumbFileId) params.thumb_offset = 500; }
  else if (c.kind === 'story') { const m = video || image; must(m, 409, 'A Story needs an image or video'); Object.assign(params, { media_type: 'STORIES', ...(m.kind === 'video' ? { video_url: await fileUrl(q, m.file_id) } : { image_url: await fileUrl(q, m.file_id) }) }); }
  else { must(image || video, 409, 'A post needs an image'); if (image) Object.assign(params, { image_url: await fileUrl(q, image.file_id), caption: fullCaption(c) }); else Object.assign(params, { media_type: 'REELS', video_url: await fileUrl(q, video.file_id), caption: fullCaption(c) }); }
  const container = await P.graph(q, 'meta', `${ig}/media`, { method: 'POST', params, ref: c.id, creds });
  // videos are processed by Instagram before they can be published
  for (let i = 0; i < 40; i++) {
    const st = await P.graph(q, 'meta', `${container.id}`, { params: { fields: 'status_code,status' }, ref: c.id, creds });
    if (st.status_code === 'FINISHED' || (!params.video_url && !st.status_code)) break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') fail(424, `Instagram could not process the media: ${st.status || st.status_code}`);
    await sleep(params.video_url ? 6000 : 1500);
    if (i === 39) fail(424, 'Instagram is still processing the video — it will be retried automatically');
  }
  const pub = await P.graph(q, 'meta', `${ig}/media_publish`, { method: 'POST', params: { creation_id: container.id }, ref: c.id, creds });
  let url = null;
  try { url = (await P.graph(q, 'meta', `${pub.id}`, { params: { fields: 'permalink' }, ref: c.id, creds })).permalink; } catch { /* permalink is optional */ }
  return { externalId: pub.id, url };
}
async function fbPublish(q, c, assets) {
  const creds = await P.metaCreds(q);
  const video = assets.find((a) => a.kind === 'video'), image = assets.find((a) => a.kind === 'image');
  const message = fullCaption(c);
  let r;
  if (video) r = await P.graph(q, 'meta', `${creds.pageId}/videos`, { method: 'POST', params: { file_url: await fileUrl(q, video.file_id), description: message }, ref: c.id, creds });
  else if (image) r = await P.graph(q, 'meta', `${creds.pageId}/photos`, { method: 'POST', params: { url: await fileUrl(q, image.file_id), caption: message }, ref: c.id, creds });
  else r = await P.graph(q, 'meta', `${creds.pageId}/feed`, { method: 'POST', params: { message, ...(c.body?.link ? { link: c.body.link } : {}) }, ref: c.id, creds });
  const pid = r.post_id || r.id;
  return { externalId: pid, url: pid ? `https://www.facebook.com/${pid}` : null };
}

/** WhatsApp: approved template to customers who opted in to marketing, throttled, results counted. */
async function waPublish(q, c, assets) {
  const s = await mktSettings(q);
  const template = c.body?.template || s.brand.whatsappTemplate;
  must(template, 412, 'Choose an approved WhatsApp message template for this promotion (Meta only allows templates for promotional messages).');
  const lang = c.body?.templateLang || s.brand.whatsappTemplateLang || 'en';
  const image = assets.find((a) => a.kind === 'image'), video = assets.find((a) => a.kind === 'video');
  const limit = Math.min(Number(c.body?.maxRecipients) || 250, 1000);
  const recipients = await q(`SELECT id, name, phone FROM customers WHERE marketing_opt_in AND phone IS NOT NULL AND phone <> '' AND NOT COALESCE(is_test,false)
    AND id NOT IN (SELECT customer_id FROM customer_interactions WHERE kind = 'whatsapp' AND subject = $1) ORDER BY created_at LIMIT $2`, [`Promotion ${c.number}`, limit]);
  must(recipients.length, 409, 'No customers have agreed to receive WhatsApp marketing (tick "marketing consent" on the customer).');
  let sent = 0, failed = 0; const errors = [];
  for (const r of recipients) {
    const to = String(r.phone).replace(/[^\d]/g, '').replace(/^00/, '').replace(/^(?=[79]\d{7}$)/, '968');
    try {
      const params = (c.body?.bodyParams || []).map((x) => String(x).replace('{name}', r.name || '').replace('{caption}', c.caption || ''));
      await P.whatsappTemplate(q, { to, template, language: lang, headerImageUrl: c.body?.headerType === 'image' && image ? await fileUrl(q, image.file_id) : null, headerVideoUrl: c.body?.headerType === 'video' && video ? await fileUrl(q, video.file_id) : null, bodyParams: params }, c.id);
      sent++;
      await q("INSERT INTO customer_interactions (id, customer_id, kind, subject, body, status, created_by) VALUES ($1,$2,'whatsapp',$3,$4,'closed',$5)", [id('int_'), r.id, `Promotion ${c.number}`, `WhatsApp template "${template}" sent`, c.approved_by]);
    } catch (e) { failed++; if (errors.length < 5) errors.push(`${r.name || r.phone}: ${e.message}`); }
    await sleep(250); // stay well within Cloud API throughput limits
  }
  await q('UPDATE mkt_content SET body = body || $2 WHERE id = $1', [c.id, { results: { sent, failed, errors, at: new Date().toISOString() } }]);
  if (!sent) fail(424, `WhatsApp: no message was accepted. ${errors.join(' | ')}`);
  return { externalId: `${sent} sent${failed ? `, ${failed} failed` : ''}`, url: null };
}

// ---- website (Shopify / WooCommerce)
async function webProduct(q, c) {
  const creds = await P.websiteCreds(q);
  const p = await productInfo(q, c.product_id);
  const b = c.body || {};
  const imgs = [];
  for (const u of p.photos) { const m = String(u).match(/\/api\/files\/([\w-]+)/); imgs.push(m ? await fileUrl(q, m[1]) : u); }
  for (const aid of c.asset_ids) { const a = await q.one("SELECT file_id FROM mkt_assets WHERE id = $1 AND kind = 'image' AND status = 'ready'", [aid]); if (a) imgs.push(await fileUrl(q, a.file_id)); }
  const variants = p.variants.filter((v) => v.active);
  const price = (v) => ((v.web_price ?? v.retail_price) / 1000).toFixed(3);
  const html = (b.description_html || (b.description || p.description || '').split(/\n+/).map((x) => `<p>${x.replace(/</g, '&lt;')}</p>`).join(''));
  if (creds.platform === 'shopify') {
    const product = {
      title: c.title || p.name, body_html: html, vendor: p.brand || '', product_type: p.category || 'Perfume', handle: b.slug || undefined, status: 'active',
      tags: (c.hashtags || '').replace(/#/g, '').split(/\s+/).filter(Boolean).slice(0, 20).join(', '),
      options: [{ name: 'Size' }],
      variants: variants.map((v) => ({ option1: v.size_ml ? `${v.size_ml} ml` : v.label || v.sku, price: price(v), compare_at_price: v.compare_price ? (v.compare_price / 1000).toFixed(3) : null, sku: v.sku, barcode: v.barcode })),
      images: imgs.map((src) => ({ src, alt: b.image_alt || p.name })),
      metafields_global_title_tag: b.seo_title || undefined, metafields_global_description_tag: b.seo_description || undefined,
    };
    const r = p.web_external_id ? await P.website(q, 'shopify_update_product', 'PUT', `products/${p.web_external_id}.json`, { product: { id: Number(p.web_external_id), ...product, images: undefined } }, c.id)
      : await P.website(q, 'shopify_create_product', 'POST', 'products.json', { product }, c.id);
    const extId = String(r.product.id);
    await q('UPDATE products SET web_external_id = $2, seo_title = COALESCE($3, seo_title), seo_description = COALESCE($4, seo_description), slug = COALESCE($5, slug) WHERE id = $1', [p.id, extId, b.seo_title || null, b.seo_description || null, r.product.handle || null]);
    return { externalId: extId, url: `${creds.url.replace(/\/+$/, '')}/products/${r.product.handle}` };
  }
  // WooCommerce: variable product with a Size attribute + one variation per size
  const sizes = variants.map((v) => (v.size_ml ? `${v.size_ml} ml` : v.label || v.sku));
  const prod = {
    name: c.title || p.name, type: variants.length > 1 ? 'variable' : 'simple', description: html, short_description: b.seo_description || '', slug: b.slug || undefined, status: 'publish',
    images: imgs.map((src) => ({ src, alt: b.image_alt || p.name })), tags: (c.hashtags || '').replace(/#/g, '').split(/\s+/).filter(Boolean).slice(0, 20).map((name) => ({ name })),
    ...(variants.length > 1 ? { attributes: [{ name: 'Size', visible: true, variation: true, options: sizes }] } : { regular_price: (variants[0]?.compare_price && variants[0].compare_price > (variants[0].web_price ?? variants[0].retail_price) ? (variants[0].compare_price / 1000).toFixed(3) : price(variants[0] || { retail_price: 0 })), sale_price: variants[0]?.compare_price ? price(variants[0]) : '', sku: variants[0]?.sku }),
    meta_data: [{ key: '_yoast_wpseo_title', value: b.seo_title || '' }, { key: '_yoast_wpseo_metadesc', value: b.seo_description || '' }],
  };
  const r = p.web_external_id ? await P.website(q, 'woo_update_product', 'PUT', `products/${p.web_external_id}`, { ...prod, images: undefined }, c.id) : await P.website(q, 'woo_create_product', 'POST', 'products', prod, c.id);
  if (variants.length > 1 && !p.web_external_id) {
    await P.website(q, 'woo_create_variations', 'POST', `products/${r.id}/variations/batch`, { create: variants.map((v, i) => ({ sku: v.sku, regular_price: v.compare_price ? (v.compare_price / 1000).toFixed(3) : price(v), sale_price: v.compare_price ? price(v) : '', attributes: [{ name: 'Size', option: sizes[i] }] })) }, c.id);
  }
  await q('UPDATE products SET web_external_id = $2, seo_title = COALESCE($3, seo_title), seo_description = COALESCE($4, seo_description), slug = COALESCE($5, slug) WHERE id = $1', [p.id, String(r.id), b.seo_title || null, b.seo_description || null, r.slug || null]);
  return { externalId: String(r.id), url: r.permalink || null };
}
async function webArticle(q, c) {
  const creds = await P.websiteCreds(q);
  const html = c.body?.html || (c.caption || '').split(/\n+/).map((x) => `<p>${x.replace(/</g, '&lt;')}</p>`).join('');
  if (creds.platform === 'shopify') {
    if (c.kind === 'landing') {
      const r = await P.website(q, 'shopify_create_page', 'POST', 'pages.json', { page: { title: c.title, body_html: html, handle: c.body?.slug, published: true } }, c.id);
      return { externalId: String(r.page.id), url: `${creds.url.replace(/\/+$/, '')}/pages/${r.page.handle}` };
    }
    const blogs = await P.website(q, 'shopify_list_blogs', 'GET', 'blogs.json', null, c.id);
    must(blogs.blogs?.length, 409, 'Create a blog in Shopify first (Online Store → Blog posts)');
    const r = await P.website(q, 'shopify_create_article', 'POST', `blogs/${blogs.blogs[0].id}/articles.json`, { article: { title: c.title, body_html: html, handle: c.body?.slug, published: true, tags: (c.hashtags || '').replace(/#/g, '').split(/\s+/).join(', '), metafields_global_title_tag: c.body?.seo_title, metafields_global_description_tag: c.body?.seo_description } }, c.id);
    return { externalId: String(r.article.id), url: `${creds.url.replace(/\/+$/, '')}/blogs/${blogs.blogs[0].handle}/${r.article.handle}` };
  }
  const r = await P.website(q, 'wp_create_post', 'POST', c.kind === 'landing' ? 'wp/v2/pages' : 'wp/v2/posts', { title: c.title, content: html, slug: c.body?.slug, status: 'publish', excerpt: c.body?.seo_description || '' }, c.id);
  return { externalId: String(r.id), url: r.link || null };
}
/** Apply campaign/offer prices to the website (compare-at = original price). */
async function webOffer(q, c) {
  const creds = await P.websiteCreds(q);
  const items = c.body?.items || [];
  must(items.length, 400, 'Add products and prices to the offer');
  let n = 0;
  for (const it of items) {
    const v = await q.one('SELECT v.*, p.web_external_id FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1', [it.variantId]);
    must(v?.web_external_id, 409, `${v?.sku || 'A product'} is not on the website yet — publish it first`);
    if (creds.platform === 'shopify') {
      const prod = await P.website(q, 'shopify_get_product', 'GET', `products/${v.web_external_id}.json`, null, c.id);
      const sv = prod.product.variants.find((x) => x.sku === v.sku); must(sv, 409, `${v.sku} not found on the website`);
      await P.website(q, 'shopify_update_price', 'PUT', `variants/${sv.id}.json`, { variant: { id: sv.id, price: (it.price / 1000).toFixed(3), compare_at_price: it.comparePrice ? (it.comparePrice / 1000).toFixed(3) : null } }, c.id);
    } else {
      const vars = await P.website(q, 'woo_list_variations', 'GET', `products/${v.web_external_id}/variations?per_page=100`, null, c.id).catch(() => []);
      const wv = Array.isArray(vars) ? vars.find((x) => x.sku === v.sku) : null;
      const body = { regular_price: ((it.comparePrice || it.price) / 1000).toFixed(3), sale_price: it.comparePrice ? (it.price / 1000).toFixed(3) : '' };
      await P.website(q, 'woo_update_price', 'PUT', wv ? `products/${v.web_external_id}/variations/${wv.id}` : `products/${v.web_external_id}`, body, c.id);
    }
    n++;
  }
  return { externalId: `${n} prices updated`, url: null };
}

/** Publish one approved/scheduled item now. Returns the updated row. */
export async function publish(q, contentId, { user, can, auto = false } = {}) {
  if (!auto) must(can('marketing', 'approve'), 403, 'Publishing needs the owner\'s approval permission (Marketing → approve).');
  const c = await q.one('SELECT * FROM mkt_content WHERE id = $1', [contentId]); must(c, 404, 'Content not found');
  must(['approved', 'scheduled', 'failed'].includes(c.status), 409, c.status === 'published' ? 'Already published' : 'Approve the content before publishing');
  if (c.status === 'failed') must(c.approved_by, 409, 'Approve the content before publishing');
  await checkPublishable(q, c);
  // duplicate guard: same product + type + identical caption already published in the last 7 days
  if (c.fingerprint) {
    const dup = await q.one("SELECT number FROM mkt_content WHERE fingerprint = $1 AND id <> $2 AND status = 'published' AND published_at > now() - interval '7 days'", [c.fingerprint, c.id]);
    must(!dup, 409, `The same content was already published (${dup?.number}) in the last 7 days`);
  }
  await q('UPDATE mkt_content SET attempts = attempts + 1, updated_at = now() WHERE id = $1', [c.id]);
  try {
    const assets = await readyAssets(q, c);
    const r = c.kind === 'facebook' ? await fbPublish(q, c, assets)
      : ['post', 'reel', 'story'].includes(c.kind) ? await igPublish(q, c, assets)
        : c.kind === 'whatsapp' ? await waPublish(q, c, assets)
          : c.kind === 'web_product' ? await webProduct(q, c)
            : ['blog', 'landing'].includes(c.kind) ? await webArticle(q, c)
              : c.kind === 'offer' ? await webOffer(q, c) : fail(400, 'This content type cannot be published automatically');
    await q("UPDATE mkt_content SET status = 'published', published_at = now(), external_id = $2, external_url = $3, error = NULL, updated_at = now() WHERE id = $1", [c.id, r.externalId || null, r.url || null]);
    await history(q, c.id, 'published', c.status, 'published', user, r.url || r.externalId);
  } catch (e) {
    if (!auto && e.status && [400, 403, 409, 412].includes(e.status)) {
      // nothing was sent: a missing connection or setting is not a publishing failure — keep the status
      await q('UPDATE mkt_content SET attempts = attempts - 1, error = $2 WHERE id = $1', [c.id, e.message]);
      throw e;
    }
    const fresh = await q.one('SELECT attempts FROM mkt_content WHERE id = $1', [c.id]);
    const retry = auto && fresh.attempts < 3 && !(e.status && [400, 403, 409, 412].includes(e.status));
    await q(`UPDATE mkt_content SET status = $2, error = $3, scheduled_at = CASE WHEN $2 = 'scheduled' THEN now() + ($4 || ' minutes')::interval ELSE scheduled_at END, updated_at = now() WHERE id = $1`,
      [c.id, retry ? 'scheduled' : 'failed', e.message, String(10 * fresh.attempts)]);
    await history(q, c.id, retry ? 'retry_scheduled' : 'failed', c.status, retry ? 'scheduled' : 'failed', user, e.message);
    if (!retry) await notify(q, { kind: 'marketing_failed', title: `Publishing failed: ${c.title || c.number}`, body: e.message, roles: ['owner', 'admin'], entity: 'mkt_content', entityId: c.id });
    throw e;
  }
  return q.one('SELECT * FROM mkt_content WHERE id = $1', [c.id]);
}

// ---------------------------------------------------------------- daily package
const CAPTION = { en: 'instagram_caption', ar: 'caption_ar', ml: 'caption_ml' };
/**
 * From one product: AI copy → website content, Instagram post, Story, Reel (video queued), Facebook post, WhatsApp message.
 * Everything is created as "AI generated" for review; nothing is published here.
 */
export async function buildPackage(q, { productId, kinds, lang = 'en', tone, promo, extra, badge, theme, campaignId, auto = false, user }) {
  const s = await mktSettings(q);
  const biz = (await getSettings(q)).business || {};
  const p = await productInfo(q, productId);
  kinds = (kinds && kinds.length ? kinds : s.automation.kinds).filter((k) => ['post', 'story', 'reel', 'facebook', 'whatsapp', 'web_product'].includes(k));
  const day = localDate();
  let copy, aiNote = null;
  try { copy = await writeCopy(q, p, { tone: tone || s.automation.tone, lang, promo, extra }, p.id); }
  catch (e) {
    if (e.extra?.code !== 'not_connected') throw e;
    copy = templateCopy(p, { shopName: biz.name, city: biz.city }); aiNote = 'Written from a template — connect Claude in Marketing → Connections for AI-written copy.';
  }
  const hashtags = [...new Set([...(copy.hashtags || []).map((h) => (h.startsWith('#') ? h : '#' + h)), ...s.brand.hashtags.split(/\s+/).filter(Boolean)])].join(' ');
  const caption = copy[CAPTION[lang]] || copy.instagram_caption;
  const created = [];
  const status = 'ai_generated';
  const fp = (k) => `${p.id}:${k}:${day}`;
  const exists = async (k) => !!(await q.one("SELECT 1 AS x FROM mkt_content WHERE fingerprint = $1 AND status <> 'archived'", [fp(k)]));
  const common = { productId: p.id, campaignId, lang, tone: tone || s.automation.tone, auto, status };
  const opts = { theme: theme || s.automation.theme, lang, badge, tagline: copy.tagline, userId: user?.id };
  for (const k of kinds) {
    if (await exists(k)) continue; // never generate the same thing twice in one day
    const base = { ...common, kind: k, fingerprint: fp(k), body: { copy, aiNote } };
    if (k === 'post') {
      const a = await makeCreative(q, { productId: p.id, format: 'portrait', ...opts });
      created.push(await createContent(q, { ...base, title: `${copy.title} — Instagram post`, caption, hashtags, assetIds: [a] }, user));
    } else if (k === 'story') {
      const a = await makeCreative(q, { productId: p.id, format: 'story', layout: 'offer', ...opts });
      created.push(await createContent(q, { ...base, title: `${copy.title} — Story`, caption: copy.story_text, assetIds: [a] }, user));
    } else if (k === 'reel') {
      const cid = await createContent(q, { ...base, title: `${copy.title} — Reel`, caption, hashtags, body: { ...base.body, script: copy.reel_script } }, user);
      await queueVideo(q, { productId: p.id, format: 'story', ...opts, voiceover: null, contentId: cid });
      created.push(cid);
    } else if (k === 'facebook') {
      const a = await makeCreative(q, { productId: p.id, format: 'square', ...opts });
      created.push(await createContent(q, { ...base, title: `${copy.title} — Facebook`, caption: copy.facebook_post, hashtags, assetIds: [a] }, user));
    } else if (k === 'whatsapp') {
      const a = await makeCreative(q, { productId: p.id, format: 'square', ...opts });
      created.push(await createContent(q, { ...base, title: `${copy.title} — WhatsApp`, caption: copy.whatsapp_message, assetIds: [a], body: { ...base.body, template: s.brand.whatsappTemplate, templateLang: s.brand.whatsappTemplateLang, headerType: 'image', bodyParams: ['{name}', copy.title] } }, user));
    } else if (k === 'web_product') {
      created.push(await createContent(q, { ...base, title: copy.title, caption: copy.description_en, hashtags, body: { ...base.body, description: copy.description_en, description_ar: copy.description_ar, seo_title: copy.seo_title, seo_description: copy.seo_description, slug: copy.slug, image_alt: copy.image_alt } }, user));
    }
  }
  return { created, aiNote };
}

// ---------------------------------------------------------------- scheduler
let ticking = false;
export async function tick(db, { now = new Date() } = {}) {
  if (ticking) return { busy: true };
  ticking = true;
  const q = db.query;
  const out = { published: 0, failed: 0, jobs: 0, generated: 0 };
  try {
    // 1) background jobs (video rendering, AI video polling, metrics)
    const jobs = await q("SELECT * FROM mkt_jobs WHERE status = 'queued' AND run_after <= now() ORDER BY created_at LIMIT 3");
    for (const j of jobs) {
      await q("UPDATE mkt_jobs SET status = 'running', attempts = attempts + 1 WHERE id = $1", [j.id]);
      try {
        const r = j.kind === 'render_video' ? await runRenderVideo(q, j.ref_id) : j.kind === 'sync_metrics' ? await syncMetrics(q) : { skipped: true };
        if (r?.retryIn) await q("UPDATE mkt_jobs SET status = 'queued', attempts = attempts - 1, run_after = now() + ($2 || ' seconds')::interval, result = $3 WHERE id = $1", [j.id, String(r.retryIn), r]);
        else await q("UPDATE mkt_jobs SET status = 'done', result = $2, finished_at = now() WHERE id = $1", [j.id, r || {}]);
        out.jobs++;
      } catch (e) {
        const final = j.attempts + 1 >= j.max_attempts;
        await q("UPDATE mkt_jobs SET status = $2, error = $3, run_after = now() + interval '2 minutes', finished_at = CASE WHEN $2 = 'failed' THEN now() END WHERE id = $1", [j.id, final ? 'failed' : 'queued', e.message]);
        if (final && j.kind === 'render_video') await q("UPDATE mkt_assets SET status = 'failed', detail = $2 WHERE id = $1", [j.ref_id, e.message]);
      }
    }
    // 2) scheduled publishing
    const due = await q("SELECT id FROM mkt_content WHERE status = 'scheduled' AND scheduled_at <= $1 ORDER BY scheduled_at LIMIT 5", [now]);
    for (const d of due) {
      try { await publish(q, d.id, { auto: true }); out.published++; } catch { out.failed++; }
    }
    // 3) daily automation (once per day after the configured time)
    const s = await mktSettings(q);
    const day = localDate(now);
    if (s.automation.enabled && localTime(now) >= s.automation.time && s.lastAutoRun !== day) {
      await saveMktSettings(q, { lastAutoRun: day });
      out.generated = await dailyAutomation(q, s, day);
      await enqueue(q, 'sync_metrics', null, {});
    }
  } finally { ticking = false; }
  return out;
}

/** New products (added in the last 24 h, visible on the website, with a photo) get a full content package. */
async function dailyAutomation(q, s, day) {
  const fresh = await q(`SELECT p.id FROM products p WHERE p.active AND p.web_visible AND p.image_url IS NOT NULL AND NOT p.is_test AND p.created_at > now() - interval '26 hours'
    AND NOT EXISTS (SELECT 1 FROM mkt_content c WHERE c.product_id = p.id AND c.auto_generated) ORDER BY p.created_at LIMIT 5`);
  let n = 0;
  for (const f of fresh) {
    try {
      const r = await buildPackage(q, { productId: f.id, auto: true, lang: s.automation.langs[0] || 'en', badge: 'New arrival' });
      for (const cid of r.created) {
        const c = await q.one('SELECT * FROM mkt_content WHERE id = $1', [cid]);
        if (s.automation.autoPublish?.[c.kind]) {
          // owner explicitly allowed automatic publishing for this content type
          const slot = s.automation.slots?.[c.kind] || '18:00';
          let at = omanAt(day, slot); if (at < new Date()) at = new Date(Date.now() + 15 * 60000);
          await q("UPDATE mkt_content SET status = 'scheduled', approved_at = now(), approved_by = 'automation', scheduled_at = $2 WHERE id = $1", [cid, at]);
          await history(q, cid, 'auto_scheduled', c.status, 'scheduled', null, 'Automatic publishing is enabled for this content type');
        } else {
          await q("UPDATE mkt_content SET status = 'under_review' WHERE id = $1", [cid]);
          await history(q, cid, 'submit', c.status, 'under_review', null, 'Daily automation');
        }
      }
      n += r.created.length;
    } catch (e) {
      await notify(q, { kind: 'marketing_failed', title: 'Daily content generation failed', body: e.message, roles: ['owner', 'admin'], dedupeDay: true, entityId: f.id });
    }
  }
  if (n) await notify(q, { kind: 'marketing_review', title: `${n} new marketing items are ready for your approval`, roles: ['owner', 'admin'], dedupeDay: true, entityId: 'daily' });
  return n;
}

// ---------------------------------------------------------------- metrics
async function upMetric(q, day, source, metric, value) {
  if (value == null || isNaN(Number(value))) return;
  await q('INSERT INTO mkt_metrics (day, source, metric, value) VALUES ($1,$2,$3,$4) ON CONFLICT (day, source, metric) DO UPDATE SET value = excluded.value', [day, source, metric, Number(value)]);
}
/** Pull follower counts and reach from Meta (only what the API returns; nothing estimated). */
export async function syncMetrics(q) {
  const day = localDate();
  const res = { instagram: null, facebook: null };
  const creds = await P.loadCreds(q, 'meta');
  if (!P.configured('meta', creds)) return { skipped: 'Meta not connected' };
  const page = await P.graph(q, 'meta', creds.pageId, { params: { fields: 'followers_count,fan_count' }, creds });
  await upMetric(q, day, 'facebook', 'followers', page.followers_count ?? page.fan_count);
  res.facebook = page.followers_count ?? page.fan_count;
  if (creds.igUserId) {
    const ig = await P.graph(q, 'meta', creds.igUserId, { params: { fields: 'followers_count,media_count' }, creds });
    await upMetric(q, day, 'instagram', 'followers', ig.followers_count);
    await upMetric(q, day, 'instagram', 'media', ig.media_count);
    res.instagram = ig.followers_count;
    for (const [metric, extra] of [['reach', {}], ['accounts_engaged', { metric_type: 'total_value' }], ['total_interactions', { metric_type: 'total_value' }], ['views', { metric_type: 'total_value' }]]) {
      try {
        const r = await P.graph(q, 'meta', `${creds.igUserId}/insights`, { params: { metric, period: 'day', ...extra }, creds });
        const d = r.data?.[0];
        const v = d?.total_value?.value ?? d?.values?.at(-1)?.value;
        await upMetric(q, day, 'instagram', metric, v);
      } catch { /* metric not available for this account/API version — left blank, never estimated */ }
    }
    // per-post engagement for the last 30 published items
    const pubs = await q("SELECT id, external_id, kind FROM mkt_content WHERE platform = 'instagram' AND status = 'published' AND external_id IS NOT NULL AND published_at > now() - interval '45 days' ORDER BY published_at DESC LIMIT 30");
    for (const c of pubs) {
      try {
        const m = await P.graph(q, 'meta', c.external_id, { params: { fields: 'like_count,comments_count' }, creds });
        let reach = null;
        try { reach = (await P.graph(q, 'meta', `${c.external_id}/insights`, { params: { metric: 'reach' }, creds })).data?.[0]?.values?.[0]?.value ?? null; } catch { /* stories expire */ }
        await q('UPDATE mkt_content SET body = body || $2 WHERE id = $1', [c.id, { stats: { likes: m.like_count ?? null, comments: m.comments_count ?? null, reach, at: new Date().toISOString() } }]);
      } catch { /* deleted post */ }
    }
  }
  return res;
}

// ---------------------------------------------------------------- reporting
export async function dashboard(q, { from, to }) {
  const metric = async (source, m) => { const v = (await q.one('SELECT value FROM mkt_metrics WHERE source = $1 AND metric = $2 ORDER BY day DESC LIMIT 1', [source, m]))?.value; return v == null ? null : Number(v); };
  const sumMetric = async (source, m) => (await q.one('SELECT SUM(value) AS v, COUNT(*)::int AS n FROM mkt_metrics WHERE source = $1 AND metric = $2 AND day BETWEEN $3 AND $4', [source, m, from, to]));
  const counts = Object.fromEntries((await q("SELECT status, COUNT(*)::int AS n FROM mkt_content GROUP BY status")).map((r) => [r.status, r.n]));
  const publishedInRange = (await q.one("SELECT COUNT(*)::int AS n FROM mkt_content WHERE status = 'published' AND published_at::date BETWEEN $1 AND $2", [from, to])).n;
  const videos = (await q.one("SELECT COUNT(*)::int AS n FROM mkt_assets WHERE kind = 'video' AND status = 'ready' AND created_at::date BETWEEN $1 AND $2", [from, to])).n;
  const webUpdates = (await q.one("SELECT COUNT(*)::int AS n FROM mkt_content WHERE platform = 'website' AND status = 'published' AND published_at::date BETWEEN $1 AND $2", [from, to])).n;
  const web = await q.one("SELECT COUNT(*) FILTER (WHERE kind = 'pageview')::int AS views, COUNT(DISTINCT visitor) FILTER (WHERE kind = 'pageview')::int AS visitors, COUNT(*) FILTER (WHERE kind = 'product_view')::int AS product_views FROM mkt_web_events WHERE at::date BETWEEN $1 AND $2", [from, to]);
  const webTracked = !!(await q.one('SELECT 1 AS x FROM mkt_web_events LIMIT 1'));
  const enquiries = (await q.one(`SELECT COUNT(*)::int AS n FROM customer_interactions WHERE kind = 'whatsapp' AND COALESCE(subject,'') NOT LIKE 'Promotion MKT-%' AND created_at::date BETWEEN $1 AND $2`, [from, to])).n;
  const social = await q.one(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(total - refunded),0)::bigint AS revenue FROM sales WHERE channel IN ('instagram','facebook','whatsapp','snapchat') AND status NOT IN ('pending','cancelled') AND created_at::date BETWEEN $1 AND $2`, [from, to]);
  const campaigns = await campaignPerformance(q, { from, to });
  const ig = await sumMetric('instagram', 'reach'), eng = await sumMetric('instagram', 'total_interactions');
  const igF = await metric('instagram', 'followers'), fbF = await metric('facebook', 'followers');
  const daily = await q(`SELECT d::date::text AS day,
      (SELECT COUNT(*) FROM mkt_content c WHERE c.status = 'published' AND c.published_at::date = d::date)::int AS published,
      (SELECT value FROM mkt_metrics m WHERE m.source = 'instagram' AND m.metric = 'reach' AND m.day = d::date) AS reach,
      (SELECT COUNT(*) FROM mkt_web_events e WHERE e.kind = 'pageview' AND e.at::date = d::date)::int AS web_views,
      (SELECT COALESCE(SUM(total - refunded),0) FROM sales s WHERE s.channel IN ('instagram','facebook','whatsapp') AND s.status NOT IN ('pending','cancelled') AND s.created_at::date = d::date)::bigint AS social_sales
    FROM generate_series($1::date, $2::date, interval '1 day') d ORDER BY d`, [from, to]);
  const spend = await q.one("SELECT COALESCE(SUM(cost_usd),0) AS usd FROM mkt_api_log WHERE at::date BETWEEN $1 AND $2", [from, to]);
  return {
    followers: { instagram: igF, facebook: fbF, total: igF == null && fbF == null ? null : Number(igF || 0) + Number(fbF || 0) },
    reach: ig.n ? Number(ig.v) : null, engagement: eng.n ? Number(eng.v) : null,
    web: webTracked ? web : null, content: { ...counts, publishedInRange, videos, webUpdates }, enquiries,
    socialSales: social, campaigns, daily, aiSpendUsd: Number(spend.usd),
    pending: (counts.ai_generated || 0) + (counts.under_review || 0), scheduled: counts.scheduled || 0,
  };
}

/** Sales linked to campaigns: orders tagged with the campaign, or using its promotion / coupon within the campaign dates. Never double-counted. */
export async function campaignPerformance(q, { from, to } = {}) {
  return q(`SELECT c.id, c.name, c.kind, c.status, c.start_date::text, c.end_date::text, c.budget, c.spend, c.platforms,
      COALESCE(x.orders,0)::int AS orders, COALESCE(x.revenue,0)::bigint AS revenue, COALESCE(x.customers,0)::int AS customers,
      (SELECT COUNT(*) FROM mkt_content m WHERE m.campaign_id = c.id AND m.status = 'published')::int AS posts,
      (SELECT COUNT(*) FROM mkt_web_events e WHERE e.utm = c.utm)::int AS clicks
    FROM mkt_campaigns c
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS orders, SUM(s.total - s.refunded) AS revenue, COUNT(DISTINCT s.customer_id) AS customers FROM sales s
      WHERE s.status NOT IN ('pending','cancelled') AND (s.campaign_id = c.id
        OR (s.created_at::date BETWEEN COALESCE(c.start_date, '2000-01-01') AND COALESCE(c.end_date, '2100-01-01')
            AND ((c.promotion_id IS NOT NULL AND c.promotion_id = ANY(s.promotion_ids)) OR (c.coupon_code IS NOT NULL AND upper(s.coupon_code) = upper(c.coupon_code)))))
        AND ($1::date IS NULL OR s.created_at::date >= $1) AND ($2::date IS NULL OR s.created_at::date <= $2)
    ) x ON true
    ORDER BY COALESCE(x.revenue,0) DESC, c.created_at DESC`, [from || null, to || null]);
}
