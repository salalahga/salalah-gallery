// Voice / typed command parser for the POS (English + Arabic).
// It only turns words into a structured intent. Nothing is ever charged from a voice command:
// the POS shows the resulting cart and a person confirms payment on screen.

const EN_NUM = { a: 1, an: 1, one: 1, single: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12 };
const AR_NUM = { 'واحد': 1, 'واحدة': 1, 'اثنين': 2, 'اثنان': 2, 'إثنين': 2, 'ثنتين': 2, 'زوج': 2, 'ثلاث': 3, 'ثلاثة': 3, 'أربع': 4, 'اربع': 4, 'أربعة': 4, 'اربعة': 4, 'خمس': 5, 'خمسة': 5, 'ست': 6, 'ستة': 6, 'سبع': 7, 'سبعة': 7, 'ثمان': 8, 'ثمانية': 8, 'تسع': 9, 'تسعة': 9, 'عشر': 10, 'عشرة': 10 };
const FILLER = new Set(['bottle', 'bottles', 'piece', 'pieces', 'pcs', 'pc', 'unit', 'units', 'of', 'the', 'please', 'x', 'perfume', 'perfumes', 'item', 'items', 'to', 'cart', 'and', 'add', 'زجاجة', 'زجاجات', 'حبة', 'حبات', 'قطعة', 'من', 'عطر', 'لو', 'سمحت', 'أضف', 'اضف', 'ضيف', 'أضيف']);

export function normalise(text) {
  return String(text || '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/٪/g, '%').replace(/[،,؟?!.]+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function extractSize(s) {
  const m = s.match(/(\d{1,4})\s*(ml|mls|millilitre|milliliter|مللي|ملل|مل)(?=\s|$)/);
  if (!m) return { size: null, rest: s };
  return { size: Number(m[1]), rest: s.replace(m[0], ' ') };
}

function extractQty(words) {
  for (let i = 0; i < Math.min(words.length, 3); i++) {
    const w = words[i];
    const n = /^\d{1,3}$/.test(w) ? Number(w) : EN_NUM[w] ?? AR_NUM[w];
    if (n) return { qty: n, words: words.filter((_, k) => k !== i) };
  }
  return { qty: 1, words };
}

const cleanQuery = (words) => words.filter((w) => !FILLER.has(w)).join(' ').trim();

/**
 * Parse one command. Returns { intent, ... } where intent is one of:
 * add, remove, discount, availability, today_sales, checkout, customer, clear, unknown.
 */
export function parseCommand(text) {
  const raw = String(text || '');
  const s = normalise(raw);
  if (!s) return { intent: 'unknown', raw };

  // customer search by phone
  const phone = s.replace(/[\s-]/g, '').match(/\+?\d{8,12}/);
  if (/(customer|client|عميل|زبون)/.test(s) && phone) return { intent: 'customer', phone: phone[0], raw };

  // discount
  if (/(discount|off|خصم|تخفيض)/.test(s)) {
    const m = s.match(/(\d{1,2}(?:\.\d+)?)\s*(%|percent|per cent|بالمئة|بالمية|في المئة|بالمائة)/) || s.match(/(?:discount|خصم|تخفيض)\s*(\d{1,2}(?:\.\d+)?)/);
    if (m) return { intent: 'discount', percent: Number(m[1]), raw };
    const a = s.match(/(\d+(?:\.\d+)?)\s*(omr|rial|riyal|ريال)/);
    if (a) return { intent: 'discount', amount: Number(a[1]), raw };
  }

  if (/(today'?s? sales|sales today|show today|مبيعات اليوم)/.test(s)) return { intent: 'today_sales', raw };
  if (/^(clear|empty|cancel) (the )?(cart|sale)|^(امسح|الغ|ألغ) (السلة|الفاتورة)/.test(s)) return { intent: 'clear', raw };
  if (/(generate|create|make|print|issue)?\s*(the )?(invoice|receipt|bill)|checkout|check out|^pay|فاتورة|الفاتورة|ادفع|الدفع/.test(s)) return { intent: 'checkout', raw };

  const avail = s.match(/^(?:check|is|are|do we have|have we got)\s+(?:the\s+)?(?:availability|stock)?\s*(?:of|for)?\s*(.+?)(?:\s+(?:available|in stock))?$/)
    || s.match(/^(?:availability|stock)\s+(?:of|for)?\s*(.+)$/)
    || s.match(/^(?:هل\s+)?(?:يتوفر|متوفر|توفر|متاح|كم المخزون من|المخزون)\s+(.+)$/);
  if (avail && /(check|avail|stock|have|is |are |توفر|يتوفر|متوفر|متاح|مخزون)/.test(s)) {
    const { size, rest } = extractSize(avail[1]);
    return { intent: 'availability', query: cleanQuery(rest.split(' ').filter(Boolean)), sizeMl: size, raw };
  }

  const rem = s.match(/^(?:remove|delete|take off|احذف|شيل|ازل|أزل)\s+(.+)$/);
  if (rem) {
    const { size, rest } = extractSize(rem[1]);
    return { intent: 'remove', query: cleanQuery(rest.split(' ').filter(Boolean)), sizeMl: size, raw };
  }

  const add = s.match(/^(?:add|أضف|اضف|ضيف|أضيف|زيد|i want|give me|بيع|sell)\s+(.+)$/);
  const body = add ? add[1] : s;
  const { size, rest } = extractSize(body);
  const { qty, words } = extractQty(rest.split(' ').filter(Boolean));
  const query = cleanQuery(words);
  if (!query) return { intent: 'unknown', raw };
  return { intent: 'add', qty, query, sizeMl: size, raw, explicit: !!add };
}

/** Score catalogue variants against a spoken product name. variants: [{id, name, brand, label, sizeMl, sku, barcode, nameAr}] */
export function matchVariants(query, sizeMl, variants, limit = 5) {
  const q = normalise(query);
  if (!q) return [];
  const qt = q.split(' ').filter((w) => w.length > 1 || /\d/.test(w));
  const scored = [];
  for (const v of variants) {
    if (sizeMl && v.sizeMl && v.sizeMl !== sizeMl) continue;
    const hay = normalise([v.brand, v.name, v.nameAr, v.label, v.sku, v.barcode].filter(Boolean).join(' '));
    if (v.barcode && q === normalise(v.barcode)) { scored.push({ v, score: 1000 }); continue; }
    let score = 0;
    for (const t of qt) {
      if (hay.split(' ').includes(t)) score += 10;
      else if (hay.includes(t)) score += 6;
      else if (t.length >= 4 && hay.split(' ').some((h) => h.startsWith(t.slice(0, 4)))) score += 3;
    }
    if (!score) continue;
    if (sizeMl && v.sizeMl === sizeMl) score += 5;
    scored.push({ v, score: score / Math.max(1, qt.length) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => ({ ...x.v, score: x.score }));
}
