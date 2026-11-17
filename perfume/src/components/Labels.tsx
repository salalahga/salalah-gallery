import { useEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { isValidEan13 } from '../../shared/barcode.js';
import { money, useSession, variantName } from '../core/session';
import { Field, Modal } from './ui';

/** Barcode drawn as SVG: EAN-13 when the code is a valid EAN-13, otherwise Code 128 (any letters/digits). */
export function Barcode({ code, height = 40, width = 1.6, fontSize = 12 }: { code: string; height?: number; width?: number; fontSize?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !code) return;
    try {
      JsBarcode(ref.current, code, { format: isValidEan13(code) ? 'EAN13' : 'CODE128', height, width, fontSize, margin: 0, displayValue: true, textMargin: 1, background: 'transparent' });
    } catch { ref.current.replaceChildren(); }
  }, [code, height, width, fontSize]);
  return <svg ref={ref} style={{ maxWidth: '100%', height: 'auto' }} />;
}

export type LabelItem = { id: string; barcode?: string | null; sku: string; name: string; brand?: string | null; label?: string | null; size_ml?: number | null; retail_price: number; copies: number };

// ---------- label layout ----------
type Layout = { mode: 'roll' | 'a4'; w: number; h: number; cols: number; gap: number; offX: number; offY: number; showPrice: boolean; showShop: boolean };
const PRESETS: Record<string, { name: string; l: Partial<Layout> }> = {
  r38: { name: 'Roll 38 × 25 mm (1 across)', l: { mode: 'roll', w: 38, h: 25, cols: 1, gap: 0 } },
  r40: { name: 'Roll 40 × 30 mm (1 across)', l: { mode: 'roll', w: 40, h: 30, cols: 1, gap: 0 } },
  r50: { name: 'Roll 50 × 25 mm (1 across)', l: { mode: 'roll', w: 50, h: 25, cols: 1, gap: 0 } },
  r50b: { name: 'Roll 50 × 30 mm (1 across)', l: { mode: 'roll', w: 50, h: 30, cols: 1, gap: 0 } },
  r58: { name: 'Roll 58 × 40 mm (1 across)', l: { mode: 'roll', w: 58, h: 40, cols: 1, gap: 0 } },
  r2x35: { name: 'Roll 2 across, 35 × 25 mm (72 mm roll)', l: { mode: 'roll', w: 35, h: 25, cols: 2, gap: 2 } },
  r2x40: { name: 'Roll 2 across, 40 × 30 mm (82 mm roll)', l: { mode: 'roll', w: 40, h: 30, cols: 2, gap: 2 } },
  r3x30: { name: 'Roll 3 across, 30 × 20 mm (96 mm roll)', l: { mode: 'roll', w: 30, h: 20, cols: 3, gap: 3 } },
  a4: { name: 'A4 sticker sheet 3 × 8 (70 × 37 mm)', l: { mode: 'a4', w: 70, h: 37, cols: 3, gap: 0 } },
  custom: { name: 'Custom size…', l: {} },
};
const DEFAULT: Layout = { mode: 'roll', w: 38, h: 25, cols: 1, gap: 0, offX: 0, offY: 0, showPrice: true, showShop: true };
const KEY = 'pf-label-layout-v2';
const loadLayout = (): { preset: string; layout: Layout } => {
  try { const v = JSON.parse(localStorage.getItem(KEY) || ''); if (v?.layout) return { preset: v.preset, layout: { ...DEFAULT, ...v.layout } }; } catch { /* first time */ }
  return { preset: 'r38', layout: DEFAULT };
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Barcode SVG markup that scales to its box (viewBox + 100 % size). */
function barcodeSvg(code: string, small: boolean) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, code, { format: isValidEan13(code) ? 'EAN13' : 'CODE128', height: small ? 46 : 60, width: 2, fontSize: small ? 15 : 18, margin: 0, marginLeft: 14, marginRight: 14, displayValue: true, textMargin: 1, background: '#ffffff' });
  } catch { return `<div class="nobc">${esc(code)}</div>`; }
  const w = svg.getAttribute('width')?.replace('px', '') || '200', h = svg.getAttribute('height')?.replace('px', '') || '60';
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.removeAttribute('style');
  return svg.outerHTML;
}

/**
 * A complete, self-contained print document sized exactly to the label stock. Printing it in its own
 * frame keeps the app's styles out, so the browser uses the label size instead of a full A4/Letter page.
 */
function labelDocument(labels: LabelItem[], L: Layout, shop: string, preview = false) {
  const small = L.h <= 25;
  const fs = Math.max(0.8, Math.min(1.5, L.h / 25)); // font scale follows label height
  const label = (it: LabelItem) => `<div class="lbl">
    ${L.showShop ? `<div class="shop">${esc(shop)}</div>` : ''}
    <div class="name">${esc(variantName(it))}</div>
    <div class="code">${it.barcode ? barcodeSvg(it.barcode, small) : '<div class="nobc">NO BARCODE</div>'}</div>
    ${L.showPrice ? `<div class="price">OMR ${esc(money(it.retail_price))}</div>` : ''}
  </div>`;
  let pageW: number, pageH: number, body: string, pageCss: string;
  if (L.mode === 'a4') {
    pageW = 210; pageH = 297;
    pageCss = '@page { size: A4 portrait; margin: 10mm 0 0 0; }';
    body = `<div class="sheet">${labels.map(label).join('')}</div>`;
  } else {
    pageW = L.cols * L.w + (L.cols - 1) * L.gap + L.offX; pageH = L.h + L.offY;
    pageCss = `@page { size: ${pageW}mm ${pageH}mm; margin: 0; }`;
    const rows: string[] = [];
    for (let i = 0; i < labels.length; i += L.cols) rows.push(`<div class="row">${labels.slice(i, i + L.cols).map(label).join('')}</div>`);
    body = rows.join('');
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
${pageCss}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Arial, Helvetica, sans-serif; }
.row { display: flex; gap: ${L.gap}mm; width: ${pageW}mm; height: ${pageH}mm; padding: ${L.offY}mm 0 0 ${L.offX}mm; overflow: hidden; break-after: page; page-break-after: always; }
.row:last-child { break-after: auto; page-break-after: auto; }
.sheet { display: grid; grid-template-columns: repeat(3, 70mm); grid-auto-rows: 37mm; width: 210mm; }
.sheet .lbl:nth-child(24n) { break-after: page; page-break-after: always; }
.lbl { width: ${L.w}mm; height: ${L.h}mm; padding: 0.8mm 1.2mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between; overflow: hidden; flex: none; }
.shop { font-size: ${(5.5 * fs).toFixed(1)}pt; letter-spacing: .12em; text-transform: uppercase; line-height: 1; white-space: nowrap; }
.name { font-size: ${(6.5 * fs).toFixed(1)}pt; font-weight: 700; line-height: 1.1; text-align: center; max-height: 2.25em; overflow: hidden; }
.code { flex: 1; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; padding: 0.3mm 0; }
.code svg { width: 100%; height: 100%; display: block; }
.price { font-size: ${(8 * fs).toFixed(1)}pt; font-weight: 800; line-height: 1; }
.nobc { font-size: 7pt; font-weight: 700; }
${preview ? `body { padding: 8px; background: #efe8dc; } .row, .sheet { background: #fff; margin-bottom: 6px; outline: 1px dashed #b9ab95; } .lbl { outline: 1px dotted #d6c9b4; }` : ''}
</style></head><body>${body}</body></html>`;
}

function printDocument(html: string) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  Object.assign(f.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(f);
  const w = f.contentWindow!;
  w.document.open(); w.document.write(html); w.document.close();
  const go = () => { w.focus(); w.print(); setTimeout(() => f.remove(), 2000); };
  if (w.document.readyState === 'complete') setTimeout(go, 150); else f.onload = () => setTimeout(go, 150);
}

/** Pick sizes and copies, preview exactly what prints, test-print one label, then print all. */
export function LabelPrinter({ items: initial, onClose }: { items: LabelItem[]; onClose: () => void }) {
  const { me } = useSession();
  const shop = me.settings.business.name;
  const saved = useMemo(loadLayout, []);
  const [preset, setPreset] = useState(saved.preset);
  const [L, setL] = useState<Layout>(saved.layout);
  const [items, setItems] = useState(initial.map((i) => ({ ...i, copies: Math.max(1, i.copies || 1) })));
  const [help, setHelp] = useState(false);
  const all = items.flatMap((it) => Array.from({ length: it.copies }, () => it));
  const set = (patch: Partial<Layout>) => { setL((x) => ({ ...x, ...patch })); setPreset('custom'); };
  const choose = (k: string) => { setPreset(k); if (k !== 'custom') setL((x) => ({ ...x, offX: 0, offY: 0, ...PRESETS[k].l } as Layout)); };
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ preset, layout: L })); } catch { /* private mode */ } }, [preset, L]);
  const pageW = L.mode === 'a4' ? 210 : L.cols * L.w + (L.cols - 1) * L.gap + L.offX;
  const previewDoc = useMemo(() => labelDocument(all.slice(0, L.mode === 'a4' ? 6 : L.cols * 2), L, shop, true), [all, L, shop]);
  const num = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Number(v) || 0));

  return (
    <Modal wide title="Print barcode labels" onClose={onClose} footer={<>
      <button className="btn" onClick={() => setHelp(!help)}>Printer setup help</button>
      <button className="btn" disabled={!all.length} onClick={() => printDocument(labelDocument(all.slice(0, L.mode === 'a4' ? 1 : L.cols), L, shop))}>Test print (1 row)</button>
      <button className="btn gold" disabled={!all.length} onClick={() => printDocument(labelDocument(all, L, shop))}>Print {all.length} label{all.length === 1 ? '' : 's'}</button>
    </>}>
      {help && (
        <div className="alert info" style={{ marginBottom: 14 }}>
          <b>If labels come out on a full A4 page:</b>
          <ol style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
            <li>Install the printer's own driver (Xprinter, TSC, Zebra, Godex…), not "Generic / Text only".</li>
            <li>Windows → Printers → your label printer → <b>Printing preferences</b> → Paper / Stock: create or choose a size of <b>{pageW} × {L.mode === 'a4' ? 297 : L.h + L.offY} mm</b>, media type <b>Labels with gaps</b>. Run the printer's <b>calibration</b> (usually hold the FEED button until it feeds 2–3 labels).</li>
            <li>In this app click <b>Test print</b>. In the print window: Destination = your label printer → <b>More settings</b> → Paper size = the label size above, Margins = <b>None</b>, Scale = <b>Default</b> (not "Fit"), Headers and footers = <b>off</b>.</li>
            <li>If the print is shifted, use <b>Move right / Move down</b> below by 1 mm at a time. If one label prints across two, the height is wrong — measure the label without the gap.</li>
            <li>Chrome / Edge remember these print settings per printer, so this is a one-time setup.</li>
          </ol>
        </div>
      )}
      <div className="grid g2">
        <div className="col">
          <Field label="Label stock"><select value={preset} onChange={(e) => choose(e.target.value)}>{Object.entries(PRESETS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select></Field>
          {L.mode === 'roll' && (
            <div className="grid g3" style={{ gap: 8 }}>
              <Field label="Label width (mm)"><input inputMode="decimal" value={L.w} onChange={(e) => set({ w: num(e.target.value, 15, 120) })} /></Field>
              <Field label="Label height (mm)"><input inputMode="decimal" value={L.h} onChange={(e) => set({ h: num(e.target.value, 10, 120) })} /></Field>
              <Field label="Labels across"><select value={L.cols} onChange={(e) => set({ cols: Number(e.target.value) })}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></Field>
              {L.cols > 1 && <Field label="Gap between (mm)"><input inputMode="decimal" value={L.gap} onChange={(e) => set({ gap: num(e.target.value, 0, 10) })} /></Field>}
              <Field label="Move right (mm)"><input inputMode="decimal" value={L.offX} onChange={(e) => set({ offX: num(e.target.value, 0, 20) })} /></Field>
              <Field label="Move down (mm)"><input inputMode="decimal" value={L.offY} onChange={(e) => set({ offY: num(e.target.value, 0, 20) })} /></Field>
            </div>
          )}
          <div className="row">
            <label className="check"><input type="checkbox" checked={L.showPrice} onChange={(e) => setL({ ...L, showPrice: e.target.checked })} /> Price</label>
            <label className="check"><input type="checkbox" checked={L.showShop} onChange={(e) => setL({ ...L, showShop: e.target.checked })} /> Shop name</label>
          </div>
          <div className="small muted">Paper size to set on the printer: <b>{pageW} × {L.mode === 'a4' ? 297 : L.h + L.offY} mm</b>{L.mode === 'roll' && L.cols > 1 ? ` (${L.cols} labels per row)` : ''}.</div>
          <table className="t"><thead><tr><th>Product</th><th>Barcode</th><th>Copies</th></tr></thead>
            <tbody>{items.map((it, i) => (
              <tr key={it.id}><td>{variantName(it)}<div className="small muted">{it.sku}</div></td><td className="small">{it.barcode || <span className="bad">none — add one first</span>}</td>
                <td><input type="number" min={0} max={500} value={it.copies} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, copies: Math.max(0, Math.min(500, Number(e.target.value) || 0)) } : x)))} style={{ width: 80 }} /></td></tr>
            ))}</tbody></table>
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>Preview — exactly what is sent to the printer (dashed line = one printed page)</div>
          <iframe title="Label preview" srcDoc={previewDoc} style={{ width: '100%', height: 320, border: '1px solid var(--line)', borderRadius: 14, background: '#efe8dc' }} />
        </div>
      </div>
    </Modal>
  );
}
