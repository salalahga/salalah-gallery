/**
 * Read a bill / receipt photo in the browser with Tesseract (free, runs on the phone or computer,
 * files served from our own /ocr folder — nothing is sent to an outside service).
 * Then pick out the total, date, shop name and bill number from the text.
 */
type TWorker = { recognize: (img: HTMLCanvasElement | string) => Promise<{ data: { text: string; confidence: number } }> };
let workerP: Promise<TWorker> | null = null;
let progressCb: ((p: number) => void) | null = null;

function getWorker(): Promise<TWorker> {
  if (!workerP) {
    workerP = import('tesseract.js').then(async (T) => {
      const w = await T.createWorker('eng', 1, {
        workerPath: '/ocr/worker.min.js', corePath: '/ocr/', langPath: '/ocr/', gzip: true,
        logger: (m: { status: string; progress: number }) => { if (m.status === 'recognizing text') progressCb?.(m.progress); },
      });
      return w as unknown as TWorker;
    }).catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

/** Grey-scale, stretch contrast and scale to a size Tesseract reads well. */
async function prepare(src: string): Promise<HTMLCanvasElement> {
  const img = new Image(); img.src = src; await img.decode();
  const k = Math.min(2.2, 2000 / Math.max(img.width, img.height), Math.max(1, 1400 / img.width));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height); const px = d.data;
  let lo = 255, hi = 0; const grey = new Uint8ClampedArray(px.length / 4);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) { const v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; grey[j] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) { const v = ((grey[j] - lo) / span) * 255; px[i] = px[i + 1] = px[i + 2] = v; }
  g.putImageData(d, 0, 0);
  return c;
}

export interface BillItem { description: string; qty: number; price: number; total: number }
export interface BillInfo { text: string; confidence: number; amount?: number; date?: string; vendor?: string; billNo?: string; vat?: number; items?: BillItem[] }

export async function readBill(src: string, onProgress?: (p: number) => void): Promise<BillInfo> {
  const w = await getWorker();
  progressCb = onProgress || null;
  try {
    const { data } = await w.recognize(await prepare(src));
    return { ...parseBill(data.text), text: data.text, confidence: data.confidence };
  } finally { progressCb = null; }
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function validDate(y: number, m: number, d: number) {
  if (y < 100) y += 2000;
  if (y < 2000 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const s = ymd(y, m, d); const t = new Date(); t.setDate(t.getDate() + 1);
  return s <= t.toISOString().slice(0, 10) ? s : undefined;
}
/** Money values on a line: 12.500 / 1,234.50 / 45 (a value without decimals only when nothing else is there). */
function amounts(line: string) {
  const clean = line.replace(/(\d)[ ,](?=\d{3}\b)/g, '$1').replace(/(\d)\s*[.,]\s*(\d{2,3})\b/g, '$1.$2');
  const dec = [...clean.matchAll(/(?<![\d/:-])(\d{1,7}\.\d{2,3})(?![\d/:%])/g)].map((m) => Number(m[1]));
  if (dec.length) return dec;
  return [...clean.matchAll(/(?<![\d/:.-])(\d{1,6})(?![\d/:.%])/g)].map((m) => Number(m[1])).filter((n) => n > 0);
}

/** Pull the useful fields out of OCR text. Day-first dates (as printed in Oman / the Gulf). */
export function parseBill(text: string): Omit<BillInfo, 'text' | 'confidence'> {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out: Omit<BillInfo, 'text' | 'confidence'> = {};
  // total: strongest keyword wins, nearest the bottom
  const RULES: [RegExp, number][] = [
    [/grand\s*total|net\s*(total|amount|payable)|total\s*(amount\s*)?(payable|due)|amount\s*(due|payable)|balance\s*due|total\s*(incl|inc\.?|with)\b.*vat|المجموع|الإجمالي|الاجمالي/i, 3],
    [/\btotal\b|\btot\b|\bamount\b|\bamt\b|\bnet\b/i, 2],
  ];
  let best: { n: number; score: number; idx: number } | undefined;
  lines.forEach((l, idx) => {
    if (/sub\s*-?\s*total|total\s*(qty|quantity|items?|pcs)|discount|vat\s*(no|reg|number|in)|tax\s*(no|reg)|change|tender|cash\s*paid|paid\s*amount/i.test(l)) return;
    for (const [re, score] of RULES) {
      if (!re.test(l)) continue;
      let vals = amounts(l.replace(re, ' '));
      if (!vals.length && lines[idx + 1]) vals = amounts(lines[idx + 1]);
      const n = vals.length ? vals[vals.length - 1] : undefined;
      if (n && n > 0 && n < 1e6 && (!best || score > best.score || (score === best.score && idx > best.idx))) best = { n, score, idx };
      break;
    }
  });
  if (best) out.amount = +best.n.toFixed(3);
  else {
    const all = lines.filter((l) => !/(tel|phone|mob|gsm|fax|cr\b|c\.r|vat|tax|p\.?o\.?\s*box|po box)/i.test(l)).flatMap((l) => amounts(l).filter((n) => !Number.isInteger(n)));
    if (all.length) out.amount = Math.max(...all);
  }
  // VAT amount
  for (const l of lines) if (/\bvat\b|ضريبة/i.test(l) && !/(no|reg|number|in)\b/i.test(l)) { const v = amounts(l.replace(/\d+(\.\d+)?\s*%/, ' ')); if (v.length) { out.vat = v[v.length - 1]; break; } }
  // date
  for (const l of lines) {
    let m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(l);
    if (m) { const d = validDate(+m[3], +m[2], +m[1]) || validDate(+m[3], +m[1], +m[2]); if (d) { out.date = d; break; } }
    m = /\b(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})\b/.exec(l);
    if (m) { const d = validDate(+m[1], +m[2], +m[3]); if (d) { out.date = d; break; } }
    m = /\b(\d{1,2})[\s-]*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\s,-]*(\d{2,4})\b/i.exec(l);
    if (m) { const d = validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]); if (d) { out.date = d; break; } }
  }
  // bill number
  for (const l of lines) {
    const m = /\b(?:invoice|inv|bill|receipt|rcpt|voucher)\s*(?:no|number|#)?\.?\s*[:#-]?\s*([A-Z]{0,4}[-/]?\d[\w/-]{0,14})/i.exec(l);
    if (m) { out.billNo = m[1]; break; }
  }
  // item lines: "<description> <qty> <price> <total>" where qty × price ≈ total
  const items: BillItem[] = [];
  for (const l of lines) {
    if (/total|vat|tax|discount|balance|change|cash|tel|phone/i.test(l)) continue;
    const nums = amounts(l); const desc = l.replace(/[\d.,]+/g, ' ').replace(/\b(x|pcs|nos|no|qty|ea|each|omr|ro)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (nums.length < 2 || (desc.match(/[A-Za-z]/g) || []).length < 3) continue;
    const total = nums[nums.length - 1];
    let hit: BillItem | undefined;
    for (let i = 0; i < nums.length - 1 && !hit; i++) for (let j = 0; j < nums.length - 1 && !hit; j++) if (i !== j && Math.abs(nums[i] * nums[j] - total) < Math.max(0.011, total * 0.01)) hit = { description: desc.slice(0, 60), qty: Math.min(nums[i], nums[j]) === nums[i] && Number.isInteger(nums[i]) ? nums[i] : nums[j], price: 0, total };
    if (!hit && nums.length === 2 && Number.isInteger(nums[0]) && nums[0] > 0 && nums[0] < 1000) hit = { description: desc.slice(0, 60), qty: nums[0], price: +(nums[1] / nums[0]).toFixed(3), total: nums[1] };
    if (hit) { if (!hit.price) hit.price = +(hit.total / (hit.qty || 1)).toFixed(3); items.push(hit); }
  }
  if (items.length) out.items = items.slice(0, 30);
  // shop name: first line that looks like a name
  for (const l of lines.slice(0, 6)) {
    const letters = (l.match(/[A-Za-z]/g) || []).length;
    if (letters >= 4 && letters / l.length > 0.5 && !/(invoice|receipt|tax|vat|date|tel|phone|mob|cash|bill|p\.?o\.?\s*box|www|@)/i.test(l)) { out.vendor = l.replace(/[^A-Za-z0-9&.,'() -]/g, '').trim().slice(0, 50); break; }
  }
  return out;
}
