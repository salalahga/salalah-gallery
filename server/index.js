// WoodWorks Pro server: login, role-based access, online database and multi-device sync.
// Serves the built app from dist/ and a JSON API under /api.
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, UPSERT, KV_SET } from './db.js';
import { hashPassword, verifyPassword, signToken, readToken, cookieMaxAge, loginAllowed, loginFailed, loginOk } from './auth.js';
import { COLLECTIONS, isCollection, canRead, canWrite, canDelete, redact, mergeProtected } from './permissions.js';
import { createPlugins } from './plugins.js';
import { createAutomations, DEFAULT_RULES } from './automations.js';
import { buildIcs } from './ical.js';
import { createFiles } from './files.js';
import { createBackup } from './backup.js';

const PORT = Number(process.env.PORT) || 8787;
const db = await openDb();
const uid = () => crypto.randomBytes(8).toString('hex');

// Session secret: from env, else generated once and stored in the database.
let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  const row = await db.get('SELECT value FROM kv WHERE key = ?', ['session_secret']);
  SECRET = row?.value || crypto.randomBytes(32).toString('hex');
  if (!row) await db.run(KV_SET, ['session_secret', SECRET, Date.now()]);
}

// Monotonic clock so two writes in the same millisecond still sync in order.
let lastTs = 0;
const tick = () => (lastTs = Math.max(Date.now(), lastTs + 1));
const plugins = createPlugins(db);
const files = createFiles(db, { tick });
const backup = createBackup(db, plugins);
const automations = createAutomations(db, plugins, { tick, backup });

// ---- activity log: who changed what (repeated edits of one record within a minute are merged) ----
const labelOf = (r) => String((r && (r.number || r.code || r.name || r.title || r.description)) || '').slice(0, 140);
async function audit(user, col, recId, action, label) {
  try {
    const at = Date.now();
    if (action === 'update') {
      const last = await db.get('SELECT id, at, action FROM audit WHERE user_id = ? AND col = ? AND rec_id = ? ORDER BY at DESC LIMIT 1', [user?.id || null, col, recId || null]);
      if (last && at - Number(last.at) < 60e3 && ['create', 'update'].includes(last.action)) { await db.run('UPDATE audit SET at = ?, label = ? WHERE id = ?', [at, label || '', last.id]); return; }
    }
    await db.run('INSERT INTO audit (id, at, user_id, user_name, col, rec_id, action, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [uid(), at, user?.id || null, user?.name || null, col, recId || null, action, label || '']);
  } catch (e) { console.error('audit', e.message); }
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '15mb' }));
app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });

const cookieName = 'ww_session';
function getCookie(req) {
  const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(cookieName + '='));
  return m ? decodeURIComponent(m.slice(cookieName.length + 1)) : null;
}
function setSession(req, res, userId) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(signToken(SECRET, userId))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cookieMaxAge}${secure}`);
}
const publicUser = (u) => u && { id: u.id, name: u.name, username: u.username, role: u.role, staffId: u.staff_id || undefined, active: !!u.active };

async function auth(req, res, next) {
  const id = readToken(SECRET, getCookie(req));
  const user = id && (await db.get('SELECT * FROM users WHERE id = ?', [id]));
  if (!user || !user.active) return res.status(401).json({ error: 'Please log in' });
  req.user = user; next();
}
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Only the owner can do this' }));
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---- status / setup / login ----
app.get('/api/status', wrap(async (_req, res) => {
  const n = await db.get('SELECT COUNT(*) AS n FROM users');
  res.json({ server: true, setupDone: Number(n.n) > 0, setupNeedsCode: !!process.env.SETUP_CODE });
}));

app.post('/api/setup', wrap(async (req, res) => {
  const n = await db.get('SELECT COUNT(*) AS n FROM users');
  if (Number(n.n) > 0) return res.status(409).json({ error: 'Already set up' });
  const { name, username, password, data, code } = req.body || {};
  // On a public host, SETUP_CODE stops a stranger from claiming the owner account before you do.
  const expected = process.env.SETUP_CODE;
  if (expected) {
    const key = 'setup:' + (req.ip || '');
    if (!loginAllowed(key)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const a = Buffer.from(String(code || '')); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { loginFailed(key); return res.status(403).json({ error: 'Wrong setup code' }); }
  }
  if (!name || !username || !password || String(password).length < 6) return res.status(400).json({ error: 'Name, username and a password of at least 6 characters are required' });
  const user = { id: uid(), name, username: String(username).toLowerCase().trim(), hash: hashPassword(password), role: 'admin' };
  await db.tx(async (t) => {
    await t.run('INSERT INTO users (id, name, username, hash, role, staff_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', [user.id, user.name, user.username, user.hash, 'admin', null, Date.now()]);
    if (data && typeof data === 'object') await importData(t, data);
  });
  setSession(req, res, user.id);
  void audit(user, 'system', null, 'setup', 'Owner account created');
  res.json({ user: publicUser({ ...user, active: 1 }) });
}));

app.post('/api/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const key = (req.ip || '') + ':' + String(username || '').toLowerCase();
  if (!loginAllowed(key)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const u = await db.get('SELECT * FROM users WHERE username = ?', [String(username || '').toLowerCase().trim()]);
  if (!u || !u.active || !verifyPassword(password || '', u.hash)) { loginFailed(key); return res.status(401).json({ error: 'Wrong username or password' }); }
  loginOk(key); setSession(req, res, u.id);
  void audit(u, 'system', null, 'login', 'Logged in');
  res.json({ user: publicUser(u) });
}));

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/password', auth, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  if (!verifyPassword(current || '', req.user.hash)) return res.status(400).json({ error: 'Current password is wrong' });
  if (!next || String(next).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  await db.run('UPDATE users SET hash = ? WHERE id = ?', [hashPassword(next), req.user.id]);
  res.json({ ok: true });
}));

// ---- data ----
async function readSettings() {
  const r = await db.get('SELECT value, updated_at FROM kv WHERE key = ?', ['settings']);
  return r ? { value: JSON.parse(r.value), updated_at: Number(r.updated_at) } : null;
}

app.get('/api/db', auth, wrap(async (req, res) => {
  const now = tick();
  const rows = await db.all('SELECT col, data FROM records WHERE deleted = 0');
  const out = Object.fromEntries(COLLECTIONS.filter((c) => canRead(req.user.role, c)).map((c) => [c, []]));
  for (const r of rows) if (out[r.col]) out[r.col].push(redact(req.user.role, r.col, JSON.parse(r.data)));
  for (const c of Object.keys(out)) out[c].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const s = await readSettings();
  res.json({ db: out, settings: s?.value || null, serverTime: now });
}));

app.get('/api/changes', auth, wrap(async (req, res) => {
  const since = Number(req.query.since) || 0;
  const now = tick();
  const rows = await db.all('SELECT col, id, data, deleted FROM records WHERE updated_at > ? AND updated_at <= ?', [since, now]);
  const changes = rows.filter((r) => canRead(req.user.role, r.col)).map((r) => ({ col: r.col, id: r.id, deleted: !!Number(r.deleted), data: Number(r.deleted) ? undefined : redact(req.user.role, r.col, JSON.parse(r.data)) }));
  const s = await readSettings();
  res.json({ changes, settings: s && s.updated_at > since ? s.value : undefined, serverTime: now });
}));

app.put('/api/r/:col/:id', auth, wrap(async (req, res) => {
  const { col, id } = req.params;
  if (!isCollection(col)) return res.status(404).json({ error: 'Unknown collection' });
  const prev = await db.get('SELECT data, deleted FROM records WHERE col = ? AND id = ?', [col, id]);
  const before = prev && !Number(prev.deleted) ? JSON.parse(prev.data) : null;
  let after = { ...(req.body || {}), id };
  if (!canWrite(req.user, col, before, after)) return res.status(403).json({ error: 'You do not have permission to change this' });
  after = mergeProtected(req.user.role, col, before, after);
  await db.run(UPSERT, [col, id, JSON.stringify(after), tick(), 0]);
  res.json({ ok: true });
  void audit(req.user, col, id, before ? 'update' : 'create', labelOf(after));
  void automations.onChange(col, before, after); // runs after the response; never blocks saving
}));

app.delete('/api/r/:col/:id', auth, wrap(async (req, res) => {
  const { col, id } = req.params;
  if (!isCollection(col)) return res.status(404).json({ error: 'Unknown collection' });
  if (!canDelete(req.user, col)) return res.status(403).json({ error: 'You do not have permission to delete this' });
  const prev = await db.get('SELECT data FROM records WHERE col = ? AND id = ? AND deleted = 0', [col, id]);
  if (prev) void audit(req.user, col, id, 'delete', labelOf(JSON.parse(prev.data)));
  await db.run('UPDATE records SET deleted = 1, data = ?, updated_at = ? WHERE col = ? AND id = ?', ['{}', tick(), col, id]);
  res.json({ ok: true });
}));

app.put('/api/settings', auth, adminOnly, wrap(async (req, res) => {
  await db.run(KV_SET, ['settings', JSON.stringify(req.body || {}), tick()]);
  res.json({ ok: true });
  void audit(req.user, 'settings', null, 'update', 'Settings');
}));

async function importData(t, data) {
  const ts = tick();
  await t.run('UPDATE records SET deleted = 1, data = ?, updated_at = ?', ['{}', ts]);
  for (const c of COLLECTIONS) for (const r of Array.isArray(data[c]) ? data[c] : []) if (r && r.id) await t.run(UPSERT, [c, String(r.id), JSON.stringify(r), ts, 0]);
  if (data.settings) await t.run(KV_SET, ['settings', JSON.stringify(data.settings), ts]);
}
app.post('/api/import', auth, adminOnly, wrap(async (req, res) => {
  await db.tx((t) => importData(t, req.body || {}));
  res.json({ ok: true });
  void audit(req.user, 'system', null, 'restore', 'Backup restored / data replaced');
}));

// ---- user accounts (owner only) ----
app.get('/api/users', auth, adminOnly, wrap(async (_req, res) => {
  res.json({ users: (await db.all('SELECT * FROM users ORDER BY created_at')).map(publicUser) });
}));
app.post('/api/users', auth, adminOnly, wrap(async (req, res) => {
  const { name, username, password, role, staffId } = req.body || {};
  if (!name || !username || !password || String(password).length < 6) return res.status(400).json({ error: 'Name, username and a password of at least 6 characters are required' });
  if (!['admin', 'manager', 'staff'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const uname = String(username).toLowerCase().trim();
  if (await db.get('SELECT id FROM users WHERE username = ?', [uname])) return res.status(409).json({ error: 'Username already taken' });
  const id = uid();
  await db.run('INSERT INTO users (id, name, username, hash, role, staff_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', [id, name, uname, hashPassword(password), role, staffId || null, Date.now()]);
  res.json({ user: publicUser(await db.get('SELECT * FROM users WHERE id = ?', [id])) });
  void audit(req.user, 'users', id, 'create', `${uname} (${role})`);
}));
app.put('/api/users/:id', auth, adminOnly, wrap(async (req, res) => {
  const u = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const { name, role, staffId, active, password } = req.body || {};
  if (u.id === req.user.id && (role && role !== 'admin' || active === false)) return res.status(400).json({ error: 'You cannot remove your own owner access' });
  if (role && !['admin', 'manager', 'staff'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (password !== undefined && String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  await db.run('UPDATE users SET name = ?, role = ?, staff_id = ?, active = ?, hash = ? WHERE id = ?', [
    name ?? u.name, role ?? u.role, staffId === undefined ? u.staff_id : staffId || null, active === undefined ? u.active : active ? 1 : 0,
    password ? hashPassword(password) : u.hash, u.id]);
  void audit(req.user, 'users', u.id, 'update', `${u.username}${password ? ' · password changed' : ''}${role && role !== u.role ? ' · role ' + role : ''}${active === false ? ' · disabled' : ''}`);
  res.json({ user: publicUser(await db.get('SELECT * FROM users WHERE id = ?', [u.id])) });
}));
app.delete('/api/users/:id', auth, adminOnly, wrap(async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  const gone = await db.get('SELECT username FROM users WHERE id = ?', [req.params.id]);
  await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
  void audit(req.user, 'users', req.params.id, 'delete', gone?.username || '');
  res.json({ ok: true });
}));

// ---- plugins (owner only; secrets are returned masked) ----
app.get('/api/plugins', auth, adminOnly, wrap(async (_req, res) => res.json({ config: await plugins.masked() })));
app.put('/api/plugins/:id', auth, adminOnly, wrap(async (req, res) => {
  if (!/^[a-z0-9-]+$/.test(req.params.id)) return res.status(400).json({ error: 'Bad plugin id' });
  await plugins.setConfig(req.params.id, { ...(req.body || {}) });
  void audit(req.user, 'plugins', req.params.id, 'update', req.params.id);
  res.json({ config: await plugins.masked() });
}));
app.post('/api/plugins/:id/test', auth, adminOnly, wrap(async (req, res) => {
  const s = await db.get('SELECT value FROM kv WHERE key = ?', ['settings']);
  const name = (s && JSON.parse(s.value).businessName) || 'Teraz Investment L.L.C';
  try {
    if (req.params.id === 'telegram') await plugins.telegram(`✅ ${name}: Telegram is connected.`);
    else if (req.params.id === 'email') await plugins.email({ subject: `${name}: email is connected`, text: `This is a test email from ${name}.` });
    else if (req.params.id === 'webhooks') await plugins.webhook('test', { message: `Test from ${name}`, business: name });
    else return res.status(400).json({ error: 'This plugin has no test' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
}));

// ---- automations (owner only) ----
app.get('/api/automations', auth, adminOnly, wrap(async (_req, res) => res.json({ rules: await automations.rules(), triggers: automations.TRIGGERS })));
app.put('/api/automations', auth, adminOnly, wrap(async (req, res) => {
  const list = Array.isArray(req.body?.rules) ? req.body.rules : null;
  if (!list) return res.status(400).json({ error: 'rules[] required' });
  await automations.saveRules(list); res.json({ ok: true });
  void audit(req.user, 'automations', null, 'update', `${list.length} rules`);
}));
app.post('/api/automations/defaults', auth, adminOnly, wrap(async (_req, res) => {
  const cur = await automations.rules(); const names = new Set(cur.map((r) => r.name));
  const add = DEFAULT_RULES.filter((r) => !names.has(r.name)).map((r) => ({ ...r, id: crypto.randomBytes(6).toString('hex') }));
  await automations.saveRules([...cur, ...add]); res.json({ added: add.length });
}));
app.post('/api/automations/test', auth, adminOnly, wrap(async (req, res) => res.json({ results: await automations.test(req.body || {}) })));
app.post('/api/automations/run-daily', auth, adminOnly, wrap(async (_req, res) => res.json({ ran: await automations.daily(true) })));
app.get('/api/automations/log', auth, adminOnly, wrap(async (_req, res) => {
  res.json({ log: (await db.all('SELECT * FROM automation_log ORDER BY at DESC LIMIT 200')).map((r) => ({ id: r.id, rule: r.rule, trigger: r.trig, detail: r.detail, at: Number(r.at), ok: !!Number(r.ok) })) });
}));

// ---- calendar feed (subscribe from Google Calendar / iPhone; secret link, read-only) ----
app.get('/api/calendar/:token.ics', wrap(async (req, res) => {
  const cfg = (await plugins.getConfig()).ical || {};
  const a = Buffer.from(String(req.params.token)); const b = Buffer.from(String(cfg.token || ''));
  if (!cfg.enabled || !cfg.token || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(404).end();
  const get = async (c) => (await db.all('SELECT data FROM records WHERE col = ? AND deleted = 0', [c])).map((r) => JSON.parse(r.data));
  const s = await db.get('SELECT value FROM kv WHERE key = ?', ['settings']);
  const ics = buildIcs({ settings: s ? JSON.parse(s.value) : {}, jobs: await get('jobs'), tasks: await get('tasks'), invoices: await get('invoices'), customers: await get('customers'), staff: await get('staff') });
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8'); res.send(ics);
}));

// ---- photos ----
app.post('/api/files', auth, wrap(async (req, res) => {
  try { res.json({ url: await files.save(req.body?.data, req.user.id) }); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
}));
// Public on purpose: ids are 128-bit random, so photos can also appear on the published website.
app.get('/api/files/:id', wrap(async (req, res) => {
  const f = await files.get(req.params.id);
  if (!f) return res.status(404).end();
  res.setHeader('Content-Type', f.mime); res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(f.buf);
}));

// ---- activity log & backups (owner only) ----
app.get('/api/audit', auth, adminOnly, wrap(async (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 200);
  const where = []; const p = [];
  if (req.query.col) { where.push('col = ?'); p.push(String(req.query.col)); }
  if (req.query.user) { where.push('user_id = ?'); p.push(String(req.query.user)); }
  if (req.query.before) { where.push('at < ?'); p.push(Number(req.query.before)); }
  const rows = await db.all(`SELECT * FROM audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC LIMIT ${limit}`, p);
  res.json({ log: rows.map((r) => ({ id: r.id, at: Number(r.at), user: r.user_name, userId: r.user_id, col: r.col, recId: r.rec_id, action: r.action, label: r.label })) });
}));
app.get('/api/backups', auth, adminOnly, wrap(async (_req, res) => res.json({ backups: await backup.list() })));
app.post('/api/backups/run', auth, adminOnly, wrap(async (req, res) => {
  const r = await backup.run(new Date().toISOString().slice(0, 10), { force: true });
  void audit(req.user, 'system', null, 'backup', 'Backup made');
  res.json(r);
}));
app.get('/api/backups/:date', auth, adminOnly, wrap(async (req, res) => {
  const gz = await backup.read(req.params.date);
  if (!gz) return res.status(404).json({ error: 'No backup for that day' });
  // sent as plain JSON so it can be restored directly from Settings → Backup
  const zlib = await import('node:zlib');
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Disposition', `attachment; filename="backup-${req.params.date}.json"`);
  res.end(zlib.gunzipSync(gz));
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---- static app ----
const dist = path.resolve(process.env.STATIC_DIR || 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, file) => { if (/sw\.js$|\.webmanifest$|index\.html$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Server error' }); });

automations.start();
files.migrateInline().then((n) => n && console.log(`moved ${n} inline photos to file storage`), (e) => console.error('photo migration', e));
app.listen(PORT, () => console.log(`WoodWorks Pro server on :${PORT} · database ${db.kind}`));
