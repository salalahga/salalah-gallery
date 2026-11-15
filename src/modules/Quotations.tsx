import { useEffect, useState } from 'react';
import { Plus, Trash2, Printer, MessageCircle, Hammer, Receipt, Copy, Eye } from 'lucide-react';
import { store, useDB, nextNumber, today, uid } from '../core/store';
import { useRoute, go } from '../core/router';
import type { Quotation, QuoteStatus } from '../core/types';
import { docTotals, money, fmtDate } from '../core/calc';
import { statusMeta, lookup, waLink } from '../core/helpers';
import { Modal, Field, PageHeader, Badge, Empty, Tabs, SearchBox, Stat, toast, confirmDelete } from '../components/ui';
import { LinesEditor, DocView } from '../components/DocEditor';
import { FileText, CheckCircle2, Send } from 'lucide-react';
import { useT } from '../core/i18n';

export default function Quotations() {
  const db = useDB(); const s = db.settings; const L = lookup(db); const t = useT(); const { params } = useRoute();
  const [edit, setEdit] = useState<Partial<Quotation> | null>(null);
  const [view, setView] = useState<Quotation | null>(null);
  const [tab, setTab] = useState<'all' | QuoteStatus>('all'); const [q, setQ] = useState('');
  const blank = (): Partial<Quotation> => ({ number: nextNumber('QT', db.quotations.map((x) => x.number)), date: today(), validUntil: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), status: 'draft', discount: 0, vat: s.vatRate, terms: s.quoteTerms, items: [{ id: uid(), description: '', qty: 1, unit: 'pcs', rate: 0 }], title: '' });
  useEffect(() => { if (params.new) { setEdit(blank()); go('quotations'); } }, [params.new]); // eslint-disable-line

  const list = db.quotations.filter((x) => (tab === 'all' || x.status === tab) && (x.number + x.title + (L.customer(x.customerId)?.name || '')).toLowerCase().includes(q.toLowerCase()));
  const save = () => { if (!edit?.customerId) return toast('Select a customer'); const saved = store.upsert('quotations', edit as Quotation); setEdit(null); toast('Quotation saved'); return saved; };
  const toJob = (qt: Quotation) => {
    const nums = db.jobs.map((j) => parseInt(j.code.replace(/\D/g, ''), 10) || 0);
    const job = store.upsert('jobs', { code: `JOB-${(nums.length ? Math.max(...nums) : 100) + 1}`, title: qt.title || qt.number, customerId: qt.customerId, workTypeId: qt.items.find((l) => l.workTypeId)?.workTypeId, status: 'design', priority: 'normal', startDate: today(), value: docTotals(qt).total, staffIds: [], details: {}, materials: [], progress: 0, quotationId: qt.id });
    store.upsert('quotations', { ...qt, status: 'accepted', jobId: job.id }); toast('Job created from quotation'); go('jobs', { id: job.id });
  };
  const toInvoice = (qt: Quotation) => {
    const inv = store.upsert('invoices', { number: nextNumber('INV', db.invoices.map((i) => i.number)), date: today(), dueDate: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), customerId: qt.customerId, title: qt.title, items: structuredClone(qt.items), discount: qt.discount, vat: qt.vat, paid: 0, quotationId: qt.id, jobId: qt.jobId });
    go('invoices', { id: inv.id });
  };
  const share = (qt: Quotation) => { const c = L.customer(qt.customerId); const tot = docTotals(qt); return waLink(c?.phone, `Dear ${c?.name},\nPlease find our quotation ${qt.number} for "${qt.title}".\n\n${qt.items.map((l) => `• ${l.description} — ${l.qty} ${l.unit} × ${l.rate}`).join('\n')}\n\nTotal (incl. VAT): ${money(tot.total, s)}\nValid until ${fmtDate(qt.validUntil)}.\n\nThank you,\n${s.businessName}\n${s.phone}`); };
  const sum = (st: QuoteStatus) => db.quotations.filter((x) => x.status === st).reduce((n, x) => n + docTotals(x).total, 0);
  const won = db.quotations.filter((x) => x.status === 'accepted').length; const decided = db.quotations.filter((x) => ['accepted', 'rejected'].includes(x.status)).length;

  return (
    <>
      <PageHeader title={t('Quotations')} sub="Build quotations with work-type rates, print as PDF and send on WhatsApp." actions={<button className="btn primary" onClick={() => setEdit(blank())}><Plus size={16} />{t('New quotation')}</button>} />
      <div className="grid g3 mb">
        <Stat label="Awaiting reply" value={money(sum('sent'), s)} icon={<Send size={20} />} tone="blue" />
        <Stat label="Accepted" value={money(sum('accepted'), s)} icon={<CheckCircle2 size={20} />} tone="green" />
        <Stat label="Win rate" value={decided ? `${Math.round((won / decided) * 100)}%` : '—'} icon={<FileText size={20} />} tone="wood" sub={`${db.quotations.length} quotations`} />
      </div>
      <div className="toolbar">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'all', label: 'All' }, ...(['draft', 'sent', 'accepted', 'rejected'] as QuoteStatus[]).map((x) => ({ id: x, label: statusMeta[x].label, count: db.quotations.filter((y) => y.status === x).length }))]} />
        <SearchBox value={q} onChange={setQ} />
      </div>
      <div className="card">
        {list.length ? <div className="table-wrap"><table>
          <thead><tr><th>Number</th><th>Customer / subject</th><th>Date</th><th>Valid until</th><th>Status</th><th className="num">Total</th><th /></tr></thead>
          <tbody>{list.map((x) => (
            <tr key={x.id} className="click" onClick={() => setEdit(structuredClone(x))}>
              <td><b>{x.number}</b></td><td>{L.customer(x.customerId)?.name}<div className="muted">{x.title}</div></td><td>{fmtDate(x.date)}</td><td>{fmtDate(x.validUntil)}</td>
              <td><Badge tone={statusMeta[x.status].tone}>{statusMeta[x.status].label}</Badge></td><td className="num"><b>{money(docTotals(x).total, s)}</b></td>
              <td onClick={(e) => e.stopPropagation()}><div className="row-actions">
                <button className="icon-btn" title="Preview / print" onClick={() => setView(x)}><Eye size={16} /></button>
                <a className="icon-btn" title="WhatsApp" target="_blank" rel="noreferrer" href={share(x)} onClick={() => x.status === 'draft' && store.upsert('quotations', { ...x, status: 'sent' })}><MessageCircle size={16} /></a>
                {!x.jobId && <button className="icon-btn" title="Convert to job" onClick={() => toJob(x)}><Hammer size={16} /></button>}
                <button className="icon-btn" title="Convert to invoice" onClick={() => toInvoice(x)}><Receipt size={16} /></button>
              </div></td>
            </tr>))}</tbody></table></div> : <Empty title="No quotations" action={<button className="btn primary" onClick={() => setEdit(blank())}>Create quotation</button>} />}
      </div>

      {edit && <Modal open wide title={edit.id ? `Quotation ${edit.number}` : 'New quotation'} onClose={() => setEdit(null)} footer={<>
        {edit.id && <button className="btn danger ghost" onClick={() => { if (confirmDelete(edit.number)) { store.remove('quotations', edit.id!); setEdit(null); } }}><Trash2 size={15} />Delete</button>}
        {edit.id && <button className="btn ghost" onClick={() => setEdit({ ...structuredClone(edit), id: undefined, number: nextNumber('QT', db.quotations.map((x) => x.number)), status: 'draft', date: today(), jobId: undefined })}><Copy size={15} />Duplicate</button>}
        <span className="spacer" /><button className="btn" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn" onClick={() => { const sv = save(); if (sv) setView(sv as Quotation); }}><Printer size={15} />Save & preview</button>
        <button className="btn primary" onClick={save}>Save</button></>}>
        <div className="form">
          <Field label="Customer"><select value={edit.customerId || ''} onChange={(e) => setEdit({ ...edit, customerId: e.target.value })}><option value="">— Select —</option>{db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Subject" span={2}><input value={edit.title || ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="e.g. Kitchen cabinets & wardrobe" /></Field>
          <Field label="Number"><input value={edit.number || ''} onChange={(e) => setEdit({ ...edit, number: e.target.value })} /></Field>
          <Field label="Date"><input type="date" value={edit.date || ''} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></Field>
          <Field label="Valid until"><input type="date" value={edit.validUntil || ''} onChange={(e) => setEdit({ ...edit, validUntil: e.target.value })} /></Field>
          <Field label="Status"><select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as QuoteStatus })}>{['draft', 'sent', 'accepted', 'rejected'].map((x) => <option key={x} value={x}>{statusMeta[x].label}</option>)}</select></Field>
          <div className="section-title">Items</div>
          <LinesEditor doc={edit} set={(p) => setEdit({ ...edit, ...(p as Partial<Quotation>) })} s={s} />
          <Field label="Terms & conditions" span={3}><textarea value={edit.terms || ''} onChange={(e) => setEdit({ ...edit, terms: e.target.value })} /></Field>
        </div>
      </Modal>}
      {view && <Modal open wide title={view.number} onClose={() => setView(null)} footer={<><a className="btn" target="_blank" rel="noreferrer" href={share(view)}><MessageCircle size={15} />WhatsApp</a><span className="spacer" /><button className="btn" onClick={() => setView(null)}>Close</button><button className="btn primary" onClick={() => window.print()}><Printer size={15} />Print / Save PDF</button></>}>
        <DocView kind="QUOTATION" doc={view} s={s} customer={L.customer(view.customerId)} />
      </Modal>}
    </>
  );
}
