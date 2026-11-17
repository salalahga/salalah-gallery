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
