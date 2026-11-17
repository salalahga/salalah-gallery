// Passwords (scrypt), session tokens, TOTP two-factor codes (RFC 6238) and field encryption (AES-256-GCM).
import crypto from 'node:crypto';

// ---------- passwords ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, s, k] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(k, 'base64');
  return want.length === key.length && crypto.timingSafeEqual(key, want);
}
export function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-zA-Z]/.test(s) || !/\d/.test(s)) return 'Password must contain letters and numbers';
  return null;
}

// ---------- session tokens: the cookie carries the raw token, the database stores only its hash ----------
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const tokenId = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// ---------- encryption of sensitive fields at rest ----------
let KEY = null;
export function setDataKey(hexOrB64) {
  const b = /^[0-9a-f]{64}$/i.test(hexOrB64) ? Buffer.from(hexOrB64, 'hex') : Buffer.from(hexOrB64, 'base64');
  if (b.length !== 32) throw new Error('DATA_KEY must be 32 bytes (64 hex chars)');
  KEY = b;
}
export function seal(plain) {
  if (plain == null || plain === '') return plain ?? null;
  if (!KEY) throw new Error('Encryption key not initialised');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `enc:v1:${Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')}`;
}
export function unseal(v) {
  if (!v || !String(v).startsWith('enc:v1:')) return v ?? null;
  const b = Buffer.from(String(v).slice(7), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
/** "OM12BANK0000123456" → "•••• 3456" */
export const mask = (v) => (v ? '•••• ' + String(v).slice(-4) : null);

// ---------- TOTP (Google Authenticator, Microsoft Authenticator, Authy …) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));
export function totp(secret, t = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(t / 1000 / step);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, '0');
  return code;
}
/** Accepts the current code and one step either side (clock drift). */
export function verifyTotp(secret, code, t = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) => crypto.timingSafeEqual(Buffer.from(totp(secret, t + w * 30000)), Buffer.from(c)));
}
export const otpauthUrl = (secret, account, issuer) => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&period=30&digits=6`;
