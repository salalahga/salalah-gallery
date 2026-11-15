import { useEffect, useState } from 'react';
import { Plus, Trash2, Play, Zap, CalendarClock, RotateCcw, Plug, CheckCircle2, XCircle } from 'lucide-react';
import { store, useDB } from '../core/store';
import { api } from '../core/api';
import { go } from '../core/router';
import { PageHeader, Modal, Field, Badge, Empty, Tabs, toast, confirmDelete } from '../components/ui';

type Action = { type: 'telegram' | 'email' | 'webhook' | 'task'; to?: string; template?: string; subject?: string; title?: string; url?: string; staffId?: string; priority?: string };
type Rule = { id: string; name: string; enabled: boolean; trigger: string; filter?: { workTypeId?: string }; actions: Action[] };
type LogRow = { id: string; at: number; rule: string; trigger: string; ok: boolean; detail: string };

const VARS: Record<string, string> = {
  job: '{{job.code}} {{job.title}} {{job.status}} {{job.dueDate}} {{job.value}} {{customer.name}}',
  task: '{{task.title}} {{task.dueDate}} {{task.priority}} {{staff.name}} {{job.code}} {{job.title}}',
  quotation: '{{quotation.number}} {{quotation.title}} {{customer.name}} {{total}}',
  invoice: '{{invoice.number}} {{invoice.dueDate}} {{customer.name}} {{total}} {{balance}}',
  payment: '{{amount}} {{invoice.number}} {{customer.name}} {{balance}}',
  sale: '{{sale.number}} {{total}} {{customer.name}}', expense: '{{txn.description}} {{txn.category}} {{amount}}',
  stock: '{{item.name}} {{item.thickness}} {{item.qty}} {{item.unit}} {{item.reorder}}', customer: '{{customer.name}} {{customer.phone}}',
  daily: '{{summary}} {{date}}',
};
const varsFor = (t: string) => VARS[t.startsWith('payment') ? 'payment' : t.startsWith('daily') ? 'daily' : t.startsWith('stock') ? 'stock' : t.startsWith('expense') ? 'expense' : t.split('.')[0]] || '{{event}} {{date}} {{business}}';
const ACTION_LABEL = { telegram: '✈️ Telegram message', email: '✉️ Email', webhook: '🔗 Webhook (n8n / Make / Zapier / Sheets)', task: '🔨 Create a task' };

export default function Automations() {
  const db = useDB(); const online = store.mode === 'server';
  const [tab, setTab] = useState<'rules' | 'log'>('rules');
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [triggers, setTriggers] = useState<Record<string, string>>({});
  const [log, setLog] = useState<LogRow[]>([]);
  const [edit, setEdit] = useState<Rule | null>(null);
  const [results, setResults] = useState<string[] | null>(null);
  const [pluginCfg, setPluginCfg] = useState<Record<string, { enabled?: boolean }>>({});

  const load = () => api<{ rules: Rule[]; triggers: Record<string, string> }>('/api/automations').then((r) => { setRules(r.rules); setTriggers(r.triggers); }, (e) => toast(e.message));
  const loadLog = () => api<{ log: LogRow[] }>('/api/automations/log').then((r) => setLog(r.log), () => {});
  useEffect(() => { if (online) { void load(); void loadLog(); api<{ config: Record<string, { enabled?: boolean }> }>('/api/plugins').then((r) => setPluginCfg(r.config), () => {}); } }, [online]);

  if (!online) return (<><PageHeader title="Automations" sub="When something happens → do something automatically." />
    <div className="card"><Empty title="Automations need the online server" hint="They run on the server so they work even when nobody has the app open. Start the app with the server to use them." /></div></>);

  const persist = async (next: Rule[]) => { setRules(next); try { await api('/api/automations', { method: 'PUT', body: { rules: next } }); } catch (e) { toast((e as Error).message); void load(); } };
  const saveEdit = async () => {
    if (!edit || !rules) return;
    if (!edit.name.trim()) return toast('Give the rule a name');
    const exists = rules.some((r) => r.id === edit.id);
    await persist(exists ? rules.map((r) => (r.id === edit.id ? edit : r)) : [...rules, edit]); setEdit(null); toast('Rule saved');
  };
  const runTest = async (r: Rule) => { setResults(['Running…']); try { const x = await api<{ results: string[] }>('/api/automations/test', { method: 'POST', body: r }); setResults(x.results.length ? x.results : ['This rule has no actions']); void loadLog(); } catch (e) { setResults([(e as Error).message]); } };
  const setAction = (i: number, p: Partial<Action>) => edit && setEdit({ ...edit, actions: edit.actions.map((a, k) => (k === i ? { ...a, ...p } : a)) });
  const triggerLabel = (t: string) => (t === '*' ? 'Every event' : triggers[t] || t);
  const missing = (rules || []).filter((r) => r.enabled).flatMap((r) => r.actions.map((a) => a.type)).filter((t) => t !== 'task' && !pluginCfg[t === 'webhook' ? 'webhooks' : t]?.enabled);

  return (
    <>
      <PageHeader title="Automations" sub="When something happens in the workshop → send a message, call a webhook or create a task. Runs on the server, 24/7."
        actions={<>
          <Tabs value={tab} onChange={(v) => { setTab(v); if (v === 'log') void loadLog(); }} tabs={[{ id: 'rules', label: 'Rules', count: rules?.length }, { id: 'log', label: 'Activity log' }]} />
          <button className="btn" onClick={async () => { await api('/api/automations/run-daily', { method: 'POST' }); toast('Daily checks ran'); void loadLog(); }}><CalendarClock size={16} />Run daily checks now</button>
          <button className="btn primary" onClick={() => setEdit({ id: crypto.randomUUID().slice(0, 12), name: '', enabled: true, trigger: 'job.created', actions: [{ type: 'telegram', template: '' }] })}><Plus size={16} />New rule</button>
        </>} />
      {missing.length > 0 && <div className="alert">Some active rules use plugins that are switched off ({[...new Set(missing)].join(', ')}). <a href="#/plugins" style={{ textDecoration: 'underline' }}>Set them up in Plugins</a> — until then those actions are logged as failed.</div>}

      {tab === 'rules' ? <div className="card">
        {rules === null ? <p className="muted">Loading…</p> : rules.length ? <ul className="list">{rules.map((r) => (
          <li key={r.id}>
            <label className="switch"><input type="checkbox" checked={r.enabled} onChange={(e) => persist(rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))} /><span /></label>
            <div className="grow" style={{ cursor: 'pointer' }} onClick={() => setEdit(structuredClone(r))}>
              <div className="title">{r.name}</div>
              <div className="muted"><Zap size={12} style={{ verticalAlign: -1 }} /> {triggerLabel(r.trigger)} → {r.actions.map((a) => ACTION_LABEL[a.type].split(' ').slice(0, 2).join(' ')).join(', ') || 'no actions'}</div>
            </div>
            <button className="icon-btn" title="Test with sample data" onClick={() => runTest(r)}><Play size={16} /></button>
          </li>))}</ul> : <Empty title="No rules" />}
        <div className="flex wrap" style={{ marginTop: 12 }}>
          <button className="btn sm ghost" onClick={async () => { const r = await api<{ added: number }>('/api/automations/defaults', { method: 'POST' }); toast(r.added ? `${r.added} ready-made rules added` : 'All ready-made rules are already here'); void load(); }}><RotateCcw size={14} />Restore ready-made rules</button>
          <button className="btn sm ghost" onClick={() => go('plugins')}><Plug size={14} />Plugins</button>
        </div>
      </div> : <div className="card">
        {log.length ? <div className="table-wrap"><table><thead><tr><th>When</th><th>Rule</th><th>Trigger</th><th>Result</th></tr></thead>
          <tbody>{log.map((l) => <tr key={l.id}><td className="muted">{new Date(l.at).toLocaleString('en-GB')}</td><td>{l.rule}</td><td><Badge>{triggerLabel(l.trigger)}</Badge></td>
            <td>{l.ok ? <span className="pos"><CheckCircle2 size={14} style={{ verticalAlign: -2 }} /> {l.detail}</span> : <span className="neg"><XCircle size={14} style={{ verticalAlign: -2 }} /> {l.detail}</span>}</td></tr>)}</tbody></table></div>
          : <Empty title="Nothing has run yet" hint="Switch on a rule and make a change (e.g. create a job), or press ▶ to test a rule." />}
      </div>}

      {edit && <Modal open wide title={rules?.some((r) => r.id === edit.id) ? 'Edit automation' : 'New automation'} onClose={() => setEdit(null)} footer={<>
        {rules?.some((r) => r.id === edit.id) && <button className="btn danger ghost" onClick={() => { if (confirmDelete(edit.name)) { void persist(rules!.filter((r) => r.id !== edit.id)); setEdit(null); } }}><Trash2 size={15} />Delete</button>}
        <button className="btn ghost" onClick={() => runTest(edit)}><Play size={15} />Test</button>
        <span className="spacer" /><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={saveEdit}>Save</button></>}>
        <div className="form">
          <Field label="Rule name" span={2}><input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Tell me when a payment comes in" /></Field>
          <Field label="Active"><select value={edit.enabled ? '1' : '0'} onChange={(e) => setEdit({ ...edit, enabled: e.target.value === '1' })}><option value="1">On</option><option value="0">Off</option></select></Field>
          <Field label="WHEN this happens" span={2}><select value={edit.trigger} onChange={(e) => setEdit({ ...edit, trigger: e.target.value })}><option value="*">Every event (for webhooks)</option>{Object.entries(triggers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Only for work type"><select value={edit.filter?.workTypeId || ''} onChange={(e) => setEdit({ ...edit, filter: { workTypeId: e.target.value || undefined } })}><option value="">Any</option>{db.settings.workTypes.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <div className="section-title">THEN do this</div>
          {edit.actions.map((a, i) => <div key={i} className="span-3 action-box">
            <div className="flex between"><select style={{ width: 'auto' }} value={a.type} onChange={(e) => setAction(i, { type: e.target.value as Action['type'] })}>{Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <button className="icon-btn" onClick={() => setEdit({ ...edit, actions: edit.actions.filter((_, k) => k !== i) })}><Trash2 size={15} /></button></div>
            <div className="form two" style={{ marginTop: 10 }}>
              {a.type === 'telegram' && <Field label="Send to"><select value={a.to || ''} onChange={(e) => setAction(i, { to: e.target.value })}><option value="">Owner chat (from plugin)</option><option value="staff">The staff member involved</option></select></Field>}
              {a.type === 'email' && <><Field label="Send to"><input value={a.to || ''} placeholder="empty = owner address · or type customer" onChange={(e) => setAction(i, { to: e.target.value })} /></Field><Field label="Subject"><input value={a.subject || ''} onChange={(e) => setAction(i, { subject: e.target.value })} /></Field></>}
              {a.type === 'webhook' && <Field label="URL (empty = all URLs in the Webhooks plugin)" span={3}><input value={a.url || ''} onChange={(e) => setAction(i, { url: e.target.value })} /></Field>}
              {a.type === 'task' && <><Field label="Task title"><input value={a.title || ''} onChange={(e) => setAction(i, { title: e.target.value })} /></Field>
                <Field label="Assign to"><select value={a.staffId || ''} onChange={(e) => setAction(i, { staffId: e.target.value })}><option value="">Unassigned</option>{db.staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field></>}
              {(a.type === 'telegram' || a.type === 'email') && <Field label="Message" span={3}><textarea value={a.template || ''} onChange={(e) => setAction(i, { template: e.target.value })} /></Field>}
            </div>
          </div>)}
          <div className="span-3"><button className="btn sm" onClick={() => setEdit({ ...edit, actions: [...edit.actions, { type: 'telegram', template: '' }] })}><Plus size={14} />Add action</button></div>
          <p className="span-3 muted">Placeholders you can use: <code>{varsFor(edit.trigger)}</code> {'{{event}} {{date}} {{business}}'}</p>
        </div>
      </Modal>}
      {results && <Modal open title="Test result" onClose={() => setResults(null)} footer={<button className="btn primary" onClick={() => setResults(null)}>OK</button>}>
        <ul className="list">{results.map((r, i) => <li key={i}>{/FAILED/.test(r) ? <XCircle size={16} color="var(--red)" /> : <CheckCircle2 size={16} color="var(--green)" />}<span className="grow">{r}</span></li>)}</ul>
        <p className="muted">Tests use sample data. Real events use your actual jobs, customers and amounts.</p>
      </Modal>}
    </>
  );
}
