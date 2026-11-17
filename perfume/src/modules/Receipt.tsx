import { money, useSession, dateTime } from '../core/session';
import { Modal, useData, Empty, TestBadge } from '../components/ui';

/** Tax invoice / receipt for a sale. Print uses the browser (Save as PDF works too). */
export function Receipt({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { me } = useSession();
  const { data: s } = useData<any>(`/sales/${saleId}`);
  const b = me.settings.business;
  return (
    <Modal title="Receipt" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => window.print()}>Print</button></>}>
      {!s ? <Empty>Loading…</Empty> : (
        <div id="receipt" style={{ maxWidth: 380, margin: '0 auto', fontSize: 13 }}>
          <div style={{ textAlign: 'center' }}>
            <img src="/brand/logo-dark.png" alt={b.name} style={{ height: 96, display: 'block', margin: '0 auto 6px' }} />
            <h2 style={{ marginBottom: 0 }}>{b.name}</h2>
            {b.nameAr && <div style={{ fontFamily: 'Noto Kufi Arabic, sans-serif' }}>{b.nameAr}</div>}
            <div className="small">{b.address}{b.phone && ` · ${b.phone}`}</div>
            {b.vatNumber && <div className="small">VATIN: {b.vatNumber}{b.crNumber && ` · CR ${b.crNumber}`}</div>}
            <div style={{ fontWeight: 700, margin: '8px 0' }}>TAX INVOICE · فاتورة ضريبية <TestBadge on={s.is_test} /></div>
          </div>
          <div className="row small"><span className="grow">{s.number}</span><span>{dateTime(s.created_at)}</span></div>
          <div className="small">{s.branch_name}{s.cashier_name && ` · Cashier: ${s.cashier_name}`}{s.customer_name && ` · ${s.customer_name}`}</div>
          <hr className="sep" />
          <table className="t" style={{ fontSize: 12.5 }}><tbody>
            {s.lines.map((l: any) => (
              <tr key={l.id}><td style={{ padding: '4px 0' }}>{l.brand} {l.name} {l.label || (l.size_ml ? l.size_ml + 'ml' : '')}<div className="muted">{l.qty} × {money(l.unit_price)}{l.discount > 0 && ` − ${money(l.discount)}`}</div></td><td className="num" style={{ padding: '4px 0' }}>{money(l.total)}</td></tr>
            ))}
          </tbody></table>
          <div className="totals">
            <span>Subtotal</span><span>{money(s.subtotal)}</span>
            {s.discount > 0 && <><span>Discount</span><span>−{money(s.discount)}</span></>}
            {s.delivery_fee > 0 && <><span>Delivery</span><span>{money(s.delivery_fee)}</span></>}
            <span>Total excl. VAT</span><span>{money(s.net)}</span>
            <span>VAT</span><span>{money(s.vat)}</span>
            <span className="grand">Total OMR</span><span className="grand">{money(s.total)}</span>
            {s.payments.filter((p: any) => p.direction === 'in').map((p: any) => <><span key={p.id + 'l'}>{p.method.replace('_', ' ')}{p.reference && ` (${p.reference})`}</span><span key={p.id}>{money(p.amount)}</span></>)}
            {s.total - s.paid - s.refunded > 0 && <><span className="bad">Balance due</span><span className="bad">{money(s.total - s.paid - s.refunded)}</span></>}
            {s.refunded > 0 && <><span className="bad">Refunded</span><span className="bad">−{money(s.refunded)}</span></>}
          </div>
          {s.points_earned > 0 && <div className="small" style={{ marginTop: 6 }}>Loyalty points earned: {s.points_earned}</div>}
          <hr className="sep" />
          <div style={{ textAlign: 'center' }} className="small">{b.receiptFooter}<br />{b.receiptFooterAr}</div>
        </div>
      )}
    </Modal>
  );
}
