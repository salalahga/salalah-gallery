// Server-side plugins: secrets (bot tokens, SMTP passwords, webhook keys) live only on the server
// and are never sent to the browser in full. All three channels below are free to use.
import crypto from 'node:crypto';
import { KV_SET } from './db.js';

export const SECRET_FIELDS = {
  telegram: ['botToken'],
  email: ['pass'],
  webhooks: ['secret'],
};

export function createPlugins(db) {
  async function getConfig() {
    const r = await db.get('SELECT value FROM kv WHERE key = ?', ['plugin_config']);
    return r ? JSON.parse(r.value) : {};
  }
  async function setConfig(id, patch) {
    const all = await getConfig();
    const cur = all[id] || {};
    // a masked value coming back from the UI means "unchanged"
    for (const k of SECRET_FIELDS[id] || []) if (typeof patch[k] === 'string' && patch[k].startsWith('••')) delete patch[k];
    all[id] = { ...cur, ...patch };
    await db.run(KV_SET, ['plugin_config', JSON.stringify(all), Date.now()]);
  }
  async function masked() {
    const all = await getConfig();
    const out = {};
    for (const [id, cfg] of Object.entries(all)) {
      out[id] = { ...cfg };
      for (const k of SECRET_FIELDS[id] || []) if (cfg[k]) out[id][k] = '••••' + String(cfg[k]).slice(-4);
    }
    return out;
  }

  // ---------- Telegram (free bot API) ----------
  async function telegram(text, chatId) {
    const c = (await getConfig()).telegram || {};
    if (!c.enabled || !c.botToken) throw new Error('Telegram plugin is not set up');
    const to = chatId || c.chatId;
    if (!to) throw new Error('No Telegram chat ID');
    const base = process.env.TELEGRAM_API || 'https://api.telegram.org';
    const r = await fetch(`${base}/bot${c.botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: to, text, disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error('Telegram: ' + (j.description || r.status));
  }
  async function telegramFile(buf, filename, caption, chatId) {
    const c = (await getConfig()).telegram || {};
    if (!c.enabled || !c.botToken) throw new Error('Telegram plugin is not set up');
    const to = chatId || c.chatId;
    if (!to) throw new Error('No Telegram chat ID');
    const base = process.env.TELEGRAM_API || 'https://api.telegram.org';
    const form = new FormData();
    form.append('chat_id', String(to)); if (caption) form.append('caption', caption);
    form.append('document', new Blob([buf], { type: 'application/gzip' }), filename);
    const r = await fetch(`${base}/bot${c.botToken}/sendDocument`, { method: 'POST', body: form });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error('Telegram: ' + (j.description || r.status));
  }

  // ---------- Email (SMTP — e.g. free Gmail with an app password) ----------
  let transport; let transportKey = '';
  async function email({ to, subject, text, attachments }) {
    const c = (await getConfig()).email || {};
    if (!c.enabled || !c.host || !c.user || !c.pass) throw new Error('Email plugin is not set up');
    const key = JSON.stringify([c.host, c.port, c.user, c.pass]);
    if (!transport || key !== transportKey) {
      const { default: nodemailer } = await import('nodemailer');
      const port = Number(c.port) || 465;
      transport = nodemailer.createTransport({ host: c.host, port, secure: port === 465, auth: { user: c.user, pass: c.pass } });
      transportKey = key;
    }
    await transport.sendMail({ from: c.from || c.user, to: to || c.to || c.user, subject, text, attachments });
  }

  // ---------- Webhooks (n8n, Make, Zapier, Pipedream, Google Apps Script…) ----------
  async function webhook(event, payload, onlyUrl) {
    const c = (await getConfig()).webhooks || {};
    if (!c.enabled) throw new Error('Webhooks plugin is not enabled');
    const urls = onlyUrl ? [onlyUrl] : String(c.urls || '').split(/\s+/).filter(Boolean);
    if (!urls.length) throw new Error('No webhook URL');
    const body = JSON.stringify({ event, at: new Date().toISOString(), data: payload });
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'WoodWorksPro-Webhook' };
    if (c.secret) headers['X-WoodWorks-Signature'] = 'sha256=' + crypto.createHmac('sha256', c.secret).update(body).digest('hex');
    const results = await Promise.allSettled(urls.map((u) => fetch(u, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) }).then((r) => { if (!r.ok) throw new Error(`${u} → ${r.status}`); })));
    const bad = results.filter((r) => r.status === 'rejected');
    if (bad.length) throw new Error(bad.map((b) => b.reason.message).join('; '));
  }

  return { getConfig, setConfig, masked, telegram, telegramFile, email, webhook };
}
