/**
 * PLUGIN CATALOG — every integration the app offers, all free to use.
 * "device" plugins run in the browser; "server" plugins need the online server (they hold
 * secrets such as bot tokens and run even when nobody has the app open).
 * To add a plugin: add an entry here, then read it anywhere with usePlugin('<id>').
 */
export type Category = 'Messaging' | 'Automation' | 'Calendar' | 'Documents' | 'Customers' | 'Data' | 'Mobile';
export interface PluginField { key: string; label: string; type?: 'text' | 'password' | 'textarea' | 'number' | 'select'; options?: string[]; placeholder?: string; help?: string; secret?: boolean }
export interface PluginDef {
  id: string; name: string; category: Category; icon: string; color: string; runsOn: 'device' | 'server';
  desc: string; cost: string; steps?: string[]; fields?: PluginField[]; test?: boolean; alwaysOn?: boolean;
}

export const WA_TEMPLATES: Record<string, { label: string; text: string }> = {
  quote: { label: 'Quotation', text: 'Dear {{customer}},\nPlease find our quotation {{number}} for "{{title}}".\n\n{{lines}}\n\nTotal (incl. VAT): {{total}}\nValid until {{valid}}.\n\nThank you,\n{{business}}\n{{phone}}' },
  invoice: { label: 'Invoice / payment reminder', text: 'Dear {{customer}},\nInvoice {{number}} for "{{title}}"\nTotal: {{total}}\nPaid: {{paid}}\nBalance due: {{balance}}\nDue date: {{due}}\n\nThank you,\n{{business}}' },
  jobUpdate: { label: 'Job status update', text: 'Hello {{customer}}, update on your order {{code}} "{{title}}": status is now {{status}}. — {{business}}' },
  task: { label: 'Task to staff', text: 'New task for you: {{title}}{{job}}. Due: {{due}}. Priority: {{priority}}.{{notes}}' },
  review: { label: 'Ask for a Google review', text: 'Hello {{customer}}, thank you for choosing {{business}} for "{{title}}"! 🙏\nIf you are happy with our work, a quick Google review would help us a lot:\n{{link}}' },
};

export const PLUGINS: PluginDef[] = [
  { id: 'whatsapp', name: 'WhatsApp messages', category: 'Messaging', icon: '💬', color: '#25d366', runsOn: 'device', alwaysOn: true,
    desc: 'One-tap WhatsApp messages to customers and staff: quotations, invoices, job updates, tasks and review requests. Edit the message templates below.',
    cost: 'Free (click-to-chat). Fully automatic sending needs the paid WhatsApp Business API.',
    fields: Object.entries(WA_TEMPLATES).map(([k, v]) => ({ key: 'tpl_' + k, label: `Template — ${v.label}`, type: 'textarea' as const, placeholder: v.text })) },
  { id: 'telegram', name: 'Telegram alerts', category: 'Messaging', icon: '✈️', color: '#229ed9', runsOn: 'server', test: true,
    desc: 'Instant notifications on your phone: new jobs, payments, low stock, daily summary. Staff can get their tasks too (add their chat ID in Staff).',
    cost: 'Free — no limits for normal use.',
    steps: ['In Telegram, open @BotFather → send /newbot → copy the token it gives you.', 'Open your new bot and press Start.', 'Open @userinfobot → it replies with your chat ID.', 'Paste both below, Save, then Send test.'],
    fields: [{ key: 'botToken', label: 'Bot token', type: 'password', secret: true, placeholder: '123456:ABC…' }, { key: 'chatId', label: 'Your chat ID (or a group ID)', placeholder: '123456789' }] },
  { id: 'email', name: 'Email (Gmail / any SMTP)', category: 'Messaging', icon: '✉️', color: '#ea4335', runsOn: 'server', test: true,
    desc: 'Send alerts and daily summaries by email from your own Gmail address.',
    cost: 'Free with Gmail (about 500 emails per day).',
    steps: ['Turn on 2-Step Verification in your Google account.', 'Google Account → Security → App passwords → create one named "Workshop".', 'Use host smtp.gmail.com, port 465, your Gmail address and the 16-letter app password.'],
    fields: [{ key: 'host', label: 'SMTP host', placeholder: 'smtp.gmail.com' }, { key: 'port', label: 'Port', type: 'number', placeholder: '465' }, { key: 'user', label: 'Username / email' },
      { key: 'pass', label: 'App password', type: 'password', secret: true }, { key: 'from', label: 'From name/address (optional)', placeholder: 'Workshop <you@gmail.com>' }, { key: 'to', label: 'Send alerts to', placeholder: 'owner@example.com' }] },
  { id: 'webhooks', name: 'Webhooks (n8n · Make · Zapier · Google Sheets)', category: 'Automation', icon: '🔗', color: '#ff6d5a', runsOn: 'server', test: true,
    desc: 'Sends every event (new job, payment, sale, low stock…) as JSON to your automation tool. Connect thousands of apps later without changing this software.',
    cost: 'Free: n8n (self-hosted), Google Apps Script, Pipedream. Make and Zapier have free monthly limits.',
    steps: ['Create a webhook trigger in n8n / Make / Zapier / Google Apps Script and copy its URL.', 'Paste one URL per line below.', 'Optional secret: requests are signed with an X-WoodWorks-Signature (HMAC-SHA256) header.', 'Turn on the "Send all events to webhooks" rule in Automations.'],
    fields: [{ key: 'urls', label: 'Webhook URLs (one per line)', type: 'textarea', placeholder: 'https://n8n.example.com/webhook/…' }, { key: 'secret', label: 'Signing secret (optional)', type: 'password', secret: true }] },
  { id: 'ical', name: 'Calendar feed (Google / iPhone)', category: 'Calendar', icon: '📅', color: '#4285f4', runsOn: 'server',
    desc: 'All job due dates, tasks and invoice due dates appear in your Google Calendar or phone calendar and update automatically.',
    cost: 'Free.', steps: ['Enable and Save — a private link appears.', 'Google Calendar (computer) → Other calendars → + → From URL → paste the link.', 'Keep the link private: anyone with it can see your schedule.'] },
  { id: 'gcal', name: 'Add to Google Calendar buttons', category: 'Calendar', icon: '🗓️', color: '#34a853', runsOn: 'device',
    desc: 'A button on jobs and tasks that adds the due date / installation visit to your Google Calendar.', cost: 'Free.' },
  { id: 'qr', name: 'QR codes on documents', category: 'Documents', icon: '🔳', color: '#111827', runsOn: 'device',
    desc: 'Adds a QR code to quotations, invoices and receipts. Customers scan it to chat on WhatsApp or open your payment/bank details link.',
    cost: 'Free.', fields: [{ key: 'target', label: 'QR opens', type: 'select', options: ['WhatsApp chat', 'Website', 'Custom link'] }, { key: 'url', label: 'Custom link (payment page, bank details, Google review…)', placeholder: 'https://…' }, { key: 'caption', label: 'Caption under QR', placeholder: 'Scan to chat with us' }] },
  { id: 'jobcard', name: 'Job cards for the workshop floor', category: 'Documents', icon: '🪪', color: '#7c4a1e', runsOn: 'device',
    desc: 'Print an A4/A5 job card with all details, materials, team and a QR code that opens the job in the app.', cost: 'Free.' },
  { id: 'print', name: 'PDF & printing', category: 'Documents', icon: '🖨️', color: '#6b7280', runsOn: 'device', alwaysOn: true,
    desc: 'Quotations, invoices, payslips and receipts print or save as PDF from any phone or computer.', cost: 'Free (built in).' },
  { id: 'maps', name: 'Google Maps directions', category: 'Customers', icon: '📍', color: '#ea4335', runsOn: 'device',
    desc: 'One tap to navigate to a customer or site address for measurement and installation.', cost: 'Free.' },
  { id: 'reviews', name: 'Google review requests', category: 'Customers', icon: '⭐', color: '#fbbc04', runsOn: 'device',
    desc: 'When a job is completed, send the customer your Google review link on WhatsApp with one tap. More reviews = more local customers.',
    cost: 'Free.', steps: ['Google Business Profile → Ask for reviews → copy the link (g.page/r/…).'],
    fields: [{ key: 'link', label: 'Google review link', placeholder: 'https://g.page/r/…/review' }] },
  { id: 'export', name: 'Excel / Google Sheets export', category: 'Data', icon: '📊', color: '#0f9d58', runsOn: 'device',
    desc: 'Download any list (jobs, customers, staff, invoices, accounts, stock…) as a CSV file that opens in Excel or Google Sheets.', cost: 'Free.' },
  { id: 'pwa', name: 'Install as phone app', category: 'Mobile', icon: '📱', color: '#7c3aed', runsOn: 'device',
    desc: 'Install the app on Android, iPhone or computer like a normal app, with its own icon and offline support.', cost: 'Free.',
    steps: ['Android/Chrome: tap Install below (or menu ⋮ → Install app).', 'iPhone/Safari: Share → Add to Home Screen.'] },
];

export const CLAUDE_CONNECTORS = [
  { name: 'Canva', use: 'Design social posts, brochures, banners from your jobs', cost: 'Free plan' },
  { name: 'Metricool / Postiz', use: 'Schedule & auto-publish Instagram, Facebook, TikTok posts', cost: 'Free plan (limited)' },
  { name: 'Google Sheets / Drive', use: 'Monthly reports, backups, shared price lists', cost: 'Free' },
  { name: 'Notion', use: 'Design library, SOPs, staff handbook', cost: 'Free plan' },
  { name: 'Netlify / Cloudflare', use: 'Publish your website on your own domain', cost: 'Free plan' },
  { name: 'Figma', use: 'Furniture/interior design mock-ups for clients', cost: 'Free plan' },
  { name: 'QuickBooks', use: 'Professional accounting & payroll sync', cost: 'Paid' },
  { name: 'Hostinger / Wix', use: 'Domain, hosting and website builder', cost: 'Paid' },
];
