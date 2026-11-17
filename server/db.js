// Storage adapter: PostgreSQL when DATABASE_URL is set (production), otherwise PGlite — the same
// PostgreSQL engine embedded in a local folder (development / single machine). One SQL dialect for both.
// Every module's data lives in one generic `records` table, so new modules need no migration.
import path from 'node:path';
import fs from 'node:fs';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS records (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at BIGINT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (col, id))`,
  `CREATE INDEX IF NOT EXISTS records_updated ON records (updated_at)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, role TEXT NOT NULL, staff_id TEXT, active INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS automation_log (id TEXT PRIMARY KEY, at BIGINT NOT NULL, rule TEXT NOT NULL, trig TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT)`,
  // photos live here instead of inside records, so syncing data stays small and fast
  `CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, size INTEGER NOT NULL, created_at BIGINT NOT NULL, created_by TEXT)`,
  // who changed what
  `CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, at BIGINT NOT NULL, user_id TEXT, user_name TEXT, col TEXT NOT NULL, rec_id TEXT, action TEXT NOT NULL, label TEXT)`,
  `CREATE INDEX IF NOT EXISTS audit_at ON audit (at)`,
  // read-only viewer logins: which modules they may open (JSON array, ["*"] = everything)
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS modules TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS sv INTEGER NOT NULL DEFAULT 0`,
];

/**
 * TLS settings with libpq `sslmode` meaning (from DATABASE_SSL, else the URL's sslmode):
 *   disable                  → no TLS (also used automatically for localhost)
 *   require / prefer / allow → encrypted, server certificate not checked (managed databases
 *                              with self-signed certificates on the provider's network)
 *   verify-ca / verify-full  → encrypted and verified; default when nothing is set.
 *                              A private CA can be supplied with PGSSLROOTCERT (file path).
 */
export function pgSsl(rawUrl, envMode, rootCertPath) {
  const url = new URL(rawUrl);
  const mode = (envMode || url.searchParams.get('sslmode') || '').toLowerCase();
  for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(k);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  let ssl;
  if (mode === 'disable' || (local && !mode)) ssl = false;
  else if (['require', 'prefer', 'allow', 'no-verify'].includes(mode)) ssl = { rejectUnauthorized: false };
  else ssl = rootCertPath ? { ca: fs.readFileSync(rootCertPath, 'utf8') } : true;
  return { connectionString: url.toString(), ssl };
}

export async function openDb() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const { connectionString, ssl } = pgSsl(process.env.DATABASE_URL, process.env.DATABASE_SSL, process.env.PGSSLROOTCERT);
    const pool = new pg.Pool({ connectionString, ssl });
    const conv = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
    const norm = (rows) => rows.map((r) => ('updated_at' in r ? { ...r, updated_at: Number(r.updated_at) } : r));
    const db = {
      kind: 'postgres',
      all: async (sql, p = []) => norm((await pool.query(conv(sql), p)).rows),
      get: async (sql, p = []) => norm((await pool.query(conv(sql), p)).rows)[0],
      run: async (sql, p = []) => { await pool.query(conv(sql), p); },
      tx: async (fn) => {
        const c = await pool.connect();
        try { await c.query('BEGIN'); await fn({ run: (s, p = []) => c.query(conv(s), p) }); await c.query('COMMIT'); }
        catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
      },
    };
    for (const s of SCHEMA) await db.run(s);
    return db;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production');
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.join(process.env.DATA_DIR || path.resolve('data'), 'pglite');
  fs.mkdirSync(dir, { recursive: true });
  const lite = new PGlite(dir);
  const conv = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  const norm = (rows) => rows.map((r) => ('updated_at' in r ? { ...r, updated_at: Number(r.updated_at) } : r));
  // PGlite runs one statement at a time; queue calls so a transaction is never interleaved.
  let chain = Promise.resolve();
  const serial = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };
  const db = {
    kind: 'pglite:' + dir,
    all: (sql, p = []) => serial(async () => norm((await lite.query(conv(sql), p)).rows)),
    get: (sql, p = []) => serial(async () => norm((await lite.query(conv(sql), p)).rows)[0]),
    run: (sql, p = []) => serial(async () => { await lite.query(conv(sql), p); }),
    tx: (fn) => serial(() => lite.transaction((t) => fn({ run: (s, p = []) => t.query(conv(s), p) }))),
  };
  for (const s of SCHEMA) await db.run(s);
  return db;
}

export const UPSERT = `INSERT INTO records (col, id, data, updated_at, deleted) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (col, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted`;
export const KV_SET = `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;
