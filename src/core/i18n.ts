import { useSyncExternalStore } from 'react';
import { AR1 } from './ar1';
import { AR2 } from './ar2';
import { AR3 } from './ar3';
import { AR4 } from './ar4';
import { AR5 } from './ar5';
import { AR6 } from './ar6';

/**
 * Interface language: English (default) or Arabic, chosen per device with the switch in the top bar.
 * The app is written in English; in Arabic mode the text on screen is swapped through the dictionary
 * (numbers inside sentences are matched as "#") and the layout turns right-to-left. Printed
 * documents (already English + Arabic), user data and anything marked data-no-tr are left alone.
 */
export type Lang = 'en' | 'ar';
const KEY = 'ww-lang';
const read = (): Lang => { try { return localStorage.getItem(KEY) === 'ar' ? 'ar' : 'en'; } catch { return 'en'; } };
let lang: Lang = read();
const subs = new Set<() => void>();
export const getLang = () => lang;
export function useLang(): Lang { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => lang); }
export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* */ }
  // a clean reload puts every screen in the new language (and back to the original English text)
  window.location.reload();
}

const DICT: Record<string, string> = { ...AR1, ...AR2, ...AR3, ...AR4, ...AR5, ...AR6 };
const NUM = /\d[\d,]*(?:\.\d+)?/g;
const cache = new Map<string, string | null>();

function lookup(s: string): string | null {
  if (DICT[s] !== undefined) return DICT[s];
  const nums = s.match(NUM);
  if (!nums) return null;
  const key = s.replace(NUM, '#'); const t = DICT[key];
  if (t === undefined) return null;
  let i = 0; return t.replace(/#/g, () => nums[i++] ?? '#');
}
const MONTH = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g;

/** Arabic for one piece of interface text, or null when it is not interface text (names, codes…). */
export function translate(raw: string): string | null {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s || !/[A-Za-z]/.test(s)) return null;
  if (cache.has(s)) return cache.get(s)!;
  let out: string | null = lookup(s);
  if (out === null) {
    // decorations around a label: "✈️ Telegram", "— Select —", "· due 3 Nov", "▲ 5% vs previous", "Name …"
    const m = /^([^A-Za-z0-9(“"]*)(.*?)([^A-Za-z0-9)”".?!%]*)$/.exec(s);
    if (m && (m[1] || m[3]) && m[2]) { const core = translate(m[2]); if (core) out = m[1] + core + m[3]; }
  }
  if (out === null && /^e\.g\. /.test(s)) out = 'مثلاً ' + (translate(s.slice(5)) ?? s.slice(5));
  if (out === null && s.includes(': ')) { // "Move to: Delivery", "Quotation accepted: done 3 Nov"
    const k = s.indexOf(': '); const a = translate(s.slice(0, k + 1)) ?? translate(s.slice(0, k)); const b = translate(s.slice(k + 2));
    if (a || b) out = `${a ? a.replace(/:?$/, ':') : s.slice(0, k + 1)} ${b ?? s.slice(k + 2)}`;
  }
  for (const sep of [' · ', ' — ', ' → ', ' / ']) {
    if (out !== null || !s.includes(sep)) continue;
    const parts = s.split(sep); const tr = parts.map((p) => translate(p));
    if (tr.some(Boolean)) out = parts.map((p, i) => tr[i] ?? p).join(sep === ' → ' ? ' ← ' : sep);
  }
  if (out === null && MONTH.test(s)) { // dates such as "17 Nov 2026", "Wednesday, 18 November 2026", "due 3 Dec"
    MONTH.lastIndex = 0;
    const replaced = s.replace(MONTH, (w) => DICT[w] ?? w); const rest = replaced.replace(/[\d\s,.:–-]/g, '');
    if (!/[A-Za-z]/.test(rest)) out = replaced;
    else { // "No payroll for Nov 2026", "due 3 Dec 2026": words before the date, then the date
      MONTH.lastIndex = 0; const first = MONTH.exec(s);
      const headText = first ? s.slice(0, first.index).replace(/[\d\s,]+$/, '').trim() : '';
      const h = headText ? translate(headText) : null;
      if (h) out = `${h} ${s.slice(headText.length).trim().replace(MONTH, (w) => DICT[w] ?? w)}`;
    }
  }
  MONTH.lastIndex = 0;
  cache.set(s, out);
  return out;
}

/** For code that builds a label itself. */
export function useT() { const l = useLang(); return (s: string) => (l === 'ar' ? translate(s) ?? s : s); }

// ---------- live translation of the page ----------
const SKIP = '.print-area, .doc, [data-no-tr], script, style, textarea, .code-tag, .site-frame, .bubble.me';
const SKIP_ATTR = '.print-area, .doc, [data-no-tr], .site-frame';
const ATTRS = ['placeholder', 'title', 'aria-label'] as const;
const done = new WeakMap<Node, string>(); // text node → the Arabic we wrote (so our own change is not re-translated)

function doText(n: Text) {
  const v = n.nodeValue || '';
  if (done.get(n) === v) return;
  const el = n.parentElement; if (!el || el.closest(SKIP)) return;
  const t = translate(v); if (!t) return;
  const lead = /^\s*/.exec(v)![0]; const trail = /\s*$/.exec(v)![0];
  const nv = lead + t + trail; done.set(n, nv); n.nodeValue = nv;
}
function doAttrs(el: Element) {
  if (el.closest(SKIP_ATTR)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a); if (!v || el.getAttribute(`data-tr-${a}`) === v) continue;
    const t = translate(v); if (t) { el.setAttribute(`data-tr-${a}`, t); el.setAttribute(a, t); }
  }
}
function walk(root: Node) {
  if (root.nodeType === 3) { doText(root as Text); return; }
  if (root.nodeType !== 1) return;
  const el = root as Element;
  doAttrs(el); for (const x of el.querySelectorAll('[placeholder],[title],[aria-label]')) doAttrs(x);
  if (el.closest(SKIP)) return;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n: Node | null;
  while ((n = w.nextNode())) doText(n as Text);
}

/** Start Arabic mode: right-to-left layout and on-screen translation (call once at start-up). */
export function startLanguage() {
  if (lang !== 'ar') return;
  document.documentElement.dir = 'rtl'; document.documentElement.lang = 'ar';
  const run = () => walk(document.body);
  run();
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target as Text);
      else if (m.type === 'attributes') doAttrs(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
}
