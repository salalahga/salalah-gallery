import crypto from 'node:crypto';

export const id = (prefix = '') => prefix + crypto.randomBytes(9).toString('base64url');

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };
export const must = (cond, status, message) => { if (!cond) fail(status, message); };

/** Atomic document number, e.g. INV-000123. Runs inside the caller's transaction. */
export async function nextNumber(q, key, prefix, pad = 6) {
  const r = await q.one(`INSERT INTO counters (key, value) VALUES ($1, 1)
    ON CONFLICT (key) DO UPDATE SET value = counters.value + 1 RETURNING value`, [key]);
  return `${prefix}-${String(r.value).padStart(pad, '0')}`;
}

/** Today's date in the business's own time zone (Oman, UTC+4) — not UTC, so a sale at 00:30 lands on the right day. */
export const localDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: /^[A-Za-z_]+\/[A-Za-z_]+$/.test(process.env.BUSINESS_TZ || '') ? process.env.BUSINESS_TZ : 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const today = () => localDate();
export const int = (v, name = 'value') => {
  const n = Number(v);
  if (!Number.isInteger(n)) fail(400, `${name} must be a whole number`);
  return n;
};
export const posInt = (v, name = 'value') => { const n = int(v, name); if (n <= 0) fail(400, `${name} must be greater than zero`); return n; };
export const money = (v, name = 'amount') => { const n = int(v, name); if (n < 0) fail(400, `${name} cannot be negative`); return n; };
export const str = (v, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null);
export const isoDate = (v, name = 'date') => {
  if (v == null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) fail(400, `${name} must be YYYY-MM-DD`);
  return String(v);
};

export function toCsv(rows, columns) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
  const esc = (v) => {
    if (v == null) return '';
    let s = Array.isArray(v) ? v.join('; ') : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

/** Excel 2003 XML spreadsheet — opens natively in Excel / Numbers / LibreOffice. */
export function toExcelXml(rows, columns, sheet = 'Report') {
  const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
  const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cell = (v) => (typeof v === 'number' ? `<Cell><Data ss:Type="Number">${v}</Data></Cell>` : `<Cell><Data ss:Type="String">${x(Array.isArray(v) ? v.join('; ') : v)}</Data></Cell>`);
  return `<?xml version="1.0"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="${x(sheet).slice(0, 30)}"><Table>`
    + `<Row>${cols.map((c) => cell(c)).join('')}</Row>`
    + rows.map((r) => `<Row>${cols.map((c) => cell(r[c])).join('')}</Row>`).join('')
    + '</Table></Worksheet></Workbook>';
}
