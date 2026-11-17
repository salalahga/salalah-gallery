import { useState } from 'react';
import { Plus, Trash2, Phone, MessageCircle, Mail, ScrollText } from 'lucide-react';
import { CustomerStatement } from '../components/Statement';
import { CustomerProfile } from '../components/CustomerProfile';
import { customerLinks } from '../core/ledger';
import { store, useDB } from '../core/store';
import type { Customer } from '../core/types';
import { docTotals, invoiceBalance, money } from '../core/calc';
import { waLink } from '../core/helpers';
import { Modal, Field, PageHeader, SearchBox, Avatar, Empty, Badge, toast, confirmDelete } from '../components/ui';
import { useT } from '../core/i18n';
import { usePlugin, mapsLink } from '../plugins/hooks';
import { MapPin } from 'lucide-react';

export default function Customers() {
  const db = useDB(); const s = db.settings; const t = useT(); const maps = usePlugin('maps').enabled;
  const [q, setQ] = useState(''); const [edit, setEdit] = useState<Partial<Customer> | null>(null); const [stmt, setStmt] = useState<Customer | null>(null); const [prof, setProf] = useState<Customer | null>(null);
  const list = db.customers.filter((c) => `${c.code || ''} ${c.name} ${c.phone || ''} ${c.whatsapp || ''} ${c.email || ''}`.toLowerCase().includes(q.toLowerCase()));
  const nextCode = () => { const n = db.customers.map((c) => parseInt(String(c.code || '').replace(/\D/g, ''), 10) || 0); return `C-${String((n.length ? Math.max(...n) : 0) + 1).padStart(4, '0')}`; };
  const stats = (id: string) => ({
    jobs: db.jobs.filter((j) => j.customerId === id).length,
    billed: db.invoices.filter((i) => i.customerId === id).reduce((n, i) => n + docTotals(i).total, 0),
    due: db.invoices.filter((i) => i.customerId === id).reduce((n, i) => n + Math.max(0, invoiceBalance(i)), 0),
  });
  const save = () => {
    if (!edit?.name?.trim()) return toast('Enter a name');
    const code = (edit.code || '').trim() || nextCode();
    if (db.customers.some((c) => c.id !== edit.id && c.code === code)) return toast(`Customer ID ${code} is already used`);
    store.upsert('customers', { ...edit, code } as Customer); setEdit(null); toast('Customer saved');
  };
  return (
    <>
      <PageHeader title={t('Customers')} sub={`${db.customers.length} customers`} actions={<><SearchBox value={q} onChange={setQ} /><button className="btn primary" onClick={() => setEdit({ type: 'Individual' })}><Plus size={16} />Add customer</button></>} />
      <div className="card">
        {list.length ? <div className="table-wrap"><table>
          <thead><tr><th>Customer</th><th>Contact</th><th>Type</th><th className="num">Jobs</th><th className="num">Billed</th><th className="num">Balance due</th><th /></tr></thead>
          <tbody>{list.map((c) => { const st = stats(c.id); return (
            <tr key={c.id} className="click" onClick={() => setProf(c)}>
              <td><div className="flex"><Avatar name={c.name} color="#a0652f" /><div>{c.code && <span className="code-tag">{c.code}</span>} <b>{c.name}</b><div className="muted">{c.address}</div></div></div></td>
              <td>{c.phone}<div className="muted">{c.email}</div></td><td><Badge>{c.type || '—'}</Badge></td>
              <td className="num">{st.jobs}</td><td className="num">{money(st.billed, s)}</td><td className={`num ${st.due > 0 ? 'neg' : ''}`}>{money(st.due, s)}</td>
              <td onClick={(e) => e.stopPropagation()}><div className="row-actions">
                <button className="icon-btn" title="Statement of account" onClick={() => setStmt(c)}><ScrollText size={16} /></button>
                {c.phone && <a className="icon-btn" href={`tel:${c.phone}`} title="Call"><Phone size={16} /></a>}
                {c.phone && <a className="icon-btn" target="_blank" rel="noreferrer" href={waLink(c.whatsapp || c.phone, `Hello ${c.name}, `)} title="WhatsApp"><MessageCircle size={16} /></a>}
                {c.email && <a className="icon-btn" href={`mailto:${c.email}`} title="Email"><Mail size={16} /></a>}
                {maps && c.address && <a className="icon-btn" target="_blank" rel="noreferrer" href={mapsLink(c.address)} title="Directions"><MapPin size={16} /></a>}
              </div></td>
            </tr>); })}</tbody></table></div> : <Empty title="No customers yet" action={<button className="btn primary" onClick={() => setEdit({})}>Add customer</button>} />}
      </div>
      {edit && <Modal open title={edit.id ? 'Edit customer' : 'New customer'} onClose={() => setEdit(null)} footer={<>
        {edit.id && <button className="btn danger ghost" onClick={() => {
          const links = customerLinks(edit as Customer);
          if (links.length) return toast(`${edit.name} has ${links.join(', ')} — they cannot be deleted. Edit the name or add a note instead.`);
          if (confirmDelete(edit.name)) { store.remove('customers', edit.id!); setEdit(null); } }}><Trash2 size={15} />Delete</button>}
        {edit.id && <button className="btn ghost" onClick={() => { setStmt(edit as Customer); setEdit(null); }}><ScrollText size={15} />Statement</button>}
        <span className="spacer" /><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
        <div className="form two">
          <Field label="Name" span={3}><input autoFocus value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Customer ID"><input value={edit.code || ''} placeholder={nextCode()} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Phone"><input value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label="WhatsApp (if different)"><input value={edit.whatsapp || ''} onChange={(e) => setEdit({ ...edit, whatsapp: e.target.value })} placeholder="+968…" /></Field>
          <Field label="Email"><input type="email" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
          <Field label="Type"><select value={edit.type || ''} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>{['Individual', 'Company', 'Contractor', 'Interior Designer', 'Government'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Address"><input value={edit.address || ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
          <Field label="Notes" span={3}><textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </div>
      </Modal>}
      {stmt && <CustomerStatement customer={stmt} onClose={() => setStmt(null)} />}
      {prof && <CustomerProfile customer={prof} onClose={() => setProf(null)} onEdit={() => { setEdit({ ...(db.customers.find((x) => x.id === prof.id) || prof) }); setProf(null); }} />}
    </>
  );
}
