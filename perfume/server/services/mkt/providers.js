// External services used by marketing: credentials (encrypted at rest), logged calls, honest errors.
// Nothing here simulates a response: without credentials every call fails with a clear "not connected" message.
import Anthropic from '@anthropic-ai/sdk';
import { seal, unseal, mask } from '../../security.js';
import { fail } from '../../util.js';

export const PROVIDERS = {
  anthropic: { name: 'Claude (Anthropic) — writing & assistant', fields: ['apiKey'], env: { apiKey: 'ANTHROPIC_API_KEY' } },
  openai: { name: 'OpenAI — background images & voiceover', fields: ['apiKey'], env: { apiKey: 'OPENAI_API_KEY' } },
  removebg: { name: 'remove.bg — background removal', fields: ['apiKey'], env: { apiKey: 'REMOVEBG_API_KEY' } },
  runway: { name: 'Runway — AI video from product photo', fields: ['apiKey'], env: { apiKey: 'RUNWAY_API_KEY' } },
  meta: { name: 'Instagram & Facebook (Meta Graph API)', fields: ['pageId', 'accessToken', 'igUserId', 'graphVersion'], secret: ['accessToken'] },
  whatsapp: { name: 'WhatsApp Business Cloud API', fields: ['phoneNumberId', 'wabaId', 'accessToken', 'graphVersion'], secret: ['accessToken'] },
  website: { name: 'Website (Shopify or WooCommerce)', fields: ['platform', 'url', 'token', 'key', 'secret', 'wpUser', 'wpAppPassword', 'currency'], secret: ['token', 'secret', 'wpAppPassword'] },
};
const isSecret = (p, f) => f === 'apiKey' || (PROVIDERS[p].secret || []).includes(f);

export async function loadCreds(q, provider) {
  const row = await q.one("SELECT value FROM settings WHERE key = 'integrations'");
  const stored = row?.value?.[provider] || {};
  const out = {};
  for (const f of PROVIDERS[provider].fields) {
    const v = stored[f];
    out[f] = v == null ? null : isSecret(provider, f) ? unseal(v) : v;
    if (!out[f] && PROVIDERS[provider].env?.[f]) out[f] = process.env[PROVIDERS[provider].env[f]] || null;
  }
  return out;
}

export async function saveCreds(q, provider, input) {
  if (!PROVIDERS[provider]) fail(400, 'Unknown service');
  const row = await q.one("SELECT value FROM settings WHERE key = 'integrations'");
  const all = row?.value || {};
  const cur = all[provider] || {};
  for (const f of PROVIDERS[provider].fields) {
    if (!(f in input)) continue;
    const v = input[f] == null ? '' : String(input[f]).trim();
    if (isSecret(provider, f) && v.startsWith('••••')) continue; // masked value sent back unchanged
    cur[f] = v ? (isSecret(provider, f) ? seal(v) : v) : null;
  }
  all[provider] = cur;
  await q(`INSERT INTO settings (key, value, updated_at) VALUES ('integrations', $1, now()) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`, [all]);
}

/** Credentials for display: secrets masked. */
export async function publicCreds(q, provider) {
  const c = await loadCreds(q, provider);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, isSecret(provider, k) ? mask(v) : v]));
}

export const configured = (provider, c) => {
  if (provider === 'meta') return !!(c.pageId && c.accessToken);
  if (provider === 'whatsapp') return !!(c.phoneNumberId && c.accessToken);
  if (provider === 'website') return !!(c.platform && c.url && (c.platform === 'shopify' ? c.token : c.key && c.secret));
  return !!c.apiKey;
};

async function need(q, provider) {
  const c = await loadCreds(q, provider);
  if (!configured(provider, c)) fail(412, `${PROVIDERS[provider].name} is not connected. Add its credentials in Marketing → Connections.`, { code: 'not_connected', provider });
  return c;
}

export async function logCall(q, provider, operation, { ok, status = null, ms = null, cost = 0, ref = null, detail = null }) {
  await q('INSERT INTO mkt_api_log (provider, operation, ok, status, ms, cost_usd, ref_id, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [provider, operation, ok, status, ms, cost, ref, detail ? String(detail).slice(0, 2000) : null]);
}

/** fetch wrapper: logs every call, turns non-2xx into a readable error. */
async function call(q, provider, operation, url, init = {}, { ref, cost = 0, parse = 'json' } = {}) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs || 120000) });
  } catch (e) {
    await logCall(q, provider, operation, { ok: false, ms: Date.now() - t0, ref, detail: e.message });
    fail(424, `${PROVIDERS[provider]?.name || provider}: could not reach the service (${e.message})`);
  }
  const ms = Date.now() - t0;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text;
    try { const j = JSON.parse(text); msg = j.error?.message || j.error?.error_user_msg || j.errors?.[0]?.title || j.message || j.error || text; if (typeof msg === 'object') msg = JSON.stringify(msg); } catch { /* text */ }
    await logCall(q, provider, operation, { ok: false, status: res.status, ms, ref, detail: msg });
    fail(424, `${PROVIDERS[provider]?.name || provider}: ${msg || 'HTTP ' + res.status}`, { providerStatus: res.status });
  }
  await logCall(q, provider, operation, { ok: true, status: res.status, ms, cost, ref });
  if (parse === 'buffer') return Buffer.from(await res.arrayBuffer());
  if (parse === 'text') return res.text();
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

// ---------------------------------------------------------------- Claude
const CLAUDE_MODEL = 'claude-opus-5-5';
// approximate list price per million tokens (USD), for the usage monitor
const CLAUDE_PRICE = { in: 4, out: 20 };

export async function claude(q, { system, messages, tools, schema, maxTokens = 16000, effort = 'medium', ref }) {
  const c = await need(q, 'anthropic');
  const client = new Anthropic({ apiKey: c.apiKey });
  const t0 = Date.now();
  try {
    const params = {
      model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages,
      output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
      ...(tools ? { tools } : {}),
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    };
    const r = await client.beta.messages.create(params);
    const cost = ((r.usage?.input_tokens || 0) * CLAUDE_PRICE.in + (r.usage?.output_tokens || 0) * CLAUDE_PRICE.out) / 1e6;
    await logCall(q, 'anthropic', schema ? 'structured' : tools ? 'assistant' : 'message', { ok: r.stop_reason !== 'refusal', ms: Date.now() - t0, cost, ref, detail: r.stop_reason === 'refusal' ? 'declined' : null });
    if (r.stop_reason === 'refusal') fail(422, 'The AI declined to write this content. Please rephrase the request.');
    return r;
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      await logCall(q, 'anthropic', 'message', { ok: false, status: e.status, ms: Date.now() - t0, ref, detail: e.message });
      if (e instanceof Anthropic.AuthenticationError) fail(424, 'Claude: the API key was rejected. Check it in Marketing → Connections.');
      if (e instanceof Anthropic.RateLimitError) fail(429, 'Claude: rate limit reached — try again in a minute.');
      fail(424, `Claude: ${e.message}`);
    }
    throw e;
  }
}
export const textOf = (r) => r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
export async function claudeJson(q, opts) {
  const r = await claude(q, opts);
  try { return JSON.parse(textOf(r)); } catch { fail(424, 'Claude returned an unreadable answer — please try again.'); }
}

// ---------------------------------------------------------------- images
export async function removeBackground(q, png, ref) {
  const c = await need(q, 'removebg');
  const fd = new FormData();
  fd.append('image_file', new Blob([png]), 'product.png');
  fd.append('size', 'auto'); fd.append('format', 'png');
  return call(q, 'removebg', 'remove_background', 'https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': c.apiKey }, body: fd }, { ref, cost: 0.2, parse: 'buffer' });
}

/** A background scene only — the product photo is composited on top unchanged, so the bottle is never redrawn. */
export async function generateBackground(q, prompt, size, ref) {
  const c = await need(q, 'openai');
  const r = await call(q, 'openai', 'image_background', 'https://api.openai.com/v1/images/generations', {
    method: 'POST', headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size, n: 1, quality: 'medium' }),
  }, { ref, cost: 0.06 });
  const b64 = r?.data?.[0]?.b64_json;
  if (!b64) fail(424, 'OpenAI returned no image');
  return Buffer.from(b64, 'base64');
}

export async function textToSpeech(q, text, voice = 'shimmer', ref) {
  const c = await need(q, 'openai');
  return call(q, 'openai', 'voiceover', 'https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text.slice(0, 4000), response_format: 'mp3' }),
  }, { ref, cost: 0.015, parse: 'buffer' });
}

// ---------------------------------------------------------------- Runway (image → video)
const RUNWAY = 'https://api.dev.runwayml.com/v1';
const runwayHeaders = (c) => ({ Authorization: `Bearer ${c.apiKey}`, 'X-Runway-Version': '2024-11-06', 'Content-Type': 'application/json' });
export async function runwayStart(q, { imageUrl, prompt, ratio, duration }, ref) {
  const c = await need(q, 'runway');
  const r = await call(q, 'runway', 'image_to_video', `${RUNWAY}/image_to_video`, {
    method: 'POST', headers: runwayHeaders(c), body: JSON.stringify({ model: 'gen4_turbo', promptImage: imageUrl, promptText: prompt.slice(0, 1000), ratio, duration }),
  }, { ref, cost: duration * 0.05 });
  return r.id;
}
export async function runwayStatus(q, taskId, ref) {
  const c = await need(q, 'runway');
  return call(q, 'runway', 'task_status', `${RUNWAY}/tasks/${taskId}`, { headers: runwayHeaders(c) }, { ref });
}
export const download = (q, provider, url, ref) => call(q, provider, 'download', url, {}, { ref, parse: 'buffer' });

// ---------------------------------------------------------------- Meta (Instagram + Facebook Page)
const gv = (c) => c.graphVersion || 'v23.0';
const graphBase = () => process.env.META_GRAPH_BASE || 'https://graph.facebook.com';
export async function graph(q, provider, path, { method = 'GET', params = {}, ref, creds } = {}) {
  const c = creds || await need(q, provider);
  const u = new URL(`${graphBase()}/${gv(c)}/${path.replace(/^\//, '')}`);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, access_token: c.accessToken })) if (v != null) (method === 'GET' ? u.searchParams : body).set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  return call(q, provider, `${method} ${path.split('?')[0].replace(/\d{6,}/g, ':id')}`, u, method === 'GET' ? {} : { method, body }, { ref });
}
export const metaCreds = (q) => need(q, 'meta');

/** Verify the token and discover the Instagram professional account linked to the Page. */
export async function metaTest(q) {
  const c = await need(q, 'meta');
  const page = await graph(q, 'meta', `${c.pageId}`, { params: { fields: 'id,name,followers_count,fan_count,instagram_business_account{id,username,followers_count}' }, creds: c });
  const ig = page.instagram_business_account || null;
  if (ig && ig.id !== c.igUserId) await saveCreds(q, 'meta', { igUserId: ig.id });
  return { page: { id: page.id, name: page.name, followers: page.followers_count ?? page.fan_count ?? null }, instagram: ig ? { id: ig.id, username: ig.username, followers: ig.followers_count ?? null } : null };
}

// ---------------------------------------------------------------- WhatsApp Cloud API
export async function whatsappTest(q) {
  const c = await need(q, 'whatsapp');
  const r = await graph(q, 'whatsapp', `${c.phoneNumberId}`, { params: { fields: 'display_phone_number,verified_name,quality_rating,messaging_limit_tier' }, creds: c });
  let templates = [];
  if (c.wabaId) templates = (await graph(q, 'whatsapp', `${c.wabaId}/message_templates`, { params: { fields: 'name,status,language,category,components', limit: 100 }, creds: c })).data || [];
  return { phone: r.display_phone_number, name: r.verified_name, quality: r.quality_rating, tier: r.messaging_limit_tier, templates };
}
export async function whatsappTemplate(q, { to, template, language, headerImageUrl, headerVideoUrl, bodyParams = [] }, ref) {
  const c = await need(q, 'whatsapp');
  const components = [];
  if (headerImageUrl) components.push({ type: 'header', parameters: [{ type: 'image', image: { link: headerImageUrl } }] });
  if (headerVideoUrl) components.push({ type: 'header', parameters: [{ type: 'video', video: { link: headerVideoUrl } }] });
  if (bodyParams.length) components.push({ type: 'body', parameters: bodyParams.map((t) => ({ type: 'text', text: String(t) })) });
  const u = `${graphBase()}/${gv(c)}/${c.phoneNumberId}/messages`;
  return call(q, 'whatsapp', 'send_template', u, {
    method: 'POST', headers: { Authorization: `Bearer ${c.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: template, language: { code: language }, components } }),
  }, { ref, cost: 0.03 });
}

// ---------------------------------------------------------------- Website (Shopify / WooCommerce)
export const websiteCreds = (q) => need(q, 'website');
/** WordPress REST login: the blog user, or the WordPress username + application password entered as key/secret. */
function wpAuth(c) {
  const user = c.wpUser || (c.key && !/^ck_/.test(c.key) ? c.key : null);
  const pass = c.wpAppPassword || (c.secret && !/^cs_/.test(c.secret) ? c.secret : null);
  if (!user || !pass) fail(412, 'Pages, posts and photos on WordPress need a WordPress user and application password (Marketing → Connections → Website).');
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

/** Upload one file to the WordPress media library. */
export async function websiteMedia(q, buf, mime, filename, { alt, caption, ref } = {}) {
  const c = await need(q, 'website');
  if (c.platform === 'shopify') fail(400, 'The website gallery page is for WordPress / WooCommerce sites');
  const url = `${c.url.replace(/\/+$/, '')}/wp-json/wp/v2/media`;
  const m = await call(q, 'website', 'wp_upload_media', url, { method: 'POST', headers: { Authorization: wpAuth(c), 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '-')}"` }, body: buf }, { ref });
  if (alt || caption) await call(q, 'website', 'wp_update_media', `${url}/${m.id}`, { method: 'POST', headers: { Authorization: wpAuth(c), 'Content-Type': 'application/json' }, body: JSON.stringify({ alt_text: alt || '', caption: caption || '' }) }, { ref });
  return m;
}

export async function website(q, operation, method, path, body, ref) {
  const c = await need(q, 'website');
  const base = c.url.replace(/\/+$/, '');
  let url, headers = { 'Content-Type': 'application/json' };
  if (c.platform === 'shopify') {
    url = `${base}/admin/api/2025-07/${path}`;
    headers['X-Shopify-Access-Token'] = c.token;
  } else if (path.startsWith('wp/')) {
    url = `${base}/wp-json/${path}`;
    headers.Authorization = wpAuth(c);
  } else {
    url = `${base}/wp-json/wc/v3/${path}`;
    headers.Authorization = 'Basic ' + Buffer.from(`${c.key}:${c.secret}`).toString('base64');
  }
  return call(q, 'website', operation, url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }, { ref });
}
