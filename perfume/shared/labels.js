// Label engine: one layout calculation (in millimetres) feeds every output — the on-screen/browser
// preview and the raw printer languages ZPL (Zebra & compatibles), TSPL (TSC, Xprinter, many Chinese
// label printers) and ESC/POS (receipt-style printers with barcode support). Same template → same label.
import { detectSymbology } from './barcode.js';

export const FIELDS = {
  shop: 'Shop name', logo: 'Logo (browser printing only)', brand: 'Brand', name: 'Product name', size: 'Size', sku: 'SKU',
  barcode: 'Barcode', price: 'Selling price', original: 'Original price', batch: 'Batch number', qr: 'QR code',
};
const f = (key, on, size, extra = {}) => ({ key, on, size, align: 'center', bold: false, ...extra });

/** Built-in templates for small, medium and large perfume labels. */
export const BUILTIN_TEMPLATES = [
  { id: 'tpl_small', name: 'Small — 38 × 25 mm', builtin: true, widthMm: 38, heightMm: 25, marginMm: 1, symbology: 'auto', barcodeHeightMm: 8, module: 2, qrData: 'barcode', qrText: '',
    fields: [f('shop', true, 5), f('brand', false, 6), f('name', true, 6.5, { bold: true }), f('size', false, 6), f('barcode', true, 0), f('sku', false, 5), f('price', true, 8.5, { bold: true }), f('original', false, 6), f('batch', false, 5), f('qr', false, 0), f('logo', false, 0)] },
  { id: 'tpl_medium', name: 'Medium — 50 × 30 mm', builtin: true, widthMm: 50, heightMm: 30, marginMm: 1.5, symbology: 'auto', barcodeHeightMm: 10, module: 2, qrData: 'barcode', qrText: '',
    fields: [f('shop', true, 6), f('brand', true, 7, { bold: true }), f('name', true, 7), f('size', true, 6.5), f('barcode', true, 0), f('sku', false, 5.5), f('price', true, 10, { bold: true }), f('original', false, 7), f('batch', false, 5.5), f('qr', false, 0), f('logo', false, 0)] },
  { id: 'tpl_large', name: 'Large with QR — 58 × 40 mm', builtin: true, widthMm: 58, heightMm: 40, marginMm: 2, symbology: 'auto', barcodeHeightMm: 12, module: 2, qrData: 'barcode', qrText: '',
    fields: [f('shop', true, 7), f('brand', true, 8, { bold: true }), f('name', true, 8), f('size', true, 7), f('barcode', true, 0), f('sku', true, 6), f('price', true, 12, { bold: true }), f('original', true, 7), f('batch', true, 6), f('qr', true, 0), f('logo', false, 0)] },
];

const PT = 0.3528; // mm per point
const fmtMoney = (minor) => (Number(minor || 0) / 1000).toFixed(3);
const sizeText = (it) => it.label || (it.size_ml ? `${it.size_ml}ml` : '');

export function fieldText(key, it, shop) {
  switch (key) {
    case 'shop': return shop || '';
    case 'brand': return it.brand || '';
    case 'name': return [it.name, sizeText(it)].filter(Boolean).join(' ');
    case 'size': return sizeText(it);
    case 'sku': return it.sku ? `SKU ${it.sku}` : '';
    case 'price': return `OMR ${fmtMoney(it.retail_price)}`;
    case 'original': return it.original_price && it.original_price > it.retail_price ? `Was OMR ${fmtMoney(it.original_price)}` : '';
    case 'batch': return it.batch_no ? `Batch ${it.batch_no}` : '';
    default: return '';
  }
}
export const qrContent = (tpl, it) => (tpl.qrData === 'sku' ? it.sku : tpl.qrData === 'text' ? tpl.qrText || it.barcode : it.barcode) || '';

/**
 * Lay a label out. Returns elements in mm relative to the label's top-left corner:
 *   { type: 'text', key, text, x, y, w, h, size, align, bold } | { type: 'barcode', code, sym, x, y, w, h }
 *   { type: 'qr', data, x, y, size } | { type: 'logo', x, y, w, h }
 * Fonts and the barcode shrink together if the chosen fields do not fit the label height.
 */
export function layoutLabel(tpl, it, shop) {
  const W = tpl.widthMm, H = tpl.heightMm, m = tpl.marginMm ?? 1;
  const on = tpl.fields.filter((x) => x.on);
  const qr = on.find((x) => x.key === 'qr') && qrContent(tpl, it);
  const qrSize = qr ? Math.min(H - 2 * m, W * 0.36) : 0;
  const colW = W - 2 * m - (qr ? qrSize + 1 : 0);
  const rows = on.filter((x) => !['qr'].includes(x.key)).map((x) => {
    if (x.key === 'barcode') return it.barcode ? { x, h: tpl.barcodeHeightMm + 2.6 } : null; // + human-readable digits
    if (x.key === 'logo') return { x, h: Math.max(3, x.size || 5) };
    const text = fieldText(x.key, it, shop);
    return text ? { x, text, h: x.size * PT * 1.18 } : null;
  }).filter(Boolean);
  const need = rows.reduce((a, r) => a + r.h, 0);
  const avail = H - 2 * m;
  const k = need > avail ? avail / need : 1; // shrink to fit
  const spare = need < avail ? (avail - need) / (rows.length + 1) : 0; // spread evenly
  const els = [];
  let y = m + spare;
  for (const r of rows) {
    const h = r.h * k;
    if (r.x.key === 'barcode') {
      els.push({ type: 'barcode', code: it.barcode, sym: tpl.symbology === 'auto' || !tpl.symbology ? (it.symbology || detectSymbology(it.barcode)) : tpl.symbology, x: m, y, w: colW, h, module: tpl.module || 2 });
    } else if (r.x.key === 'logo') {
      els.push({ type: 'logo', x: m, y, w: colW, h });
    } else {
      els.push({ type: 'text', key: r.x.key, text: r.text, x: m, y, w: colW, h, size: r.x.size * k, align: r.x.align || 'center', bold: !!r.x.bold });
    }
    y += h + spare;
  }
  if (qr) els.push({ type: 'qr', data: qr, x: W - m - qrSize, y: (H - qrSize) / 2, size: qrSize });
  return els;
}

/** Raw printer languages only carry plain text reliably: Â → A, Arabic etc. removed. */
export function asciiText(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
}
export const hasNonAscii = (s) => /[^\x20-\x7e]/.test(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''));

/** Group a list of labels into printed rows for rolls with several labels across. */
const rowsOf = (labels, cols) => { const out = []; for (let i = 0; i < labels.length; i += cols) out.push(labels.slice(i, i + cols)); return out; };
const estBarcodeMm = (code, sym, moduleMm) => {
  const n = String(code).length;
  const modules = sym === 'ean13' ? 95 : sym === 'ean8' ? 67 : sym === 'code39' ? (n + 2) * 16 : /^\d+$/.test(code) && n % 2 === 0 ? 11 * (n / 2 + 3) + 2 : 11 * (n + 3) + 2;
  return modules * moduleMm;
};

/**
 * ZPL II for Zebra and ZPL-compatible printers.
 * printer: { dpi, density (0-15), speed (ips), orientation: 0|180, cols, colGapMm, offsetXMm, offsetYMm }
 */
export function toZPL(tpl, labels, shop, printer = {}) {
  const dpm = (printer.dpi || 203) / 25.4;
  const d = (mm) => Math.max(0, Math.round(mm * dpm));
  const cols = printer.cols || 1, gap = printer.colGapMm || 0, ox = printer.offsetXMm || 0, oy = printer.offsetYMm || 0;
  const pw = d(cols * tpl.widthMm + (cols - 1) * gap + ox);
  const out = [];
  for (const row of rowsOf(labels, cols)) {
    const parts = [`^XA^CI28^PW${pw}^LL${d(tpl.heightMm + oy)}^LH0,0^PO${printer.orientation === 180 ? 'I' : 'N'}^PR${Math.min(14, Math.max(1, printer.speed || 4))}~SD${Math.min(30, Math.max(0, Math.round((printer.density ?? 8) * 2)))}`];
    row.forEach((it, c) => {
      const bx = ox + c * (tpl.widthMm + gap);
      for (const e of layoutLabel(tpl, it, shop)) {
        if (e.type === 'text') {
          const h = d(e.size * PT);
          parts.push(`^FO${d(bx + e.x)},${d(oy + e.y)}^A0N,${h},${h}^FB${d(e.w)},1,0,${e.align === 'left' ? 'L' : e.align === 'right' ? 'R' : 'C'},0^FD${asciiText(e.text).replace(/[\^~]/g, '')}^FS`);
        } else if (e.type === 'barcode') {
          const mod = e.module, hb = d(e.h - 2.6);
          const wmm = estBarcodeMm(e.code, e.sym, mod / dpm);
          const x = d(bx + e.x + Math.max(0, (e.w - wmm) / 2));
          const cmd = e.sym === 'ean13' ? `^BEN,${hb},Y,N^FD${e.code.slice(0, 12)}` : e.sym === 'ean8' ? `^B8N,${hb},Y,N^FD${e.code.slice(0, 7)}` : e.sym === 'code39' ? `^B3N,N,${hb},Y,N^FD${e.code}` : `^BCN,${hb},Y,N,N^FD${e.code}`;
          parts.push(`^FO${x},${d(oy + e.y)}^BY${mod},2.5,${hb}${cmd}^FS`);
        } else if (e.type === 'qr') {
          const mag = Math.max(1, Math.min(10, Math.floor(d(e.size) / 29)));
          parts.push(`^FO${d(bx + e.x)},${d(oy + e.y)}^BQN,2,${mag}^FDLA,${asciiText(e.data)}^FS`);
        }
      }
    });
    parts.push('^PQ1^XZ');
    out.push(parts.join('\n'));
  }
  return out.join('\n');
}

/** TSPL / TSPL2 for TSC, Xprinter (XP-365B, XP-420B …), HPRT, Gprinter and similar. */
export function toTSPL(tpl, labels, shop, printer = {}) {
  const dpm = (printer.dpi || 203) / 25.4;
  const d = (mm) => Math.max(0, Math.round(mm * dpm));
  const cols = printer.cols || 1, gap = printer.colGapMm || 0, ox = printer.offsetXMm || 0, oy = printer.offsetYMm || 0;
  const rollW = cols * tpl.widthMm + (cols - 1) * gap + ox;
  const head = [
    `SIZE ${rollW.toFixed(1)} mm,${tpl.heightMm.toFixed(1)} mm`,
    `GAP ${(printer.gapMm ?? 2).toFixed(1)} mm,0 mm`,
    `DIRECTION ${printer.orientation === 180 ? 0 : 1},0`,
    'REFERENCE 0,0',
    `DENSITY ${Math.min(15, Math.max(0, printer.density ?? 8))}`,
    `SPEED ${Math.min(6, Math.max(1, printer.speed || 4))}`,
    'SET TEAR ON',
  ];
  const out = [...head];
  const q = (s) => asciiText(s).replace(/"/g, "'");
  for (const row of rowsOf(labels, cols)) {
    out.push('CLS');
    row.forEach((it, c) => {
      const bx = ox + c * (tpl.widthMm + gap);
      for (const e of layoutLabel(tpl, it, shop)) {
        if (e.type === 'text') {
          const text = q(e.text);
          const size = Math.max(4, Math.round(e.size)); // font "0" is scalable: multipliers are point sizes
          const wmm = text.length * size * PT * 0.55;
          const x = e.align === 'left' ? bx + e.x : e.align === 'right' ? bx + e.x + e.w - wmm : bx + e.x + Math.max(0, (e.w - wmm) / 2);
          out.push(`TEXT ${d(x)},${d(oy + e.y)},"0",0,${size},${size},"${text}"`);
        } else if (e.type === 'barcode') {
          const narrow = e.module, hb = d(e.h - 2.6);
          const wmm = estBarcodeMm(e.code, e.sym, narrow / dpm);
          const x = d(bx + e.x + Math.max(0, (e.w - wmm) / 2));
          const type = e.sym === 'ean13' ? 'EAN13' : e.sym === 'ean8' ? 'EAN8' : e.sym === 'code39' ? '39' : '128';
          const data = e.sym === 'ean13' ? e.code.slice(0, 12) : e.sym === 'ean8' ? e.code.slice(0, 7) : e.code;
          out.push(`BARCODE ${x},${d(oy + e.y)},"${type}",${hb},1,0,${narrow},${narrow * 2},"${data}"`);
        } else if (e.type === 'qr') {
          const cell = Math.max(1, Math.min(10, Math.floor(d(e.size) / 29)));
          out.push(`QRCODE ${d(bx + e.x)},${d(oy + e.y)},L,${cell},A,0,"${q(e.data)}"`);
        }
      }
    });
    out.push('PRINT 1,1');
  }
  return out.join('\r\n') + '\r\n';
}

/** ESC/POS for receipt-style printers that print barcodes (continuous paper, one label after another). */
export function toESCPOS(tpl, labels, shop, printer = {}) {
  const bytes = [];
  const push = (...b) => bytes.push(...b);
  const text = (s) => { for (const ch of asciiText(s)) bytes.push(ch.charCodeAt(0)); };
  push(0x1b, 0x40); // initialise
  for (const it of labels) {
    for (const e of layoutLabel(tpl, it, shop)) {
      if (e.type === 'text') {
        push(0x1b, 0x61, e.align === 'left' ? 0 : e.align === 'right' ? 2 : 1, 0x1b, 0x45, e.bold ? 1 : 0, 0x1d, 0x21, e.size >= 10 ? 0x11 : 0x00);
        text(e.text); push(0x0a);
      } else if (e.type === 'barcode') {
        const data = e.sym === 'ean13' ? e.code.slice(0, 12) : e.sym === 'ean8' ? e.code.slice(0, 7) : e.code;
        push(0x1b, 0x61, 1, 0x1d, 0x68, Math.min(255, Math.round(e.h * 8)), 0x1d, 0x77, Math.min(6, Math.max(2, e.module)), 0x1d, 0x48, 2);
        if (e.sym === 'code128') { const payload = '{B' + data; push(0x1d, 0x6b, 73, payload.length); text(payload); }
        else { push(0x1d, 0x6b, e.sym === 'ean13' ? 67 : e.sym === 'ean8' ? 68 : 69, data.length); text(data); }
        push(0x0a);
      } else if (e.type === 'qr') {
        const data = asciiText(e.data); const len = data.length + 3;
        push(0x1b, 0x61, 1, 0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00, 0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6, 0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x30,
          0x1d, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30);
        text(data); push(0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, 0x0a);
      }
    }
    push(0x1b, 0x64, 3); // feed 3 lines between labels
    if (printer.cut) push(0x1d, 0x56, 66, 0);
  }
  return Uint8Array.from(bytes);
}

/** A tiny label that proves the printer, language and paper size are right. */
export function testLabel(barcode = '2900000000018') {
  return { barcode, sku: 'TEST', name: 'Printer test', brand: 'Belle Ame', label: '', size_ml: null, retail_price: 0, batch_no: 'TEST' };
}
