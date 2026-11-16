// Fetch pages and images from the internet for the material catalogue ("find online").
// Guards against server-side request forgery: only http(s), only public addresses (checked
// again on every redirect), short timeouts and size limits.
import dns from 'node:dns/promises';
import net from 'node:net';

const PRIVATE = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\./, /^2[3-5]\d\./,
  /^::1?$/, /^f[cd]/i, /^fe80/i, /^::ffff:(10|127|169\.254|192\.168)\./i,
];
const isPrivate = (ip) => PRIVATE.some((r) => r.test(ip));

async function checkUrl(raw) {
  let u; try { u = new URL(raw); } catch { throw Object.assign(new Error('That is not a valid web address'), { status: 400 }); }
  if (!['http:', 'https:'].includes(u.protocol)) throw Object.assign(new Error('Only http and https links are allowed'), { status: 400 });
  if (u.username || u.password) throw Object.assign(new Error('Links with passwords are not allowed'), { status: 400 });
  if (process.env.ALLOW_PRIVATE_FETCH === '1') return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!ips.length) throw Object.assign(new Error(`Could not find ${host}`), { status: 400 });
  if (ips.some(isPrivate)) throw Object.assign(new Error('That address is not on the public internet'), { status: 400 });
  return u;
}

/** GET with manual, re-checked redirects. Returns { res, url } with the body still unread. */
async function safeGet(raw, accept) {
  let url = raw;
  for (let i = 0; i < 4; i++) {
    const u = await checkUrl(url);
    const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (WorkshopCatalog)', Accept: accept } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), u).toString(); continue; }
    if (!res.ok) throw Object.assign(new Error(`The site answered ${res.status}`), { status: 400 });
    return { res, url: u.toString() };
  }
  throw Object.assign(new Error('Too many redirects'), { status: 400 });
}
async function readLimited(res, max) {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > max) throw Object.assign(new Error(`File is too large (over ${Math.round(max / 1e6)} MB)`), { status: 413 });
  const reader = res.body.getReader(); const parts = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    n += value.length; if (n > max) { await reader.cancel(); throw Object.assign(new Error(`File is too large (over ${Math.round(max / 1e6)} MB)`), { status: 413 }); }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

const IMG_TYPES = /^image\/(jpeg|png|webp|gif|avif)/i;

/** Look at a link: an image → itself; a web page → the product images found on it. */
export async function scan(raw) {
  const { res, url } = await safeGet(raw, 'text/html,image/*;q=0.9,*/*;q=0.5');
  const type = res.headers.get('content-type') || '';
  if (IMG_TYPES.test(type)) { await res.body?.cancel(); return { url, title: '', images: [{ src: url, alt: '' }] }; }
  if (!/html|xml/i.test(type)) { await res.body?.cancel(); throw Object.assign(new Error('That link is not a web page or an image'), { status: 400 }); }
  const html = (await readLimited(res, 4e6)).toString('utf8');
  const title = (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  const found = new Map();
  const add = (src, alt = '') => {
    if (!src || src.startsWith('data:')) return;
    try {
      const abs = new URL(src.trim().split(/\s+/)[0].replace(/&amp;/g, '&'), url).toString();
      if (!/^https?:/.test(abs) || /\.svg(\?|$)/i.test(abs) || /(sprite|icon|logo|favicon|pixel|spacer|loader)/i.test(abs.split('?')[0].split('/').pop())) return;
      if (!found.has(abs)) found.set(abs, alt.trim().slice(0, 120));
    } catch { /* bad url */ }
  };
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/gi)) add(/content=["']([^"']+)/i.exec(m[0])?.[1]);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0]; const alt = /alt=["']([^"']*)/i.exec(tag)?.[1] || '';
    const src = /\s(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)/i.exec(tag)?.[1] || /srcset=["']([^"']+)/i.exec(tag)?.[1]?.split(',').pop();
    add(src, alt);
  }
  for (const m of html.matchAll(/href=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)) add(m[1]);
  return { url, title, images: [...found].slice(0, 120).map(([src, alt]) => ({ src, alt })) };
}

/** Download one image (passed back to the browser, which resizes it before storing). */
export async function image(raw) {
  const { res } = await safeGet(raw, 'image/*');
  const type = res.headers.get('content-type') || '';
  if (!IMG_TYPES.test(type)) { await res.body?.cancel(); throw Object.assign(new Error('That link is not an image'), { status: 400 }); }
  return { type: type.split(';')[0], buf: await readLimited(res, 15e6) };
}
