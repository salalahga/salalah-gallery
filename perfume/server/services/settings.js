export const DEFAULT_SETTINGS = {
  business: { name: 'Salalah Perfume Gallery', nameAr: 'معرض صلالة للعطور', address: 'Salalah, Sultanate of Oman', phone: '', email: '', vatNumber: '', crNumber: '', receiptFooter: 'Thank you for shopping with us', receiptFooterAr: 'شكراً لتسوقكم معنا' },
  currency: 'OMR',
  // Oman VAT: standard rate 5 % since 16 April 2021. Kept configurable — verify against current Tax Authority rules.
  tax: { defaultRateBp: 500, pricesIncludeVat: true, registered: true },
  pos: { maxManualDiscountPct: 20, requireOpenTillForCash: true, allowNegativeStock: false },
  loyalty: { enabled: true, pointsPerOmr: 1, pointValueBaisa: 10, vipThreshold: 500000 },
  purchases: { autoApproveBelow: 0, approverMustDiffer: true },
  security: { require2faRoles: [], sessionHours: 12 }, // owner can require 2FA per role in Settings → Security
  delivery: { defaultFee: 2000 },
  fx: { USD: 0.3845, EUR: 0.42, AED: 0.1047, SAR: 0.1025, INR: 0.0046 },
};

export async function getSettings(q) {
  const rows = await q('SELECT key, value FROM settings');
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) out[r.key] = typeof out[r.key] === 'object' && !Array.isArray(out[r.key]) ? { ...out[r.key], ...r.value } : r.value;
  return out;
}

export async function saveSetting(q, key, value) {
  if (!(key in DEFAULT_SETTINGS)) throw Object.assign(new Error('Unknown setting'), { status: 400 });
  await q(`INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`, [key, JSON.stringify(value)]);
}
