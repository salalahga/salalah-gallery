import { Plus, Trash2 } from 'lucide-react';
import type { Invoice, LineItem, Quotation, Settings, Customer } from '../core/types';
import { uid } from '../core/store';
import { docTotals, lineTotal, money, fmtDate, amountInWords } from '../core/calc';
import { QR, useDocQr } from '../plugins/hooks';

type Doc = Partial<Quotation> | Partial<Invoice>;

export function LinesEditor({ doc, set, s }: { doc: Doc; set: (p: Doc) => void; s: Settings }) {
  const items = doc.items || [];
  const upd = (i: number, p: Partial<LineItem>) => set({ items: items.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  const tot = docTotals({ items, discount: doc.discount || 0, vat: doc.vat || 0 });
  return (
    <div className="span-3">
      <div className="table-wrap" style={{ margin: 0 }}>
        <table className="lines">
          <thead><tr><th style={{ minWidth: 220 }}>Description</th><th>Work type</th><th style={{ width: 80 }}>Qty</th><th style={{ width: 80 }}>Unit</th><th style={{ width: 100 }}>Rate</th><th className="num" style={{ width: 110 }}>Amount</th><th /></tr></thead>
          <tbody>{items.map((l, i) => (
            <tr key={l.id}>
              <td><input value={l.description} onChange={(e) => upd(i, { description: e.target.value })} placeholder="Item / work description" /></td>
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
      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => set({ items: [...items, { id: uid(), description: '', qty: 1, unit: 'pcs', rate: 0 }] })}><Plus size={14} />Add line</button>
      <div className="totals">
        <div><span>Subtotal</span><span>{money(tot.subtotal, s)}</span></div>
        <div><span>Discount</span><input type="number" style={{ width: 110, textAlign: 'right' }} value={doc.discount || 0} onChange={(e) => set({ discount: +e.target.value })} /></div>
        <div><span>VAT %</span><input type="number" style={{ width: 110, textAlign: 'right' }} value={doc.vat ?? s.vatRate} onChange={(e) => set({ vat: +e.target.value })} /></div>
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
      {s.logo && <img className="doc-watermark" src={s.logo} alt="" />}
      <div className="doc-head">
        <div className="flex" style={{ gap: 16, alignItems: 'flex-start' }}>{s.logo && <img src={s.logo} alt="" style={{ height: 76 }} />}<div><h2>{s.businessName}</h2>{s.tagline && <div>{s.tagline}</div>}<div>{s.address}, {s.city}, {s.country}</div><div>{s.phone && `GSM: ${s.phone}`}{s.phone && s.email ? ' · ' : ''}{s.email}</div>{s.crNumber && <div>C.R: {s.crNumber}</div>}{s.vatNumber && <div>VATIN: {s.vatNumber}</div>}</div></div>
        <div className="right"><h2>{kind}</h2><div><b>{doc.number}</b></div><div>Date: {fmtDate(doc.date)}</div>{'validUntil' in doc && doc.validUntil && <div>Valid until: {fmtDate(doc.validUntil)}</div>}{'dueDate' in doc && doc.dueDate && <div>Due: {fmtDate(doc.dueDate)}</div>}</div>
      </div>
      <div style={{ marginBottom: 16 }}><div style={{ color: '#888', fontSize: 11, textTransform: 'uppercase' }}>Bill to</div><b>{customer?.name || '—'}</b><div>{customer?.address}</div><div>{customer?.phone}</div></div>
      {doc.title && <p><b>Subject:</b> {doc.title}</p>}
      <table style={{ width: '100%' }}><thead><tr><th>#</th><th>Description</th><th className="num">Qty</th><th>Unit</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
        <tbody>{doc.items.map((l, i) => <tr key={l.id}><td>{i + 1}</td><td>{l.description}</td><td className="num">{l.qty}</td><td>{l.unit}</td><td className="num">{money(l.rate, s)}</td><td className="num">{money(lineTotal(l), s)}</td></tr>)}</tbody></table>
      <div className="totals" style={{ marginTop: 14 }}>
        <div><span>Subtotal</span><span>{money(tot.subtotal, s)}</span></div>
        {tot.discount > 0 && <div><span>Discount</span><span>−{money(tot.discount, s)}</span></div>}
        <div><span>VAT {doc.vat}%</span><span>{money(tot.vat, s)}</span></div>
        <div className="grand"><span>Total</span><span>{money(tot.total, s)}</span></div>
        {extra}
      </div>
      <p className="doc-words"><i>Amount in words: {amountInWords(tot.total, s.currency)}</i></p>
      {kind !== 'QUOTATION' && s.paymentInfo && <div className="doc-terms">{s.paymentInfo}</div>}
      {'terms' in doc && doc.terms && <div className="doc-terms"><b>Terms & conditions</b><br />{doc.terms}</div>}
      <div className="doc-foot">{qr ? <QR value={qr.url} caption={qr.caption} /> : <span />}</div>
      <div className="doc-sign"><div>Authorised signature</div><div>Customer acceptance</div></div>
    </div></div>
  );
}
