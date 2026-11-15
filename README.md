# WoodWorks Pro — Carpentry Workshop Manager

An all-in-one app for a carpentry / CNC workshop: jobs, staff, payroll, quotations, invoices, accounts, stock, product sales, social media and website. Runs in the browser, works on phone and desktop, has an English interface and light/dark mode.

## Modules

| Area | Module | What it does |
|---|---|---|
| Workshop | **Dashboard** | Income/expense, dues, active jobs, staff tasks, low stock, 6-month cash-flow chart |
| | **Jobs** | Kanban + list of work orders per work type (CNC, Carpentry, Board, Polish, Installation, or your own). Each type has its own detail fields. Assign team, track progress, record materials, issue from stock, create invoice, WhatsApp update to customer |
| | **Tasks** | Assign tasks to staff, drag across To do → Done, send the task to staff on WhatsApp |
| | **Inventory** | Boards/sheets/hardware and products for sale, reorder alerts, purchases post to accounts |
| Team | **Staff** | Profiles, roles, skills, monthly/daily/hourly pay |
| | **Attendance** | Monthly grid (P/A/H/L) + overtime hours |
| | **Payroll** | Auto-calculated from attendance, overtime, allowance, bonus, deductions and advances. Payslip print; paying posts to accounts |
| Business | **Customers** | Contacts with billed/balance totals, call/WhatsApp/email |
| | **Quotations** | Line items with work-type rates, VAT, discount, terms → print/PDF, WhatsApp, convert to job or invoice |
| | **Invoices** | Partial payments, overdue tracking, print/PDF, WhatsApp reminders |
| | **Sales** | Point-of-sale for products, reduces stock, prints receipt, posts income |
| Money | **Accounts** | Income/expense ledger, P&L by category, 12-month trend, CSV export |
| Growth | **Social Media** | Accounts, content calendar, caption generator from jobs, hashtags, one-click share |
| | **Website** | Auto-built business website (services, gallery, shop, contact, WhatsApp button), 4 themes, live preview, download `index.html` |
| System | **Settings** | Business profile & logo, currency, VAT, work types & their fields, categories, payroll rules, integrations, backup/restore |

## Workshop extras

| Feature | Where | What it does |
|---|---|---|
| Job photos | Job → Photos | Before / progress / after photos from the phone camera, compressed automatically; send one to a social post or the website gallery |
| CNC / board cutting list | Job → Cutting list | Parts list → how many sheets are needed (shelf-packing estimate, rotation unless “grain”), layout drawing, stock check, printable list |
| Suppliers & purchase orders | Purchases | PO → “Goods received” adds stock → “Pay supplier” posts the expense; amounts owed per supplier |
| Staff document expiry | Staff → Documents | Resident card / visa / passport dates; dashboard warning and a Telegram alert 30/14/7/3/1 days before |
| Arabic on documents | Settings → Business | Company name, address and labels in English + Arabic on quotations, invoices, receipts, delivery notes, POs |
| Receipts & delivery notes | Receipts & Delivery | Advance receipts (credited automatically when the job is invoiced), payment receipts, delivery notes |
| Site measurements | Site measurements | On-site form for phones: sizes, GPS location, photos; staff can use it; one tap turns it into a draft quotation |

## Plugins (all free)

Open **Plugins** (owner only) to switch each one on.

| Plugin | What it does | Cost |
|---|---|---|
| WhatsApp messages | One-tap messages for quotes, invoices, job updates, tasks, review requests. Templates are editable | Free (click-to-chat) |
| Telegram alerts | Instant alerts to the owner and to staff (task assignments) | Free |
| Email (Gmail / SMTP) | Alerts and daily summary from your own Gmail | Free (Gmail allows about 500 a day) |
| Webhooks | Every event sent as signed JSON to n8n / Make / Zapier / Pipedream / Google Apps Script | Free (n8n self-hosted, Apps Script); Make/Zapier have free monthly limits |
| Calendar feed (iCal) | Jobs, tasks and invoice due dates in Google/iPhone Calendar via a private link | Free |
| Add-to-Google-Calendar buttons | On jobs and tasks | Free |
| QR codes | On quotations, invoices and receipts (WhatsApp, website or a custom/payment link) | Free |
| Job cards | Printable workshop-floor card with details, materials, stages and a QR code that opens the job | Free |
| Google Maps directions | To customer and site addresses | Free |
| Google review requests | Sends your review link on WhatsApp when a job is completed | Free |
| Excel / Sheets export | CSV export of any list | Free |
| Install as app (PWA) | Home-screen app with offline start | Free |

Secrets such as bot tokens, SMTP passwords and webhook keys are stored **only on the server**. They are shown masked and are never sent to the browser in full.

## Automations

**Automations** (owner only) runs rules on the server around the clock: *when X happens → Telegram / email / webhook / create a task*.

- **Triggers:** new job, job status changed or completed, task assigned or completed, quotation created or accepted, invoice created, payment received, sale, expense, low stock, new customer. Daily triggers: morning summary, overdue invoices, tasks due today, jobs due within 2 days. The time zone and the summary hour are set in Settings.
- **Ready-made rules** are included and switched **off** until you enable them. Messages use `{{placeholders}}`, and every rule can be tested with sample data (▶).
- An **activity log** shows what ran and why anything failed.
- To add a trigger, fire it from `onChange` or `daily` in `server/automations.js` and add its label to `TRIGGERS`.

## Logins & online database

The app has a small Node.js server (`server/`) that provides logins and an online database, so every phone and computer sees the same data.

| Role | Can use |
|---|---|
| **Owner** | Everything, including payroll, settings, website and user logins |
| **Manager** | Jobs, tasks, stock, staff, attendance, customers, quotations, invoices, sales, accounts, social. No payroll, settings or logins |
| **Staff** | Jobs (without prices), their own tasks (can update status), stock (without cost). No salaries, accounts or customer contacts |

The server enforces these rules: hidden fields are never sent to a lower role, and a forbidden change is rejected even if someone calls the API directly.

- **First run:** the app shows *Set up your workshop* and creates the owner account. You can start empty, with demo data, or with the data already saved on that device.
- **Add people:** Settings → *Users & logins*. Link each staff login to their staff profile so they see their own tasks.
- **Sync:** changes appear on other devices within about 8 seconds, or straight away when the app is focused.
- **Offline:** if the internet drops, the app keeps working. Changes are queued on the device (the cloud badge shows *Offline*) and sent automatically when the connection returns.
- **Security:** passwords are hashed with scrypt, sessions use signed httpOnly cookies, and there is a lockout after 10 wrong logins.

## Run it

Requires Node.js 22.13 or newer.

```bash
npm install
npm run build
npm start            # serves the app + API on http://localhost:8787
```

Development: run `npm run dev:server` and `npm run dev` in two terminals. Vite proxies `/api` to the server.

### Database

| Setting | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (recommended for production). TLS is verified unless the host is localhost or the URL has `sslmode=disable` |
| *(not set)* | PGlite — the same PostgreSQL engine embedded in a folder (`DATA_DIR/pglite`, default `./data`). For development or one machine with a persistent disk. Refused when `NODE_ENV=production` |
| `PORT` | HTTP port (default 8787) |
| `SESSION_SECRET` | Optional. If unset, a secret is generated once and stored in the database |

All module data is stored in one generic `records` table, so new modules need no database migration.

### Without the server

If the app is opened without the server (for example `npm run dev` alone, or `dist/` on a static host), it runs in **single-device mode** and stores data in the browser, as before. Settings → Backup still works in both modes.

## Adding a new feature later

1. Create `src/modules/MyFeature.tsx` (copy any module as a template).
2. Add one line to `src/modules/registry.tsx`.
3. If it stores data, add a collection to `DB` in `src/core/types.ts`, an empty array in `emptyDB()` in `src/core/seed.ts`, and the name to `COLLECTIONS` in `server/permissions.js` (decide there which roles may read and write it). Old backups keep working because new collections are merged in on load.
4. Optionally restrict who sees it with `roles: [...]` on its registry entry.

New kinds of work (e.g. *Aluminium*, *Upholstery*) need **no code** — add them in Settings → Work types.

## Project layout

```
server/        Node server: API, logins, role permissions, PostgreSQL / PGlite storage,
               plugins (Telegram/email/webhooks), automations engine, iCal feed
src/plugins/   plugin catalog, plugin hooks (QR, templates, calendar, CSV), PWA
src/core/      types, store (sync + offline outbox), session, api, calculations, i18n, router, website generator
src/components ui kit, document (quotation/invoice) editor & print layout
src/modules/   one file per module + registry.tsx
```
