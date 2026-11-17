// Server entry: opens the database, loads the encryption key, serves the API and the built web apps.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { setDataKey } from './security.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8790;
const dataDir = process.env.DATA_DIR || path.resolve(here, '..', 'data');

// Key for encrypting sensitive fields (2FA secrets, IBANs, ID numbers). In production supply DATA_KEY
// (64 hex chars) from your secret manager and back it up: without it those fields cannot be read.
let key = process.env.DATA_KEY;
if (!key) {
  if (process.env.NODE_ENV === 'production') throw new Error('DATA_KEY is required in production (64 hex characters)');
  const f = path.join(dataDir, '.data-key');
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  key = fs.readFileSync(f, 'utf8').trim();
}
setDataKey(key);

const db = await openDb({ dataDir: process.env.DATABASE_URL ? undefined : path.join(dataDir, 'pglite') });
const app = await createApp(db, { secureCookies: process.env.NODE_ENV === 'production' });

const dist = path.resolve(here, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  // each application has its own entry page
  const page = (f) => (_req, res) => res.sendFile(path.join(dist, f));
  app.get(/^\/manager(\/.*)?$/, page('manager.html'));
  app.get(/^\/staff(\/.*)?$/, page('staff.html'));
  app.get(/^\/(?!api\/).*/, page('index.html'));
}
app.listen(PORT, () => console.log(`Perfume business system on http://localhost:${PORT} (database: ${db.kind})`));
