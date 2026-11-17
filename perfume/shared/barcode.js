// EAN-13 helpers. In-store barcodes use the GS1 "restricted circulation" prefix 2x, which is
// reserved for a shop's own use and never clashes with manufacturers' barcodes on perfume boxes.
export function ean13CheckDigit(first12) {
  const d = String(first12).split('').map(Number);
  const sum = d.reduce((a, n, i) => a + n * (i % 2 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}
export const isValidEan13 = (code) => /^\d{13}$/.test(String(code)) && ean13CheckDigit(String(code).slice(0, 12)) === String(code)[12];
/** n-th internal barcode: 29 + 10-digit sequence + check digit. */
export function internalEan13(n) {
  const body = '29' + String(n).padStart(10, '0');
  return body + ean13CheckDigit(body);
}
/** Clean what a scanner typed: Arabic/Persian digits (Arabic keyboard layout) → 0-9, trim stray characters. */
export function cleanScan(raw) {
  return String(raw || '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[\r\n\t]/g, '').trim();
}

// ---------- symbologies ----------
export const SYMBOLOGIES = { ean13: 'EAN-13', ean8: 'EAN-8', code128: 'Code 128', code39: 'Code 39' };
export const ean8CheckDigit = (first7) => {
  const d = String(first7).split('').map(Number);
  const sum = d.reduce((a, n, i) => a + n * (i % 2 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
};
export const isValidEan8 = (code) => /^\d{8}$/.test(String(code)) && ean8CheckDigit(String(code).slice(0, 7)) === String(code)[7];
const CODE39 = /^[0-9A-Z \-.$/+%]+$/;

/** Best symbology for a code: EAN when the check digit is valid, otherwise Code 128. */
export function detectSymbology(code) {
  const c = String(code || '');
  if (isValidEan13(c)) return 'ean13';
  if (isValidEan8(c)) return 'ean8';
  return 'code128';
}

/** null when the code can be printed with this symbology, otherwise a plain-language problem. */
export function barcodeProblem(code, sym) {
  const c = String(code || '');
  if (!c) return 'Barcode is empty';
  if (c.length > 48) return 'Barcode is too long (48 characters at most)';
  switch (sym) {
    case 'ean13': return /^\d{13}$/.test(c) ? (isValidEan13(c) ? null : `EAN-13 check digit is wrong (should end in ${ean13CheckDigit(c.slice(0, 12))})`) : 'EAN-13 needs exactly 13 digits';
    case 'ean8': return /^\d{8}$/.test(c) ? (isValidEan8(c) ? null : `EAN-8 check digit is wrong (should end in ${ean8CheckDigit(c.slice(0, 7))})`) : 'EAN-8 needs exactly 8 digits';
    case 'code39': return CODE39.test(c) ? null : 'Code 39 allows only A-Z, 0-9, space and - . $ / + %';
    case 'code128': return /^[\x20-\x7e]+$/.test(c) ? null : 'Code 128 allows only plain letters, digits and symbols';
    default: return 'Unknown barcode type';
  }
}
