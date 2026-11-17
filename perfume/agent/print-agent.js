#!/usr/bin/env node
// Belle Âme print agent — runs on the shop computer next to the label printer.
//
// Why: a web page cannot open a USB port or a raw TCP connection to a LAN printer. This small program
// (Node.js 18+, no extra packages) listens ONLY on this computer (127.0.0.1) and passes label data the
// app sends it to the printer: over the network (raw TCP, usually port 9100) or to a printer installed
// in the operating system (USB / Bluetooth / shared printers) as a RAW print job.
//
// Security: only the allowed web addresses may call it, and every request must carry the pairing code
// shown when the agent starts (enter it once in the app: Barcodes & labels → Printers → Pair).
//
//   node print-agent.js                      start (Ctrl+C to stop)
//   AGENT_PORT=9333 ALLOWED_ORIGINS=https://belleame.ample.run node print-agent.js
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

export const VERSION = '1.0.0';

export function createAgent({ port = Number(process.env.AGENT_PORT) || 9333, configPath = path.join(os.homedir(), '.belleame-print-agent.json'), allowedOrigins, log = console.log } = {}) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { /* first run */ }
  if (!cfg.token) { cfg.token = crypto.randomBytes(4).toString('hex').toUpperCase(); try { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), { mode: 0o600 }); } catch { /* read-only home */ } }
  const origins = new Set(allowedOrigins || (process.env.ALLOWED_ORIGINS || 'https://belleame.ample.run,http://localhost:8790,http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean));

  const run = (file, args, timeout = 15000) => new Promise((resolve, reject) => execFile(file, args, { timeout, windowsHide: true }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).toString().trim())) : resolve(stdout.toString()))));

  /** Printers installed in the operating system (USB, Bluetooth, shared). */
  async function osPrinters() {
    try {
      if (process.platform === 'win32') {
        const out = await run('powershell', ['-NoProfile', '-Command', 'Get-Printer | Select-Object Name,ShareName,Shared,DriverName,PortName | ConvertTo-Json -Compress']);
        const list = JSON.parse(out || '[]');
        return (Array.isArray(list) ? list : [list]).map((p) => ({ name: p.Name, share: p.Shared ? p.ShareName : null, driver: p.DriverName, port: p.PortName }));
      }
      const out = await run('lpstat', ['-e']);
      return out.split('\n').map((s) => s.trim()).filter(Boolean).map((name) => ({ name, share: name }));
    } catch (e) { return { error: e.message }; }
  }

  /** Open a TCP connection to a network printer; optionally ask a ZPL printer for its status. */
  function probeNetwork(host, port, language) {
    return new Promise((resolve) => {
      const s = net.createConnection({ host, port, timeout: 3000 });
      let data = '';
      const done = (r) => { s.destroy(); resolve(r); };
      s.on('connect', () => {
        if (language === 'zpl') { s.write('~HS\r\n'); setTimeout(() => done({ reachable: true, detected: data.includes('\x02') || data.length > 10 ? 'zpl' : null, response: data.slice(0, 200) }), 1200); }
        else done({ reachable: true, detected: null });
      });
      s.on('data', (b) => { data += b.toString('latin1'); });
      s.on('timeout', () => done({ reachable: false, error: `No answer from ${host}:${port} within 3 seconds` }));
      s.on('error', (e) => done({ reachable: false, error: e.message }));
    });
  }

  function sendNetwork(host, port, buf) {
    return new Promise((resolve, reject) => {
      const s = net.createConnection({ host, port, timeout: 8000 }, () => s.end(buf, () => resolve(buf.length)));
      s.on('timeout', () => { s.destroy(); reject(new Error(`Printer ${host}:${port} did not answer`)); });
      s.on('error', reject);
    });
  }

  async function sendQueue(queue, buf) {
    if (!/^[\w .()#-]{1,80}$/.test(queue)) throw new Error('Invalid printer name');
    const tmp = path.join(os.tmpdir(), `belleame-label-${Date.now()}.prn`);
    fs.writeFileSync(tmp, buf);
    try {
      if (process.platform === 'win32') {
        // RAW to a shared Windows printer: share the label printer (Printer properties → Sharing) and use its share name
        await run('cmd', ['/c', 'copy', '/b', tmp, `\\\\localhost\\${queue}`]);
      } else {
        await run('lp', ['-d', queue, '-o', 'raw', tmp]);
      }
      return buf.length;
    } finally { fs.rmSync(tmp, { force: true }); }
  }

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const allowed = !origin || origins.has(origin);
    if (allowed && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'content-type, x-agent-token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Private-Network', 'true'); // Chrome private-network access
    }
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'OPTIONS') { res.writeHead(allowed ? 204 : 403); return res.end(); }
    if (!allowed) return send(403, { error: `This web address (${origin}) is not allowed. Add it to ALLOWED_ORIGINS.` });
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/hello') return send(200, { agent: 'belleame-print-agent', version: VERSION, platform: process.platform });
    if (req.headers['x-agent-token'] !== cfg.token) return send(401, { error: 'Wrong or missing pairing code' });
    let body = {};
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 8e6) return send(413, { error: 'Too large' }); }
      try { body = JSON.parse(raw || '{}'); } catch { return send(400, { error: 'Invalid JSON' }); }
    }
    try {
      if (url.pathname === '/status') return send(200, { agent: 'belleame-print-agent', version: VERSION, platform: process.platform, hostname: os.hostname(), printers: await osPrinters() });
      if (url.pathname === '/probe') {
        if (body.connection === 'network') {
          if (!body.host) return send(400, { error: 'Enter the printer IP address' });
          return send(200, await probeNetwork(String(body.host), Number(body.port) || 9100, body.language));
        }
        const list = await osPrinters();
        if (!Array.isArray(list)) return send(200, { reachable: false, error: list.error });
        const hit = list.find((p) => p.name === body.queue || p.share === body.queue);
        return send(200, hit ? { reachable: true, printer: hit, note: process.platform === 'win32' && !hit.share ? 'Found, but not shared — share it (Printer properties → Sharing) and use the share name' : undefined } : { reachable: false, error: `No printer called "${body.queue}" on this computer`, printers: list.map((p) => p.share || p.name) });
      }
      if (url.pathname === '/print') {
        const buf = Buffer.from(String(body.dataBase64 || ''), 'base64');
        if (!buf.length) return send(400, { error: 'Nothing to print' });
        const bytes = body.connection === 'network' ? await sendNetwork(String(body.host), Number(body.port) || 9100, buf) : await sendQueue(String(body.queue || ''), buf);
        log(`printed ${bytes} bytes → ${body.connection === 'network' ? `${body.host}:${body.port || 9100}` : body.queue}`);
        return send(200, { ok: true, bytes });
      }
      send(404, { error: 'Unknown request' });
    } catch (e) { send(502, { error: e.message }); }
  });
  return {
    token: cfg.token, server,
    listen: () => new Promise((r) => server.listen(port, '127.0.0.1', () => r(server.address().port))),
    close: () => new Promise((r) => server.close(r)),
  };
}

if (process.argv[1] && process.argv[1].endsWith('print-agent.js')) {
  const a = createAgent();
  a.listen().then((p) => {
    console.log(`\nBelle Âme print agent ${VERSION} is running on http://127.0.0.1:${p}`);
    console.log(`Pairing code: ${a.token}   (enter it in the app: Barcodes & labels → Printers → Pair this computer)`);
    console.log('Keep this window open while printing labels. Press Ctrl+C to stop.\n');
  });
}
