// Storage adapter: PostgreSQL when DATABASE_URL is set, otherwise a local SQLite file.
// Every module's data lives in one generic `records` table, so new modules need no migration.
import path from 'node:path';
import fs from 'node:fs';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS records (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at BIGINT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (col, id))`,
  `CREATE INDEX IF NOT EXISTS records_updated ON records (updated_at)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, role TEXT NOT NULL, staff_id TEXT, active INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS automation_log (id TEXT PRIMARY KEY, at BIGINT NOT NULL, rule TEXT NOT NULL, trig TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT)`,
];

export async function openDb() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    // TLS is verified by default. Local databases skip TLS; a provider with a private CA can be
    // trusted by pointing PGSSLROOTCERT / NODE_EXTRA_CA_CERTS at its certificate.
    const ssl = /sslmode=disable|@localhost|@127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : true;
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl });
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
  const { DatabaseSync } = await import('node:sqlite');
  const dir = process.env.DATA_DIR || path.resolve('data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'workshop.db');
  const sq = new DatabaseSync(file);
  sq.exec('PRAGMA journal_mode = WAL');
  const db = {
    kind: 'sqlite:' + file,
    all: async (sql, p = []) => sq.prepare(sql).all(...p),
    get: async (sql, p = []) => sq.prepare(sql).get(...p),
    run: async (sql, p = []) => { sq.prepare(sql).run(...p); },
    tx: async (fn) => {
      sq.exec('BEGIN');
      try { await fn({ run: async (s, p = []) => sq.prepare(s).run(...p) }); sq.exec('COMMIT'); }
      catch (e) { sq.exec('ROLLBACK'); throw e; }
    },
  };
  for (const s of SCHEMA) await db.run(s);
  return db;
}

export const UPSERT = `INSERT INTO records (col, id, data, updated_at, deleted) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (col, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted`;
export const KV_SET = `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;
