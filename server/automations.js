// Automation engine: "When <trigger> happens → do <actions>".
// Triggers come from data changes (job created, payment received…) and from a daily scheduler
// (summary, overdue invoices, tasks due today). Actions: Telegram, email, webhook, create a task.
import crypto from 'node:crypto';
import { KV_SET, UPSERT } from './db.js';

export const TRIGGERS = {
  'job.created': 'New job created',
  'job.status_changed': 'Job status changed',
  'job.completed': 'Job completed',
  'task.assigned': 'Task assigned to staff',
  'task.completed': 'Task completed',
  'quotation.created': 'Quotation created',
  'quotation.accepted': 'Quotation accepted',
  'invoice.created': 'Invoice created',
  'payment.received': 'Payment received',
  'sale.completed': 'Product sale completed',
  'expense.added': 'Expense added',
  'stock.low': 'Stock fell below reorder level',
  'customer.created': 'New customer added',
  'daily.summary': 'Daily summary (every morning)',
  'invoice.overdue': 'Overdue invoices (daily)',
  'task.due_today': 'Tasks due today (daily)',
  'job.due_soon': 'Jobs due in 2 days (daily)',
  'document.expiring': 'Staff document expiring (30/14/7/3/1 days before)',
  'measurement.created': 'New site measurement recorded',
  'purchase.received': 'Supplier goods received',
  'receipt.created': 'Advance / payment receipt issued',
  'service.created': 'New service / warranty call',
  'cheque.due': 'Cheque due today (daily)',
  'selection.submitted': 'Customer submitted a material selection',
  'expense.claimed': 'Staff sent a bill photo for approval',
  'enquiry.received': 'New enquiry from the website form',
  'delivery.created': 'Delivery note issued',
};

const id = () => crypto.randomBytes(6).toString('hex');
export const DEFAULT_RULES = [
  { name: 'Tell me about every new job', trigger: 'job.created', actions: [{ type: 'telegram', template: '🪵 New job {{job.code}}: {{job.title}}\nCustomer: {{customer.name}}\nDue: {{job.dueDate}}' }] },
  { name: 'Quotation accepted → design task', trigger: 'quotation.accepted', actions: [
    { type: 'task', title: 'Prepare design & cutting list — {{quotation.title}}' },
    { type: 'telegram', template: '✅ Quotation {{quotation.number}} accepted by {{customer.name}} — {{total}}' }] },
  { name: 'Payment received', trigger: 'payment.received', actions: [{ type: 'telegram', template: '💰 Payment {{amount}} received for {{invoice.number}} ({{customer.name}}). Balance {{balance}}' }] },
  { name: 'Low stock alert', trigger: 'stock.low', actions: [{ type: 'telegram', template: '⚠️ Low stock: {{item.name}} {{item.thickness}} — {{item.qty}} {{item.unit}} left (min {{item.reorder}})' }, { type: 'email', subject: 'Low stock: {{item.name}}', template: '{{item.name}} has {{item.qty}} {{item.unit}} left. Reorder level is {{item.reorder}}.' }] },
  { name: 'Send staff their new task', trigger: 'task.assigned', actions: [{ type: 'telegram', to: 'staff', template: '🔨 New task: {{task.title}}\nJob: {{job.code}} {{job.title}}\nDue: {{task.dueDate}} · Priority: {{task.priority}}' }] },
  { name: 'Morning summary', trigger: 'daily.summary', actions: [{ type: 'telegram', template: '{{summary}}' }, { type: 'email', subject: 'Workshop summary {{date}}', template: '{{summary}}' }] },
  { name: 'Overdue invoices reminder', trigger: 'invoice.overdue', actions: [{ type: 'telegram', template: '⏰ Overdue: {{invoice.number}} — {{customer.name}} owes {{balance}} (due {{invoice.dueDate}})' }] },
  { name: 'Staff document expiring', trigger: 'document.expiring', actions: [{ type: 'telegram', template: '🪪 {{staff.name}} — {{doc.type}} {{doc.number}} expires on {{doc.expiry}} ({{days}} days left)' }] },
  { name: 'New site measurement', trigger: 'measurement.created', actions: [{ type: 'telegram', template: '📐 New site measurement {{measurement.number}} by {{staff.name}} for {{customer.name}} — {{measurement.site}}' }] },
  { name: 'Customer picked materials', trigger: 'selection.submitted', actions: [{ type: 'telegram', template: '🎨 {{customer.name}} chose {{count}} item(s) for "{{selection.title}}": {{picks}}' }] },
  { name: 'Staff bill photo to approve', trigger: 'expense.claimed', actions: [{ type: 'telegram', template: '🧾 {{staff.name}} sent a bill for {{job.code}}: {{msg.text}} — {{amount}}. Open Expense chat to approve.' }] },
  { name: 'New website enquiry', trigger: 'enquiry.received', actions: [{ type: 'telegram', template: '📥 New enquiry ({{source}}) from {{customer.name}} {{customer.phone}}\n{{enquiry}}' }] },
  { name: 'WhatsApp welcome to new enquiries', trigger: 'enquiry.received', actions: [{ type: 'whatsapp', to: 'customer', template: 'Hello {{customer.name}}, thank you for contacting {{business}}. We received your request and will call you shortly.' }] },
  { name: 'WhatsApp the customer their invoice', trigger: 'invoice.created', actions: [{ type: 'whatsapp', to: 'customer', template: 'Dear {{customer.name}}, invoice {{invoice.number}} for {{total}} from {{business}} is ready. Thank you!' }] },
  { name: 'WhatsApp payment reminder', trigger: 'invoice.overdue', actions: [{ type: 'whatsapp', to: 'customer', template: 'Dear {{customer.name}}, a friendly reminder: invoice {{invoice.number}} has {{balance}} outstanding (due {{invoice.dueDate}}). Thank you — {{business}}' }] },
  { name: 'WhatsApp project status to customer', trigger: 'job.status_changed', actions: [{ type: 'whatsapp', to: 'customer', template: 'Dear {{customer.name}}, your project {{job.code}} ({{job.title}}) is now: {{to}}. — {{business}}' }] },
  { name: 'WhatsApp delivery notice', trigger: 'delivery.created', actions: [{ type: 'whatsapp', to: 'customer', template: 'Dear {{customer.name}}, your items ({{delivery.number}}) are on the way / delivered today. — {{business}}' }] },
  { name: 'Send all events to webhooks (n8n / Make / Sheets)', trigger: '*', actions: [{ type: 'webhook' }] },
].map((r) => ({ id: id(), enabled: false, ...r }));

const money = (n, cur) => `${cur || ''} ${(Number(n) || 0).toFixed(['OMR', 'KWD', 'BHD'].includes(cur) ? 3 : 2)}`.trim();
const docTotal = (d) => {
  const sub = (d.items || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const taxable = Math.max(0, sub - (Number(d.discount) || 0));
  return taxable * (1 + (Number(d.vat) || 0) / 100);
};
export function render(tpl, vars) {
  return String(tpl || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => {
    const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), vars);
    return v == null || v === '' ? '—' : String(v);
  }).replace(/\s—\s*$/gm, '');
}

export function createAutomations(db, plugins, { tick, backup }) {
  async function rules() {
    const r = await db.get('SELECT value FROM kv WHERE key = ?', ['automations']);
    if (r) {
      // rules added in later versions appear once (switched off) in existing setups
      const list = JSON.parse(r.value); const names = new Set(list.map((x) => x.name));
      const missing = DEFAULT_RULES.filter((x) => /enquiry|WhatsApp/i.test(x.name) && !names.has(x.name));
      const done = await db.get('SELECT value FROM kv WHERE key = ?', ['automations_v2']);
      if (missing.length && !done) { const next = [...list, ...missing]; await db.run(KV_SET, ['automations', JSON.stringify(next), Date.now()]); await db.run(KV_SET, ['automations_v2', '1', Date.now()]); return next; }
      return list;
    }
    await db.run(KV_SET, ['automations', JSON.stringify(DEFAULT_RULES), Date.now()]);
    return DEFAULT_RULES;
  }
  const saveRules = (list) => db.run(KV_SET, ['automations', JSON.stringify(list), Date.now()]);
  async function log(rule, trigger, ok, detail) {
    await db.run('INSERT INTO automation_log (id, at, rule, trig, ok, detail) VALUES (?, ?, ?, ?, ?, ?)', [id(), Date.now(), rule, trigger, ok ? 1 : 0, String(detail).slice(0, 500)]);
    await db.run('DELETE FROM automation_log WHERE at < ?', [Date.now() - 30 * 864e5]);
  }
  async function all(col) { return (await db.all('SELECT data FROM records WHERE col = ? AND deleted = 0', [col])).map((r) => JSON.parse(r.data)); }
  async function one(col, rid) { if (!rid) return undefined; const r = await db.get('SELECT data FROM records WHERE col = ? AND id = ? AND deleted = 0', [col, rid]); return r ? JSON.parse(r.data) : undefined; }
  async function settings() { const r = await db.get('SELECT value FROM kv WHERE key = ?', ['settings']); return r ? JSON.parse(r.value) : {}; }

  async function runAction(a, vars, trigger) {
    if (a.type === 'telegram') {
      let chat = a.to && a.to !== 'staff' ? a.to : undefined;
      if (a.to === 'staff') { chat = vars.staff?.telegramChatId; if (!chat) return 'skipped (staff has no Telegram chat ID)'; }
      await plugins.telegram(render(a.template, vars), chat); return 'telegram sent';
    }
    if (a.type === 'email') {
      const to = a.to === 'customer' ? vars.customer?.email : a.to;
      if (a.to === 'customer' && !to) return 'skipped (customer has no email)';
      await plugins.email({ to, subject: render(a.subject || '{{event}}', vars), text: render(a.template, vars) }); return 'email sent';
    }
    if (a.type === 'whatsapp') {
      const to = a.to === 'customer' ? (vars.customer?.whatsapp || vars.customer?.phone) : a.to === 'staff' ? vars.staff?.phone : a.to;
      if (!to) return 'skipped (no WhatsApp number)';
      const params = (a.params || []).map((p) => render(p, vars));
      await plugins.whatsapp(a.templateName ? { to, template: a.templateName, lang: a.lang, params } : { to, text: render(a.template, vars) });
      return 'whatsapp sent';
    }
    if (a.type === 'webhook') { await plugins.webhook(trigger, vars.raw || vars, a.url || undefined); return 'webhook delivered'; }
    if (a.type === 'task') {
      const rec = { id: id(), createdAt: new Date().toISOString(), title: render(a.title, vars), jobId: vars.job?.id, staffId: a.staffId || undefined, status: 'todo', priority: a.priority || 'normal', dueDate: new Date(Date.now() + 864e5).toISOString().slice(0, 10), notes: 'Created by automation' };
      await db.run(UPSERT, ['tasks', rec.id, JSON.stringify(rec), tick(), 0]); return 'task created';
    }
    return 'unknown action';
  }

  async function fire(trigger, vars) {
    const list = (await rules()).filter((r) => r.enabled && (r.trigger === trigger || r.trigger === '*'));
    if (!list.length) return;
    const s = await settings();
    const ctx = { ...vars, event: TRIGGERS[trigger] || trigger, business: s.businessName, date: new Date().toISOString().slice(0, 10) };
    for (const r of list) {
      if (r.filter?.workTypeId && ctx.job?.workTypeId !== r.filter.workTypeId) continue;
      for (const a of r.actions || []) {
        try { await log(r.name, trigger, true, await runAction(a, ctx, trigger)); }
        catch (e) { await log(r.name, trigger, false, `${a.type}: ${e.message}`); }
      }
    }
  }

  /** Called after every saved record change. Never throws (automation must not block saving). */
  async function onChange(col, before, after) {
    try {
      const s = await settings(); const cur = s.currency;
      const customer = await one('customers', after?.customerId || before?.customerId);
      const raw = { col, before, after };
      if (col === 'jobs' && after) {
        const job = { ...after, value: money(after.value, cur) };
        if (!before) await fire('job.created', { job, customer, raw });
        else if (before.status !== after.status) {
          await fire('job.status_changed', { job, customer, from: before.status, to: after.status, raw });
          if (after.status === 'completed') await fire('job.completed', { job, customer, raw });
        }
      }
      if (col === 'deliveries' && after && !before) await fire('delivery.created', { delivery: after, customer, raw });
      if (col === 'tasks' && after) {
        const staff = await one('staff', after.staffId); const job = await one('jobs', after.jobId);
        if (after.staffId && after.staffId !== before?.staffId) await fire('task.assigned', { task: after, staff, job, raw });
        if (after.status === 'done' && before?.status !== 'done') await fire('task.completed', { task: after, staff, job, raw });
      }
      if (col === 'quotations' && after) {
        const v = { quotation: after, customer, total: money(docTotal(after), cur), raw };
        if (!before) await fire('quotation.created', v);
        if (after.status === 'accepted' && before?.status !== 'accepted') await fire('quotation.accepted', v);
      }
      if (col === 'invoices' && after) {
        const total = docTotal(after);
        const v = { invoice: after, customer, total: money(total, cur), balance: money(total - (Number(after.paid) || 0), cur), raw };
        if (!before) await fire('invoice.created', v);
        const paidNow = (Number(after.paid) || 0) - (Number(before?.paid) || 0);
        if (paidNow > 0.0005) await fire('payment.received', { ...v, amount: money(paidNow, cur) });
      }
      if (col === 'sales' && after && !before) {
        const total = (after.lines || []).reduce((n, l) => n + l.qty * l.price, 0);
        await fire('sale.completed', { sale: after, customer, total: money(Math.max(0, total - (after.discount || 0)) * (1 + (after.vat || 0) / 100), cur), raw });
      }
      if (col === 'txns' && after && !before && after.kind === 'expense') await fire('expense.added', { txn: after, amount: money(after.amount, cur), raw });
      if (col === 'items' && after && Number(after.qty) <= Number(after.reorder) && (!before || Number(before.qty) > Number(before.reorder))) await fire('stock.low', { item: after, raw });
      if (col === 'customers' && after && !before) await fire('customer.created', { customer: after, raw });
      if (col === 'measurements' && after && !before) await fire('measurement.created', { measurement: after, customer: customer || { name: after.customerName, phone: after.customerPhone }, staff: await one('staff', after.measuredBy), raw });
      if (col === 'purchases' && after && after.status === 'received' && before?.status !== 'received') await fire('purchase.received', { purchase: after, supplier: await one('suppliers', after.supplierId), raw });
      if (col === 'selections' && after && after.status === 'submitted' && before?.submittedAt !== after.submittedAt) {
        const names = []; for (const p of after.picks || []) { const it = await one('catalog', p.itemId); if (it) names.push(`${it.code} ${it.name}${p.qty ? ' ×' + p.qty : ''}${p.area ? ' (' + p.area + ')' : ''}`); }
        await fire('selection.submitted', { selection: after, customer: customer || { name: after.customerName, phone: after.customerPhone }, picks: names.join(', '), count: String((after.picks || []).length), raw: after });
      }
      if (col === 'expenseChat' && after && after.status === 'pending' && before?.status !== 'pending') {
        const job = await one('jobs', after.jobId);
        await fire('expense.claimed', { msg: after, job: job || { code: 'General', title: '' }, staff: { name: after.byName }, amount: after.amount ? money(after.amount, cur) : '—', raw: after });
      }
      if (col === 'services' && after && !before) await fire('service.created', { service: after, customer, job: await one('jobs', after.jobId), staff: await one('staff', after.staffId), raw });
      if (col === 'receipts' && after && !before) await fire('receipt.created', { receipt: after, customer, amount: money(after.amount, cur), raw });
    } catch (e) { console.error('automation', e); }
  }

  // ---------- daily scheduler ----------
  function localParts(tz) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
    const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
  }
  async function daily(force = false) {
    const s = await settings(); const cur = s.currency;
    const { date, hour } = localParts(s.timezone);
    const state = JSON.parse((await db.get('SELECT value FROM kv WHERE key = ?', ['automation_state']))?.value || '{}');
    if (!force && (state.lastDaily === date || hour < (Number(s.dailyHour) || 8))) return false;
    await db.run(KV_SET, ['automation_state', JSON.stringify({ ...state, lastDaily: date }), Date.now()]);

    const [jobs, tasks, invoices, txns, items, customers, staff] = await Promise.all(['jobs', 'tasks', 'invoices', 'txns', 'items', 'customers', 'staff'].map(all));
    const cust = (cid) => customers.find((c) => c.id === cid);
    const month = date.slice(0, 7);
    const inc = txns.filter((t) => t.kind === 'income' && t.date.startsWith(month)).reduce((n, t) => n + t.amount, 0);
    const exp = txns.filter((t) => t.kind === 'expense' && t.date.startsWith(month)).reduce((n, t) => n + t.amount, 0);
    const active = jobs.filter((j) => !['completed', 'cancelled'].includes(j.status));
    const dueToday = tasks.filter((t) => t.status !== 'done' && t.dueDate === date);
    const overdue = invoices.filter((i) => i.dueDate && i.dueDate < date && docTotal(i) - (Number(i.paid) || 0) > 0.001);
    const low = items.filter((i) => Number(i.qty) <= Number(i.reorder));
    const in2 = new Date(date + 'T00:00:00Z'); in2.setUTCDate(in2.getUTCDate() + 2); const soon = in2.toISOString().slice(0, 10);
    const dueSoon = active.filter((j) => j.dueDate && j.dueDate >= date && j.dueDate <= soon);
    const summary = [
      `📋 ${s.businessName || 'Workshop'} — ${date}`,
      `Active jobs: ${active.length} (${dueSoon.length} due within 2 days)`,
      `Tasks due today: ${dueToday.length}`,
      `This month: income ${money(inc, cur)}, expense ${money(exp, cur)}, profit ${money(inc - exp, cur)}`,
      `Overdue invoices: ${overdue.length} (${money(overdue.reduce((n, i) => n + docTotal(i) - (Number(i.paid) || 0), 0), cur)})`,
      `Low stock items: ${low.length}${low.length ? ' — ' + low.slice(0, 5).map((i) => i.name).join(', ') : ''}`,
    ].join('\n');
    await fire('daily.summary', { summary, raw: { activeJobs: active.length, tasksDueToday: dueToday.length, income: inc, expense: exp, overdue: overdue.length, lowStock: low.length } });
    for (const i of overdue) await fire('invoice.overdue', { invoice: i, customer: cust(i.customerId), balance: money(docTotal(i) - (Number(i.paid) || 0), cur), raw: i });
    for (const t of dueToday) await fire('task.due_today', { task: t, staff: staff.find((x) => x.id === t.staffId), job: jobs.find((j) => j.id === t.jobId), raw: t });
    for (const j of dueSoon) await fire('job.due_soon', { job: j, customer: cust(j.customerId), raw: j });
    const marks = new Set([30, 14, 7, 3, 1, 0, Number(s.docExpiryDays) || 30]);
    for (const st of staff.filter((x) => x.active !== false)) for (const d of st.documents || []) {
      if (!d.expiry) continue;
      const days = Math.round((new Date(d.expiry + 'T00:00:00Z') - new Date(date + 'T00:00:00Z')) / 864e5);
      if (marks.has(days)) await fire('document.expiring', { staff: st, doc: d, days, raw: { staff: st.name, ...d, days } });
    }
    for (const c of (await all('cheques')).filter((x) => ['pending', 'deposited'].includes(x.status) && x.date === date)) {
      await fire('cheque.due', { cheque: c, amount: money(c.amount, cur), raw: c });
    }
    await postRecurring(date).catch((e) => console.error('recurring', e));
    if (backup) await backup.run(date).catch((e) => console.error('backup', e));
    await db.run('DELETE FROM audit WHERE at < ?', [Date.now() - 365 * 864e5]).catch(() => {});
    return true;
  }
  /** Post due recurring expenses. Ids are deterministic (rec-<rule>-<month>) so a month is never posted twice. */
  async function postRecurring(date) {
    let n = 0;
    for (const r of await all('recurring')) {
      for (const m of dueMonths(r, date)) {
        const txn = { id: `rec-${r.id}-${m}`, createdAt: new Date().toISOString(), date: `${m}-${String(Math.min(28, Number(r.day) || 1)).padStart(2, '0')}`, kind: 'expense', category: r.category, amount: Number(r.amount) || 0, method: r.method || 'Bank', description: r.description, ref: 'Recurring', recurringId: r.id, ...(r.jobId ? { jobId: r.jobId } : {}) };
        const exists = await db.get('SELECT id FROM records WHERE col = ? AND id = ?', ['txns', txn.id]);
        if (!exists) { await db.run(UPSERT, ['txns', txn.id, JSON.stringify(txn), tick(), 0]); n++; }
        r.lastMonth = m;
      }
      if (r.lastMonth) await db.run(UPSERT, ['recurring', r.id, JSON.stringify({ ...r, updatedAt: new Date().toISOString() }), tick(), 0]);
    }
    return n;
  }
  function start() { setInterval(() => daily().catch((e) => console.error('daily', e)), 5 * 60e3); setTimeout(() => daily().catch(() => {}), 10e3); }

  async function test(rule) {
    const sample = {
      job: { id: 'demo', code: 'JOB-000', title: 'Sample kitchen', dueDate: new Date().toISOString().slice(0, 10), status: 'production', priority: 'high' },
      customer: { name: 'Sample Customer', email: '' }, task: { title: 'Sample task', dueDate: 'tomorrow', priority: 'normal' }, staff: {},
      quotation: { number: 'QT-TEST', title: 'Sample quotation' }, invoice: { number: 'INV-TEST', dueDate: 'yesterday' }, item: { name: 'MDF Board', thickness: '18mm', qty: 3, unit: 'sheet', reorder: 10 },
      total: '100.000', amount: '50.000', balance: '50.000', summary: '📋 Test summary', raw: { test: true },
    };
    const ctx = { ...sample, event: TRIGGERS[rule.trigger] || rule.trigger, date: new Date().toISOString().slice(0, 10) };
    const out = [];
    for (const a of rule.actions || []) {
      if (a.type === 'task') { out.push('task: would create "' + render(a.title, ctx) + '"'); continue; }
      try { out.push(`${a.type}: ${await runAction(a, ctx, rule.trigger)}`); } catch (e) { out.push(`${a.type}: FAILED — ${e.message}`); }
    }
    return out;
  }

  return { TRIGGERS, rules, saveRules, onChange, daily, start, test, fire, postRecurring };
}

/** Months (YYYY-MM) a recurring rule still has to post as of `date`: after lastMonth, from startMonth, day reached. */
export function dueMonths(r, date) {
  if (!r || r.active === false || !(Number(r.amount) > 0)) return [];
  const cur = date.slice(0, 7); const day = Number(date.slice(8, 10));
  const out = [];
  let [y, m] = (r.lastMonth || '').split('-').map(Number);
  if (y) { m++; if (m > 12) { m = 1; y++; } } else [y, m] = String(r.startMonth || cur).split('-').map(Number);
  for (let i = 0; i < 24; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key > cur || (key === cur && day < Math.min(28, Number(r.day) || 1))) break;
    out.push(key); m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
