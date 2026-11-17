import { useState } from 'react';
import { t } from '../core/i18n';
import { money, useSession, variantName, dateTime } from '../core/session';
import { useData, Stat, Card, PageHead, LineChart, Bars, Empty, Loading, Status, download } from '../components/ui';
import { api, qs } from '../core/api';

const CH: Record<string, string> = { pos: 'Shop (POS)', web: 'Website', whatsapp: 'WhatsApp', instagram: 'Instagram', snapchat: 'Snapchat', facebook: 'Facebook', phone: 'Phone', wholesale: 'Wholesale' };

export default function Dashboard() {
  const { can, me } = useSession();
  const [branch, setBranch] = useState('');
  const { data: branches } = useData<any[]>('/branches');
  const { data: d, error } = useData<any>('/dashboard' + qs({ branchId: branch }), [branch]);
  if (error) return <div className="alert bad">{error}</div>;
  if (!d) return <Loading />;
  const f = d.finance;
  const ch = (k: string) => d.byChannel.find((x: any) => x.channel === k)?.total || 0;
  const online = ['web', 'instagram', 'snapchat', 'facebook'].reduce((a, k) => a + ch(k), 0);
  return (
    <>
      <PageHead title={t('Dashboard')} sub={`${me.settings.business.name} · all figures in OMR`} actions={<>
        {(branches?.length || 0) > 1 && !me.branchScope && <select value={branch} onChange={(e) => setBranch(e.target.value)} style={{ width: 'auto' }}><option value="">All branches</option>{branches!.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
        {can('reports', 'export') && <button className="btn" onClick={() => download('/export/sales' + qs({ from: d.ranges.month[0], to: d.ranges.month[1] }))}>Export month (CSV)</button>}
        <button className="btn" onClick={() => window.print()}>Print / PDF</button>
      </>} />
      <div className="grid g4">
        <Stat dark label={t('Sales today')} value={money(d.today.gross)} sub={`${d.today.orders} orders`} />
        <Stat label={t('This week')} value={money(d.week.gross)} sub={`${d.week.orders} orders`} />
        <Stat label={t('This month')} value={money(d.month.gross)} sub={`${d.month.orders} orders · discounts ${money(d.month.discount)}`} />
        <Stat label="This year" value={money(d.year.gross)} sub={`${d.year.orders} orders`} />
      </div>
      {f && (
        <div className="grid g4" style={{ marginTop: 14 }}>
          <Stat label={`${t('Revenue')} (month, ex-VAT)`} value={money(f.month.revenue)} sub="after discounts & refunds" />
          <Stat label={`${t('Gross profit')} (month)`} value={money(f.month.grossProfit)} sub={`${f.month.margin}% margin · revenue − cost of goods`} />
          <Stat label={`${t('Net profit')} (month)`} value={<span className={f.month.netProfit < 0 ? 'bad' : ''}>{money(f.month.netProfit)}</span>} sub="gross profit − operating expenses" />
          <Stat label={`${t('Expenses')} (month)`} value={money(f.month.expenses)} sub="rent, salaries, utilities, marketing…" />
          <Stat label={t('Cash balance')} value={money(f.position.cash)} sub={`card/gateway in transit ${money(f.position.clearing)}`} />
          <Stat label={t('Bank balance')} value={money(f.position.bank)} />
          <Stat label={t('Receivable')} value={money(f.position.receivable)} sub="customers owe you" />
          <Stat label={t('Payable')} value={money(f.position.payable)} sub={`suppliers · purchases this month ${money(d.purchasesMonth)}`} />
        </div>
      )}
      <div className="grid g4" style={{ marginTop: 14 }}>
        <Stat label={t('Shop sales')} value={money(ch('pos'))} sub="this month" />
        <Stat label={t('Online sales')} value={money(online)} sub="website & social, this month" />
        <Stat label={t('WhatsApp sales')} value={money(ch('whatsapp'))} sub="this month" />
        <Stat label={t('Inventory value')} value={money(d.inventory.costValue ?? d.inventory.retailValue)} sub={`${d.inventory.units} units · ${d.inventory.costValue != null ? 'at cost' : 'at retail price'}`} />
      </div>
      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Sales — last 30 days"><LineChart points={d.daily.map((x: any) => ({ x: x.day, y: x.total }))} format={(n) => money(Math.round(n))} /></Card>
        <Card title="Sales by channel (month)"><Bars items={d.byChannel.map((x: any) => ({ label: CH[x.channel] || x.channel, value: x.total }))} format={(n) => money(n)} /></Card>
        <Card title={t('Best sellers') + ' (month)'}>
          {d.best.length ? <table className="t"><tbody>{d.best.map((b: any) => <tr key={b.id}><td>{variantName(b)}</td><td className="num">{b.qty} pcs</td><td className="num">{money(b.total)}</td></tr>)}</tbody></table> : <Empty>No sales yet this month</Empty>}
        </Card>
        <Card title={t('Sales by staff') + ' (month)'}><Bars items={d.byStaff.map((x: any) => ({ label: x.name, value: x.total }))} format={(n) => money(n)} /></Card>
        <Card title={t('Low stock')} actions={<a href="#/inventory" className="small">Inventory →</a>}>
          {d.low.length ? <table className="t"><tbody>{d.low.map((l: any) => <tr key={l.id}><td>{variantName(l)}</td><td className="num"><span className={l.qty <= 0 ? 'bad' : 'warn'}>{l.qty}</span> / min {l.min_stock}</td></tr>)}</tbody></table> : <Empty>Everything is above its minimum level</Empty>}
        </Card>
        <Card title={t('Slow moving') + ' (no sale in 60 days)'}>
          {d.slow.length ? <table className="t"><tbody>{d.slow.map((l: any) => <tr key={l.id}><td>{variantName(l)}</td><td className="num">{l.qty} pcs</td>{l.value != null && f && <td className="num">{money(l.value)}</td>}</tr>)}</tbody></table> : <Empty>Every product has sold recently</Empty>}
        </Card>
        <Card title={t('Pending orders')} actions={<a href="#/sales" className="small">Orders →</a>}>
          {d.pending.length ? <table className="t"><tbody>{d.pending.map((o: any) => <tr key={o.id} className="click" onClick={() => (window.location.hash = '#/sales/' + o.id)}><td>{o.number}<div className="small muted">{CH[o.channel]} · {o.customer || 'Guest'}</div></td><td><Status s={o.status} /> <Status s={o.payment_status} /></td><td className="num">{money(o.total)}</td></tr>)}</tbody></table> : <Empty>No orders waiting</Empty>}
        </Card>
        <Card title={t('Active offers')} actions={<a href="#/promotions" className="small">Offers →</a>}>
          {d.offers.length ? <table className="t"><tbody>{d.offers.map((o: any) => <tr key={o.id}><td>{o.name}{o.coupon_code && <div className="small muted">code {o.coupon_code}</div>}</td><td className="small muted">{o.ends_at ? 'ends ' + dateTime(o.ends_at) : 'no end date'}</td><td className="num">{o.used_count} uses</td></tr>)}</tbody></table> : <Empty>No offer running today</Empty>}
        </Card>
        <Card title={t('Customer growth')}>
          <div className="muted small" style={{ marginBottom: 6 }}>{d.totalCustomers} customers in total · new per month</div>
          <Bars items={d.customers.map((c: any) => ({ label: c.month, value: c.n }))} />
        </Card>
      </div>
      <QuickAsk />
    </>
  );
}

function QuickAsk() {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [a, setA] = useState<any>(null);
  if (!can('assistant') && !can('dashboard')) return null;
  return (
    <Card title="Ask about your business" className="no-print" actions={<a href="#/assistant" className="small">Open assistant →</a>}>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); if (q) setA(await api.post('/assistant', { question: q }).catch((er) => ({ answer: er.message }))); }}>
        <input className="grow" placeholder="e.g. How much did my shop sell today?" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <button className="btn primary">Ask</button>
      </form>
      {a && <div className="alert info" style={{ marginTop: 10 }}>{a.answer}{a.tips && <ul>{a.tips.map((x: string) => <li key={x}>{x}</li>)}</ul>}{a.source && <div className="small muted">Source: {a.source}</div>}</div>}
    </Card>
  );
}
