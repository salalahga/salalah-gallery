import { useState } from 'react';
import { Pencil, Printer, MessageCircle, Phone, Mail } from 'lucide-react';
import type { Customer } from '../core/types';
import { store, useDB } from '../core/store';
import { go } from '../core/router';
import { docTotals, fmtDate, invoiceBalance, money } from '../core/calc';
import { statusMeta, waLink } from '../core/helpers';
import { projectTrack } from '../core/stages';
import { advanceOpen } from '../core/store';
import { customerLedger, ledgerBalance, CustomerStatement } from './Statement';
import { Photos } from './Photos';
import { Attachments } from './Attachments';
import { Modal, Badge, Empty, Tabs, Stat } from './ui';
import { useCanWrite } from '../core/session';

type Tab = 'overview' | 'projects' | 'quotes' | 'invoices' | 'payments' | 'ledger' | 'docs';

/** Everything about one customer: projects, quotations, invoices, payments, advances, ledger, documents. */
export function CustomerProfile({ customer, onClose, onEdit }: { customer: Customer; onClose: () => void; onEdit: () => void }) {
  const db = useDB(); const s = db.settings; const can = useCanWrite()('customers');
  const c = db.customers.find((x) => x.id === customer.id) || customer;
  const [tab, setTab] = useState<Tab>('overview'); const [stmt, setStmt] = useState(false);
  const jobs = db.jobs.filter((j) => j.customerId === c.id);
  const quotes = db.quotations.filter((q) => q.customerId === c.id);
  const invoices = db.invoices.filter((i) => i.customerId === c.id);
  const receipts = db.receipts.filter((r) => r.customerId === c.id);
  const ledger = customerLedger(db, c.id); const bal = ledgerBalance(ledger);
  const billed = invoices.reduce((n, i) => n + docTotals(i).total, 0);
  const received = receipts.filter((r) => !r.voided).reduce((n, r) => n + r.amount, 0);
  const outstanding = invoices.reduce((n, i) => n + Math.max(0, invoiceBalance(i)), 0);
  const advances = receipts.filter((r) => r.kind === 'advance').reduce((n, r) => n + advanceOpen(r), 0);
  const wa = c.whatsapp || c.phone;
  const save = (p: Partial<Customer>) => store.upsert('customers', { ...c, ...p });
  let run = 0;
  return (
    <Modal open wide title={`${c.code ? c.code + ' · ' : ''}${c.name}`} onClose={onClose} footer={<>
      {can && <button className="btn ghost" onClick={onEdit}><Pencil size={15} />Edit details</button>}
      <span className="spacer" />
      {wa && <a className="btn" target="_blank" rel="noreferrer" href={waLink(wa, `Hello ${c.name}, `)}><MessageCircle size={15} />WhatsApp</a>}
      <button className="btn" onClick={() => setStmt(true)}><Printer size={15} />Statement</button>
      <button className="btn" onClick={onClose}>Close</button></>}>
      <div className="flex wrap muted" style={{ gap: 14, marginBottom: 12 }}>
        <Badge>{c.type || 'Customer'}</Badge>
        {c.phone && <a href={`tel:${c.phone}`} className="flex"><Phone size={14} />{c.phone}</a>}
        {c.whatsapp && c.whatsapp !== c.phone && <span className="flex"><MessageCircle size={14} />{c.whatsapp}</span>}
        {c.email && <a href={`mailto:${c.email}`} className="flex"><Mail size={14} />{c.email}</a>}
        {c.address && <span>{c.address}</span>}
        <span>Customer since {fmtDate(c.createdAt?.slice(0, 10))}</span>
      </div>
      <div className="toolbar"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'projects', label: 'Projects', count: jobs.length }, { id: 'quotes', label: 'Quotations', count: quotes.length }, { id: 'invoices', label: 'Invoices', count: invoices.length }, { id: 'payments', label: 'Payments', count: receipts.length }, { id: 'ledger', label: 'Ledger' }, { id: 'docs', label: 'Documents & photos', count: (c.photos?.length || 0) + (c.attachments?.length || 0) }]} /></div>

      {tab === 'overview' && <>
        <div className="grid g4 mb">
          <Stat label="Projects" value={jobs.length} sub={`${jobs.filter((j) => j.status === 'completed').length} completed`} tone="blue" />
          <Stat label="Billed" value={money(billed, s)} tone="wood" sub={`${invoices.length} invoices`} />
          <Stat label="Received" value={money(received, s)} tone="green" sub={advances > 0.0005 ? `${money(advances, s)} advance not yet invoiced` : undefined} />
          <Stat label={bal >= 0 ? 'Balance due' : 'Advance held'} value={<span className={bal > 0.0005 ? 'neg' : 'pos'}>{money(Math.abs(bal), s)}</span>} tone="red" sub={`invoices open ${money(outstanding, s)}`} />
        </div>
        {c.notes && <div className="alert mb" style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</div>}
        <h3>Recent projects</h3>
        {jobs.length ? <ul className="list">{jobs.slice(0, 5).map((j) => { const t = projectTrack(db, j); return <li key={j.id} style={{ cursor: 'pointer' }} onClick={() => go('jobs', { id: j.id })}><span className="code-tag">{j.code}</span><div className="grow"><div className="title">{j.title}</div><div className="muted">{t.next}</div></div><b>{money(t.balance, s)}</b></li>; })}</ul> : <Empty title="No projects yet" />}
      </>}
      {tab === 'projects' && (jobs.length ? <div className="table-wrap"><table><thead><tr><th>Code</th><th>Project</th><th>Status</th><th className="num">Value</th><th className="num">Received</th><th className="num">Balance</th></tr></thead>
        <tbody>{jobs.map((j) => { const t = projectTrack(db, j); return <tr key={j.id} className="click" onClick={() => go('jobs', { id: j.id })}><td><span className="code-tag">{j.code}</span></td><td><b>{j.title}</b><div className="muted">{fmtDate(j.startDate)} → {fmtDate(j.dueDate)}</div></td><td><Badge tone={statusMeta[j.status].tone}>{statusMeta[j.status].label}</Badge></td><td className="num">{money(t.contract, s)}</td><td className="num pos">{money(t.collected, s)}</td><td className={`num ${t.balance > 0.0005 ? 'neg' : ''}`}>{money(t.balance, s)}</td></tr>; })}</tbody></table></div> : <Empty title="No projects" />)}
      {tab === 'quotes' && (quotes.length ? <div className="table-wrap"><table><thead><tr><th>Number</th><th>Subject</th><th>Date</th><th>Status</th><th className="num">Total</th></tr></thead>
        <tbody>{quotes.map((q) => <tr key={q.id} className="click" onClick={() => go('quotations', { id: q.id })}><td><b>{q.number}</b></td><td>{q.title}</td><td>{fmtDate(q.date)}</td><td><Badge tone={statusMeta[q.status].tone}>{statusMeta[q.status].label}</Badge></td><td className="num">{money(docTotals(q).total, s)}</td></tr>)}</tbody></table></div> : <Empty title="No quotations" />)}
      {tab === 'invoices' && (invoices.length ? <div className="table-wrap"><table><thead><tr><th>Number</th><th>Subject</th><th>Date</th><th>Due</th><th className="num">Total</th><th className="num">Balance</th></tr></thead>
        <tbody>{invoices.map((i) => <tr key={i.id} className="click" onClick={() => go('invoices', { id: i.id })}><td><b>{i.number}</b></td><td>{i.title}</td><td>{fmtDate(i.date)}</td><td>{fmtDate(i.dueDate)}</td><td className="num">{money(docTotals(i).total, s)}</td><td className={`num ${invoiceBalance(i) > 0.0005 ? 'neg' : ''}`}><b>{money(Math.max(0, invoiceBalance(i)), s)}</b></td></tr>)}</tbody></table></div> : <Empty title="No invoices" />)}
      {tab === 'payments' && (receipts.length ? <div className="table-wrap"><table><thead><tr><th>Receipt</th><th>Date</th><th>Type</th><th>Method</th><th className="num">Amount</th></tr></thead>
        <tbody>{receipts.map((r) => <tr key={r.id} style={r.voided ? { opacity: .5 } : undefined}><td><b>{r.number}</b>{r.voided && <Badge tone="red">Void</Badge>}</td><td>{fmtDate(r.date)}</td><td><Badge tone={r.kind === 'advance' ? 'amber' : 'green'}>{r.kind}</Badge>{r.kind === 'advance' && advanceOpen(r) > 0.0005 && <div className="muted">{money(advanceOpen(r), s)} not yet invoiced</div>}</td><td>{r.method}{r.chequeNo ? ` · ${r.chequeNo}` : ''}</td><td className="num"><b>{money(r.amount, s)}</b></td></tr>)}</tbody></table></div> : <Empty title="No payments yet" />)}
      {tab === 'ledger' && (ledger.length ? <div className="table-wrap"><table className="statement"><thead><tr><th>Date</th><th>Ref</th><th>Details</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
        <tbody>{ledger.map((l, i) => { run += l.debit - l.credit; return <tr key={i}><td>{fmtDate(l.date)}</td><td>{l.ref}</td><td>{l.text}</td><td className="num">{l.debit ? money(l.debit, s) : ''}</td><td className="num">{l.credit ? money(l.credit, s) : ''}</td><td className="num"><b>{money(run, s)}</b></td></tr>; })}</tbody></table></div> : <Empty title="No entries yet" />)}
      {tab === 'docs' && <div className="grid g2">
        <div className="card flat"><h3>Photos</h3><Photos photos={c.photos || []} onChange={(photos) => save({ photos })} readOnly={!can} kinds={['site', 'before', 'after']} /></div>
        <div className="card flat"><h3>Documents</h3><Attachments files={c.attachments || []} onChange={(attachments) => save({ attachments })} readOnly={!can} label="Add document / PDF" kind="document" /></div>
      </div>}
      {stmt && <CustomerStatement customer={c} onClose={() => setStmt(false)} />}
    </Modal>
  );
}
