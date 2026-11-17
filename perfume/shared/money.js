// Money helpers shared by server and browser.
// All amounts are integers in the currency's minor unit (OMR → baisa, 3 decimals).
// Rounding is half-away-from-zero on the minor unit, applied once per line.

export const DECIMALS = { OMR: 3, BHD: 3, KWD: 3, AED: 2, SAR: 2, USD: 2, EUR: 2, INR: 2, QAR: 2 };
export const decimalsOf = (cur = 'OMR') => DECIMALS[cur] ?? 2;

/** Parse "12.5", "12.500", 12.5 or "1,234.250" into minor units. Throws on garbage. */
export function toMinor(v, cur = 'OMR') {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Invalid amount');
    return roundHalf(v * 10 ** decimalsOf(cur));
  }
  const s = String(v ?? '').replace(/[,\s]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (!/^-?\d*(\.\d*)?$/.test(s) || s === '' || s === '.' || s === '-') throw new Error(`Invalid amount: ${v}`);
  const d = decimalsOf(cur);
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const frac = (f + '0'.repeat(d + 1)).slice(0, d + 1); // one extra digit for rounding
  let n = Number(i || '0') * 10 ** d + Number(frac.slice(0, d) || '0');
  if (Number(frac[d]) >= 5) n += 1;
  return neg ? -n : n;
}

/** 12500 → "12.500" */
export function fmt(minor, cur = 'OMR', { symbol = false } = {}) {
  const d = decimalsOf(cur);
  const n = Number(minor || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 10 ** d).toLocaleString('en-US');
  const frac = d ? '.' + String(abs % 10 ** d).padStart(d, '0') : '';
  return (neg ? '-' : '') + (symbol ? cur + ' ' : '') + whole + frac;
}

export function roundHalf(x) { return x < 0 ? -Math.round(-x) : Math.round(x); }

/** Percentage of an amount where the rate is in basis points (500 = 5 %). */
export const pct = (amount, bp) => roundHalf((amount * bp) / 10000);

/**
 * VAT on one line. `gross` is the line amount after discount, as priced.
 * inclusive=true  → gross already contains VAT: vat = gross × r / (1 + r)
 * inclusive=false → VAT is added on top.
 */
export function lineTax(gross, rateBp, inclusive) {
  if (!rateBp) return { net: gross, vat: 0, total: gross };
  if (inclusive) {
    const vat = roundHalf((gross * rateBp) / (10000 + rateBp));
    return { net: gross - vat, vat, total: gross };
  }
  const vat = pct(gross, rateBp);
  return { net: gross, vat, total: gross + vat };
}

/**
 * Split `total` across `weights` proportionally so the parts are integers that sum exactly to total
 * (largest-remainder method). Used for order discounts, landed cost and partial refunds.
 */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (!weights.length) return [];
  if (sum <= 0) { const out = weights.map(() => 0); out[0] = total; return out; }
  const raw = weights.map((w) => (total * Math.max(0, w)) / sum);
  const out = raw.map((r) => Math.floor(r));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k][1]] += 1;
  return out;
}
