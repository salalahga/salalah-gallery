import { useState } from 'react';
import { api } from '../core/api';
import { t } from '../core/i18n';
import { money, parseMoney, useSession, dateTime, variantName } from '../core/session';
import { Card, Empty, Field, Loading, Modal, PageHead, Status, useAction, useData } from '../components/ui';

const TYPES: [string, string][] = [['percent', 'Percentage off'], ['fixed', 'Fixed amount off'], ['buy_x_get_y', 'Buy X get Y free'], ['bundle_price', 'Bundle price (e.g. any 3 for 30)'], ['fixed_price', 'Special price per item']];
const CHANNELS: [string, string][] = [['pos', 'Physical shop'], ['web', 'Website'], ['whatsapp', 'WhatsApp'], ['instagram', 'Instagram'], ['snapchat', 'Snapchat'], ['facebook', 'Facebook'], ['wholesale', 'Wholesale']];
const AUD: [string, string][] = [['all', 'Everyone'], ['customers', 'Registered customers'], ['vip', 'VIP customers'], ['segment', 'Customer segment'], ['staff', 'Staff purchases'], ['wholesale', 'Wholesale buyers']];

function describe(p: any) {
  const v = p.type === 'percent' ? `${p.value / 100}% off` : p.type === 'fixed' ? `${money(p.value)} OMR off${p.scope === 'order' ? ' the order' : ' each'}` : p.type === 'buy_x_get_y' ? `Buy ${p.buy_qty} get ${p.get_qty}${p.value && p.value < 10000 ? ` at ${p.value / 100}% off` : ' free'}` : p.type === 'bundle_price' ? `Any ${p.bundle_qty} for ${money(p.value)}` : `Now ${money(p.value)} each`;
  return v + (p.min_purchase ? ` · min ${money(p.min_purchase)}` : '') + (p.max_discount ? ` · max ${money(p.max_discount)}` : '');
}

export default function Promotions() {
  const { can } = useSession();
  const { data, reload } = useData<any[]>('/promotions');
  const [edit, setEdit] = useState<any>(null);
  const { busy, run } = useAction();
  const act = (id: string, a: string, ok: string) => run(() => api.post(`/promotions/${id}/${a}`), ok).then(reload);
  return (
    <>
      <PageHead title={t('Promotions')} sub="Offers apply automatically at the till and online. Only one offer applies per order unless the owner marks it combinable." actions={can('promotions', 'create') && <button className="btn primary" onClick={() => setEdit({})}>+ New offer</button>} />
      <div className="card tablewrap">{!data ? <Loading /> : !data.length ? <Empty>No offers yet</Empty> : (
        <table className="t"><thead><tr><th>Offer</th><th>Channels</th><th>When</th><th>State</th><th className="num">Orders</th><th className="num">Sales</th><th className="num">Discount given</th><th /></tr></thead>
          <tbody>{data.map((p) => (
            <tr key={p.id}>
              <td><b>{p.name}</b>{p.coupon_code && <span className="badge gold" style={{ marginInlineStart: 6 }}>{p.coupon_code}</span>}{p.stackable && <span className="badge warn" style={{ marginInlineStart: 6 }}>combinable</span>}<div className="small muted">{describe(p)} · {AUD.find((a) => a[0] === p.audience)?.[1]}</div></td>
              <td className="small">{p.channels.join(', ')}</td>
              <td className="small">{p.starts_at ? dateTime(p.starts_at) : 'now'} → {p.ends_at ? dateTime(p.ends_at) : 'no end'}{p.usage_limit && <div className="muted">{p.used_count}/{p.usage_limit} uses</div>}</td>
              <td><Status s={p.state} /></td>
              <td className="num">{p.orders}</td><td className="num">{money(p.revenue)}</td><td className="num">{money(p.discount_given)}</td>
              <td className="right" style={{ whiteSpace: 'nowrap' }}>
                {can('promotions', 'edit') && <button className="btn ghost sm" onClick={() => setEdit(p)}>Edit</button>}
                {['draft', 'disabled'].includes(p.status) && can('promotions', 'create') && <button className="btn sm" disabled={busy} onClick={() => act(p.id, 'submit', 'Sent for approval')}>Submit</button>}
                {p.status === 'pending_approval' && can('promotions', 'approve') && <button className="btn gold sm" disabled={busy} onClick={() => act(p.id, 'approve', 'Approved — it activates on its start date')}>Approve</button>}
                {['approved', 'pending_approval'].includes(p.status) && can('promotions', 'edit') && <button className="btn danger sm" disabled={busy} onClick={() => act(p.id, 'disable', 'Disabled')}>Stop</button>}
              </td>
            </tr>
          ))}</tbody></table>
      )}</div>
      {edit && <PromoForm p={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </>
  );
}

const toLocal = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 16) : '');

function PromoForm({ p, onClose, onDone }: { p: any; onClose: () => void; onDone: () => void }) {
  const { data: brands } = useData<any[]>('/brands');
  const { data: cats } = useData<any[]>('/categories');
  const { data: items } = useData<any[]>('/inventory');
  const { data: branches } = useData<any[]>('/branches');
  const [f, setF] = useState<any>({
    name: p.name || '', description: p.description || '', type: p.type || 'percent', value: p.type === 'percent' ? String((p.value || 1000) / 100) : p.value != null ? money(p.value) : '10',
    buyQty: p.buy_qty || 2, getQty: p.get_qty || 1, bundleQty: p.bundle_qty || 3, scope: p.scope || 'items', productIds: p.product_ids || [], variantIds: p.variant_ids || [], categoryIds: p.category_ids || [], brandIds: p.brand_ids || [],
    channels: p.channels || ['pos', 'web', 'whatsapp', 'instagram'], branchIds: p.branch_ids || [], audience: p.audience || 'all', segment: p.segment || '', couponCode: p.coupon_code || '',
    minPurchase: p.min_purchase ? money(p.min_purchase) : '', maxDiscount: p.max_discount != null ? money(p.max_discount) : '', startsAt: toLocal(p.starts_at), endsAt: toLocal(p.ends_at), usageLimit: p.usage_limit || '', stackable: !!p.stackable, priority: p.priority || 0,
  });
  const { busy, run } = useAction();
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const toggle = (k: string, id: string) => set(k, f[k].includes(id) ? f[k].filter((x: string) => x !== id) : [...f[k], id]);
  const save = () => run(() => {
    const body = {
      ...f, value: f.type === 'percent' ? Math.round(Number(f.value) * 100) : f.type === 'buy_x_get_y' ? 10000 : parseMoney(f.value), minPurchase: f.minPurchase ? parseMoney(f.minPurchase) : 0, maxDiscount: f.maxDiscount ? parseMoney(f.maxDiscount) : null,
      startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null, endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null, usageLimit: f.usageLimit ? Number(f.usageLimit) : null,
    };
    return p.id ? api.put(`/promotions/${p.id}`, body) : api.post('/promotions', body);
  }, p.id ? (p.status === 'approved' ? 'Saved — it needs approval again' : 'Saved') : 'Draft saved — submit it for approval').then((r) => r && onDone());
  const chip = (on: boolean, label: string, onClick: () => void, key: string) => <button key={key} className={on ? 'on' : ''} onClick={onClick}>{label}</button>;
  return (
    <Modal wide title={p.id ? 'Edit offer' : 'New offer'} onClose={onClose} footer={<button className="btn primary" disabled={busy || !f.name} onClick={save}>Save</button>}>
      <div className="grid g2">
        <div className="col">
          <Field label="1. Name"><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Eid Oud Festival 20%" /></Field>
          <Field label="Type of discount"><select value={f.type} onChange={(e) => set('type', e.target.value)}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {f.type === 'buy_x_get_y' ? <div className="row"><Field label="Buy"><input value={f.buyQty} onChange={(e) => set('buyQty', Number(e.target.value))} /></Field><Field label="Get free"><input value={f.getQty} onChange={(e) => set('getQty', Number(e.target.value))} /></Field></div>
            : <div className="row">{f.type === 'bundle_price' && <Field label="Items in bundle"><input value={f.bundleQty} onChange={(e) => set('bundleQty', Number(e.target.value))} /></Field>}<Field label={f.type === 'percent' ? '4. Percent off' : 'Amount (OMR)'}><input value={f.value} onChange={(e) => set('value', e.target.value)} /></Field></div>}
          {['percent', 'fixed'].includes(f.type) && <Field label="Applies to"><div className="pill-group">{chip(f.scope === 'items', 'Each matching item', () => set('scope', 'items'), 'i')}{chip(f.scope === 'order', 'Whole order', () => set('scope', 'order'), 'o')}</div></Field>}
          <div className="row"><Field label="6. Minimum purchase (OMR)"><input value={f.minPurchase} onChange={(e) => set('minPurchase', e.target.value)} /></Field><Field label="7. Maximum discount (OMR)"><input value={f.maxDiscount} onChange={(e) => set('maxDiscount', e.target.value)} /></Field></div>
          <div className="row"><Field label="5. Starts"><input type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></Field><Field label="Ends (expires automatically)"><input type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></Field></div>
          <div className="row"><Field label="Coupon code (optional)"><input value={f.couponCode} onChange={(e) => set('couponCode', e.target.value.toUpperCase())} /></Field><Field label="Usage limit"><input value={f.usageLimit} onChange={(e) => set('usageLimit', e.target.value)} /></Field></div>
          <Field label="Who can use it"><select value={f.audience} onChange={(e) => set('audience', e.target.value)}>{AUD.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {f.audience === 'segment' && <Field label="Segment name"><input value={f.segment} onChange={(e) => set('segment', e.target.value)} /></Field>}
          <label className="check"><input type="checkbox" checked={f.stackable} onChange={(e) => set('stackable', e.target.checked)} /> Can combine with other offers (owner approval required)</label>
        </div>
        <div className="col">
          <Field label="8. Sales channels"><div className="pill-group">{CHANNELS.map(([k, l]) => chip(f.channels.includes(k), l, () => toggle('channels', k), k))}</div></Field>
          {(branches?.length || 0) > 1 && <Field label="Branches (none selected = all)"><div className="pill-group">{branches!.map((b) => chip(f.branchIds.includes(b.id), b.name, () => toggle('branchIds', b.id), b.id))}</div></Field>}
          <Field label="3. Categories (none = all products)"><div className="pill-group">{cats?.map((c) => chip(f.categoryIds.includes(c.id), c.name, () => toggle('categoryIds', c.id), c.id))}</div></Field>
          <Field label="Brands"><div className="pill-group">{brands?.map((b) => chip(f.brandIds.includes(b.id), b.name, () => toggle('brandIds', b.id), b.id))}</div></Field>
          <Field label="2. Specific products">
            <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 6 }}>
              {items?.map((v) => <label key={v.id} className="check"><input type="checkbox" checked={f.variantIds.includes(v.id)} onChange={() => toggle('variantIds', v.id)} />{variantName(v)}</label>)}
            </div>
          </Field>
          <Card><div className="small muted">Selected products, categories and brands combine: an item qualifies if it matches any of them. With nothing selected the offer covers every product.</div></Card>
        </div>
      </div>
    </Modal>
  );
}
