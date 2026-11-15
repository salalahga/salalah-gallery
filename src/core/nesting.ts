import type { CutPart } from './types';

export interface Placed { name: string; x: number; y: number; w: number; h: number; rotated: boolean }
export interface SheetLayout { parts: Placed[]; used: number }
export interface NestResult { sheets: SheetLayout[]; oversize: string[]; partArea: number; sheetArea: number; utilisation: number; count: number }

/**
 * Shelf packing (first-fit decreasing height) — a fast, safe estimate of how many sheets a job needs.
 * Parts may rotate 90° unless `grain` is set. Real CNC nesting software can do slightly better; this
 * never under-counts the sheets it lays out.
 */
export function nest(parts: CutPart[], sheetL: number, sheetW: number, kerf = 4): NestResult {
  const a = Number(sheetL) || 2440, b = Number(sheetW) || 1220, k = Math.max(0, Number(kerf) || 0);
  const L = Math.max(a, b), W = Math.min(a, b);
  const items: { name: string; l: number; w: number; grain: boolean }[] = [];
  const oversize: string[] = [];
  for (const p of parts) {
    const l = Number(p.length) || 0, w = Number(p.width) || 0, q = Math.max(0, Math.floor(Number(p.qty) || 0));
    if (!l || !w || !q) continue;
    const fits = (l <= L && w <= W) || (!p.grain && w <= L && l <= W);
    if (!fits) { oversize.push(`${p.name || 'Part'} ${l}×${w}`); continue; }
    for (let i = 0; i < q; i++) items.push({ name: p.name || 'Part', l, w, grain: !!p.grain });
  }
  // place the tallest strips first; orient each part so its short side is the strip height when allowed
  const prepared = items.map((it) => {
    if (it.grain) return { ...it, pw: it.l, ph: it.w, rot: false };
    const long = Math.max(it.l, it.w), short = Math.min(it.l, it.w);
    return long <= L ? { ...it, pw: long, ph: short, rot: it.l !== long } : { ...it, pw: short, ph: long, rot: it.l === long };
  }).sort((a, b) => b.ph - a.ph || b.pw - a.pw);

  type Shelf = { y: number; h: number; x: number };
  const sheets: { shelves: Shelf[]; parts: Placed[]; top: number }[] = [];
  for (const it of prepared) {
    let placed = false;
    for (const s of sheets) {
      for (const sh of s.shelves) {
        if (it.ph <= sh.h && sh.x + it.pw <= L) { s.parts.push({ name: it.name, x: sh.x, y: sh.y, w: it.pw, h: it.ph, rotated: it.rot }); sh.x += it.pw + k; placed = true; break; }
      }
      if (placed) break;
      if (s.top + it.ph <= W) {
        const sh = { y: s.top, h: it.ph, x: it.pw + k };
        s.shelves.push(sh); s.parts.push({ name: it.name, x: 0, y: s.top, w: it.pw, h: it.ph, rotated: it.rot }); s.top += it.ph + k; placed = true; break;
      }
    }
    if (!placed) sheets.push({ shelves: [{ y: 0, h: it.ph, x: it.pw + k }], parts: [{ name: it.name, x: 0, y: 0, w: it.pw, h: it.ph, rotated: it.rot }], top: it.ph + k });
  }
  const partArea = items.reduce((n, it) => n + it.l * it.w, 0);
  const sheetArea = sheets.length * L * W;
  return {
    sheets: sheets.map((s) => ({ parts: s.parts, used: s.parts.reduce((n, p) => n + p.w * p.h, 0) / (L * W) })),
    oversize, partArea, sheetArea, utilisation: sheetArea ? partArea / sheetArea : 0, count: items.length,
  };
}
