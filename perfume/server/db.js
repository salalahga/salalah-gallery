// Database adapter: PostgreSQL when DATABASE_URL is set (production), otherwise PGlite —
// the same PostgreSQL engine embedded in a local folder (development, tests, single machine).
// Both expose: query(sql, params) → rows, one(sql, params) → first row, tx(fn) → runs fn(q) in a transaction.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Dates ("today", daily totals, reports) follow the shop's clock in Oman, not UTC.
const BUSINESS_TZ = /^[A-Za-z_]+\/[A-Za-z_]+$/.test(process.env.BUSINESS_TZ || '') ? process.env.BUSINESS_TZ : 'Asia/Muscat';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
const SCHEMA_VERSION = 1;

// BIGINT (20) and NUMERIC (1700) arrive as JS numbers. Money is baisa, far below 2^53.
const toNum = (v) => (v === null ? null : Number(v));

function sslFor(rawUrl) {
  const url = new URL(rawUrl);
  const mode = (process.env.DATABASE_SSL || url.searchParams.get('sslmode') || '').toLowerCase();
  url.searchParams.delete('sslmode');
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (mode === 'disable' || (local && !mode)) return { connectionString: url.toString(), ssl: false };
  if (['require', 'prefer', 'allow', 'no-verify'].includes(mode)) return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } };
  return { connectionString: url.toString(), ssl: process.env.PGSSLROOTCERT ? { ca: fs.readFileSync(process.env.PGSSLROOTCERT, 'utf8') } : true };
}

function wrap(exec) {
  const q = (sql, params = []) => exec(sql, params);
  q.one = async (sql, params = []) => (await exec(sql, params))[0];
  return q;
}

export async function openDb({ dataDir, url = process.env.DATABASE_URL } = {}) {
  let db;
  if (url) {
    const { default: pg } = await import('pg');
    pg.types.setTypeParser(20, toNum);
    pg.types.setTypeParser(1700, toNum);
    // DB_SCHEMA keeps this app's tables in their own PostgreSQL schema, so it can share a database
    // server with another app without any table names clashing. Every connection gets the search_path.
    const schema = process.env.DB_SCHEMA;
    if (schema && !/^[a-z_][a-z0-9_]{0,40}$/.test(schema)) throw new Error('DB_SCHEMA must be a simple lowercase name');
    const tzOpt = `-c timezone=${BUSINESS_TZ}`;
    const pool = new pg.Pool({ ...sslFor(url), max: Number(process.env.PG_POOL || 10), options: schema ? `-c search_path=${schema} ${tzOpt}` : tzOpt });
    if (schema) await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    const q = wrap(async (sql, p) => (await pool.query(sql, p)).rows);
    db = {
      kind: 'postgres', query: q, one: q.one,
      tx: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const r = await fn(wrap(async (sql, p) => (await c.query(sql, p)).rows));
          await c.query('COMMIT');
          return r;
        } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
      },
      exec: async (sql) => { await pool.query(sql); },
      close: () => pool.end(),
    };
  } else {
    if (process.env.NODE_ENV === 'production' && !dataDir) throw new Error('DATABASE_URL is required in production');
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = dataDir === ':memory:' ? undefined : (dataDir || path.join(process.env.DATA_DIR || path.resolve('data'), 'pglite'));
    if (dir) fs.mkdirSync(dir, { recursive: true });
    const lite = new PGlite(dir, { parsers: { 20: toNum, 1700: toNum } });
    await lite.exec(`SET TimeZone = '${BUSINESS_TZ}'`);
    // PGlite is a single connection: queue calls so a transaction is never interleaved with other work.
    let chain = Promise.resolve();
    const serial = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };
    const q = wrap((sql, p) => serial(async () => (await lite.query(sql, p)).rows));
    db = {
      kind: 'pglite', query: q, one: q.one,
      tx: (fn) => serial(() => lite.transaction((t) => fn(wrap(async (sql, p) => (await t.query(sql, p)).rows)))),
      exec: (sql) => serial(() => lite.exec(sql)),
      close: () => lite.close(),
    };
  }
  await db.exec(SCHEMA);
  await db.query('INSERT INTO schema_version (version) VALUES ($1) ON CONFLICT DO NOTHING', [SCHEMA_VERSION]);
  return db;
}
