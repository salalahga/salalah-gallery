import { Plus, Trash2 } from 'lucide-react';
import type { Invoice, LineItem, Quotation, Settings, Customer } from '../core/types';
import { uid } from '../core/store';
import { docTotals, lineTotal, money, fmtDate, amountInWords } from '../core/calc';
import { QR, useDocQr } from '../plugins/hooks';
import { Letterhead, Bi, Signatures } from './DocParts';

type Doc = Partial<Quotation> | Partial<Invoice>;
const KINDS: { id: NonNullable<LineItem['kind']>; label: string }[] = [{ id: 'item', label: 'Item / work' }, { id: 'material', label: 'Material' }, { id: 'labour', label: 'Labour' }, { id: 'additional', label: 'Additional charge' }];
const KIND_LABEL: Record<string, string> = { item: 'Items', material: 'Material charges', labour: 'Labour charges', additional: 'Additional charges' };
/** Subtotal per kind of line (items, materials, labour, additional charges). */
function byKind(items: LineItem[]) {
  const out: Record<string, number> = {};
  for (const l of items) out[l.kind || 'item'] = (out[l.kind || 'item'] || 0) + lineTotal(l);
  return out;
}

export function LinesEditor({ doc, set, s }: { doc: Doc; set: (p: Doc) => void; s: Settings }) {
  const items = doc.items || [];
  const upd = (i: number, p: Partial<LineItem>) => set({ items: items.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  const tot = docTotals({ items, discount: doc.discount || 0, vat: doc.vat || 0 });
  return (
    <div className="span-3">
      <div className="table-wrap" style={{ margin: 0 }}>
        <table className="lines">
          <thead><tr><th style={{ minWidth: 220 }}>Description</th><th>Type</th><th>Work type</th><th style={{ width: 80 }}>Qty</th><th style={{ width: 80 }}>Unit</th><th style={{ width: 100 }}>Rate</th><th className="num" style={{ width: 110 }}>Amount</th><th /></tr></thead>
          <tbody>{items.map((l, i) => (
            <tr key={l.id}>
              <td><input value={l.description} onChange={(e) => upd(i, { description: e.target.value })} placeholder="Item / work description" /></td>
              <td><select value={l.kind || 'item'} onChange={(e) => upd(i, { kind: e.target.value as LineItem['kind'] })}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></td>
              <td><select value={l.workTypeId || ''} onChange={(e) => { const w = s.workTypes.find((x) => x.id === e.target.value); upd(i, { workTypeId: e.target.value, unit: w?.unit || l.unit, rate: l.rate || w?.rate || 0 }); }}>
                <option value="">—</option>{s.workTypes.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></td>
              <td><input type="number" value={l.qty} onChange={(e) => upd(i, { qty: +e.target.value })} /></td>
              <td><input value={l.unit} onChange={(e) => upd(i, { unit: e.target.value })} /></td>
              <td><input type="number" value={l.rate} onChange={(e) => upd(i, { rate: +e.target.value })} /></td>
              <td className="num">{money(lineTotal(l), s)}</td>
              <td><button className="icon-btn" onClick={() => set({ items: items.filter((_, k) => k !== i) })}><Trash2 size={15} /></button></td>
            </tr>))}</tbody>
        </table>
      </div>
      <div className="flex wrap" style={{ marginTop: 8 }}>
        <button className="btn sm" onClick={() => set({ items: [...items, { id: uid(), description: '', qty: 1, unit: 'pcs', rate: 0, kind: 'item' }] })}><Plus size={14} />Add line</button>
        <button className="btn sm ghost" onClick={() => set({ items: [...items, { id: uid(), description: 'Materials', qty: 1, unit: 'lot', rate: 0, kind: 'material' }] })}><Plus size={14} />Material charges</button>
        <button className="btn sm ghost" onClick={() => set({ items: [...items, { id: uid(), description: 'Labour', qty: 1, unit: 'lot', rate: 0, kind: 'labour' }] })}><Plus size={14} />Labour charges</button>
        <button className="btn sm ghost" onClick={() => set({ items: [...items, { id: uid(), description: 'Additional charges', qty: 1, unit: 'lot', rate: 0, kind: 'additional' }] })}><Plus size={14} />Additional charges</button>
      </div>
      <div className="totals">
        {Object.keys(byKind(items)).length > 1 && Object.entries(byKind(items)).map(([k, v]) => <div key={k} className="muted"><span>{KIND_LABEL[k]}</span><span>{money(v, s)}</span></div>)}
        <div><span>Subtotal</span><span>{money(tot.subtotal, s)}</span></div>
        <div><span>Discount</span><input type="number" style={{ width: 110, textAlign: 'right' }} value={doc.discount || 0} onChange={(e) => set({ discount: +e.target.value })} /></div>
        <div><span>VAT %</span><span className="flex" style={{ gap: 4 }}>{(s.taxRates || []).length > 0 && <select style={{ width: 'auto' }} value="" onChange={(e) => e.target.value !== '' && set({ vat: +e.target.value })}><option value="">Rate…</option>{(s.taxRates || []).map((r) => <option key={r.name} value={r.rate}>{r.name} {r.rate}%</option>)}</select>}<input type="number" style={{ width: 110, textAlign: 'right' }} value={doc.vat ?? s.vatRate} onChange={(e) => set({ vat: +e.target.value })} /></span></div>
        <div><span>VAT amount</span><span>{money(tot.vat, s)}</span></div>
        <div className="grand"><span>Total</span><span>{money(tot.total, s)}</span></div>
      </div>
    </div>
  );
}

export function DocView({ kind, doc, s, customer, extra }: { kind: 'QUOTATION' | 'TAX INVOICE' | 'INVOICE'; doc: Quotation | Invoice; s: Settings; customer?: Customer; extra?: React.ReactNode }) {
  const tot = docTotals(doc);
  const qr = useDocQr();
  return (
    <div className="print-area"><div className="doc">
      <Letterhead s={s} title={kind} meta={<><div><b>{doc.number}</b></div><div><Bi en="Date" inline />: {fmtDate(doc.date)}</div>{'validUntil' in doc && doc.validUntil && <div><Bi en="Valid until" inline />: {fmtDate(doc.validUntil)}</div>}{'dueDate' in doc && doc.dueDate && <div><Bi en="Due" inline />: {fmtDate(doc.dueDate)}</div>}</>} />
      <div style={{ marginBottom: 16 }}><div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase' }}><Bi en="Bill to" inline /></div><b>{customer?.name || '—'}</b><div>{customer?.address}</div><div>{customer?.phone}</div></div>
      {doc.title && <p><b><Bi en="Subject" inline />:</b> {doc.title}</p>}
      <table style={{ width: '100%' }}><thead><tr><th>#</th><th><Bi en="Description" /></th><th className="num"><Bi en="Qty" /></th><th><Bi en="Unit" /></th><th className="num"><Bi en="Rate" /></th><th className="num"><Bi en="Amount" /></th></tr></thead>
        <tbody>{doc.items.map((l, i) => <tr key={l.id}><td>{i + 1}</td><td>{l.description}</td><td className="num">{l.qty}</td><td>{l.unit}</td><td className="num">{money(l.rate, s)}</td><td className="num">{money(lineTotal(l), s)}</td></tr>)}</tbody></table>
      <div className="totals" style={{ marginTop: 14 }}>
        {Object.keys(byKind(doc.items)).length > 1 && Object.entries(byKind(doc.items)).map(([k, v]) => <div key={k}><span><Bi en={KIND_LABEL[k]} inline /></span><span>{money(v, s)}</span></div>)}
        <div><span><Bi en="Subtotal" inline /></span><span>{money(tot.subtotal, s)}</span></div>
        {tot.discount > 0 && <div><span><Bi en="Discount" inline /></span><span>−{money(tot.discount, s)}</span></div>}
        <div><span><Bi en="VAT" inline /> {doc.vat}%</span><span>{money(tot.vat, s)}</span></div>
        <div className="grand"><span><Bi en="Total" inline /></span><span>{money(tot.total, s)}</span></div>
        {extra}
      </div>
      <p className="doc-words"><i><Bi en="Amount in words" inline />: {amountInWords(tot.total, s.currency)}</i></p>
      {kind !== 'QUOTATION' && s.paymentInfo && <div className="doc-terms">{s.paymentInfo}</div>}
      {'terms' in doc && doc.terms && <div className="doc-terms"><b><Bi en="Terms & conditions" inline /></b><br />{doc.terms}</div>}
      <div className="doc-foot">{qr ? <QR value={qr.url} caption={qr.caption} /> : <span />}</div>
      <Signatures />
    </div></div>
  );
}
