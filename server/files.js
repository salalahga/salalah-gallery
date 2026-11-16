// Photo storage: images are kept in their own table and referenced by URL (/api/files/<id>),
// so the records every device syncs stay small. Ids are long and random, which lets a photo be
// used on the public website without exposing anything else.
import crypto from 'node:crypto';
import { UPSERT } from './db.js';

const MAX_BYTES = 4 * 1024 * 1024;
const DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

export function createFiles(db, { tick }) {
  async function save(dataUrl, userId) {
    const m = DATA_URL.exec(String(dataUrl || ''));
    if (!m) throw Object.assign(new Error('Only JPEG, PNG, WebP or GIF images can be uploaded'), { status: 400 });
    const size = Math.floor((m[2].length * 3) / 4);
    if (size > MAX_BYTES) throw Object.assign(new Error('Image is too large (max 4 MB)'), { status: 413 });
    const id = crypto.randomBytes(16).toString('hex');
    await db.run('INSERT INTO files (id, mime, data, size, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)', [id, m[1], m[2], size, Date.now(), userId || null]);
    return `/api/files/${id}`;
  }
  async function get(id) {
    if (!/^[a-f0-9]{32}$/.test(id)) return null;
    const r = await db.get('SELECT mime, data FROM files WHERE id = ?', [id]);
    return r ? { mime: r.mime, buf: Buffer.from(r.data, 'base64') } : null;
  }

  /** Move photos that older versions stored inline (data: URLs) into the files table. */
  async function migrateInline() {
    let moved = 0;
    const rows = await db.all("SELECT col, id, data FROM records WHERE deleted = 0 AND col IN ('jobs', 'measurements', 'services', 'socialPosts') AND data LIKE '%data:image%'");
    for (const r of rows) {
      const rec = JSON.parse(r.data); let changed = false;
      for (const p of Array.isArray(rec.photos) ? rec.photos : []) {
        if (typeof p.url === 'string' && p.url.startsWith('data:image')) { try { p.url = await save(p.url); changed = true; moved++; } catch { /* leave it inline */ } }
      }
      if (typeof rec.image === 'string' && rec.image.startsWith('data:image')) { try { rec.image = await save(rec.image); changed = true; moved++; } catch { /* */ } }
      if (changed) await db.run(UPSERT, [r.col, r.id, JSON.stringify(rec), tick(), 0]);
    }
    return moved;
  }

  return { save, get, migrateInline };
}
