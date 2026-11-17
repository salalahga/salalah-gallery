import crypto from 'node:crypto';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${h}`;
}
export function verifyPassword(pw, stored) {
  const [, salt, h] = String(stored).split('$');
  if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex');
  const b = crypto.scryptSync(String(pw), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const DAYS = 30;
export const cookieMaxAge = DAYS * 86400;
export function signToken(secret, userId, version = 0) {
  const body = Buffer.from(JSON.stringify({ u: userId, v: Number(version) || 0, e: Date.now() + DAYS * 864e5 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
/** { u, v } of a valid token (v = session version: raising it logs out every device). */
export function readTokenFull(secret, token) {
  const u = readToken(secret, token); if (!u) return null;
  try { const p = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()); return { u, v: Number(p.v) || 0 }; } catch { return null; }
}
export function readToken(secret, token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const exp = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.e > Date.now() ? p.u : null; } catch { return null; }
}

// Small in-memory brute-force guard for the login endpoint.
const attempts = new Map();
export function loginAllowed(key) {
  const a = attempts.get(key);
  if (!a) return true;
  if (Date.now() - a.t > 15 * 60e3) { attempts.delete(key); return true; }
  return a.n < 10;
}
export function loginFailed(key) { const a = attempts.get(key) || { n: 0, t: Date.now() }; a.n++; attempts.set(key, a); }
export function loginOk(key) { attempts.delete(key); }
