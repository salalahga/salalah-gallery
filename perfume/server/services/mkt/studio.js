// Image & video studio. The product photo is always used as supplied (only resized / background removed
// when asked): AI may create the backdrop, never the bottle, label, logo or packaging.
import sharp from 'sharp';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { id, fail } from '../../util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.resolve(here, '../../assets/fonts');
const LOGO = path.resolve(here, '../../../public/brand/logo-light.png');

export const FORMATS = {
  square: { w: 1080, h: 1080, label: 'Square 1:1 — Instagram / Facebook post' },
  portrait: { w: 1080, h: 1350, label: 'Portrait 4:5 — Instagram feed' },
  story: { w: 1080, h: 1920, label: 'Vertical 9:16 — Reels & Stories' },
  landscape: { w: 1920, h: 1080, label: 'Landscape 16:9 — Facebook / YouTube' },
  banner: { w: 1920, h: 640, label: 'Website banner / homepage slider 3:1' },
};
export const THEMES = {
  noir: { label: 'Noir & gold', stops: ['#1a1610', '#0b0a08', '#000000'], glow: '#c9a54a', accent: '#d8b45a', text: '#f6efe0' },
  champagne: { label: 'Champagne', stops: ['#3a2f1f', '#1b150d', '#0a0806'], glow: '#f0d79a', accent: '#f0d79a', text: '#fff8ea' },
  rose: { label: 'Rose gold', stops: ['#3b1d24', '#1b0c10', '#070304'], glow: '#e7a9a0', accent: '#e9b8a5', text: '#fff1ee' },
  emerald: { label: 'Emerald oud', stops: ['#10261d', '#07130e', '#020604'], glow: '#c9a54a', accent: '#d8b45a', text: '#f3efe2' },
};

// ---------------------------------------------------------------- files
export async function loadFile(q, fileId) {
  const f = await q.one('SELECT mime, data FROM files WHERE id = $1', [fileId]);
  if (!f) fail(404, 'File not found');
  return { mime: f.mime, buf: Buffer.from(f.data) };
}
export async function saveFile(q, buf, mime, name, userId) {
  const fid = id('f_');
  await q('INSERT INTO files (id, mime, data, size, name, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [fid, mime, buf, buf.length, name || null, userId || null]);
  return fid;
}
/** Read an image referenced as /api/files/<id> (the ERP's own product photos). */
export async function loadImageUrl(q, url) {
  const m = String(url || '').match(/\/api\/files\/([\w-]+)/);
  if (!m) fail(400, 'This product photo is not stored in the ERP — upload it again in the product form.');
  return (await loadFile(q, m[1])).buf;
}

// ---------------------------------------------------------------- text
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FACES = {
  serif: ['Cormorant Garamond SemiBold', 'CormorantGaramond_600SemiBold.ttf'],
  serifLight: ['Cormorant Garamond', 'CormorantGaramond_400Regular.ttf'],
  sans: ['Inter Medium', 'Inter_500Medium.ttf'],
  sansBold: ['Inter Bold', 'Inter_700Bold.ttf'],
  arabic: ['Noto Naskh Arabic SemiBold', 'NotoNaskhArabic_600SemiBold.ttf'],
  malayalam: ['Noto Sans Malayalam SemiBold', 'NotoSansMalayalam_600SemiBold.ttf'],
};
const scriptFace = (s, face) => (/[؀-ۿ]/.test(s) ? 'arabic' : /[ഀ-ൿ]/.test(s) ? 'malayalam' : face);

/** Render one block of text to a transparent PNG (bundled fonts, so it works on servers without fonts). */
export async function textPng(str, { size = 48, color = '#ffffff', face = 'serif', width = 900, align = 'center', strike = false, spacing = 0 }) {
  if (!str) return null;
  const f = FACES[scriptFace(str, face)];
  let markup = esc(str);
  if (strike) markup = `<s>${markup}</s>`;
  const ls = spacing ? ` letter_spacing="${Math.round(spacing * 1024)}"` : '';
  const buf = await sharp({ text: { text: `<span foreground="${color}"${ls}>${markup}</span>`, font: `${f[0]} ${size}`, fontfile: path.join(FONTS, f[1]), width, align, rgba: true, dpi: 72, wrap: 'word' } }).png().toBuffer();
  const m = await sharp(buf).metadata();
  return { buf, w: m.width, h: m.height };
}

// ---------------------------------------------------------------- backgrounds
export async function themedBackground(w, h, theme = 'noir') {
  const t = THEMES[theme] || THEMES.noir;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="g" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="${t.stops[0]}"/><stop offset="0.55" stop-color="${t.stops[1]}"/><stop offset="1" stop-color="${t.stops[2]}"/></radialGradient>
    <radialGradient id="glow" cx="50%" cy="46%" r="38%"><stop offset="0" stop-color="${t.glow}" stop-opacity="0.32"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>
    <linearGradient id="line" x1="0" x2="1"><stop offset="0" stop-color="${t.accent}" stop-opacity="0"/><stop offset="0.5" stop-color="${t.accent}" stop-opacity="0.9"/><stop offset="1" stop-color="${t.accent}" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#glow)"/>
  <rect x="${w * 0.06}" y="${h * 0.035}" width="${w * 0.88}" height="${h * 0.93}" fill="none" stroke="${t.accent}" stroke-opacity="0.35" stroke-width="2"/>
  <rect x="${w * 0.2}" y="${h * 0.965 - 3}" width="${w * 0.6}" height="2" fill="url(#line)"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
/** Fit an AI-generated (or uploaded) backdrop to the canvas. */
export const fitBackground = (buf, w, h) => sharp(buf).resize(w, h, { fit: 'cover' }).modulate({ brightness: 0.85 }).png().toBuffer();

// ---------------------------------------------------------------- product
/** Product image sized to a box; transparency kept. A photo with its own background gets a fine gold frame. */
async function productLayer(buf, boxW, boxH, accent) {
  const img = sharp(buf).rotate();
  const meta = await img.metadata();
  const hasAlpha = meta.hasAlpha && (await sharp(buf).stats()).channels[3]?.min < 250;
  const fitted = await img.resize(Math.round(boxW), Math.round(boxH), { fit: 'inside', withoutEnlargement: false }).png().toBuffer();
  if (hasAlpha) return fitted;
  const m = await sharp(fitted).metadata();
  const r = 18;
  const mask = Buffer.from(`<svg width="${m.width}" height="${m.height}"><rect width="100%" height="100%" rx="${r}" ry="${r}"/></svg>`);
  const rounded = await sharp(fitted).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const frame = Buffer.from(`<svg width="${m.width}" height="${m.height}"><rect x="1" y="1" width="${m.width - 2}" height="${m.height - 2}" rx="${r}" ry="${r}" fill="none" stroke="${accent}" stroke-width="3"/></svg>`);
  return sharp(rounded).composite([{ input: frame }]).png().toBuffer();
}
async function shadow(w, h) {
  return sharp(Buffer.from(`<svg width="${w}" height="${h}"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#000" fill-opacity="0.55"/></svg>`)).blur(Math.max(2, h / 3)).png().toBuffer();
}

/**
 * Compose a poster / slide.
 * t: { brand, name, size, price, oldPrice, badge, tagline, cta, shop }
 * layout: 'hero' (product + full text), 'detail' (big product, tagline), 'offer' (price focus), 'cta' (shop sign-off)
 */
export async function composePoster({ w, h, product, background, theme = 'noir', t = {}, layout = 'hero', logo = true }) {
  const th = THEMES[theme] || THEMES.noir;
  const bg = background ? await fitBackground(background, w, h) : await themedBackground(w, h, theme);
  const layers = [];
  const wide = w / h > 1.4;
  const unit = Math.min(w, h) / 1080;
  const put = (o, left, top) => o && layers.push({ input: o.buf || o, left: Math.max(0, Math.round(left)), top: Math.max(0, Math.round(top)) });

  if (logo && layout !== 'cta') {
    const lg = await sharp(LOGO).resize({ height: Math.round(110 * unit) }).png().toBuffer();
    const lm = await sharp(lg).metadata();
    put(lg, wide ? w * 0.08 : (w - lm.width) / 2, h * 0.05);
  }
  if (t.badge && layout !== 'cta') {
    const b = await textPng(t.badge.toUpperCase(), { size: Math.round(30 * unit), color: '#0b0a08', face: 'sansBold', width: Math.round(w * 0.6), spacing: 2 });
    const pad = Math.round(18 * unit);
    const pill = Buffer.from(`<svg width="${b.w + pad * 2}" height="${b.h + pad}"><rect width="100%" height="100%" rx="${(b.h + pad) / 2}" fill="${th.accent}"/></svg>`);
    const pb = await sharp(pill).composite([{ input: b.buf, left: pad, top: Math.round(pad / 2) }]).png().toBuffer();
    put(pb, w - b.w - pad * 2 - w * 0.08, h * 0.06);
  }

  if (layout === 'cta') {
    const lg = await sharp(LOGO).resize({ height: Math.round(h * 0.28) }).png().toBuffer();
    const lm = await sharp(lg).metadata();
    put(lg, (w - lm.width) / 2, h * 0.2);
    let y = h * 0.2 + lm.height + 40 * unit;
    for (const [s, o] of [[t.cta || 'Shop now', { size: Math.round(64 * unit), color: th.text, face: 'serif' }], [t.shop, { size: Math.round(34 * unit), color: th.accent, face: 'sans', spacing: 3 }], [t.contact, { size: Math.round(30 * unit), color: th.text, face: 'sans' }]]) {
      const x = await textPng(s, { ...o, width: Math.round(w * 0.84) });
      if (x) { put(x, (w - x.w) / 2, y); y += x.h + 22 * unit; }
    }
    return sharp(bg).composite(layers).png().toBuffer();
  }

  // product box
  const big = layout === 'detail';
  const box = wide ? { x: w * 0.5, y: h * 0.12, w: w * 0.42, h: h * 0.76 } : { x: w * 0.12, y: h * (big ? 0.15 : 0.17), w: w * 0.76, h: h * (big ? 0.6 : layout === 'offer' ? 0.42 : 0.5) };
  if (product) {
    const p = await productLayer(product, box.w, box.h, th.accent);
    const pm = await sharp(p).metadata();
    const px = box.x + (box.w - pm.width) / 2, py = box.y + (box.h - pm.height) / 2;
    const sw = Math.round(pm.width * 0.8), sh = Math.max(8, Math.round(pm.height * 0.06));
    put(await shadow(sw, sh), px + (pm.width - sw) / 2, py + pm.height - sh * 0.5);
    put(p, px, py);
  }
  // text column
  const tx = wide ? { x: w * 0.08, y: h * 0.32, w: w * 0.4, align: 'left' } : { x: w * 0.08, y: box.y + box.h + 26 * unit, w: w * 0.84, align: 'center' };
  let y = tx.y;
  const line = async (s, o) => {
    const x = await textPng(s, { ...o, width: Math.round(tx.w), align: tx.align });
    if (!x) return;
    put(x, tx.align === 'center' ? tx.x + (tx.w - x.w) / 2 : tx.x, y); y += x.h + 10 * unit;
  };
  if (layout === 'detail') {
    await line(t.tagline || t.name, { size: Math.round(52 * unit), color: th.text, face: 'serif' });
  } else if (layout === 'offer') {
    await line(t.name, { size: Math.round(48 * unit), color: th.text, face: 'serif' });
    if (t.size) await line(t.size, { size: Math.round(30 * unit), color: th.text, face: 'sans' });
    if (t.oldPrice) await line(t.oldPrice, { size: Math.round(40 * unit), color: '#b9ab95', face: 'sans', strike: true });
    await line(t.price, { size: Math.round(96 * unit), color: th.accent, face: 'serif' });
  } else {
    if (t.brand) await line(t.brand.toUpperCase(), { size: Math.round(30 * unit), color: th.accent, face: 'sans', spacing: 4 });
    await line(t.name, { size: Math.round((wide ? 64 : 70) * unit), color: th.text, face: 'serif' });
    if (t.size) await line(t.size, { size: Math.round(30 * unit), color: th.text, face: 'sans' });
    if (t.price) {
      const parts = [t.oldPrice ? await textPng(t.oldPrice, { size: Math.round(34 * unit), color: '#b9ab95', face: 'sans', strike: true }) : null, await textPng(t.price, { size: Math.round(54 * unit), color: th.accent, face: 'serif' })].filter(Boolean);
      const tw = parts.reduce((a, p) => a + p.w, 0) + (parts.length - 1) * 24 * unit;
      let x = tx.align === 'center' ? tx.x + (tx.w - tw) / 2 : tx.x;
      const hmax = Math.max(...parts.map((p) => p.h));
      for (const p of parts) { put(p, x, y + (hmax - p.h) / 2); x += p.w + 24 * unit; }
      y += hmax + 10 * unit;
    }
    if (t.tagline && h / w >= 1.2) await line(t.tagline, { size: Math.round(32 * unit), color: th.text, face: 'serifLight' });
  }
  return sharp(bg).composite(layers).png().toBuffer();
}

// ---------------------------------------------------------------- video
const run = (args, timeoutMs = 300000) => new Promise((resolve, reject) => {
  execFile(ffmpegPath, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, _o, stderr) => (err ? reject(new Error(String(stderr || err.message).split('\n').filter((l) => /error|invalid|fail/i.test(l)).slice(0, 4).join(' ') || String(stderr).slice(-400))) : resolve()));
});

/**
 * Slides → MP4 (H.264 + AAC, faststart) with gentle zoom, cross-fades, optional music and voiceover.
 * clips: optional AI video clips (mp4 buffers) played first, scaled to the canvas.
 */
export async function renderVideo({ w, h, slides, seconds = 3.5, music, voice, clips = [] }) {
  if (!ffmpegPath) fail(500, 'Video renderer (ffmpeg) is not installed on the server');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mkt-'));
  try {
    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    const parts = [];
    let n = 0;
    for (const c of clips) { const f = path.join(dir, `c${n}.mp4`); await fs.writeFile(f, c); args.push('-i', f); parts.push({ i: n++, clip: true }); }
    for (const s of slides) { const f = path.join(dir, `s${n}.png`); await fs.writeFile(f, s); args.push('-loop', '1', '-framerate', '30', '-t', String(seconds), '-i', f); parts.push({ i: n++, clip: false }); }
    const fps = 30, fade = 0.6;
    const filters = [];
    const durs = [];
    for (const [k, p] of parts.entries()) {
      if (p.clip) {
        filters.push(`[${p.i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},format=yuv420p,setsar=1,trim=duration=5,setpts=PTS-STARTPTS,fps=${fps}[v${k}]`);
        durs.push(5);
      } else {
        const frames = Math.round(seconds * fps);
        filters.push(`[${p.i}:v]scale=${Math.round(w * 1.25)}:-2,zoompan=z='min(1+0.0009*on\\,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${fps},format=yuv420p,setsar=1,trim=duration=${seconds},setpts=PTS-STARTPTS,fps=${fps}[v${k}]`);
        durs.push(seconds);
      }
    }
    let last = 'v0', t = durs[0];
    for (let k = 1; k < parts.length; k++) {
      const out = `x${k}`;
      filters.push(`[${last}][v${k}]xfade=transition=fade:duration=${fade}:offset=${(t - fade).toFixed(2)}[${out}]`);
      last = out; t += durs[k] - fade;
    }
    const total = t;
    // audio: music (looped / trimmed, faded out), voiceover on top, or silence (Instagram expects an audio track)
    let ai = n;
    if (music) { const f = path.join(dir, 'music'); await fs.writeFile(f, music); args.push('-stream_loop', '-1', '-i', f); }
    if (voice) { const f = path.join(dir, 'voice.mp3'); await fs.writeFile(f, voice); args.push('-i', f); }
    if (!music && !voice) args.push('-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=44100:cl=stereo');
    if (music && voice) filters.push(`[${ai}:a]volume=0.35,atrim=0:${total}[m];[${ai + 1}:a]adelay=400|400,volume=1.4[vo];[m][vo]amix=inputs=2:duration=first:normalize=0,afade=t=out:st=${Math.max(0, total - 1.5)}:d=1.5[a]`);
    else if (music) filters.push(`[${ai}:a]atrim=0:${total},volume=0.7,afade=t=out:st=${Math.max(0, total - 1.5)}:d=1.5[a]`);
    else if (voice) filters.push(`[${ai}:a]adelay=400|400,apad,atrim=0:${total}[a]`);
    else filters.push(`[${ai}:a]atrim=0:${total}[a]`);
    const out = path.join(dir, 'out.mp4');
    args.push('-filter_complex', filters.join(';'), '-map', `[${last}]`, '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(fps),
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-t', total.toFixed(2), '-movflags', '+faststart', out);
    await run(args);
    return { buf: await fs.readFile(out), duration: Math.round(total * 10) / 10 };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** First frame of a video as JPEG (thumbnails / cover images). */
export async function videoThumb(buf) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-'));
  try {
    await fs.writeFile(path.join(dir, 'in.mp4'), buf);
    await run(['-y', '-loglevel', 'error', '-ss', '0.5', '-i', path.join(dir, 'in.mp4'), '-frames:v', '1', '-vf', 'scale=540:-2', path.join(dir, 't.jpg')]);
    return fs.readFile(path.join(dir, 't.jpg'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
