import { useMemo, useState } from 'react';
import { Plus, Trash2, Printer, Scissors } from 'lucide-react';
import type { CuttingList, Item, Settings } from '../core/types';
import { uid } from '../core/store';
import { nest } from '../core/nesting';
import { money } from '../core/calc';
import { Modal } from './ui';

const COLORS = ['#e0a458', '#93c5fd', '#86efac', '#fca5a5', '#c4b5fd', '#fcd34d', '#a5f3fc', '#f9a8d4'];
export const emptyCutting = (): CuttingList => ({ sheetL: 2440, sheetW: 1220, kerf: 4, parts: [{ id: uid(), name: '', length: 0, width: 0, qty: 1 }] });

export function SheetSvg({ parts, L, W, width = 360 }: { parts: { name: string; x: number; y: number; w: number; h: number }[]; L: number; W: number; width?: number }) {
  const names = [...new Set(parts.map((p) => p.name))];
  return (
    <svg viewBox={`0 0 ${L} ${W}`} width={width} style={{ background: '#f5ead9', border: '1px solid #c9b79f', borderRadius: 4, maxWidth: '100%', height: 'auto' }}>
      {parts.map((p, i) => <g key={i}>
        <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={COLORS[names.indexOf(p.name) % COLORS.length]} stroke="#7c4a1e" strokeWidth={4} />
        {p.w > 180 && p.h > 70 && <text x={p.x + p.w / 2} y={p.y + p.h / 2} fontSize={Math.min(60, p.h / 3)} textAnchor="middle" dominantBaseline="middle" fill="#2a1f17">{p.name} {p.w}×{p.h}</text>}
      </g>)}
    </svg>
  );
}

export function CuttingListEditor({ value, onChange, items, s, readOnly, title }: { value?: CuttingList; onChange: (c: CuttingList) => void; items: Item[]; s: Settings; readOnly?: boolean; title: string }) {
  const c = value || emptyCutting();
  const [print, setPrint] = useState(false);
  const set = (p: Partial<CuttingList>) => onChange({ ...c, ...p });
  const setPart = (i: number, p: Partial<CuttingList['parts'][number]>) => set({ parts: c.parts.map((x, k) => (k === i ? { ...x, ...p } : x)) });
  const r = useMemo(() => nest(c.parts, c.sheetL, c.sheetW, c.kerf), [c]);
  const boards = items.filter((i) => i.kind === 'material' && /sheet/i.test(i.unit));
  const item = items.find((i) => i.id === c.itemId);
  const pickBoard = (id: string) => {
    const it = items.find((i) => i.id === id);
    const m = it?.size?.match(/(\d+)\s*[×x*]\s*(\d+)/);
    set({ itemId: id || undefined, material: it ? `${it.name} ${it.thickness || ''}`.trim() : c.material, ...(m ? { sheetL: Math.max(+m[1], +m[2]), sheetW: Math.min(+m[1], +m[2]) } : {}) });
  };
  return (
    <div className="span-3 cutting">
      <div className="form" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <label className="field"><span>Board (from stock)</span><select disabled={readOnly} value={c.itemId || ''} onChange={(e) => pickBoard(e.target.value)}><option value="">— type below —</option>{boards.map((b) => <option key={b.id} value={b.id}>{b.name} {b.thickness} ({b.qty} in stock)</option>)}</select></label>
        <label className="field"><span>Sheet length (mm)</span><input disabled={readOnly} type="number" value={c.sheetL} onChange={(e) => set({ sheetL: +e.target.value })} /></label>
        <label className="field"><span>Sheet width (mm)</span><input disabled={readOnly} type="number" value={c.sheetW} onChange={(e) => set({ sheetW: +e.target.value })} /></label>
        <label className="field"><span>Saw / bit gap (mm)</span><input disabled={readOnly} type="number" value={c.kerf} onChange={(e) => set({ kerf: +e.target.value })} /></label>
      </div>
      <div className="table-wrap" style={{ margin: '10px 0 0' }}><table className="lines">
        <thead><tr><th>Part name</th><th style={{ width: 110 }}>Length mm</th><th style={{ width: 110 }}>Width mm</th><th style={{ width: 70 }}>Qty</th><th title="Keep grain direction (no rotation)">Grain</th><th /></tr></thead>
        <tbody>{c.parts.map((p, i) => <tr key={p.id}>
          <td><input disabled={readOnly} value={p.name} placeholder="e.g. Side panel" onChange={(e) => setPart(i, { name: e.target.value })} /></td>
          <td><input disabled={readOnly} type="number" value={p.length || ''} onChange={(e) => setPart(i, { length: +e.target.value })} /></td>
          <td><input disabled={readOnly} type="number" value={p.width || ''} onChange={(e) => setPart(i, { width: +e.target.value })} /></td>
          <td><input disabled={readOnly} type="number" value={p.qty} onChange={(e) => setPart(i, { qty: +e.target.value })} /></td>
          <td style={{ textAlign: 'center' }}><input disabled={readOnly} type="checkbox" checked={!!p.grain} onChange={(e) => setPart(i, { grain: e.target.checked })} /></td>
          <td>{!readOnly && <button type="button" className="icon-btn" onClick={() => set({ parts: c.parts.filter((_, k) => k !== i) })}><Trash2 size={14} /></button>}</td>
        </tr>)}</tbody></table></div>
      <div className="flex wrap" style={{ marginTop: 8 }}>
        {!readOnly && <button type="button" className="btn sm" onClick={() => set({ parts: [...c.parts, { id: uid(), name: '', length: 0, width: 0, qty: 1 }] })}><Plus size={14} />Add part</button>}
        {r.count > 0 && <button type="button" className="btn sm" onClick={() => setPrint(true)}><Printer size={14} />Print cutting list</button>}
      </div>
      {r.count > 0 && <div className="cut-summary">
        <div><Scissors size={16} /> <b>{r.sheets.length} sheet{r.sheets.length === 1 ? '' : 's'}</b> of {c.sheetL}×{c.sheetW} for {r.count} parts · uses {Math.round(r.utilisation * 100)}% of the board{item && <> · stock {item.qty} {item.unit}{item.qty < r.sheets.length && <b className="neg"> (short by {r.sheets.length - item.qty})</b>} · board cost {money(r.sheets.length * item.cost, s)}</>}</div>
        {r.oversize.length > 0 && <div className="neg">Too big for this sheet: {r.oversize.join(', ')}</div>}
        <div className="sheet-row">{r.sheets.slice(0, 6).map((sh, i) => <div key={i}><SheetSvg parts={sh.parts} L={c.sheetL} W={c.sheetW} width={240} /><small>Sheet {i + 1} · {Math.round(sh.used * 100)}%</small></div>)}{r.sheets.length > 6 && <small>+{r.sheets.length - 6} more</small>}</div>
      </div>}
      {print && <Modal open wide title="Cutting list" onClose={() => setPrint(false)} footer={<><button className="btn" onClick={() => setPrint(false)}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print</button></>}>
        <div className="print-area"><div className="doc">
          <div className="doc-head"><div><h2>Cutting list</h2><div>{title}</div><div>{c.material || ''} · sheet {c.sheetL}×{c.sheetW} mm · gap {c.kerf} mm</div></div><div className="right"><b style={{ fontSize: 22 }}>{r.sheets.length} sheets</b><div>{r.count} parts · {Math.round(r.utilisation * 100)}% used</div></div></div>
          <table style={{ width: '100%' }}><thead><tr><th>#</th><th>Part</th><th className="num">Length</th><th className="num">Width</th><th className="num">Qty</th><th>Grain</th><th>✓</th></tr></thead>
            <tbody>{c.parts.filter((p) => p.length && p.width && p.qty).map((p, i) => <tr key={p.id}><td>{i + 1}</td><td>{p.name}</td><td className="num">{p.length}</td><td className="num">{p.width}</td><td className="num">{p.qty}</td><td>{p.grain ? 'Keep' : '—'}</td><td>☐</td></tr>)}</tbody></table>
          <div className="sheet-row" style={{ marginTop: 16 }}>{r.sheets.map((sh, i) => <div key={i}><SheetSvg parts={sh.parts} L={c.sheetL} W={c.sheetW} width={330} /><small>Sheet {i + 1}</small></div>)}</div>
        </div></div>
      </Modal>}
    </div>
  );
}
