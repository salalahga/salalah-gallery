// The print agent against a fake network label printer (a TCP server on port 9100-style raw socket).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createAgent } from '../agent/print-agent.js';
import { toZPL, BUILTIN_TEMPLATES } from '../shared/labels.js';

let agent, base, printer, printerPort, received = [];
const ORIGIN = 'https://belleame.ample.run';
before(async () => {
  printer = net.createServer((s) => { let buf = ''; s.on('data', (d) => { buf += d.toString(); if (buf.includes('~HS')) s.write('\x02030,0,0,1245,000,0,0,0,000,0,0,0\x03\r\n'); }); s.on('end', () => received.push(buf)); });
  await new Promise((r) => printer.listen(0, '127.0.0.1', r));
  printerPort = printer.address().port;
  const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-')), 'cfg.json');
  agent = createAgent({ port: 0, configPath: cfg, allowedOrigins: [ORIGIN], log: () => {} });
  base = `http://127.0.0.1:${await agent.listen()}`;
});
after(async () => { await agent.close(); printer.close(); });
const call = (p, body, { token = agent.token, origin = ORIGIN } = {}) => fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin, 'x-agent-token': token }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: await r.json(), headers: r.headers }));

test('agent: hello works without pairing; everything else needs the pairing code and an allowed origin', async () => {
  assert.equal((await call('/hello', null, { token: '' })).data.agent, 'belleame-print-agent');
  assert.equal((await call('/status', null, { token: 'WRONG' })).status, 401);
  assert.equal((await call('/hello', null, { origin: 'https://evil.example' })).status, 403);
  const pre = await fetch(base + '/print', { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-private-network': 'true' } });
  assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
});

test('agent: probe reports a real connection only when the printer answers, and detects ZPL', async () => {
  const ok = await call('/probe', { connection: 'network', host: '127.0.0.1', port: printerPort, language: 'zpl' });
  assert.equal(ok.data.reachable, true);
  assert.equal(ok.data.detected, 'zpl');
  const closed = net.createServer(); await new Promise((r) => closed.listen(0, '127.0.0.1', r)); const deadPort = closed.address().port; closed.close();
  const bad = await call('/probe', { connection: 'network', host: '127.0.0.1', port: deadPort });
  assert.equal(bad.data.reachable, false);
  assert.ok(bad.data.error);
});

test('agent: prints raw ZPL to a network printer byte for byte', async () => {
  const zpl = toZPL(BUILTIN_TEMPLATES[0], [{ barcode: '2900000000018', sku: 'X', name: 'Test', retail_price: 1000 }], 'Shop');
  received = [];
  const r = await call('/print', { connection: 'network', host: '127.0.0.1', port: printerPort, dataBase64: Buffer.from(zpl).toString('base64') });
  assert.equal(r.data.ok, true);
  assert.equal(r.data.bytes, Buffer.byteLength(zpl));
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(received.join(''), zpl);
});
