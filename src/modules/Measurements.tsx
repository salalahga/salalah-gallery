import { useState } from 'react';
import { Plus, Trash2, Printer, MapPin, Crosshair, FileText, Ruler, Loader2 } from 'lucide-react';
import { store, useDB, nextNumber, today, uid } from '../core/store';
import { go } from '../core/router';
import type { Measurement, MeasureItem, Quotation } from '../core/types';
import { fmtDate } from '../core/calc';
import { lookup } from '../core/helpers';
import { useRole, useUser } from '../core/session';
import { mapsLink } from '../plugins/hooks';
import { Photos } from '../components/Photos';
import { Modal, Field, PageHeader, Empty, Badge, Tabs, toast, confirmDelete } from '../components/ui';
import { Letterhead, Signatures } from '../components/DocParts';

const STATUS = { new: { label: 'New', tone: 'amber' }, quoted: { label: 'Quoted', tone: 'blue' }, done: { label: 'Done', tone: 'green' } } as const;
const size = (m: MeasureItem, unit: string) => [m.width, m.height, m.depth].filter((v) => v).join(' × ') + (m.width || m.height ? ` ${unit}` : '');

export default function Measurements() {
  const db = useDB(); const s = db.settings; const L = lookup(db);
  const role = useRole(); const me = useUser()?.staffId; const isStaff = role === 'staff';
  const [tab, setTab] = useState<'all' | Measurement['status']>('all');
  const [edit, setEdit] = useState<Partial<Measurement> | null>(null);
  const [view, setView] = useState<Measurement | null>(null);
  const [locating, setLocating] = useState(false);

  const blank = (): Partial<Measurement> => ({ number: nextNumber('MS', db.measurements.map((x) => x.number)), date: today(), status: 'new', unit: 'mm', measuredBy: me, items: [{ id: uid(), name: '', qty: 1 }], photos: [] });
  const list = db.measurements.filter((m) => (tab === 'all' || m.status === tab) && (!isStaff || m.measuredBy === me));
  const custName = (m: Partial<Measurement>) => L.customer(m.customerId)?.name || m.customerName || '—';
  const setItem = (i: number, p: Partial<MeasureItem>) => edit && setEdit({ ...edit, items: edit.items!.map((x, k) => (k === i ? { ...x, ...p } : x)) });

  const locate = () => {
    if (!navigator.geolocation) return toast('This device has no GPS');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); setEdit((e) => e && { ...e, lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) }); toast('Location saved'); },
      (err) => { setLocating(false); toast(err.code === 1 ? 'Allow location access to save the site position' : 'Could not get location'); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  const save = () => {
    if (!edit) return;
    if (!edit.customerId && !edit.customerName) return toast('Choose a customer or type their name');
    if (isStaff && !me) return toast('Your login is not linked to a staff profile');
    const v = store.upsert('measurements', { ...edit, measuredBy: isStaff ? me : edit.measuredBy } as Measurement) as Measurement;
    setEdit(null); toast('Measurement saved'); return v;
  };
  const toQuote = (m: Measurement) => {
    let customerId = m.customerId;
    if (!customerId && m.customerName) customerId = store.upsert('customers', { name: m.customerName, phone: m.customerPhone, address: m.site, type: 'Individual' }).id;
    const q = store.upsert('quotations', {
      number: nextNumber('QT', db.quotations.map((x) => x.number)), date: today(), validUntil: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), customerId,
      title: `${m.items[0]?.name || 'Work'}${m.items.length > 1 ? ` + ${m.items.length - 1} more` : ''} — ${m.site || ''}`.trim(), status: 'draft', discount: 0, vat: s.vatRate, terms: s.quoteTerms,
      items: m.items.filter((x) => x.name).map((x) => ({ id: uid(), description: `${x.name}${size(x, m.unit) ? ` (${size(x, m.unit)})` : ''}${x.notes ? ` — ${x.notes}` : ''}`, qty: x.qty || 1, unit: 'pcs', rate: 0 })),
    }) as Quotation;
    store.upsert('measurements', { ...m, customerId, status: 'quoted', quotationId: q.id });
    toast('Quotation drafted — add the rates'); go('quotations', { id: q.id });
  };

  return (
    <>
      <PageHeader title="Site measurements" sub="Record measurements, photos and the exact location on site — then turn them into a quotation."
        actions={<><Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: 'All' }, ...(['new', 'quoted', 'done'] as const).map((k) => ({ id: k, label: STATUS[k].label, count: db.measurements.filter((m) => m.status === k && (!isStaff || m.measuredBy === me)).length }))]} />
          <button className="btn primary" onClick={() => setEdit(blank())}><Plus size={16} />New measurement</button></>} />
      {isStaff && !me && <div className="alert">Your login is not linked to a staff profile yet — ask the owner to link it in Settings → Users.</div>}
      <div className="grid g3">
        {list.map((m) => <div key={m.id} className="card measure-card" onClick={() => setEdit(structuredClone(m))}>
          <div className="flex between"><b>{m.number}</b><Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge></div>
          <div style={{ fontSize: 15, fontWeight: 600, margin: '6px 0 2px' }}>{custName(m)}</div>
          <div className="muted">{fmtDate(m.date)} · {L.staff(m.measuredBy)?.name || '—'}</div>
          <div className="muted">{m.site || 'No address'}{m.lat ? ' · 📍 GPS' : ''}</div>
          <div className="muted" style={{ marginTop: 6 }}><Ruler size={13} style={{ verticalAlign: -2 }} /> {m.items.filter((x) => x.name).length} items · {(m.photos || []).length} photos</div>
          {m.photos?.[0] && <img className="measure-thumb" src={m.photos[0].url} alt="" />}
        </div>)}
        {!list.length && <div className="card"><Empty title="No measurements yet" hint="Tap New measurement when you are on site." /></div>}
      </div>

      {edit && <Modal open wide title={db.measurements.some((m) => m.id === edit.id) ? `Measurement ${edit.number}` : 'New site measurement'} onClose={() => setEdit(null)} footer={<>
        {edit.id && !isStaff && <button className="btn danger ghost" onClick={() => { if (confirmDelete(edit.number)) { store.remove('measurements', edit.id!); setEdit(null); } }}><Trash2 size={15} />Delete</button>}
        {edit.id && !isStaff && <button className="btn ghost" onClick={() => { const v = save(); if (v) toQuote(v); }}><FileText size={15} />{edit.quotationId ? 'Re-create quotation' : 'Create quotation'}</button>}
        <span className="spacer" /><button className="btn" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn" onClick={() => { const v = save(); if (v) setView(v); }}><Printer size={15} />Save & print</button><button className="btn primary" onClick={save}>Save</button></>}>
        <div className="form">
          <Field label="Customer"><select value={edit.customerId || ''} onChange={(e) => { const c = L.customer(e.target.value); setEdit({ ...edit, customerId: e.target.value || undefined, site: edit.site || c?.address }); }}><option value="">— New customer (type name) —</option>{db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          {!edit.customerId && <><Field label="New customer name"><input value={edit.customerName || ''} onChange={(e) => setEdit({ ...edit, customerName: e.target.value })} /></Field>
            <Field label="Phone"><input type="tel" value={edit.customerPhone || ''} onChange={(e) => setEdit({ ...edit, customerPhone: e.target.value })} /></Field></>}
          <Field label="Date"><input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></Field>
          <Field label="Measured by"><select disabled={isStaff} value={edit.measuredBy || ''} onChange={(e) => setEdit({ ...edit, measuredBy: e.target.value || undefined })}><option value="">—</option>{db.staff.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label="Job (optional)"><select value={edit.jobId || ''} onChange={(e) => setEdit({ ...edit, jobId: e.target.value || undefined })}><option value="">—</option>{db.jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.title}</option>)}</select></Field>
          <Field label="Site address" span={2}><input value={edit.site || ''} onChange={(e) => setEdit({ ...edit, site: e.target.value })} placeholder="Area, building, flat / villa no." /></Field>
          <Field label="Location (GPS)"><div className="flex"><button type="button" className="btn sm" onClick={locate} disabled={locating}>{locating ? <Loader2 size={14} className="spin" /> : <Crosshair size={14} />}{edit.lat ? 'Update' : 'Use my location'}</button>
            {edit.lat && <a className="btn sm ghost" target="_blank" rel="noreferrer" href={mapsLink(`${edit.lat},${edit.lng}`)}><MapPin size={14} />Map</a>}</div></Field>
          <div className="section-title">Measurements</div>
          <div className="span-3">
            <div className="flex" style={{ marginBottom: 8 }}><span className="muted">Unit</span><div className="chips">{(['mm', 'cm', 'm', 'in'] as const).map((u) => <button key={u} type="button" className={`chip ${edit.unit === u ? 'on' : ''}`} onClick={() => setEdit({ ...edit, unit: u })}>{u}</button>)}</div></div>
            {(edit.items || []).map((it, i) => <div key={it.id} className="measure-row">
              <input placeholder="Item / area (e.g. Kitchen wall A)" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} />
              <input type="number" inputMode="decimal" placeholder="Width" value={it.width ?? ''} onChange={(e) => setItem(i, { width: e.target.value === '' ? undefined : +e.target.value })} />
              <input type="number" inputMode="decimal" placeholder="Height" value={it.height ?? ''} onChange={(e) => setItem(i, { height: e.target.value === '' ? undefined : +e.target.value })} />
              <input type="number" inputMode="decimal" placeholder="Depth" value={it.depth ?? ''} onChange={(e) => setItem(i, { depth: e.target.value === '' ? undefined : +e.target.value })} />
              <input type="number" inputMode="numeric" placeholder="Qty" value={it.qty} onChange={(e) => setItem(i, { qty: +e.target.value })} />
              <input placeholder="Notes (finish, colour, obstacles…)" value={it.notes || ''} onChange={(e) => setItem(i, { notes: e.target.value })} />
              <button type="button" className="icon-btn" onClick={() => setEdit({ ...edit, items: edit.items!.filter((_, k) => k !== i) })}><Trash2 size={14} /></button>
            </div>)}
            <button type="button" className="btn sm" onClick={() => setEdit({ ...edit, items: [...(edit.items || []), { id: uid(), name: '', qty: 1 }] })}><Plus size={14} />Add item</button>
          </div>
          <div className="section-title">Site photos</div>
          <div className="span-3"><Photos photos={edit.photos || []} onChange={(photos) => setEdit({ ...edit, photos })} kinds={['site']} /></div>
          <Field label="Notes (power points, access, customer wishes…)" span={3}><textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          {!isStaff && <Field label="Status"><select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as Measurement['status'] })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>}
        </div>
      </Modal>}

      {view && <Modal open wide title={view.number} onClose={() => setView(null)} footer={<><span className="spacer" /><button className="btn" onClick={() => setView(null)}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print</button></>}>
        <div className="print-area"><div className="doc">
          <Letterhead s={{ ...s, arabicOnDocs: false }} title="SITE MEASUREMENT" meta={<><div><b>{view.number}</b></div><div>Date: {fmtDate(view.date)}</div></>} />
          <p><b>Customer:</b> {custName(view)} {view.customerPhone || L.customer(view.customerId)?.phone || ''}<br /><b>Site:</b> {view.site || '—'}{view.lat ? ` (GPS ${view.lat}, ${view.lng})` : ''}<br /><b>Measured by:</b> {L.staff(view.measuredBy)?.name || '—'}</p>
          <table style={{ width: '100%' }}><thead><tr><th>#</th><th>Item / area</th><th className="num">Width</th><th className="num">Height</th><th className="num">Depth</th><th className="num">Qty</th><th>Notes</th></tr></thead>
            <tbody>{view.items.map((it, i) => <tr key={it.id}><td>{i + 1}</td><td>{it.name}</td><td className="num">{it.width ?? ''}</td><td className="num">{it.height ?? ''}</td><td className="num">{it.depth ?? ''}</td><td className="num">{it.qty}</td><td>{it.notes}</td></tr>)}</tbody></table>
          <p className="muted">All sizes in {view.unit}.</p>
          {view.notes && <div className="doc-terms">{view.notes}</div>}
          {(view.photos || []).length > 0 && <div className="photo-grid" style={{ marginTop: 12 }}>{view.photos!.slice(0, 6).map((p) => <figure key={p.id}><img src={p.url} alt="" /></figure>)}</div>}
          <Signatures left="Measured by" right="Customer acceptance" />
        </div></div>
      </Modal>}
    </>
  );
}
