import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barcodeProblem, detectSymbology, isValidEan8, ean8CheckDigit } from '../shared/barcode.js';
import { BUILTIN_TEMPLATES, layoutLabel, toZPL, toTSPL, toESCPOS, asciiText } from '../shared/labels.js';

const item = { barcode: '6291041500213', sku: 'DIO-SAUV-100', name: 'Sauvage', brand: 'Dior', size_ml: 100, retail_price: 56000, original_price: 62000, batch_no: 'B12' };

test('symbology validation', () => {
  assert.equal(ean8CheckDigit('9638507'), '4');
  assert.equal(isValidEan8('96385074'), true);
  assert.equal(detectSymbology('6291041500213'), 'ean13');
  assert.equal(detectSymbology('96385074'), 'ean8');
  assert.equal(detectSymbology('ABC-123'), 'code128');
  assert.equal(barcodeProblem('6291041500213', 'ean13'), null);
  assert.match(barcodeProblem('6291041500214', 'ean13'), /check digit/);
  assert.match(barcodeProblem('abc', 'code39'), /Code 39/);
  assert.equal(barcodeProblem('SAUV-100', 'code39'), null);
  assert.equal(barcodeProblem('Sauv 100', 'code128'), null);
});

test('layout fits every template inside the label', () => {
  for (const tpl of BUILTIN_TEMPLATES) {
    const els = layoutLabel(tpl, item, 'Belle Âme');
    for (const e of els) {
      const right = e.x + (e.w ?? e.size), bottom = e.y + (e.h ?? e.size);
      assert.ok(e.x >= 0 && e.y >= 0 && right <= tpl.widthMm + 0.01 && bottom <= tpl.heightMm + 0.01, `${tpl.name}: ${e.type} out of bounds`);
    }
    assert.ok(els.some((e) => e.type === 'barcode'));
  }
  const large = layoutLabel(BUILTIN_TEMPLATES[2], item, 'Belle Âme');
  assert.ok(large.some((e) => e.type === 'qr'));
});

test('ZPL output', () => {
  const z = toZPL(BUILTIN_TEMPLATES[0], [item, item], 'Belle Âme', { dpi: 203, cols: 1 });
  assert.equal((z.match(/\^XA/g) || []).length, 2, 'one label per format on a 1-across roll');
  assert.match(z, /\^PW304/); // 38 mm at 203 dpi = 304 dots
  assert.match(z, /\^BEN,\d+,Y,N\^FD629104150021\^FS/); // EAN-13 sends 12 digits, printer adds the check digit
  assert.match(z, /\^FDBelle Ame\^FS/); // accents removed for the printer's built-in font
  const two = toZPL(BUILTIN_TEMPLATES[0], [item, item, item], 'X', { cols: 2, colGapMm: 2 });
  assert.equal((two.match(/\^XA/g) || []).length, 2, '3 labels on a 2-across roll = 2 rows');
});

test('TSPL output', () => {
  const t = toTSPL(BUILTIN_TEMPLATES[1], [item], 'Belle Âme', { dpi: 203, density: 10, speed: 3 });
  assert.match(t, /^SIZE 50\.0 mm,30\.0 mm\r\n/);
  assert.match(t, /DENSITY 10\r\n/);
  assert.match(t, /BARCODE \d+,\d+,"EAN13",\d+,1,0,2,4,"629104150021"/);
  assert.match(t, /PRINT 1,1\r\n$/);
  const code39 = toTSPL({ ...BUILTIN_TEMPLATES[0], symbology: 'code39' }, [{ ...item, barcode: 'SAUV-100' }], 'X');
  assert.match(code39, /"39"/);
});

test('ESC/POS output', () => {
  const b = toESCPOS(BUILTIN_TEMPLATES[0], [item], 'X', {});
  assert.equal(b[0], 0x1b); assert.equal(b[1], 0x40);
  const s = Buffer.from(b).toString('latin1');
  assert.ok(s.includes('\x1dk\x43\x0c629104150021'), 'GS k EAN-13 with 12 digits');
});

test('ascii fallback', () => {
  assert.equal(asciiText('Belle Âme عطر'), 'Belle Ame');
});
