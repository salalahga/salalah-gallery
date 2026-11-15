import { useEffect, useState } from 'react';
import { Settings2, Send, Copy, RefreshCw, Download, Smartphone, Zap, CheckCircle2 } from 'lucide-react';
import { store, useDB } from '../core/store';
import { api } from '../core/api';
import { go } from '../core/router';
import { PLUGINS, CLAUDE_CONNECTORS, WA_TEMPLATES, type PluginDef } from '../plugins/catalog';
import { downloadCsv } from '../plugins/hooks';
import { useInstallPrompt, isInstalled } from '../plugins/pwa';
import { PageHeader, Modal, Field, Badge, Tabs, toast } from '../components/ui';
import type { Collection } from '../core/types';

type ServerCfg = Record<string, Record<string, unknown>>;
const EXPORTS: { col: Collection; label: string }[] = [
  { col: 'jobs', label: 'Jobs' }, { col: 'tasks', label: 'Tasks' }, { col: 'customers', label: 'Customers' }, { col: 'staff', label: 'Staff' },
  { col: 'attendance', label: 'Attendance' }, { col: 'payslips', label: 'Payslips' }, { col: 'quotations', label: 'Quotations' }, { col: 'invoices', label: 'Invoices' },
  { col: 'txns', label: 'Accounts (income & expense)' }, { col: 'items', label: 'Stock / products' }, { col: 'sales', label: 'Sales' }, { col: 'socialPosts', label: 'Social posts' },
];

export default function Plugins() {
  const db = useDB(); const s = db.settings;
  const online = store.mode === 'server';
  const [cat, setCat] = useState('All');
  const [server, setServer] = useState<ServerCfg>({});
  const [open, setOpen] = useState<PluginDef | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const { canInstall, install } = useInstallPrompt();

  useEffect(() => {
    if (!online) return;
    api<{ config: ServerCfg }>('/api/plugins').then((r) => {
      setServer(r.config);
      const cur = store.get().settings.plugins || {};
      const drift = PLUGINS.filter((p) => p.runsOn === 'server' && !!r.config[p.id]?.enabled !== !!cur[p.id]?.enabled);
      if (drift.length) store.setSettings({ plugins: { ...cur, ...Object.fromEntries(drift.map((p) => [p.id, { ...(cur[p.id] || {}), enabled: !!r.config[p.id]?.enabled }])) } });
    }, (e) => toast(e.message));
  }, [online]);

  const isOn = (p: PluginDef) => p.alwaysOn || !!s.plugins?.[p.id]?.enabled;
  const setLocal = (id: string, patch: Record<string, unknown>) => store.setSettings({ plugins: { ...(s.plugins || {}), [id]: { ...(s.plugins?.[id] || { enabled: false }), ...patch } as never } });

  const toggle = async (p: PluginDef, enabled: boolean) => {
    if (p.alwaysOn) return;
    if (p.runsOn === 'server') {
      if (!online) return toast('This plugin needs the online server');
      const patch: Record<string, unknown> = { enabled };
      if (p.id === 'ical' && enabled && !server.ical?.token) patch.token = crypto.randomUUID().replace(/-/g, '');
      try { const r = await api<{ config: ServerCfg }>(`/api/plugins/${p.id}`, { method: 'PUT', body: patch }); setServer(r.config); } catch (e) { return toast((e as Error).message); }
    }
    setLocal(p.id, { enabled }); toast(`${p.name} ${enabled ? 'enabled' : 'disabled'}`);
  };
  const openCfg = (p: PluginDef) => { setOpen(p); setForm(p.runsOn === 'server' ? { ...(server[p.id] || {}) } : { ...(s.plugins?.[p.id] || {}) }); };
  const save = async () => {
    if (!open) return;
    if (open.runsOn === 'server') {
      if (!online) return toast('This plugin needs the online server');
      setBusy(true);
      try { const r = await api<{ config: ServerCfg }>(`/api/plugins/${open.id}`, { method: 'PUT', body: { ...form, enabled: isOn(open) || !!form.enabled } }); setServer(r.config); setForm({ ...r.config[open.id] }); toast('Saved'); }
      catch (e) { toast((e as Error).message); } finally { setBusy(false); }
    } else { setLocal(open.id, form); toast('Saved'); }
  };
  const test = async () => {
    if (!open) return; setBusy(true);
    try { await save(); await api(`/api/plugins/${open.id}/test`, { method: 'POST' }); toast('Test sent ✓'); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const icalUrl = server.ical?.token ? `${window.location.origin}/api/calendar/${server.ical.token}.ics` : '';
  const regenIcal = async () => { const r = await api<{ config: ServerCfg }>('/api/plugins/ical', { method: 'PUT', body: { token: crypto.randomUUID().replace(/-/g, '') } }); setServer(r.config); toast('New private link created — the old one stops working'); };

  const cats = ['All', ...new Set(PLUGINS.map((p) => p.category))];
  const list = PLUGINS.filter((p) => cat === 'All' || p.category === cat);
  const active = PLUGINS.filter(isOn).length;

  return (
    <>
      <PageHeader title="Plugins" sub={`${active} of ${PLUGINS.length} active · every plugin here is free to use`}
        actions={<button className="btn primary" onClick={() => go('automations')}><Zap size={16} />Automations</button>} />
      {!online && <div className="alert">You are in single-device mode. Telegram, email, webhooks, the calendar feed and automations need the online server — the other plugins work now.</div>}
      <div className="toolbar"><Tabs value={cat} onChange={setCat} tabs={cats.map((c) => ({ id: c, label: c }))} /></div>
      <div className="grid g3">
        {list.map((p) => { const on = isOn(p); const blocked = p.runsOn === 'server' && !online; return (
          <div key={p.id} className={`card plugin ${on ? 'on' : ''}`}>
            <div className="flex between" style={{ alignItems: 'flex-start' }}>
              <div className="plugin-icon" style={{ background: p.color + '1f' }}>{p.icon}</div>
              {p.alwaysOn ? <Badge tone="green">Built in</Badge> : <label className="switch" title={blocked ? 'Needs the online server' : ''}><input type="checkbox" checked={on} disabled={blocked} onChange={(e) => toggle(p, e.target.checked)} /><span /></label>}
            </div>
            <b className="plugin-name">{p.name}</b>
            <p className="plugin-desc">{p.desc}</p>
            <div className="flex between wrap" style={{ marginTop: 'auto' }}>
              <span className="flex wrap" style={{ gap: 6 }}><Badge tone="green">{p.cost.split(/[.(—]/)[0].trim()}</Badge>{p.runsOn === 'server' && <Badge tone="blue">Server</Badge>}</span>
              {(p.fields || p.steps || ['export', 'pwa', 'ical'].includes(p.id)) && <button className="btn sm" onClick={() => openCfg(p)}><Settings2 size={14} />{p.fields ? 'Configure' : 'Open'}</button>}
            </div>
          </div>); })}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3>More connectors through Claude</h3>
        <p className="muted" style={{ marginTop: -6 }}>These are used by asking Claude (for example “design an Instagram post for job JOB-101 in Canva”). Costs shown are the service's own plans.</p>
        <div className="grid g2">{CLAUDE_CONNECTORS.map((c) => <div key={c.name} className="integ"><div style={{ flex: 1 }}><b>{c.name}</b><span className="muted">{c.use}</span></div><Badge tone={c.cost === 'Paid' ? 'amber' : 'green'}>{c.cost}</Badge></div>)}</div>
      </div>

      {open && <Modal open wide={open.id === 'whatsapp'} title={`${open.icon} ${open.name}`} onClose={() => setOpen(null)} footer={<>
        {open.test && <button className="btn" disabled={busy || !online} onClick={test}><Send size={15} />Save & send test</button>}
        <span className="spacer" /><button className="btn" onClick={() => setOpen(null)}>Close</button>
        {open.fields && <button className="btn primary" disabled={busy} onClick={save}>Save</button>}</>}>
        <p style={{ marginTop: 0 }}>{open.desc}</p>
        <p className="muted"><b>Cost:</b> {open.cost}</p>
        {open.steps && <ol className="steps">{open.steps.map((x) => <li key={x}>{x}</li>)}</ol>}
        {open.fields && <div className="form two" style={{ marginTop: 10 }}>
          {open.fields.map((f) => <Field key={f.key} label={f.label} span={f.type === 'textarea' ? 3 : 1}>
            {f.type === 'textarea' ? <textarea value={String(form[f.key] ?? '')} placeholder={f.placeholder} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              : f.type === 'select' ? <select value={String(form[f.key] ?? f.options?.[0])} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
              : <input type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'} autoComplete="off" value={String(form[f.key] ?? '')} placeholder={f.placeholder} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}
          </Field>)}
          {open.id === 'whatsapp' && <p className="span-3 muted">Placeholders: {'{{customer}} {{number}} {{title}} {{total}} {{balance}} {{due}} {{status}} {{business}} {{phone}} {{link}}'} … Leave a template empty to use the default. <button className="btn sm ghost" onClick={() => setForm(Object.fromEntries(Object.entries(WA_TEMPLATES).map(([k, v]) => ['tpl_' + k, v.text])))}>Fill in defaults</button></p>}
        </div>}
        {open.id === 'ical' && (online ? (icalUrl ? <div className="copy-box"><code>{icalUrl}</code><div className="flex"><button className="btn sm" onClick={() => { navigator.clipboard?.writeText(icalUrl); toast('Link copied'); }}><Copy size={14} />Copy</button><button className="btn sm ghost" onClick={regenIcal}><RefreshCw size={14} />New link</button></div></div>
          : <p className="muted">Switch the plugin on to create your private calendar link.</p>) : <p className="muted">Needs the online server.</p>)}
        {open.id === 'export' && <div className="chips">{EXPORTS.filter((x) => x.col in db).map((x) => <button key={x.col} className="btn sm" onClick={() => downloadCsv(`${x.col}-${new Date().toISOString().slice(0, 10)}`, db[x.col] as unknown as Record<string, unknown>[])}><Download size={14} />{x.label} ({(db[x.col] as unknown[]).length})</button>)}</div>}
        {open.id === 'pwa' && <div style={{ marginTop: 10 }}>{isInstalled() ? <Badge tone="green"><CheckCircle2 size={13} /> Installed on this device</Badge>
          : canInstall ? <button className="btn primary" onClick={async () => { if (await install()) toast('App installed'); }}><Smartphone size={16} />Install on this device</button>
          : <p className="muted">Your browser has not offered installation yet. Use the browser menu as described above.</p>}</div>}
      </Modal>}
    </>
  );
}
