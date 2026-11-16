// Automatic daily backup: a compressed copy of all data is kept on the server (last N days) and,
// if enabled, sent to the owner on Telegram and/or by email — so the data survives even if the
// free hosting or database is lost. Photos stay in the files table and are not included.
import zlib from 'node:zlib';
import { KV_SET } from './db.js';

export function createBackup(db, plugins) {
  async function build() {
    const rows = await db.all('SELECT col, data FROM records WHERE deleted = 0');
    const out = {};
    for (const r of rows) (out[r.col] ||= []).push(JSON.parse(r.data));
    const s = await db.get('SELECT value FROM kv WHERE key = ?', ['settings']);
    out.settings = s ? JSON.parse(s.value) : undefined;
    return out;
  }
  async function list() {
    const rows = await db.all("SELECT key, updated_at, LENGTH(value) AS n FROM kv WHERE key LIKE 'backup:%' ORDER BY key DESC");
    return rows.map((r) => ({ date: r.key.slice(7), at: Number(r.updated_at), size: Math.floor((Number(r.n) * 3) / 4) }));
  }
  async function read(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const r = await db.get('SELECT value FROM kv WHERE key = ?', ['backup:' + date]);
    return r ? Buffer.from(r.value, 'base64') : null;
  }
  /** Make today's backup. Returns what was done; sending errors are reported, not thrown. */
  async function run(date, { force = false } = {}) {
    const cfg = (await plugins.getConfig()).backup || {};
    if (!cfg.enabled && !force) return { skipped: true };
    const data = await build();
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(data)));
    await db.run(KV_SET, ['backup:' + date, gz.toString('base64'), Date.now()]);
    const keep = Math.max(1, Math.min(60, Number(cfg.keep) || 7));
    const all = await list();
    for (const b of all.slice(keep)) await db.run('DELETE FROM kv WHERE key = ?', ['backup:' + b.date]);
    const name = (data.settings?.businessName || 'workshop').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    const filename = `${name}-backup-${date}.json.gz`;
    const sent = []; const errors = [];
    const count = Object.entries(data).filter(([k]) => k !== 'settings').reduce((n, [, v]) => n + v.length, 0);
    const caption = `🗄️ Backup ${date} — ${count} records. Restore it in Settings → Backup.`;
    if (cfg.enabled && cfg.telegram) { try { await plugins.telegramFile(gz, filename, caption); sent.push('telegram'); } catch (e) { errors.push(e.message); } }
    if (cfg.enabled && cfg.email) { try { await plugins.email({ subject: `Backup ${date}`, text: caption, attachments: [{ filename, content: gz }] }); sent.push('email'); } catch (e) { errors.push(e.message); } }
    return { date, size: gz.length, records: count, sent, errors };
  }
  return { build, list, read, run };
}
