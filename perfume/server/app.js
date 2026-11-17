// HTTP API. Every route declares the module + permission level it needs; the check runs on the server,
// so hiding a button in the UI is never the only protection. Every change is written to the audit log.
import express from 'express';
import crypto from 'node:crypto';
import { HttpError, fail, must, id, str, money, int, isoDate, today, toCsv, toExcelXml, posInt } from './util.js';
import { hashPassword, verifyPassword, passwordProblem, newToken, tokenId, newTotpSecret, verifyTotp, otpauthUrl, seal, unseal, mask } from './security.js';
import { effectivePermissions, can, branchScope, canSeeCost, serialisePerms, MODULES, LEVELS, ROLE_DEFAULTS, ROLE_CEILING } from './rbac.js';
import { getSettings, saveSetting } from './services/settings.js';
import * as inv from './services/inventory.js';
import * as sales from './services/sales.js';
import * as pur from './services/purchases.js';
import * as fin from './services/finance.js';
import { balances, partyBalance } from './services/ledger.js';
import { dashboard } from './services/analytics.js';
import { ask } from './services/assistant.js';
import { notify, listFor } from './services/notify.js';
import { ensureBase } from './seed.js';
import { internalEan13, cleanScan } from '../shared/barcode.js';

const COOKIE = 'pf_session';
const ROLES = ['owner', 'admin', 'manager', 'accountant', 'hr', 'cashier', 'staff'];
const APP_ROLES = { admin: ['owner', 'admin', 'accountant', 'hr', 'cashier', 'staff'], manager: ['owner', 'admin', 'manager'], staff: ROLES };

export async function createApp(db, { secureCookies = false, setupCode = process.env.SETUP_CODE } = {}) {
  await ensureBase(db);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '8mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  const api = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const tx = (fn) => db.tx(fn);

  // ---------- audit ----------
  const SECRET_KEYS = /password|secret|token|code|pin|iban|card/i;
  const scrub = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 3) return o;
    if (Array.isArray(o)) return o.slice(0, 50).map((x) => scrub(x, depth + 1));
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, SECRET_KEYS.test(k) && !/coupon/i.test(k) ? '•••' : scrub(v, depth + 1)]));
  };
  async function audit(req, action, entity, entityId, detail) {
    const u = req.user;
    await db.query('INSERT INTO audit_log (user_id, user_name, user_role, app, action, entity, entity_id, detail, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [u?.id || null, u?.name || detail?.username || null, u?.role || null, req.session?.app || req.body?.app || null, action, entity || null, entityId || null, detail ? JSON.stringify(scrub(detail)) : null, req.ip || null]).catch((e) => console.error('audit', e.message));
  }

  // ---------- sessions ----------
  const readCookie = (req) => {
    const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
    return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
  };
  async function startSession(req, res, user, app, mfaOk) {
    const s = await getSettings(db.query);
    const token = newToken();
    const hours = s.security.sessionHours || 12;
    await db.query('INSERT INTO sessions (id, user_id, app, mfa_ok, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tokenId(token), user.id, app, mfaOk, req.ip || null, str(req.headers['user-agent'], 200), new Date(Date.now() + hours * 3600e3)]);
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${hours * 3600}${secureCookies || req.secure ? '; Secure' : ''}`);
  }
  async function loadUser(req) {
    const t = readCookie(req);
    if (!t) return null;
    const s = await db.one('SELECT * FROM sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()', [tokenId(t)]);
    if (!s) return null;
    const u = await db.one('SELECT * FROM users WHERE id = $1 AND active', [s.user_id]);
    if (!u) return null;
    if (Date.now() - new Date(s.last_seen).getTime() > 60e3) db.query('UPDATE sessions SET last_seen = now() WHERE id = $1', [s.id]).catch(() => {});
    const grants = await db.query('SELECT * FROM user_permissions WHERE user_id = $1', [u.id]);
    return { user: u, session: s, grants, perms: effectivePermissions(u, grants) };
  }
  const authed = wrap(async (req, _res, next) => {
    const ctx = await loadUser(req);
    if (!ctx) fail(401, 'Please log in');
    Object.assign(req, ctx);
    if (ctx.user.totp_enabled && !ctx.session.mfa_ok && !req.path.startsWith('/auth/')) fail(401, 'Enter your two-factor code', { code: 'mfa_required' });
    const s = await getSettings(db.query);
    if (s.security.require2faRoles?.includes(ctx.user.role) && !ctx.user.totp_enabled && !req.path.startsWith('/auth/')) fail(403, 'Set up two-factor authentication to continue', { code: 'mfa_enrol_required' });
    if (ctx.user.must_change_password && !req.path.startsWith('/auth/')) fail(403, 'Change your password to continue', { code: 'password_change_required' });
    next();
  });
  const need = (module, level = 'view') => (req, _res, next) => {
    if (!can(req.perms, module, level)) {
      void audit(req, 'denied', module, null, { level, path: req.originalUrl });
      return next(new HttpError(403, `You do not have "${level}" permission for ${MODULES[module] || module}`));
    }
    next();
  };
  const needAny = (...pairs) => (req, _res, next) => (pairs.some(([m, l]) => can(req.perms, m, l)) ? next() : next(new HttpError(403, 'You do not have permission for this')));
  const ownerOnly = (req, _res, next) => (req.user.role === 'owner' ? next() : next(new HttpError(403, 'Only the owner can do this')));
  const ctx = (req) => ({ user: req.user, perms: req.perms, grants: req.grants });
  const scopeOf = (req, module) => branchScope(req.user, req.grants, module);
  const checkBranch = (req, module, branchId) => {
    must(branchId, 400, 'Choose a branch');
    const sc = scopeOf(req, module);
    if (sc && !sc.includes(branchId)) fail(403, 'You do not have access to this branch');
  };
  // log every successful change
  api.use((req, res, next) => {
    if (req.method === 'GET') return next();
    res.on('finish', () => {
      if (res.statusCode < 400 && req.user && !req.path.startsWith('/auth/login')) void audit(req, `${req.method} ${req.route?.path || req.path}`, req.path.split('/')[1], req.params?.id || res.locals.entityId, req.body);
    });
    next();
  });

  // ---------- public ----------
  api.get('/status', wrap(async (_req, res) => {
    const n = await db.one('SELECT COUNT(*)::int AS n FROM users');
    const s = await getSettings(db.query);
    res.json({ ok: true, setupDone: n.n > 0, setupNeedsCode: !!setupCode, business: { name: s.business.name, nameAr: s.business.nameAr }, db: db.kind });
  }));

  api.post('/auth/setup', wrap(async (req, res) => {
    const n = await db.one('SELECT COUNT(*)::int AS n FROM users');
    must(n.n === 0, 409, 'Setup is already done');
    if (setupCode) {
      const a = Buffer.from(String(req.body.setupCode || '')), b = Buffer.from(setupCode);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) fail(403, 'Wrong setup code');
    }
    const { name, username, password } = req.body || {};
    must(str(name) && str(username), 400, 'Name and username are required');
    const bad = passwordProblem(password); if (bad) fail(400, bad);
    const uid = id('usr_');
    await db.query("INSERT INTO users (id, name, username, hash, role, branch_id) VALUES ($1,$2,$3,$4,'owner','br_main')", [uid, str(name, 80), String(username).toLowerCase().trim(), hashPassword(password)]);
    if (req.body.businessName) await saveSetting(db.query, 'business', { ...(await getSettings(db.query)).business, name: str(req.body.businessName, 120) });
    if (req.body.demo) { const { seedDemo } = await import('./seed-demo.js'); await seedDemo(db, uid); }
    const user = await db.one('SELECT * FROM users WHERE id = $1', [uid]);
    await startSession(req, res, user, 'admin', true);
    req.user = user; void audit(req, 'setup', 'users', uid, { username: user.username, demo: !!req.body.demo });
    res.json({ ok: true });
  }));

  const attempts = new Map(); // per-IP throttle on top of the per-account lockout
  api.post('/auth/login', wrap(async (req, res) => {
    const { username, password } = req.body || {};
    const app = APP_ROLES[req.body.app] ? req.body.app : 'admin';
    const key = req.ip || 'x';
    const a = attempts.get(key) || { n: 0, at: Date.now() };
    if (Date.now() - a.at > 15 * 60e3) { a.n = 0; a.at = Date.now(); }
    if (a.n >= 30) fail(429, 'Too many attempts. Try again in 15 minutes.');
    const u = await db.one('SELECT * FROM users WHERE username = $1', [String(username || '').toLowerCase().trim()]);
    if (u?.locked_until && new Date(u.locked_until) > new Date()) fail(429, 'Account locked after repeated wrong passwords. Try again in 15 minutes or ask the owner.');
    if (!u || !u.active || !verifyPassword(password || '', u.hash)) {
      a.n++; attempts.set(key, a);
      if (u) await db.query("UPDATE users SET failed_logins = failed_logins + 1, locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id = $1", [u.id]);
      void audit(req, 'login_failed', 'users', u?.id, { username, app });
      fail(401, 'Wrong username or password');
    }
    if (!APP_ROLES[app].includes(u.role)) fail(403, u.role === 'manager' ? 'Managers sign in to the Business Manager app' : 'This login cannot use this app');
    await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
    await startSession(req, res, u, app, !u.totp_enabled);
    req.user = u; void audit(req, 'login', 'users', u.id, { app });
    res.json({ ok: true, mfaRequired: !!u.totp_enabled });
  }));

  api.post('/auth/mfa', authed, wrap(async (req, res) => {
    must(req.user.totp_enabled, 400, 'Two-factor authentication is not enabled');
    if (!verifyTotp(unseal(req.user.totp_secret), req.body.code)) { void audit(req, 'mfa_failed', 'users', req.user.id); fail(401, 'Wrong code'); }
    await db.query('UPDATE sessions SET mfa_ok = true WHERE id = $1', [req.session.id]);
    res.json({ ok: true });
  }));

  api.post('/auth/logout', wrap(async (req, res) => {
    const t = readCookie(req);
    if (t) await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [tokenId(t)]);
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.json({ ok: true });
  }));

  api.get('/auth/me', authed, wrap(async (req, res) => {
    const s = await getSettings(db.query);
    const u = req.user;
    res.json({
      user: { id: u.id, name: u.name, username: u.username, role: u.role, branchId: u.branch_id, employeeId: u.employee_id, totpEnabled: u.totp_enabled, mustChangePassword: u.must_change_password },
      app: req.session.app, mfaOk: req.session.mfa_ok || !u.totp_enabled,
      mfaEnrolRequired: s.security.require2faRoles?.includes(u.role) && !u.totp_enabled,
      permissions: serialisePerms(req.perms), branchScope: scopeOf(req, 'pos'), seeCost: canSeeCost(req.perms),
      settings: { business: s.business, currency: s.currency, tax: s.tax, pos: s.pos, loyalty: s.loyalty, delivery: s.delivery },
    });
  }));

  api.post('/auth/password', authed, wrap(async (req, res) => {
    must(verifyPassword(req.body.current || '', req.user.hash), 400, 'Current password is wrong');
    const bad = passwordProblem(req.body.password); if (bad) fail(400, bad);
    await db.query('UPDATE users SET hash = $1, must_change_password = false, updated_at = now() WHERE id = $2', [hashPassword(req.body.password), req.user.id]);
    await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2', [req.user.id, req.session.id]);
    res.json({ ok: true });
  }));

  api.post('/auth/2fa/begin', authed, wrap(async (req, res) => {
    const secret = newTotpSecret();
    await db.query('UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2', [seal(secret), req.user.id]);
    const s = await getSettings(db.query);
    res.json({ secret, url: otpauthUrl(secret, req.user.username, s.business.name) });
  }));
  api.post('/auth/2fa/enable', authed, wrap(async (req, res) => {
    const u = await db.one('SELECT totp_secret FROM users WHERE id = $1', [req.user.id]);
    must(u.totp_secret, 400, 'Start the setup first');
    must(verifyTotp(unseal(u.totp_secret), req.body.code), 400, 'Wrong code — check the time on your phone and try again');
    await db.query('UPDATE users SET totp_enabled = true WHERE id = $1', [req.user.id]);
    await db.query('UPDATE sessions SET mfa_ok = true WHERE id = $1', [req.session.id]);
    res.json({ ok: true });
  }));
  api.post('/auth/2fa/disable', authed, wrap(async (req, res) => {
    must(verifyPassword(req.body.password || '', req.user.hash), 400, 'Password is wrong');
    await db.query('UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = $1', [req.user.id]);
    res.json({ ok: true });
  }));
  api.get('/auth/sessions', authed, wrap(async (req, res) => {
    res.json(await db.query('SELECT id, app, ip, user_agent, created_at, last_seen, expires_at, (id = $2) AS current FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen DESC', [req.user.id, req.session.id]));
  }));
  api.delete('/auth/sessions/:id', authed, wrap(async (req, res) => {
    await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  }));

  // public product photos (storefront)
  api.get('/files/:id', wrap(async (req, res) => {
    const f = await db.one('SELECT mime, data FROM files WHERE id = $1', [req.params.id]);
    if (!f) fail(404, 'Not found');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(Buffer.from(f.data));
  }));

  // ---------- everything below needs a login ----------
  api.use(authed);

  api.post('/files', needAny(['inventory', 'edit'], ['online', 'edit']), wrap(async (req, res) => {
    const m = String(req.body.data || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    must(m, 400, 'Upload a JPEG, PNG or WebP image');
    const buf = Buffer.from(m[2], 'base64');
    must(buf.length <= 5 * 1024 * 1024, 400, 'Image must be under 5 MB');
    const fid = id('f_');
    await db.query('INSERT INTO files (id, mime, data, size, created_by) VALUES ($1,$2,$3,$4,$5)', [fid, m[1], buf, buf.length, req.user.id]);
    res.json({ id: fid, url: `/api/files/${fid}` });
  }));

  // ---------- settings ----------
  api.get('/settings', need('settings', 'view'), wrap(async (_req, res) => res.json(await getSettings(db.query))));
  api.put('/settings/:key', need('settings', 'manage'), wrap(async (req, res) => {
    if (req.params.key === 'security') must(req.user.role === 'owner', 403, 'Only the owner can change security settings');
    await saveSetting(db.query, req.params.key, req.body);
    res.json({ ok: true });
  }));

  // ---------- branches & registers ----------
  api.get('/branches', wrap(async (req, res) => {
    const sc = scopeOf(req, 'dashboard');
    const rows = await db.query('SELECT * FROM branches ORDER BY code');
    res.json(sc ? rows.filter((b) => sc.includes(b.id)) : rows);
  }));
  api.post('/branches', need('branches', 'manage'), wrap(async (req, res) => {
    const bid = id('br_');
    await db.query('INSERT INTO branches (id, code, name, name_ar, address, phone, is_warehouse) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [bid, String(str(req.body.code, 10) || '').toUpperCase(), str(req.body.name, 80), str(req.body.nameAr, 80), str(req.body.address), str(req.body.phone, 30), !!req.body.isWarehouse]);
    await db.query('INSERT INTO registers (id, branch_id, name) VALUES ($1,$2,$3)', [id('reg_'), bid, 'Till 1']);
    res.json({ id: bid });
  }));
  api.put('/branches/:id', need('branches', 'manage'), wrap(async (req, res) => {
    await db.query('UPDATE branches SET name = $1, name_ar = $2, address = $3, phone = $4, active = $5 WHERE id = $6', [str(req.body.name, 80), str(req.body.nameAr, 80), str(req.body.address), str(req.body.phone, 30), req.body.active !== false, req.params.id]);
    res.json({ ok: true });
  }));
  api.get('/registers', needAny(['pos', 'view'], ['sales', 'view']), wrap(async (req, res) => {
    const sc = scopeOf(req, 'pos');
    const rows = await db.query(`SELECT r.*, b.name AS branch, rs.id AS session_id, rs.opened_at, rs.opened_by, u.name AS opened_by_name, rs.opening_float FROM registers r JOIN branches b ON b.id = r.branch_id
      LEFT JOIN register_sessions rs ON rs.register_id = r.id AND rs.status = 'open' LEFT JOIN users u ON u.id = rs.opened_by WHERE r.active ORDER BY b.code, r.name`);
    res.json(sc ? rows.filter((r) => sc.includes(r.branch_id)) : rows);
  }));
  api.post('/registers', need('branches', 'manage'), wrap(async (req, res) => {
    const rid = id('reg_');
    await db.query('INSERT INTO registers (id, branch_id, name) VALUES ($1,$2,$3)', [rid, req.body.branchId, str(req.body.name, 40)]);
    res.json({ id: rid });
  }));
  api.post('/registers/:id/open', need('pos', 'create'), wrap(async (req, res) => {
    const r = await db.one('SELECT branch_id FROM registers WHERE id = $1', [req.params.id]);
    must(r, 404, 'Register not found');
    checkBranch(req, 'pos', r.branch_id);
    res.json(await tx((q) => sales.openRegister(q, { registerId: req.params.id, openingFloat: req.body.openingFloat, user: req.user })));
  }));
  api.get('/register-sessions/:id', needAny(['pos', 'view'], ['finance', 'view']), wrap(async (req, res) => res.json(await sales.registerSummary(db.query, req.params.id))));
  api.post('/register-sessions/:id/cash', need('pos', 'edit'), wrap(async (req, res) => res.json(await tx((q) => sales.cashMovement(q, { ...req.body, sessionId: req.params.id, user: req.user })))));
  api.post('/register-sessions/:id/close', need('pos', 'create'), wrap(async (req, res) => res.json(await tx((q) => sales.closeRegister(q, { sessionId: req.params.id, countedCash: req.body.countedCash, note: req.body.note, user: req.user })))));
  api.get('/register-sessions', needAny(['pos', 'approve'], ['finance', 'view']), wrap(async (_req, res) => {
    res.json(await db.query(`SELECT rs.*, r.name AS register, b.name AS branch, uo.name AS opened_by_name, uc.name AS closed_by_name FROM register_sessions rs JOIN registers r ON r.id = rs.register_id
      JOIN branches b ON b.id = rs.branch_id LEFT JOIN users uo ON uo.id = rs.opened_by LEFT JOIN users uc ON uc.id = rs.closed_by ORDER BY rs.opened_at DESC LIMIT 100`));
  }));

  // ---------- users & permissions ----------
  const publicUser = (u) => ({ id: u.id, name: u.name, username: u.username, email: u.email, phone: u.phone, role: u.role, branchId: u.branch_id, employeeId: u.employee_id, active: u.active, totpEnabled: u.totp_enabled, createdAt: u.created_at, lockedUntil: u.locked_until });
  const canTouchUser = (actor, target, newRole) => {
    if (actor.role === 'owner') return target?.role !== 'owner' || target.id === actor.id || fail(403, 'Owner accounts are managed by themselves');
    if (target && ['owner', 'admin'].includes(target.role)) fail(403, 'Only the owner can change owner or admin accounts');
    if (newRole && ['owner', 'admin'].includes(newRole)) fail(403, 'Only the owner can create admins');
    return true;
  };
  api.get('/users', need('users', 'view'), wrap(async (_req, res) => res.json((await db.query('SELECT * FROM users ORDER BY role, name')).map(publicUser))));
  api.post('/users', need('users', 'manage'), wrap(async (req, res) => {
    const role = req.body.role;
    must(ROLES.includes(role) && role !== 'owner', 400, 'Choose a role');
    canTouchUser(req.user, null, role);
    const bad = passwordProblem(req.body.password); if (bad) fail(400, bad);
    const uid = id('usr_');
    await db.query('INSERT INTO users (id, name, username, email, phone, hash, role, branch_id, employee_id, must_change_password) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)',
      [uid, str(req.body.name, 80), String(req.body.username || '').toLowerCase().trim(), str(req.body.email, 120), str(req.body.phone, 30), hashPassword(req.body.password), role, req.body.branchId || null, req.body.employeeId || null]);
    res.locals.entityId = uid;
    res.json({ id: uid });
  }));
  api.put('/users/:id', need('users', 'manage'), wrap(async (req, res) => {
    const t = await db.one('SELECT * FROM users WHERE id = $1', [req.params.id]);
    must(t, 404, 'User not found');
    canTouchUser(req.user, t, req.body.role);
    if (t.id === req.user.id) must(req.body.active !== false && (!req.body.role || req.body.role === t.role), 400, 'You cannot deactivate yourself or change your own role');
    await db.query('UPDATE users SET name = $1, email = $2, phone = $3, role = $4, branch_id = $5, employee_id = $6, active = $7, updated_at = now() WHERE id = $8',
      [str(req.body.name, 80) || t.name, str(req.body.email, 120), str(req.body.phone, 30), req.body.role || t.role, req.body.branchId || null, req.body.employeeId || null, req.body.active !== false, t.id]);
    if (req.body.active === false) await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [t.id]);
    res.json({ ok: true });
  }));
  api.post('/users/:id/reset-password', need('users', 'manage'), wrap(async (req, res) => {
    const t = await db.one('SELECT * FROM users WHERE id = $1', [req.params.id]);
    must(t, 404, 'User not found');
    canTouchUser(req.user, t);
    must(t.id !== req.user.id, 400, 'Use “Change password” for your own account');
    const bad = passwordProblem(req.body.password); if (bad) fail(400, bad);
    await db.query('UPDATE users SET hash = $1, must_change_password = true, failed_logins = 0, locked_until = NULL, totp_enabled = CASE WHEN $3 THEN false ELSE totp_enabled END WHERE id = $2', [hashPassword(req.body.password), t.id, !!req.body.reset2fa]);
    await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [t.id]);
    res.json({ ok: true });
  }));
  api.get('/permissions/catalogue', need('users', 'view'), (_req, res) => res.json({ modules: MODULES, levels: LEVELS, roleDefaults: ROLE_DEFAULTS, ceilings: ROLE_CEILING }));
  api.get('/users/:id/permissions', need('users', 'view'), wrap(async (req, res) => {
    const t = await db.one('SELECT * FROM users WHERE id = $1', [req.params.id]);
    must(t, 404, 'User not found');
    const grants = await db.query('SELECT module, levels, branch_ids FROM user_permissions WHERE user_id = $1', [t.id]);
    res.json({ grants, effective: serialisePerms(effectivePermissions(t, grants)) });
  }));
  // The owner alone decides what other users — above all the business manager — may do.
  api.put('/users/:id/permissions', ownerOnly, wrap(async (req, res) => {
    const t = await db.one('SELECT * FROM users WHERE id = $1', [req.params.id]);
    must(t && t.role !== 'owner', 400, 'Owner permissions cannot be limited');
    const grants = req.body.grants || {};
    await tx(async (q) => {
      for (const [module, val] of Object.entries(grants)) {
        if (!MODULES[module]) continue;
        if (val === null) { await q('DELETE FROM user_permissions WHERE user_id = $1 AND module = $2', [t.id, module]); continue; }
        const levels = (val.levels || []).filter((l) => LEVELS.includes(l));
        await q(`INSERT INTO user_permissions (user_id, module, levels, branch_ids, updated_by) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (user_id, module) DO UPDATE SET levels = excluded.levels, branch_ids = excluded.branch_ids, updated_by = excluded.updated_by, updated_at = now()`, [t.id, module, levels, val.branchIds?.length ? val.branchIds : null, req.user.id]);
      }
    });
    const after = await db.query('SELECT module, levels, branch_ids FROM user_permissions WHERE user_id = $1', [t.id]);
    res.json({ grants: after, effective: serialisePerms(effectivePermissions(t, after)) });
  }));
  api.get('/users/:id/sessions', need('users', 'manage'), wrap(async (req, res) => res.json(await db.query('SELECT id, app, ip, user_agent, created_at, last_seen FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()', [req.params.id]))));
  api.post('/users/:id/revoke-sessions', need('users', 'manage'), wrap(async (req, res) => {
    const t = await db.one('SELECT * FROM users WHERE id = $1', [req.params.id]);
    must(t, 404, 'User not found'); canTouchUser(req.user, t);
    await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [t.id]);
    res.json({ ok: true });
  }));

  // ---------- catalogue ----------
  const redactVariant = (req, v) => (canSeeCost(req.perms) ? v : { ...v, avg_cost: undefined });
  api.get('/brands', wrap(async (_req, res) => res.json(await db.query('SELECT * FROM brands ORDER BY name'))));
  api.post('/brands', need('inventory', 'edit'), wrap(async (req, res) => {
    const bid = id('brd_');
    await db.query('INSERT INTO brands (id, name, name_ar, country) VALUES ($1,$2,$3,$4)', [bid, str(req.body.name, 80), str(req.body.nameAr, 80), str(req.body.country, 40)]);
    res.json({ id: bid });
  }));
  api.get('/categories', wrap(async (_req, res) => res.json(await db.query('SELECT * FROM categories ORDER BY sort, name'))));
  api.post('/categories', need('inventory', 'edit'), wrap(async (req, res) => {
    const cid = id('cat_');
    await db.query('INSERT INTO categories (id, name, name_ar, parent_id) VALUES ($1,$2,$3,$4)', [cid, str(req.body.name, 80), str(req.body.nameAr, 80), req.body.parentId || null]);
    res.json({ id: cid });
  }));

  api.get('/products/:id', need('inventory', 'view'), wrap(async (req, res) => {
    const p = await db.one('SELECT * FROM products WHERE id = $1', [req.params.id]);
    must(p, 404, 'Product not found');
    const variants = await db.query(`SELECT v.*, COALESCE((SELECT SUM(qty) FROM stock_levels WHERE variant_id = v.id),0)::int AS qty FROM variants v WHERE product_id = $1 ORDER BY size_ml`, [p.id]);
    const stock = await db.query('SELECT s.*, b.name AS branch FROM stock_levels s JOIN branches b ON b.id = s.branch_id JOIN variants v ON v.id = s.variant_id WHERE v.product_id = $1', [p.id]);
    const batches = await db.query('SELECT bt.* FROM batches bt JOIN variants v ON v.id = bt.variant_id WHERE v.product_id = $1 ORDER BY expiry_date NULLS LAST', [p.id]);
    res.json({ ...p, variants: variants.map((v) => redactVariant(req, v)), stock, batches });
  }));
  const productFields = (b) => [str(b.name, 120), str(b.nameAr, 120), b.brandId || null, b.categoryId || null, str(b.description, 4000), str(b.descriptionAr, 4000), str(b.gender, 20), str(b.concentration, 40),
    str(b.notesTop, 300), str(b.notesHeart, 300), str(b.notesBase, 300), str(b.imageUrl, 400), b.webVisible !== false, b.active !== false];
  async function saveVariant(q, productId, v, vid) {
    const vals = [str(v.sku, 40), str(v.barcode, 40), v.sizeMl ? posInt(v.sizeMl, 'size') : null, str(v.label, 40), money(v.retailPrice, 'retail price'), v.wholesalePrice != null && v.wholesalePrice !== '' ? money(v.wholesalePrice) : null,
      v.webPrice != null && v.webPrice !== '' ? money(v.webPrice) : null, v.vatRateBp == null ? 500 : int(v.vatRateBp), int(v.minStock || 0), !!v.trackExpiry, v.active !== false];
    must(vals[0], 400, 'Every size needs a SKU');
    if (vals[1]) vals[1] = cleanScan(vals[1]);
    // no barcode typed → give it an in-store EAN-13 so every bottle can be scanned and labelled
    if (!vals[1] && !vid) vals[1] = await nextBarcode(q);
    if (vid) await q('UPDATE variants SET sku=$1, barcode=$2, size_ml=$3, label=$4, retail_price=$5, wholesale_price=$6, web_price=$7, vat_rate_bp=$8, min_stock=$9, track_expiry=$10, active=$11 WHERE id=$12', [...vals, vid]);
    else { vid = id('var_'); await q('INSERT INTO variants (sku, barcode, size_ml, label, retail_price, wholesale_price, web_price, vat_rate_bp, min_stock, track_expiry, active, id, product_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [...vals, vid, productId]); }
    return vid;
  }
  async function nextBarcode(q) {
    for (;;) {
      const r = await q.one(`INSERT INTO counters (key, value) VALUES ('barcode', 1) ON CONFLICT (key) DO UPDATE SET value = counters.value + 1 RETURNING value`);
      const code = internalEan13(r.value);
      if (!(await q.one('SELECT 1 AS x FROM variants WHERE barcode = $1', [code]))) return code;
    }
  }
  api.post('/barcodes/next', need('inventory', 'edit'), wrap(async (_req, res) => res.json({ barcode: await nextBarcode(db.query) })));
  api.get('/barcodes/lookup', needAny(['pos', 'view'], ['inventory', 'view']), wrap(async (req, res) => {
    const code = cleanScan(req.query.code);
    const v = await db.one(`SELECT v.id, v.sku, v.barcode, v.size_ml, v.label, v.retail_price, v.active, p.name, b.name AS brand FROM variants v JOIN products p ON p.id = v.product_id
      LEFT JOIN brands b ON b.id = p.brand_id WHERE v.barcode = $1 OR lower(v.sku) = lower($1)`, [code]);
    res.json(v || null);
  }));
  api.post('/products', need('inventory', 'create'), wrap(async (req, res) => {
    must(str(req.body.name), 400, 'Product name is required');
    const out = await tx(async (q) => {
      const pid = id('prd_');
      await q(`INSERT INTO products (name, name_ar, brand_id, category_id, description, description_ar, gender, concentration, notes_top, notes_heart, notes_base, image_url, web_visible, active, id, is_test)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [...productFields(req.body), pid, !!req.body.isTest]);
      const vids = [];
      for (const v of req.body.variants || []) {
        const vid = await saveVariant(q, pid, v);
        vids.push(vid);
        if (Number(v.openingQty) > 0) {
          checkBranch(req, 'inventory', v.branchId || req.body.branchId);
          must(can(req.perms, 'inventory', 'manage'), 403, 'Entering opening stock needs Inventory "manage"');
          await inv.receiveIntoStock(q, { branchId: v.branchId || req.body.branchId, variantId: vid, qty: posInt(v.openingQty), unitCost: money(v.unitCost || 0, 'unit cost'), reason: 'opening', refType: 'opening', userId: req.user.id, batchNo: str(v.batchNo, 60), expiryDate: isoDate(v.expiryDate) });
          const value = posInt(v.openingQty) * money(v.unitCost || 0);
          const { post } = await import('./services/ledger.js');
          await post(q, { memo: `Opening stock ${v.sku}`, sourceType: 'opening', sourceId: vid, branchId: v.branchId || req.body.branchId, userId: req.user.id, isTest: !!req.body.isTest, lines: [{ account: '1200', debit: value }, { account: '3000', credit: value }] });
        }
      }
      return { id: pid, variants: vids };
    });
    res.locals.entityId = out.id;
    res.json(out);
  }));
  api.put('/products/:id', need('inventory', 'edit'), wrap(async (req, res) => {
    await tx(async (q) => {
      const p = await q.one('SELECT id FROM products WHERE id = $1', [req.params.id]);
      must(p, 404, 'Product not found');
      await q(`UPDATE products SET name=$1, name_ar=$2, brand_id=$3, category_id=$4, description=$5, description_ar=$6, gender=$7, concentration=$8, notes_top=$9, notes_heart=$10, notes_base=$11, image_url=$12, web_visible=$13, active=$14, updated_at=now() WHERE id=$15`, [...productFields(req.body), p.id]);
      for (const v of req.body.variants || []) await saveVariant(q, p.id, v, v.id);
    });
    res.json({ ok: true });
  }));

  // ---------- inventory ----------
  api.get('/inventory', needAny(['inventory', 'view'], ['pos', 'view']), wrap(async (req, res) => {
    const sc = scopeOf(req, 'inventory');
    let branchId = req.query.branchId || null;
    if (sc && (!branchId || !sc.includes(branchId))) branchId = sc[0];
    const rows = await inv.stockList(db.query, { branchId, search: str(req.query.search, 80), lowOnly: req.query.low === '1', includeInactive: req.query.all === '1' });
    res.json(rows.map((r) => redactVariant(req, r)));
  }));
  api.get('/inventory/movements', need('inventory', 'view'), wrap(async (req, res) => {
    res.json(await db.query(`SELECT m.*, b.name AS branch, u.name AS user_name FROM stock_movements m JOIN branches b ON b.id = m.branch_id LEFT JOIN users u ON u.id = m.user_id
      WHERE ($1::text IS NULL OR m.variant_id = $1) ORDER BY m.at DESC LIMIT 300`, [req.query.variantId || null]));
  }));
  api.post('/inventory/adjust', need('inventory', 'manage'), wrap(async (req, res) => {
    checkBranch(req, 'inventory', req.body.branchId);
    res.json(await tx((q) => inv.adjust(q, { ...req.body, userId: req.user.id })));
  }));
  api.post('/inventory/receive-opening', need('inventory', 'manage'), wrap(async (req, res) => {
    checkBranch(req, 'inventory', req.body.branchId);
    res.json(await tx(async (q) => {
      const qty = posInt(req.body.qty); const cost = money(req.body.unitCost);
      await inv.receiveIntoStock(q, { branchId: req.body.branchId, variantId: req.body.variantId, qty, unitCost: cost, reason: 'opening', refType: 'opening', userId: req.user.id, batchNo: str(req.body.batchNo, 60), expiryDate: isoDate(req.body.expiryDate) });
      const { post } = await import('./services/ledger.js');
      await post(q, { memo: 'Opening stock', sourceType: 'opening', sourceId: req.body.variantId, branchId: req.body.branchId, userId: req.user.id, lines: [{ account: '1200', debit: qty * cost }, { account: '3000', credit: qty * cost }] });
      return { ok: true };
    }));
  }));
  api.post('/inventory/transfer', need('inventory', 'edit'), wrap(async (req, res) => {
    checkBranch(req, 'inventory', req.body.fromBranch);
    res.json(await tx((q) => inv.transfer(q, { ...req.body, userId: req.user.id })));
  }));
  api.get('/inventory/transfers', need('inventory', 'view'), wrap(async (_req, res) => {
    res.json(await db.query(`SELECT t.*, bf.name AS from_name, bt.name AS to_name, (SELECT json_agg(json_build_object('variant_id', l.variant_id, 'qty', l.qty, 'name', p.name, 'sku', v.sku)) FROM stock_transfer_lines l JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id WHERE l.transfer_id = t.id) AS lines
      FROM stock_transfers t JOIN branches bf ON bf.id = t.from_branch JOIN branches bt ON bt.id = t.to_branch ORDER BY t.created_at DESC LIMIT 100`));
  }));
  api.post('/inventory/counts', need('inventory', 'edit'), wrap(async (req, res) => {
    checkBranch(req, 'inventory', req.body.branchId);
    res.json(await tx((q) => inv.startCount(q, { ...req.body, userId: req.user.id })));
  }));
  api.get('/inventory/counts', need('inventory', 'view'), wrap(async (_req, res) => res.json(await db.query('SELECT c.*, b.name AS branch FROM stock_counts c JOIN branches b ON b.id = c.branch_id ORDER BY c.created_at DESC LIMIT 50'))));
  api.get('/inventory/counts/:id', need('inventory', 'view'), wrap(async (req, res) => {
    const c = await db.one('SELECT * FROM stock_counts WHERE id = $1', [req.params.id]);
    must(c, 404, 'Count not found');
    const lines = await db.query(`SELECT l.*, p.name, b.name AS brand, v.sku, v.barcode, v.size_ml, v.label FROM stock_count_lines l JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN brands b ON b.id = p.brand_id WHERE l.count_id = $1 ORDER BY b.name, p.name`, [c.id]);
    res.json({ ...c, lines });
  }));
  api.post('/inventory/counts/:id/post', need('inventory', 'manage'), wrap(async (req, res) => res.json(await tx((q) => inv.postCount(q, { countId: req.params.id, counts: req.body.counts, userId: req.user.id })))));
  api.get('/inventory/expiring', need('inventory', 'view'), wrap(async (_req, res) => {
    res.json(await db.query(`SELECT bt.*, v.sku, p.name FROM batches bt JOIN variants v ON v.id = bt.variant_id JOIN products p ON p.id = v.product_id WHERE bt.expiry_date IS NOT NULL AND bt.expiry_date <= CURRENT_DATE + 120 ORDER BY bt.expiry_date`));
  }));
  api.get('/inventory/valuation', needAny(['finance', 'view'], ['inventory', 'manage']), wrap(async (_req, res) => {
    res.json(await db.query(`SELECT b.name AS branch, COUNT(DISTINCT s.variant_id)::int AS skus, COALESCE(SUM(s.qty),0)::int AS units, COALESCE(SUM(s.qty * v.avg_cost),0)::bigint AS cost_value, COALESCE(SUM(s.qty * v.retail_price),0)::bigint AS retail_value
      FROM branches b LEFT JOIN stock_levels s ON s.branch_id = b.id AND s.qty > 0 LEFT JOIN variants v ON v.id = s.variant_id GROUP BY b.id, b.name ORDER BY b.name`));
  }));

  // ---------- customers (CRM) ----------
  api.get('/customers', needAny(['customers', 'view'], ['pos', 'view']), wrap(async (req, res) => {
    const s = str(req.query.search, 80);
    const p = s ? ['%' + s.toLowerCase() + '%', s.replace(/\D/g, '') || '§'] : [];
    const rows = await db.query(`SELECT c.*, COALESCE(x.spent,0) AS spent, COALESCE(x.orders,0) AS orders, x.last_purchase FROM customers c
      LEFT JOIN (SELECT customer_id, SUM(total - refunded) AS spent, COUNT(*)::int AS orders, MAX(created_at) AS last_purchase FROM sales WHERE status NOT IN ('pending','cancelled') GROUP BY customer_id) x ON x.customer_id = c.id
      ${s ? "WHERE lower(c.name) LIKE $1 OR c.phone LIKE '%' || $2 || '%' OR lower(COALESCE(c.email,'')) LIKE $1 OR lower(c.code) LIKE $1" : ''} ORDER BY c.created_at DESC LIMIT 200`, p);
    res.json(rows);
  }));
  api.get('/customers/insights', need('customers', 'view'), wrap(async (_req, res) => {
    const birthdays = await db.query("SELECT id, name, phone, birthday FROM customers WHERE birthday IS NOT NULL AND EXTRACT(MONTH FROM birthday) = EXTRACT(MONTH FROM CURRENT_DATE) ORDER BY EXTRACT(DAY FROM birthday)");
    const lapsed = await db.query(`SELECT c.id, c.name, c.phone, MAX(s.created_at) AS last_purchase, COUNT(s.id)::int AS orders FROM customers c JOIN sales s ON s.customer_id = c.id AND s.status NOT IN ('pending','cancelled')
      GROUP BY c.id HAVING MAX(s.created_at) < now() - interval '90 days' ORDER BY MAX(s.created_at) DESC LIMIT 50`);
    const segments = await db.query('SELECT segment, COUNT(*)::int AS n FROM customers GROUP BY segment ORDER BY n DESC');
    const followUps = await db.query(`SELECT i.*, c.name, c.phone FROM customer_interactions i JOIN customers c ON c.id = i.customer_id WHERE i.status = 'open' ORDER BY i.due_date NULLS LAST LIMIT 50`);
    res.json({ birthdays, lapsed, segments, followUps });
  }));
  api.get('/customers/:id', need('customers', 'view'), wrap(async (req, res) => {
    const c = await db.one('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    must(c, 404, 'Customer not found');
    const history = await db.query('SELECT id, number, channel, total, refunded, paid, status, payment_status, created_at FROM sales WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 100', [c.id]);
    const favourites = await db.query(`SELECT p.name, b.name AS brand, SUM(l.qty)::int AS qty FROM sale_lines l JOIN sales s ON s.id = l.sale_id JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
      LEFT JOIN brands b ON b.id = p.brand_id WHERE s.customer_id = $1 GROUP BY p.name, b.name ORDER BY qty DESC LIMIT 5`, [c.id]);
    const interactions = await db.query('SELECT * FROM customer_interactions WHERE customer_id = $1 ORDER BY created_at DESC', [c.id]);
    const loyalty = await db.query('SELECT * FROM loyalty_ledger WHERE customer_id = $1 ORDER BY at DESC LIMIT 50', [c.id]);
    const balance = await partyBalance(db.query, '1100', 'customer', c.id);
    res.json({ ...c, history, favourites, interactions, loyalty, balance, spent: history.filter((h) => !['pending', 'cancelled'].includes(h.status)).reduce((a, h) => a + h.total - h.refunded, 0) });
  }));
  const customerVals = (b) => [str(b.name, 120), str(b.phone, 20)?.replace(/[^\d+]/g, '') || null, str(b.email, 120), isoDate(b.birthday, 'birthday'), str(b.gender, 10), str(b.address), str(b.city, 60), str(b.segment, 30) || 'regular', !!b.vip,
    Array.isArray(b.favouriteBrands) ? b.favouriteBrands.slice(0, 10) : [], str(b.preferences), str(b.notes), !!b.marketingOptIn];
  api.post('/customers', needAny(['customers', 'create'], ['pos', 'create']), wrap(async (req, res) => {
    must(str(req.body.name), 400, 'Customer name is required');
    const out = await tx(async (q) => {
      const cid = id('cus_');
      const { nextNumber } = await import('./util.js');
      const code = await nextNumber(q, 'customer', 'C', 5);
      await q(`INSERT INTO customers (name, phone, email, birthday, gender, address, city, segment, vip, favourite_brands, preferences, notes, marketing_opt_in, id, code, source, is_test)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [...customerVals(req.body), cid, code, str(req.body.source, 30) || 'pos', !!req.body.isTest]);
      return { id: cid, code };
    });
    res.json(out);
  }));
  api.put('/customers/:id', need('customers', 'edit'), wrap(async (req, res) => {
    await db.query(`UPDATE customers SET name=$1, phone=$2, email=$3, birthday=$4, gender=$5, address=$6, city=$7, segment=$8, vip=$9, favourite_brands=$10, preferences=$11, notes=$12, marketing_opt_in=$13, updated_at=now() WHERE id=$14`, [...customerVals(req.body), req.params.id]);
    if (req.body.creditEnabled != null || req.body.creditLimit != null) {
      must(can(req.perms, 'finance', 'edit') || can(req.perms, 'customers', 'approve'), 403, 'Credit accounts need Finance edit or Customers approve permission');
      await db.query('UPDATE customers SET credit_enabled = $1, credit_limit = $2 WHERE id = $3', [!!req.body.creditEnabled, money(req.body.creditLimit || 0), req.params.id]);
    }
    res.json({ ok: true });
  }));
  api.post('/customers/:id/interactions', needAny(['customers', 'create'], ['pos', 'create']), wrap(async (req, res) => {
    must(['note', 'complaint', 'follow_up', 'call', 'whatsapp', 'visit'].includes(req.body.kind), 400, 'Choose a type');
    const iid = id('int_');
    await db.query('INSERT INTO customer_interactions (id, customer_id, kind, subject, body, due_date, assigned_to, created_by, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [iid, req.params.id, req.body.kind, str(req.body.subject, 200), str(req.body.body, 2000), isoDate(req.body.dueDate), req.body.assignedTo || null, req.user.id, ['note', 'call', 'visit'].includes(req.body.kind) ? 'closed' : 'open']);
    res.json({ id: iid });
  }));
  api.put('/interactions/:id', need('customers', 'edit'), wrap(async (req, res) => {
    await db.query("UPDATE customer_interactions SET status = $1, closed_at = CASE WHEN $1 = 'closed' THEN now() ELSE NULL END WHERE id = $2", [req.body.status === 'closed' ? 'closed' : 'open', req.params.id]);
    res.json({ ok: true });
  }));
  api.post('/customers/:id/points', need('customers', 'approve'), wrap(async (req, res) => {
    const pts = int(req.body.points, 'points');
    must(str(req.body.reason), 400, 'Give a reason');
    await tx(async (q) => {
      const c = await q.one('UPDATE customers SET loyalty_points = loyalty_points + $1 WHERE id = $2 AND loyalty_points + $1 >= 0 RETURNING id', [pts, req.params.id]);
      must(c, 400, 'Points cannot go below zero');
      await q("INSERT INTO loyalty_ledger (customer_id, points, reason) VALUES ($1,$2,$3)", [req.params.id, pts, 'manual: ' + str(req.body.reason, 100)]);
    });
    res.json({ ok: true });
  }));

  // ---------- suppliers & purchasing ----------
  api.get('/suppliers', need('purchases', 'view'), wrap(async (req, res) => {
    const rows = await pur.supplierSummary(db.query);
    res.json(can(req.perms, 'finance', 'view') || can(req.perms, 'purchases', 'edit') ? rows : rows.map(({ balance: _b, overdue: _o, ...r }) => r));
  }));
  api.get('/suppliers/:id', need('purchases', 'view'), wrap(async (req, res) => {
    const s = await db.one('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
    must(s, 404, 'Supplier not found');
    const bills = await db.query('SELECT * FROM supplier_bills WHERE supplier_id = $1 ORDER BY bill_date DESC', [s.id]);
    const payments = await db.query('SELECT * FROM supplier_payments WHERE supplier_id = $1 ORDER BY date DESC', [s.id]);
    const orders = await db.query('SELECT * FROM purchase_orders WHERE supplier_id = $1 ORDER BY created_at DESC', [s.id]);
    const returns = await db.query('SELECT * FROM purchase_returns WHERE supplier_id = $1 ORDER BY created_at DESC', [s.id]);
    res.json({ ...s, bills, payments, orders, returns, balance: -(await partyBalance(db.query, '2000', 'supplier', s.id)) });
  }));
  const supplierVals = (b) => [str(b.name, 120), str(b.contactPerson, 80), str(b.phone, 30), str(b.email, 120), str(b.address), str(b.country, 40), str(b.vatNumber, 40), str(b.currency, 3) || 'OMR', int(b.paymentTermsDays ?? 30), money(b.creditLimit || 0), str(b.notes), b.active !== false];
  api.post('/suppliers', need('purchases', 'create'), wrap(async (req, res) => {
    must(str(req.body.name), 400, 'Supplier name is required');
    res.json(await tx(async (q) => {
      const sid = id('sup_');
      const { nextNumber } = await import('./util.js');
      const code = await nextNumber(q, 'supplier', 'S', 4);
      await q('INSERT INTO suppliers (name, contact_person, phone, email, address, country, vat_number, currency, payment_terms_days, credit_limit, notes, active, id, code, is_test) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [...supplierVals(req.body), sid, code, !!req.body.isTest]);
      return { id: sid, code };
    }));
  }));
  api.put('/suppliers/:id', need('purchases', 'edit'), wrap(async (req, res) => {
    await db.query('UPDATE suppliers SET name=$1, contact_person=$2, phone=$3, email=$4, address=$5, country=$6, vat_number=$7, currency=$8, payment_terms_days=$9, credit_limit=$10, notes=$11, active=$12 WHERE id=$13', [...supplierVals(req.body), req.params.id]);
    res.json({ ok: true });
  }));
  api.get('/purchase-orders', need('purchases', 'view'), wrap(async (req, res) => {
    res.json(await db.query(`SELECT po.*, s.name AS supplier, b.name AS branch, u.name AS created_by_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN branches b ON b.id = po.branch_id
      LEFT JOIN users u ON u.id = po.created_by WHERE ($1::text IS NULL OR po.status = $1) ORDER BY po.created_at DESC LIMIT 200`, [req.query.status || null]));
  }));
  api.get('/purchase-orders/:id', need('purchases', 'view'), wrap(async (req, res) => {
    const po = await db.one('SELECT po.*, s.name AS supplier FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = $1', [req.params.id]);
    must(po, 404, 'Purchase order not found');
    const lines = await db.query('SELECT l.*, p.name, b.name AS brand, v.sku, v.size_ml, v.label FROM po_lines l JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN brands b ON b.id = p.brand_id WHERE l.po_id = $1', [po.id]);
    const bills = await db.query('SELECT * FROM supplier_bills WHERE po_id = $1', [po.id]);
    res.json({ ...po, lines, bills });
  }));
  api.post('/purchase-orders', need('purchases', 'create'), wrap(async (req, res) => {
    checkBranch(req, 'purchases', req.body.branchId);
    res.json(await tx((q) => pur.savePO(q, req.body, ctx(req))));
  }));
  api.post('/purchase-orders/:id/submit', need('purchases', 'create'), wrap(async (req, res) => res.json(await tx((q) => pur.submitPO(q, req.params.id, ctx(req))))));
  api.post('/purchase-orders/:id/approve', need('purchases', 'approve'), wrap(async (req, res) => res.json(await tx((q) => pur.decidePO(q, req.params.id, { approve: true, user: req.user })))));
  api.post('/purchase-orders/:id/reject', need('purchases', 'approve'), wrap(async (req, res) => res.json(await tx((q) => pur.decidePO(q, req.params.id, { approve: false, reason: req.body.reason, user: req.user })))));
  api.post('/purchase-orders/:id/cancel', need('purchases', 'edit'), wrap(async (req, res) => res.json(await tx((q) => pur.cancelPO(q, req.params.id, req.body)))));
  api.post('/purchase-orders/:id/receive', need('purchases', 'edit'), wrap(async (req, res) => res.json(await tx((q) => pur.receivePO(q, req.params.id, req.body, ctx(req))))));
  api.get('/supplier-bills', need('purchases', 'view'), wrap(async (_req, res) => {
    res.json(await db.query('SELECT b.*, s.name AS supplier FROM supplier_bills b JOIN suppliers s ON s.id = b.supplier_id ORDER BY b.bill_date DESC LIMIT 300'));
  }));
  api.post('/supplier-payments', needAny(['finance', 'create'], ['purchases', 'approve']), wrap(async (req, res) => res.json(await tx((q) => pur.paySupplier(q, req.body, ctx(req))))));
  api.post('/purchase-returns', need('purchases', 'edit'), wrap(async (req, res) => {
    checkBranch(req, 'purchases', req.body.branchId);
    res.json(await tx((q) => pur.returnToSupplier(q, req.body, ctx(req))));
  }));

  // ---------- promotions ----------
  const promoVals = (b) => {
    must(['percent', 'fixed', 'buy_x_get_y', 'bundle_price', 'fixed_price'].includes(b.type), 400, 'Choose the offer type');
    must(str(b.name), 400, 'Name the offer');
    if (b.type === 'percent') must(Number(b.value) > 0 && Number(b.value) <= 10000, 400, 'Percentage must be between 0 and 100');
    if (b.type === 'buy_x_get_y') must(Number(b.buyQty) > 0 && Number(b.getQty) > 0, 400, 'Enter how many to buy and how many free');
    if (b.endsAt && b.startsAt) must(new Date(b.endsAt) > new Date(b.startsAt), 400, 'The end must be after the start');
    const arr = (x) => (Array.isArray(x) ? x.map(String).slice(0, 500) : []);
    return [str(b.name, 120), str(b.description, 1000), b.type, int(b.value || 0), b.buyQty ? int(b.buyQty) : null, b.getQty ? int(b.getQty) : null, b.bundleQty ? int(b.bundleQty) : null,
      b.scope === 'order' ? 'order' : 'items', arr(b.productIds), arr(b.variantIds), arr(b.categoryIds), arr(b.brandIds), arr(b.channels).length ? arr(b.channels) : ['pos', 'web', 'whatsapp', 'instagram'],
      arr(b.branchIds).length ? arr(b.branchIds) : null, b.audience || 'all', arr(b.customerIds), str(b.segment, 30), str(b.couponCode, 30)?.toUpperCase() || null, money(b.minPurchase || 0),
      b.maxDiscount != null && b.maxDiscount !== '' ? money(b.maxDiscount) : null, b.startsAt || null, b.endsAt || null, b.usageLimit ? int(b.usageLimit) : null, !!b.stackable, int(b.priority || 0)];
  };
  api.get('/promotions', needAny(['promotions', 'view'], ['pos', 'view']), wrap(async (_req, res) => {
    res.json(await db.query(`SELECT p.*, (SELECT COUNT(*)::int FROM sales s WHERE p.id = ANY(s.promotion_ids) AND s.status NOT IN ('pending','cancelled')) AS orders,
      (SELECT COALESCE(SUM(s.total - s.refunded),0) FROM sales s WHERE p.id = ANY(s.promotion_ids) AND s.status NOT IN ('pending','cancelled')) AS revenue,
      (SELECT COALESCE(SUM(l.discount),0) FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE l.promotion_id = p.id AND s.status NOT IN ('pending','cancelled')) AS discount_given,
      CASE WHEN p.status = 'approved' AND p.ends_at IS NOT NULL AND p.ends_at < now() THEN 'expired' WHEN p.status = 'approved' AND p.starts_at > now() THEN 'scheduled' WHEN p.status = 'approved' THEN 'active' ELSE p.status END AS state
      FROM promotions p ORDER BY p.created_at DESC`));
  }));
  api.post('/promotions', need('promotions', 'create'), wrap(async (req, res) => {
    const pid = id('prm_');
    await db.query(`INSERT INTO promotions (name, description, type, value, buy_qty, get_qty, bundle_qty, scope, product_ids, variant_ids, category_ids, brand_ids, channels, branch_ids, audience, customer_ids, segment, coupon_code, min_purchase, max_discount, starts_at, ends_at, usage_limit, stackable, priority, id, created_by, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'draft')`, [...promoVals(req.body), pid, req.user.id]);
    res.json({ id: pid });
  }));
  api.put('/promotions/:id', need('promotions', 'edit'), wrap(async (req, res) => {
    // editing an approved offer sends it back for approval, so a live discount can't be changed silently
    await db.query(`UPDATE promotions SET name=$1, description=$2, type=$3, value=$4, buy_qty=$5, get_qty=$6, bundle_qty=$7, scope=$8, product_ids=$9, variant_ids=$10, category_ids=$11, brand_ids=$12, channels=$13, branch_ids=$14, audience=$15, customer_ids=$16, segment=$17, coupon_code=$18, min_purchase=$19, max_discount=$20, starts_at=$21, ends_at=$22, usage_limit=$23, stackable=$24, priority=$25,
      status = CASE WHEN status = 'approved' THEN 'pending_approval' ELSE status END, approved_by = NULL WHERE id = $26`, [...promoVals(req.body), req.params.id]);
    res.json({ ok: true });
  }));
  api.post('/promotions/:id/submit', need('promotions', 'create'), wrap(async (req, res) => {
    const p = await db.one("UPDATE promotions SET status = 'pending_approval' WHERE id = $1 AND status IN ('draft','disabled') RETURNING name", [req.params.id]);
    must(p, 409, 'Only a draft or disabled offer can be submitted');
    await notify(db.query, { kind: 'promotion_approval', title: `Offer “${p.name}” needs approval`, roles: ['owner', 'admin'], entity: 'promotion', entityId: req.params.id });
    res.json({ ok: true });
  }));
  api.post('/promotions/:id/approve', need('promotions', 'approve'), wrap(async (req, res) => {
    const p = await db.one('SELECT * FROM promotions WHERE id = $1', [req.params.id]);
    must(p && p.status === 'pending_approval', 409, 'This offer is not waiting for approval');
    if (p.stackable) must(req.user.role === 'owner' || req.user.role === 'admin', 403, 'Only the owner can approve an offer that combines with other offers');
    await db.query("UPDATE promotions SET status = 'approved', approved_by = $1, approved_at = now() WHERE id = $2", [req.user.id, p.id]);
    res.json({ ok: true });
  }));
  api.post('/promotions/:id/disable', need('promotions', 'edit'), wrap(async (req, res) => {
    await db.query("UPDATE promotions SET status = 'disabled' WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  }));

  // ---------- POS, sales & orders ----------
  api.post('/pos/quote', needAny(['pos', 'create'], ['sales', 'create']), wrap(async (req, res) => {
    checkBranch(req, 'pos', req.body.branchId);
    const r = await sales.quote(db.query, req.body, ctx(req));
    const { settings: _s, customer, ...rest } = r;
    res.json({ ...rest, customer: customer && { id: customer.id, name: customer.name, phone: customer.phone, vip: customer.vip, loyaltyPoints: customer.loyalty_points, creditEnabled: customer.credit_enabled }, lines: rest.lines.map((l) => (canSeeCost(req.perms) ? l : { ...l, unitCost: undefined })) });
  }));
  api.post('/pos/checkout', need('pos', 'create'), wrap(async (req, res) => {
    checkBranch(req, 'pos', req.body.branchId);
    const out = await tx((q) => sales.checkout(q, req.body, ctx(req)));
    res.locals.entityId = out.id;
    res.json(out);
  }));
  const saleScope = (req) => scopeOf(req, 'sales');
  api.get('/sales', needAny(['sales', 'view'], ['pos', 'view']), wrap(async (req, res) => {
    const p = [req.query.from || '2000-01-01', req.query.to || today()];
    const where = ['s.created_at::date BETWEEN $1 AND $2'];
    const add = (sql, v) => { p.push(v); where.push(sql.replace('?', '$' + p.length)); };
    if (req.query.channel) add('s.channel = ?', req.query.channel);
    if (req.query.status) add('s.status = ?', req.query.status);
    if (req.query.customerId) add('s.customer_id = ?', req.query.customerId);
    if (req.query.search) add("(s.number ILIKE '%' || ? || '%')", String(req.query.search));
    const sc = saleScope(req); if (sc) add('s.branch_id = ANY(?)', sc);
    if (!can(req.perms, 'sales', 'view')) add('s.cashier_id = ?', req.user.id); // cashiers see their own sales
    if (req.query.test !== 'all') where.push(req.query.test === '1' ? 's.is_test' : 'true');
    const rows = await db.query(`SELECT s.id, s.number, s.channel, s.status, s.payment_status, s.fulfilment_status, s.total, s.paid, s.refunded, s.discount, s.vat, s.created_at, s.is_test, s.branch_id,
      c.name AS customer, c.phone AS customer_phone, u.name AS cashier ${canSeeCost(req.perms) ? ', s.cost, s.net' : ''} FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.cashier_id
      WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC LIMIT 500`, p);
    res.json(rows);
  }));
  api.get('/sales/:id', needAny(['sales', 'view'], ['pos', 'view']), wrap(async (req, res) => {
    const s = await db.one('SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, u.name AS cashier_name, b.name AS branch_name FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.cashier_id JOIN branches b ON b.id = s.branch_id WHERE s.id = $1', [req.params.id]);
    must(s, 404, 'Sale not found');
    if (!can(req.perms, 'sales', 'view')) must(s.cashier_id === req.user.id, 403, 'You can only open your own sales');
    const lines = await db.query('SELECT l.*, p.name, p.name_ar, b.name AS brand, v.sku, v.size_ml, v.label FROM sale_lines l JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN brands b ON b.id = p.brand_id WHERE l.sale_id = $1 ORDER BY l.id', [s.id]);
    const payments = await db.query('SELECT id, direction, method, amount, status, provider, reference, at FROM payments WHERE sale_id = $1 ORDER BY at', [s.id]);
    const refunds = await db.query('SELECT r.*, u.name AS approved_by_name FROM refunds r LEFT JOIN users u ON u.id = r.approved_by WHERE r.sale_id = $1 ORDER BY r.created_at', [s.id]);
    const delivery = await db.one('SELECT * FROM deliveries WHERE sale_id = $1', [s.id]);
    const cost = canSeeCost(req.perms);
    res.json({ ...s, cost: cost ? s.cost : undefined, lines: lines.map((l) => (cost ? l : { ...l, unit_cost: undefined })), payments, refunds, delivery });
  }));
  api.post('/sales/:id/payments', needAny(['pos', 'create'], ['payments', 'create'], ['sales', 'edit']), wrap(async (req, res) => res.json(await tx((q) => sales.recordPayment(q, req.params.id, req.body, ctx(req))))));

  // refunds & cancellations: executed directly with POS "approve", otherwise queued for approval
  async function requestApproval(req, kind, entity, entityId, payload, title) {
    const aid = id('apr_');
    await db.query('INSERT INTO approvals (id, kind, entity, entity_id, payload, requested_by) VALUES ($1,$2,$3,$4,$5,$6)', [aid, kind, entity, entityId, JSON.stringify(payload), req.user.id]);
    await notify(db.query, { kind: 'approval', title, body: `Requested by ${req.user.name}`, roles: ['owner', 'admin', 'manager'], entity: 'approval', entityId: aid });
    return { approvalId: aid, status: 'pending_approval' };
  }
  const APPROVAL_RUN = {
    refund: (q, a, user) => sales.refund(q, a.entity_id, { ...a.payload, approvedBy: user.id, requestedBy: a.requested_by }, { user }),
    cancel_sale: (q, a, user) => sales.cancelSale(q, a.entity_id, { ...a.payload, approvedBy: user.id, requestedBy: a.requested_by }, { user }),
  };
  api.post('/sales/:id/refund', needAny(['pos', 'create'], ['sales', 'edit']), wrap(async (req, res) => {
    if (!can(req.perms, 'pos', 'approve')) return res.json(await requestApproval(req, 'refund', 'sale', req.params.id, req.body, 'Refund waiting for approval'));
    res.json(await tx((q) => sales.refund(q, req.params.id, req.body, ctx(req))));
  }));
  api.post('/sales/:id/cancel', needAny(['pos', 'create'], ['sales', 'edit']), wrap(async (req, res) => {
    must(str(req.body.reason), 400, 'Give a reason');
    if (!can(req.perms, 'pos', 'approve')) return res.json(await requestApproval(req, 'cancel_sale', 'sale', req.params.id, req.body, 'Sale cancellation waiting for approval'));
    res.json(await tx((q) => sales.cancelSale(q, req.params.id, req.body, ctx(req))));
  }));
  api.get('/approvals', needAny(['pos', 'approve'], ['sales', 'approve'], ['purchases', 'approve'], ['promotions', 'approve']), wrap(async (req, res) => {
    res.json(await db.query(`SELECT a.*, u.name AS requested_by_name, d.name AS decided_by_name, s.number AS sale_number, s.total AS sale_total FROM approvals a LEFT JOIN users u ON u.id = a.requested_by LEFT JOIN users d ON d.id = a.decided_by
      LEFT JOIN sales s ON a.entity = 'sale' AND s.id = a.entity_id WHERE ($1::text IS NULL OR a.status = $1) ORDER BY a.requested_at DESC LIMIT 200`, [req.query.status || null]));
  }));
  api.post('/approvals/:id/:decision', need('pos', 'approve'), wrap(async (req, res) => {
    const a = await db.one('SELECT * FROM approvals WHERE id = $1', [req.params.id]);
    must(a && a.status === 'pending', 409, 'This request is not pending');
    if (req.params.decision === 'reject') {
      await db.query("UPDATE approvals SET status = 'rejected', decided_by = $1, decided_at = now(), reason = $2 WHERE id = $3", [req.user.id, str(req.body.reason), a.id]);
      return res.json({ status: 'rejected' });
    }
    must(req.params.decision === 'approve', 400, 'Approve or reject');
    must(a.requested_by !== req.user.id || req.user.role === 'owner', 403, 'You cannot approve your own request');
    const run = APPROVAL_RUN[a.kind];
    must(run, 400, 'Unknown request type');
    const result = await tx(async (q) => {
      const r = await run(q, a, req.user);
      await q("UPDATE approvals SET status = 'executed', decided_by = $1, decided_at = now(), result = $2 WHERE id = $3", [req.user.id, JSON.stringify(r), a.id]);
      return r;
    });
    res.json({ status: 'executed', result });
  }));

  const orderNeed = (req, _res, next) => {
    const ch = req.body.channel;
    const mod = ch === 'web' ? 'online' : ch === 'whatsapp' ? 'whatsapp' : 'sales';
    return can(req.perms, mod, 'create') || can(req.perms, 'sales', 'create') ? next() : next(new HttpError(403, 'You cannot create orders for this channel'));
  };
  api.post('/orders', orderNeed, wrap(async (req, res) => {
    checkBranch(req, 'sales', req.body.branchId);
    res.json(await tx((q) => sales.createOrder(q, req.body, ctx(req))));
  }));
  api.post('/orders/:id/confirm', needAny(['sales', 'edit'], ['online', 'edit'], ['whatsapp', 'edit']), wrap(async (req, res) => res.json(await tx((q) => sales.confirmOrder(q, req.params.id, ctx(req))))));
  api.post('/orders/:id/fulfil', needAny(['sales', 'edit'], ['online', 'edit'], ['whatsapp', 'edit']), wrap(async (req, res) => res.json(await tx((q) => sales.setFulfilment(q, req.params.id, req.body.status, { user: req.user, tracking: str(req.body.tracking, 60), courier: str(req.body.courier, 60) })))));

  // ---------- finance ----------
  api.get('/accounts', need('finance', 'view'), wrap(async (req, res) => res.json(await balances(db.query, { from: req.query.from, to: req.query.to }))));
  api.get('/accounts/list', needAny(['finance', 'view'], ['purchases', 'view']), wrap(async (_req, res) => res.json(await db.query('SELECT id, code, name, type, subtype FROM accounts WHERE active ORDER BY code'))));
  api.post('/accounts', need('finance', 'manage'), wrap(async (req, res) => {
    must(['asset', 'liability', 'equity', 'income', 'expense'].includes(req.body.type), 400, 'Choose the account type');
    const code = String(req.body.code || '').trim();
    must(/^\d{3,6}$/.test(code), 400, 'Account code must be 3–6 digits');
    await db.query('INSERT INTO accounts (id, code, name, type, subtype, currency) VALUES ($1,$2,$3,$4,$5,$6)', ['acc_' + code, code, str(req.body.name, 100), req.body.type, str(req.body.subtype, 30) || (req.body.type === 'expense' ? 'operating' : 'other'), str(req.body.currency, 3) || 'OMR']);
    res.json({ id: 'acc_' + code });
  }));
  api.get('/expenses', need('finance', 'view'), wrap(async (req, res) => {
    res.json(await db.query(`SELECT e.*, a.name AS category, pf.name AS paid_from_name, b.name AS branch FROM expenses e JOIN accounts a ON a.id = e.account_id JOIN accounts pf ON pf.id = e.paid_from LEFT JOIN branches b ON b.id = e.branch_id
      WHERE e.date BETWEEN $1 AND $2 ORDER BY e.date DESC, e.created_at DESC LIMIT 500`, [req.query.from || '2000-01-01', req.query.to || today()]));
  }));
  api.post('/expenses', need('finance', 'create'), wrap(async (req, res) => res.json(await tx((q) => fin.createExpense(q, req.body, ctx(req))))));
  api.post('/expenses/:id/reverse', need('finance', 'approve'), wrap(async (req, res) => res.json(await tx((q) => fin.reverseExpense(q, req.params.id, { user: req.user, reason: req.body.reason })))));
  api.post('/journal', need('finance', 'manage'), wrap(async (req, res) => res.json(await tx((q) => fin.journalEntry(q, req.body, ctx(req))))));
  api.post('/journal/:id/reverse', need('finance', 'manage'), wrap(async (req, res) => {
    const { reverse } = await import('./services/ledger.js');
    const e = await db.one('SELECT source_type FROM journal_entries WHERE id = $1', [req.params.id]);
    must(e, 404, 'Entry not found');
    must(e.source_type === 'manual', 409, 'Only manual journal entries can be reversed here. Correct sales, purchases and expenses from their own screens.');
    res.json({ id: await tx((q) => reverse(q, req.params.id, { userId: req.user.id, memo: str(req.body.reason) })) });
  }));
  api.get('/journal', need('finance', 'view'), wrap(async (req, res) => {
    res.json(await db.query(`SELECT e.*, u.name AS created_by_name, (SELECT json_agg(json_build_object('account', a.code || ' ' || a.name, 'debit', l.debit, 'credit', l.credit) ORDER BY l.id) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = e.id) AS lines
      FROM journal_entries e LEFT JOIN users u ON u.id = e.created_by WHERE e.date BETWEEN $1 AND $2 ORDER BY e.date DESC, e.created_at DESC LIMIT 300`, [req.query.from || '2000-01-01', req.query.to || today()]));
  }));
  const range = (req) => ({ from: isoDate(req.query.from) || today().slice(0, 8) + '01', to: isoDate(req.query.to) || today() });
  api.get('/reports/pl', need('finance', 'view'), wrap(async (req, res) => res.json(await fin.profitLoss(db.query, { ...range(req), branchId: req.query.branchId || null }))));
  api.get('/reports/balance-sheet', need('finance', 'view'), wrap(async (req, res) => res.json(await fin.balanceSheet(db.query, { asOf: isoDate(req.query.asOf) || today() }))));
  api.get('/reports/trial-balance', need('finance', 'view'), wrap(async (req, res) => res.json(await fin.trialBalance(db.query, { asOf: isoDate(req.query.asOf) || today() }))));
  api.get('/reports/cash-flow', need('finance', 'view'), wrap(async (req, res) => res.json(await fin.cashFlow(db.query, range(req)))));
  api.get('/reports/ledger', need('finance', 'view'), wrap(async (req, res) => res.json(await fin.generalLedger(db.query, { accountId: req.query.accountId, ...range(req) }))));
  api.get('/reports/vat', need('finance', 'view'), wrap(async (req, res) => res.json(await fin.vatReport(db.query, range(req)))));
  api.get('/finance/position', need('finance', 'view'), wrap(async (_req, res) => res.json(await fin.moneyPosition(db.query))));

  // ---------- dashboard, assistant, notifications ----------
  api.get('/dashboard', needAny(['dashboard', 'view'], ['sales', 'view']), wrap(async (req, res) => {
    const sc = scopeOf(req, 'dashboard');
    const pick = req.query.branchId ? [String(req.query.branchId)] : null;
    if (pick && sc) must(sc.includes(pick[0]), 403, 'You do not have access to this branch');
    res.json(await dashboard(db.query, { branchIds: pick || sc, showMoney: can(req.perms, 'finance', 'view') }));
  }));
  api.post('/assistant', needAny(['assistant', 'view'], ['dashboard', 'view']), wrap(async (req, res) => {
    const question = str(req.body.question, 500);
    must(question, 400, 'Ask a question');
    const r = await ask(db.query, question, ctx(req));
    void audit(req, 'assistant', 'assistant', null, { question });
    res.json(r);
  }));
  api.get('/notifications', wrap(async (req, res) => res.json(await listFor(db.query, req.user))));
  api.post('/notifications/:id/read', wrap(async (req, res) => {
    await db.query('UPDATE notifications SET read_by = array_append(read_by, $1) WHERE id = $2 AND NOT ($1 = ANY(read_by))', [req.user.id, req.params.id]);
    res.json({ ok: true });
  }));
  api.get('/audit', need('audit', 'view'), wrap(async (req, res) => {
    const p = [req.query.from || '2000-01-01', (req.query.to || today()) + 'T23:59:59Z'];
    let extra = '';
    if (req.query.userId) { p.push(req.query.userId); extra += ` AND user_id = $${p.length}`; }
    if (req.query.role) { p.push(req.query.role); extra += ` AND user_role = $${p.length}`; }
    if (req.query.app) { p.push(req.query.app); extra += ` AND app = $${p.length}`; }
    res.json(await db.query(`SELECT * FROM audit_log WHERE at BETWEEN $1 AND $2 ${extra} ORDER BY at DESC LIMIT 500`, p));
  }));

  // ---------- HR & staff ----------
  const showPay = (req) => can(req.perms, 'hr', 'view');
  const employeeOut = (req, e) => {
    if (!e) return e;
    const out = { ...e, bank_iban: showPay(req) ? mask(unseal(e.bank_iban)) : undefined, id_number: showPay(req) ? mask(unseal(e.id_number)) : undefined };
    if (!showPay(req)) for (const k of ['basic_salary', 'housing_allowance', 'transport_allowance', 'other_allowance']) delete out[k];
    return out;
  };
  api.get('/employees', needAny(['hr', 'view'], ['staff', 'view']), wrap(async (req, res) => res.json((await db.query('SELECT e.*, b.name AS branch FROM employees e LEFT JOIN branches b ON b.id = e.branch_id ORDER BY e.name')).map((e) => employeeOut(req, e)))));
  const empVals = (b) => [str(b.name, 100), str(b.phone, 30), str(b.email, 120), str(b.nationality, 40), str(b.jobTitle, 60), str(b.department, 60), b.branchId || null, isoDate(b.joiningDate), isoDate(b.probationEnd),
    b.status || 'active', money(b.basicSalary || 0), money(b.housingAllowance || 0), money(b.transportAllowance || 0), money(b.otherAllowance || 0), str(b.workSchedule, 200), int(b.annualLeaveDays ?? 30), money(b.salesTarget || 0), isoDate(b.idExpiry), isoDate(b.passportExpiry)];
  api.post('/employees', need('hr', 'create'), wrap(async (req, res) => {
    must(str(req.body.name), 400, 'Name is required');
    res.json(await tx(async (q) => {
      const eid = id('emp_');
      const { nextNumber } = await import('./util.js');
      const code = await nextNumber(q, 'employee', 'EMP', 4);
      await q(`INSERT INTO employees (name, phone, email, nationality, job_title, department, branch_id, joining_date, probation_end, status, basic_salary, housing_allowance, transport_allowance, other_allowance, work_schedule, annual_leave_days, sales_target, id_expiry, passport_expiry, id, code, bank_iban, id_number, is_test)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`, [...empVals(req.body), eid, code, seal(str(req.body.bankIban, 40)), seal(str(req.body.idNumber, 40)), !!req.body.isTest]);
      return { id: eid, code };
    }));
  }));
  api.put('/employees/:id', need('hr', 'edit'), wrap(async (req, res) => {
    await db.query(`UPDATE employees SET name=$1, phone=$2, email=$3, nationality=$4, job_title=$5, department=$6, branch_id=$7, joining_date=$8, probation_end=$9, status=$10, basic_salary=$11, housing_allowance=$12, transport_allowance=$13, other_allowance=$14, work_schedule=$15, annual_leave_days=$16, sales_target=$17, id_expiry=$18, passport_expiry=$19 WHERE id=$20`, [...empVals(req.body), req.params.id]);
    if (req.body.bankIban) await db.query('UPDATE employees SET bank_iban = $1 WHERE id = $2', [seal(str(req.body.bankIban, 40)), req.params.id]);
    if (req.body.idNumber) await db.query('UPDATE employees SET id_number = $1 WHERE id = $2', [seal(str(req.body.idNumber, 40)), req.params.id]);
    res.json({ ok: true });
  }));
  api.get('/attendance', needAny(['hr', 'view'], ['staff', 'view']), wrap(async (req, res) => {
    res.json(await db.query(`SELECT a.*, e.name, e.code FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.date BETWEEN $1 AND $2 ORDER BY a.date DESC, e.name`, [req.query.from || today(), req.query.to || today()]));
  }));
  api.post('/attendance', needAny(['hr', 'edit'], ['staff', 'edit']), wrap(async (req, res) => {
    await db.query(`INSERT INTO attendance (id, employee_id, date, status, overtime_minutes, note) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (employee_id, date) DO UPDATE SET status = excluded.status, overtime_minutes = excluded.overtime_minutes, note = excluded.note`,
    [id('att_'), req.body.employeeId, isoDate(req.body.date) || today(), req.body.status || 'present', int(req.body.overtimeMinutes || 0), str(req.body.note)]);
    res.json({ ok: true });
  }));
  api.get('/leave', needAny(['hr', 'view'], ['staff', 'view']), wrap(async (_req, res) => res.json(await db.query('SELECT l.*, e.name, e.code FROM leave_requests l JOIN employees e ON e.id = l.employee_id ORDER BY l.created_at DESC LIMIT 200'))));
  api.post('/leave/:id/decide', needAny(['hr', 'approve'], ['staff', 'approve']), wrap(async (req, res) => {
    const st = req.body.approve ? 'approved' : 'rejected';
    const l = await db.one("UPDATE leave_requests SET status = $1, decided_by = $2, decided_at = now() WHERE id = $3 AND status = 'pending' RETURNING *", [st, req.user.id, req.params.id]);
    must(l, 409, 'This request is not pending');
    res.json({ ok: true });
  }));
  api.get('/announcements', wrap(async (_req, res) => res.json(await db.query('SELECT a.*, u.name AS author FROM announcements a LEFT JOIN users u ON u.id = a.created_by ORDER BY created_at DESC LIMIT 50'))));
  api.post('/announcements', needAny(['hr', 'create'], ['staff', 'create']), wrap(async (req, res) => {
    await db.query('INSERT INTO announcements (id, title, body, branch_id, created_by) VALUES ($1,$2,$3,$4,$5)', [id('ann_'), str(req.body.title, 160), str(req.body.body, 4000), req.body.branchId || null, req.user.id]);
    res.json({ ok: true });
  }));

  // ---------- staff self-service: only the signed-in person's own records ----------
  const myEmployee = async (req) => {
    must(req.user.employee_id, 404, 'Your login is not linked to an employee profile. Ask HR to link it.');
    return db.one('SELECT * FROM employees WHERE id = $1', [req.user.employee_id]);
  };
  api.get('/me/profile', wrap(async (req, res) => {
    const e = req.user.employee_id ? await db.one('SELECT e.*, b.name AS branch FROM employees e LEFT JOIN branches b ON b.id = e.branch_id WHERE e.id = $1', [req.user.employee_id]) : null;
    res.json({ user: { name: req.user.name, username: req.user.username, role: req.user.role }, employee: e && { ...e, bank_iban: mask(unseal(e.bank_iban)), id_number: mask(unseal(e.id_number)) } });
  }));
  api.post('/me/check-in', wrap(async (req, res) => {
    const e = await myEmployee(req);
    const r = await db.one(`INSERT INTO attendance (id, employee_id, date, check_in, status) VALUES ($1,$2,CURRENT_DATE,now(),'present')
      ON CONFLICT (employee_id, date) DO UPDATE SET check_in = COALESCE(attendance.check_in, now()) RETURNING *`, [id('att_'), e.id]);
    res.json(r);
  }));
  api.post('/me/check-out', wrap(async (req, res) => {
    const e = await myEmployee(req);
    const r = await db.one('UPDATE attendance SET check_out = now() WHERE employee_id = $1 AND date = CURRENT_DATE AND check_in IS NOT NULL RETURNING *', [e.id]);
    must(r, 409, 'Check in first');
    res.json(r);
  }));
  api.get('/me/attendance', wrap(async (req, res) => { const e = await myEmployee(req); res.json(await db.query('SELECT * FROM attendance WHERE employee_id = $1 ORDER BY date DESC LIMIT 62', [e.id])); }));
  api.get('/me/leave', wrap(async (req, res) => { const e = await myEmployee(req); res.json(await db.query('SELECT * FROM leave_requests WHERE employee_id = $1 ORDER BY created_at DESC', [e.id])); }));
  api.post('/me/leave', wrap(async (req, res) => {
    const e = await myEmployee(req);
    const from = isoDate(req.body.fromDate, 'from'), to = isoDate(req.body.toDate, 'to');
    must(from && to && to >= from, 400, 'Choose valid dates');
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400e3) + 1;
    const lid = id('lv_');
    await db.query('INSERT INTO leave_requests (id, employee_id, kind, from_date, to_date, days, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)', [lid, e.id, str(req.body.kind, 30) || 'annual', from, to, days, str(req.body.reason)]);
    await notify(db.query, { kind: 'leave_request', title: `Leave request from ${e.name}`, body: `${days} day(s) from ${from}`, roles: ['owner', 'admin', 'hr', 'manager'], entity: 'leave', entityId: lid });
    res.json({ id: lid });
  }));
  api.get('/me/sales', wrap(async (req, res) => {
    const m = today().slice(0, 8) + '01';
    const r = await db.one(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(total - refunded),0) AS total FROM sales WHERE cashier_id = $1 AND created_at::date >= $2 AND status NOT IN ('pending','cancelled')`, [req.user.id, m]);
    const target = req.user.employee_id ? (await db.one('SELECT sales_target FROM employees WHERE id = $1', [req.user.employee_id]))?.sales_target : 0;
    res.json({ ...r, target, since: m });
  }));

  // ---------- integrations: honest connection status ----------
  api.get('/integrations', need('settings', 'view'), (_req, res) => {
    const has = (...k) => k.every((x) => !!process.env[x]);
    res.json([
      { key: 'whatsapp', name: 'WhatsApp Business Cloud API (Meta)', connected: has('WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID'), needs: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_VERIFY_TOKEN', 'approved message templates'], status: 'Order capture inside the app works now; automatic messaging needs Meta credentials and is not yet tested end-to-end.' },
      { key: 'gateway', name: 'Online card payments (e.g. Thawani, OmanNet / bank gateway)', connected: has('PAYMENT_GATEWAY', 'PAYMENT_GATEWAY_KEY'), needs: ['merchant account', 'API keys', 'webhook URL'], status: 'Card payments at the till are recorded with the terminal approval code. Online payment links need a gateway account.' },
      { key: 'instagram', name: 'Instagram / Facebook (Meta Graph API)', connected: has('META_APP_ID', 'META_APP_SECRET'), needs: ['Meta app review', 'page access token'], status: 'Orders from Instagram can be entered as Instagram-channel orders and are tracked separately.' },
      { key: 'snapchat', name: 'Snapchat Marketing API', connected: has('SNAP_CLIENT_ID'), needs: ['Snap business account', 'OAuth app'], status: 'Not connected.' },
      { key: 'email', name: 'Email (SMTP) for reports', connected: has('SMTP_HOST'), needs: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'], status: 'Not connected.' },
    ]);
  });

  // ---------- exports (CSV / Excel); PDF is printed from each report screen ----------
  const EXPORTS = {
    sales: { module: 'sales', sql: `SELECT s.number, s.created_at::date::text AS date, s.channel, b.name AS branch, c.name AS customer, u.name AS cashier, s.status, s.payment_status, s.subtotal/1000.0 AS subtotal, s.discount/1000.0 AS discount, s.net/1000.0 AS net, s.vat/1000.0 AS vat, s.total/1000.0 AS total, s.refunded/1000.0 AS refunded, s.is_test
      FROM sales s JOIN branches b ON b.id = s.branch_id LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.cashier_id WHERE s.created_at::date BETWEEN $1 AND $2 ORDER BY s.created_at` },
    'sale-lines': { module: 'sales', sql: `SELECT s.number, s.created_at::date::text AS date, s.channel, br.name AS brand, p.name AS product, v.sku, v.size_ml, l.qty, l.refunded_qty, l.unit_price/1000.0 AS unit_price, l.discount/1000.0 AS discount, l.vat/1000.0 AS vat, l.total/1000.0 AS total
      FROM sale_lines l JOIN sales s ON s.id = l.sale_id JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN brands br ON br.id = p.brand_id WHERE s.created_at::date BETWEEN $1 AND $2 ORDER BY s.created_at` },
    inventory: { module: 'inventory', sql: `SELECT b.name AS branch, br.name AS brand, p.name AS product, v.sku, v.barcode, v.size_ml, s.qty, v.min_stock, v.retail_price/1000.0 AS retail_price FROM stock_levels s JOIN branches b ON b.id = s.branch_id JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN brands br ON br.id = p.brand_id WHERE $1::text IS NOT NULL AND $2::text IS NOT NULL ORDER BY b.name, br.name, p.name` },
    'inventory-valuation': { module: 'finance', sql: `SELECT b.name AS branch, br.name AS brand, p.name AS product, v.sku, s.qty, v.avg_cost/1000.0 AS avg_cost, (s.qty * v.avg_cost)/1000.0 AS value FROM stock_levels s JOIN branches b ON b.id = s.branch_id JOIN variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id LEFT JOIN brands br ON br.id = p.brand_id WHERE s.qty <> 0 AND $1::text IS NOT NULL AND $2::text IS NOT NULL ORDER BY value DESC` },
    purchases: { module: 'purchases', sql: `SELECT b.number, b.bill_date::text AS date, s.name AS supplier, b.supplier_ref, b.goods/1000.0 AS goods, b.landed_cost/1000.0 AS landed_cost, b.vat/1000.0 AS vat, b.total/1000.0 AS total, b.paid/1000.0 AS paid, b.returned/1000.0 AS returned, b.status, b.due_date::text AS due_date FROM supplier_bills b JOIN suppliers s ON s.id = b.supplier_id WHERE b.bill_date BETWEEN $1 AND $2 ORDER BY b.bill_date` },
    expenses: { module: 'finance', sql: `SELECT e.number, e.date::text AS date, a.name AS category, e.payee, e.description, e.amount/1000.0 AS amount, e.vat/1000.0 AS vat, pf.name AS paid_from, e.status FROM expenses e JOIN accounts a ON a.id = e.account_id JOIN accounts pf ON pf.id = e.paid_from WHERE e.date BETWEEN $1 AND $2 ORDER BY e.date` },
    customers: { module: 'customers', sql: `SELECT c.code, c.name, c.phone, c.email, c.city, c.segment, c.vip, c.loyalty_points, c.created_at::date::text AS since, (SELECT COALESCE(SUM(total - refunded),0)/1000.0 FROM sales s WHERE s.customer_id = c.id AND s.status NOT IN ('pending','cancelled')) AS spent FROM customers c WHERE $1::text IS NOT NULL AND $2::text IS NOT NULL ORDER BY c.name` },
    suppliers: { module: 'purchases', sql: `SELECT s.code, s.name, s.phone, s.email, s.country, s.currency, s.payment_terms_days, COALESCE((SELECT SUM(credit - debit) FROM journal_lines WHERE account_id = 'acc_2000' AND party_type = 'supplier' AND party_id = s.id),0)/1000.0 AS balance FROM suppliers s WHERE $1::text IS NOT NULL AND $2::text IS NOT NULL ORDER BY s.name` },
    'staff-sales': { module: 'sales', sql: `SELECT COALESCE(u.name,'Online / unassigned') AS staff, COUNT(*) AS orders, SUM(s.total - s.refunded)/1000.0 AS sales FROM sales s LEFT JOIN users u ON u.id = s.cashier_id WHERE s.status NOT IN ('pending','cancelled') AND s.created_at::date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 3 DESC` },
    payments: { module: 'payments', sql: `SELECT p.at::text AS at, s.number AS sale, p.direction, p.method, p.amount/1000.0 AS amount, p.status, p.provider, p.reference FROM payments p LEFT JOIN sales s ON s.id = p.sale_id WHERE p.at::date BETWEEN $1 AND $2 ORDER BY p.at` },
    journal: { module: 'finance', sql: `SELECT e.number, e.date::text AS date, e.memo, e.source_type, a.code, a.name AS account, l.debit/1000.0 AS debit, l.credit/1000.0 AS credit FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id WHERE e.date BETWEEN $1 AND $2 ORDER BY e.date, e.number, l.id` },
    attendance: { module: 'hr', sql: `SELECT e.code, e.name, a.date::text AS date, a.status, a.check_in::text AS check_in, a.check_out::text AS check_out, a.overtime_minutes FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.date BETWEEN $1 AND $2 ORDER BY a.date, e.name` },
    audit: { module: 'audit', sql: `SELECT at::text AS at, user_name, user_role, app, action, entity, entity_id, ip FROM audit_log WHERE at::date BETWEEN $1 AND $2 ORDER BY at` },
  };
  api.get('/export/:dataset', need('reports', 'export'), wrap(async (req, res) => {
    const d = EXPORTS[req.params.dataset];
    must(d, 404, 'Unknown report');
    must(can(req.perms, d.module, 'view'), 403, `You do not have access to ${MODULES[d.module]}`);
    const { from, to } = range(req);
    const rows = await db.query(d.sql, [from, to]);
    const name = `${req.params.dataset}_${from}_${to}`;
    void audit(req, 'export', req.params.dataset, null, { from, to, rows: rows.length, format: req.query.format });
    if (req.query.format === 'xls') {
      res.setHeader('Content-Type', 'application/vnd.ms-excel');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.xls"`);
      return res.send(toExcelXml(rows, null, req.params.dataset));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    res.send('﻿' + toCsv(rows));
  }));

  // ---------- errors ----------
  api.use((req, _res, next) => next(new HttpError(404, `No API route ${req.method} ${req.path}`)));
  app.use('/api', api);
  // eslint-disable-next-line no-unused-vars
  app.use('/api', (err, req, res, _next) => {
    let status = err.status || 500;
    let message = err.message || 'Server error';
    if (err.code === '23505') { status = 409; message = /sku/.test(err.detail || err.message) ? 'That SKU is already used' : /barcode/.test(err.detail || err.message) ? 'That barcode is already used' : /phone/.test(err.detail || err.message) ? 'A customer with this phone number already exists' : /username/.test(err.detail || err.message) ? 'That username is taken' : 'That record already exists'; }
    if (err.code === '23503') { status = 400; message = 'A linked record does not exist'; }
    if (err.code === '22P02' || err.code === '22007' || err.code === '22008') { status = 400; message = 'Invalid value in the request'; }
    if (err.type === 'entity.parse.failed') { status = 400; message = 'Invalid JSON'; }
    if (status >= 500) console.error(req.method, req.path, err);
    res.status(status).json({ error: status >= 500 && process.env.NODE_ENV === 'production' ? 'Server error' : message, ...(err.extra || {}) });
  });
  return app;
}

