import { useRef, useState } from 'react';
import { Plus, Trash2, Download, Upload, RotateCcw, Plug } from 'lucide-react';
import { store, useDB, exportBackup, uid } from '../core/store';
import type { WorkType, DB } from '../core/types';
import { PageHeader, Field, Tabs, toast, Badge } from '../components/ui';
import { useT } from '../core/i18n';

const INTEGRATIONS = [
  { name: 'WhatsApp', area: 'Customers & staff', status: 'Built in', desc: 'Send quotations, invoices, job updates and task assignments as WhatsApp messages.' },
  { name: 'Print / PDF', area: 'Documents', status: 'Built in', desc: 'Quotations, invoices, payslips and receipts print or save as PDF.' },
  { name: 'Facebook · X · LinkedIn share', area: 'Social', status: 'Built in', desc: 'One-click share from the post planner.' },
  { name: 'QuickBooks', area: 'Accounts / Payroll', status: 'Available via Claude', desc: 'Sync invoices, expenses and payroll to QuickBooks Online.' },
  { name: 'Metricool / Postiz', area: 'Social', status: 'Available via Claude', desc: 'Auto-publish scheduled posts and pull analytics for Instagram, Facebook, TikTok.' },
  { name: 'Canva / Adobe Express', area: 'Social', status: 'Available via Claude', desc: 'Design post graphics and brochures for your jobs.' },
  { name: 'Netlify / Hostinger / Wix', area: 'Website', status: 'Available via Claude', desc: 'Publish the generated website on your own domain.' },
  { name: 'Google Sheets / Drive', area: 'Backup & reports', status: 'Available via Claude', desc: 'Export accounts, payroll and job reports to Sheets.' },
];

export default function SettingsPage() {
  const db = useDB(); const s = db.settings; const t = useT();
  const [tab, setTab] = useState<'business' | 'work' | 'lists' | 'integrations' | 'data'>('business');
  const fileRef = useRef<HTMLInputElement>(null);
  const set = store.setSettings;
  const setWT = (i: number, p: Partial<WorkType>) => set({ workTypes: s.workTypes.map((w, k) => (k === i ? { ...w, ...p } : w)) });
  const restore = (f: File) => { const r = new FileReader(); r.onload = () => { try { const d = JSON.parse(String(r.result)) as DB; if (!d.settings) throw 0; store.replace(d); toast('Backup restored'); } catch { toast('Invalid backup file'); } }; r.readAsText(f); };
  const logo = (f: File) => { const r = new FileReader(); r.onload = () => set({ logo: String(r.result) }); r.readAsDataURL(f); };

  return (
    <>
      <PageHeader title={t('Settings')} sub="Business profile, work types, lists, integrations and backup." />
      <div className="toolbar"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'business', label: 'Business' }, { id: 'work', label: 'Work types', count: s.workTypes.length }, { id: 'lists', label: 'Lists & payroll' }, { id: 'integrations', label: 'Integrations' }, { id: 'data', label: 'Backup' }]} /></div>

      {tab === 'business' && <div className="card"><div className="form">
        <Field label="Business name" span={2}><input value={s.businessName} onChange={(e) => set({ businessName: e.target.value })} /></Field>
        <Field label="Logo"><div className="flex">{s.logo && <img src={s.logo} alt="" style={{ height: 38, borderRadius: 8 }} />}<input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && logo(e.target.files[0])} />{s.logo && <button className="icon-btn" onClick={() => set({ logo: undefined })}><Trash2 size={15} /></button>}</div></Field>
        <Field label="Tagline" span={3}><input value={s.tagline} onChange={(e) => set({ tagline: e.target.value })} /></Field>
        <Field label="Phone"><input value={s.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label="WhatsApp number (with country code)"><input value={s.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} /></Field>
        <Field label="Email"><input value={s.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Address"><input value={s.address} onChange={(e) => set({ address: e.target.value })} /></Field>
        <Field label="City"><input value={s.city} onChange={(e) => set({ city: e.target.value })} /></Field>
        <Field label="Country"><input value={s.country} onChange={(e) => set({ country: e.target.value })} /></Field>
        <Field label="Currency"><select value={s.currency} onChange={(e) => set({ currency: e.target.value })}>{['OMR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'INR', 'USD', 'EUR'].map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="VAT %"><input type="number" value={s.vatRate} onChange={(e) => set({ vatRate: +e.target.value })} /></Field>
        <Field label="VAT number"><input value={s.vatNumber} onChange={(e) => set({ vatNumber: e.target.value })} /></Field>
        <Field label="CR / licence number"><input value={s.crNumber} onChange={(e) => set({ crNumber: e.target.value })} /></Field>
        <Field label="Language"><select value={s.lang} onChange={(e) => set({ lang: e.target.value as 'en' | 'ml' })}><option value="en">English</option><option value="ml">മലയാളം (Malayalam)</option></select></Field>
        <Field label="Default quotation terms" span={3}><textarea value={s.quoteTerms} onChange={(e) => set({ quoteTerms: e.target.value })} /></Field>
      </div></div>}

      {tab === 'work' && <>
        <p className="muted" style={{ marginTop: 0 }}>Add any kind of work your workshop does. Each work type has its own default rate and its own detail fields that appear on jobs (e.g. CNC → design file, machine hours).</p>
        <div className="grid g2">
          {s.workTypes.map((w, i) => <div key={w.id} className="card" style={{ borderTop: `4px solid ${w.color}` }}>
            <div className="form two">
              <Field label="Name"><input value={w.name} onChange={(e) => setWT(i, { name: e.target.value })} /></Field>
              <Field label="Colour"><input type="color" value={w.color} onChange={(e) => setWT(i, { color: e.target.value })} style={{ height: 40, padding: 4 }} /></Field>
              <Field label="Unit"><input value={w.unit} onChange={(e) => setWT(i, { unit: e.target.value })} /></Field>
              <Field label={`Default rate (${s.currency})`}><input type="number" value={w.rate} onChange={(e) => setWT(i, { rate: +e.target.value })} /></Field>
              <Field label="Detail fields (one per line)" span={3}><textarea value={w.fields.join('\n')} onChange={(e) => setWT(i, { fields: e.target.value.split('\n') })} onBlur={() => setWT(i, { fields: w.fields.map((x) => x.trim()).filter(Boolean) })} /></Field>
            </div>
            <div className="flex between" style={{ marginTop: 10 }}><span className="muted">{db.jobs.filter((j) => j.workTypeId === w.id).length} jobs</span><button className="btn sm danger ghost" onClick={() => { if (window.confirm(`Remove ${w.name}?`)) set({ workTypes: s.workTypes.filter((x) => x.id !== w.id) }); }}><Trash2 size={14} />Remove</button></div>
          </div>)}
          <button className="card" style={{ borderStyle: 'dashed', cursor: 'pointer', minHeight: 160, background: 'transparent' }} onClick={() => set({ workTypes: [...s.workTypes, { id: uid(), name: 'New work type', color: '#0891b2', unit: 'job', rate: 0, fields: ['Specification'] }] })}><span className="flex" style={{ justifyContent: 'center' }}><Plus size={18} />Add work type</span></button>
        </div>
      </>}

      {tab === 'lists' && <div className="grid g2">
        <div className="card"><h3>Categories & roles</h3><div className="form" style={{ gridTemplateColumns: '1fr' }}>
          {([['expenseCategories', 'Expense categories'], ['incomeCategories', 'Income categories'], ['roles', 'Staff roles']] as const).map(([k, label]) =>
            <Field key={k} label={`${label} (comma separated)`}><textarea defaultValue={s[k].join(', ')} onBlur={(e) => set({ [k]: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>)}
        </div></div>
        <div className="card"><h3>Payroll rules</h3><div className="form two">
          <Field label="Working days / month"><input type="number" value={s.workingDaysPerMonth} onChange={(e) => set({ workingDaysPerMonth: +e.target.value })} /></Field>
          <Field label="Work hours / day"><input type="number" value={s.workHoursPerDay} onChange={(e) => set({ workHoursPerDay: +e.target.value })} /></Field>
          <Field label="Overtime multiplier"><input type="number" step={0.05} value={s.overtimeMultiplier} onChange={(e) => set({ overtimeMultiplier: +e.target.value })} /></Field>
          <p className="span-3 muted">Monthly staff: salary ÷ working days × days present. Daily staff: rate × days. Overtime = hourly rate × multiplier. Unrecovered advances are deducted automatically.</p>
        </div></div>
      </div>}

      {tab === 'integrations' && <div className="card"><h3><span className="flex"><Plug size={17} />Connectors</span></h3>
        <div className="grid g2">{INTEGRATIONS.map((x) => <div key={x.name} className="integ"><div style={{ flex: 1 }}><b>{x.name}</b><span className="muted">{x.area}</span><p style={{ margin: '6px 0 0', fontSize: 13.5 }}>{x.desc}</p></div><Badge tone={x.status === 'Built in' ? 'green' : 'blue'}>{x.status}</Badge></div>)}</div>
        <p className="muted" style={{ marginTop: 14 }}>“Available via Claude” connectors work by asking Claude, e.g. “sync this month’s invoices to QuickBooks” or “publish my website to Netlify”. Live in-app sync needs a small server and your account keys — the module system is ready for it.</p>
      </div>}

      {tab === 'data' && <div className="grid g3">
        <div className="card"><h3>Backup</h3><p className="muted">Data is stored in this browser. Download a backup regularly.</p><button className="btn primary" onClick={exportBackup}><Download size={16} />Download backup</button></div>
        <div className="card"><h3>Restore</h3><p className="muted">Load a backup file (replaces current data).</p><input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} /><button className="btn" onClick={() => fileRef.current?.click()}><Upload size={16} />Restore backup</button></div>
        <div className="card"><h3>Start fresh</h3><p className="muted">Remove demo data and start with your own.</p><div className="flex wrap">
          <button className="btn danger" onClick={() => window.confirm('Delete ALL records and keep settings defaults?') && (store.reset(true), toast('All data cleared'))}><Trash2 size={16} />Clear all</button>
          <button className="btn" onClick={() => window.confirm('Reload demo data?') && (store.reset(false), toast('Demo data loaded'))}><RotateCcw size={16} />Demo data</button></div></div>
      </div>}
    </>
  );
}
