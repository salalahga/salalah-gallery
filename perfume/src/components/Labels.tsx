import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

const SIZES = {
  '38x25': { name: 'Thermal label 38 × 25 mm', w: 38, h: 25, sheet: false },
  '50x30': { name: 'Thermal label 50 × 30 mm', w: 50, h: 30, sheet: false },
  '58x40': { name: 'Thermal label 58 × 40 mm', w: 58, h: 40, sheet: false },
  a4: { name: 'A4 sticker sheet (3 × 8 = 24 labels, 70 × 37 mm)', w: 70, h: 37, sheet: true },
} as const;
type SizeKey = keyof typeof SIZES;

function Label({ it, size, showPrice, shop }: { it: LabelItem; size: SizeKey; showPrice: boolean; shop: string }) {
  const s = SIZES[size];
  const small = s.h <= 25;
  return (
    <div className="lbl" style={{ width: `${s.w}mm`, height: `${s.h}mm` }}>
      <div className="lbl-shop">{shop}</div>
      <div className="lbl-name">{variantName(it)}</div>
      <div className="lbl-code">{it.barcode ? <Barcode code={it.barcode} height={small ? 22 : 34} width={small ? 1.1 : 1.4} fontSize={small ? 9 : 11} /> : <span className="bad">No barcode</span>}</div>
      {showPrice && <div className="lbl-price">OMR {money(it.retail_price)}</div>}
    </div>
  );
}

/** Pick sizes and copies, preview, and print barcode labels. */
export function LabelPrinter({ items: initial, onClose }: { items: LabelItem[]; onClose: () => void }) {
  const { me } = useSession();
  const [items, setItems] = useState(initial.map((i) => ({ ...i, copies: Math.max(1, i.copies || 1) })));
  const [size, setSize] = useState<SizeKey>(() => { try { return (localStorage.getItem('pf-label-size') as SizeKey) || '38x25'; } catch { return '38x25'; } });
  const [showPrice, setShowPrice] = useState(true);
  const [printing, setPrinting] = useState(false);
  const all = items.flatMap((it) => Array.from({ length: it.copies }, () => it));
  const s = SIZES[size];

  const print = () => {
    try { localStorage.setItem('pf-label-size', size); } catch { /* ignore */ }
    const style = document.createElement('style');
    style.id = 'label-page';
    style.textContent = s.sheet ? '@page { size: A4; margin: 10mm 5mm; }' : `@page { size: ${s.w}mm ${s.h}mm; margin: 0; }`;
    document.head.appendChild(style);
    document.body.classList.add('print-labels');
    setPrinting(true);
    setTimeout(() => {
      window.print();
      document.body.classList.remove('print-labels');
      style.remove();
      setPrinting(false);
    }, 300);
  };

  return (
    <Modal wide title="Print barcode labels" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn gold" disabled={!all.length} onClick={print}>Print {all.length} label{all.length === 1 ? '' : 's'}</button></>}>
      <div className="grid g2">
        <div className="col">
          <Field label="Label size / printer"><select value={size} onChange={(e) => setSize(e.target.value as SizeKey)}>{Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select></Field>
          <label className="check"><input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} /> Show the price on the label</label>
          <table className="t"><thead><tr><th>Product</th><th>Barcode</th><th>Copies</th></tr></thead>
            <tbody>{items.map((it, i) => (
              <tr key={it.id}><td>{variantName(it)}<div className="small muted">{it.sku}</div></td><td className="small">{it.barcode || <span className="bad">none — add one first</span>}</td>
                <td><input type="number" min={0} max={500} value={it.copies} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, copies: Math.max(0, Math.min(500, Number(e.target.value) || 0)) } : x)))} style={{ width: 80 }} /></td></tr>
            ))}</tbody></table>
          <div className="small muted">Thermal label printers (Zebra, Xprinter, TSC, Brother …): set the same label size in the printer settings and choose “Actual size / 100 %” in the print dialog. Any USB barcode scanner reads these labels.</div>
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>Preview</div>
          <div className="lbl-preview">{all.slice(0, 6).map((it, k) => <Label key={k} it={it} size={size} showPrice={showPrice} shop={me.settings.business.name} />)}</div>
          {all.length > 6 && <div className="small muted">… and {all.length - 6} more</div>}
        </div>
      </div>
      {printing && createPortal(
        <div id="print-root" className={s.sheet ? 'sheet' : 'roll'}>{all.map((it, k) => <Label key={k} it={it} size={size} showPrice={showPrice} shop={me.settings.business.name} />)}</div>,
        document.body,
      )}
    </Modal>
  );
}
