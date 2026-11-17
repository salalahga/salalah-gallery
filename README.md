# WoodWorks Pro — Carpentry Workshop Manager

An all-in-one app for a carpentry / CNC workshop: jobs, staff, payroll, quotations, invoices, accounts, stock, product sales, social media and website. Runs in the browser, works on phone and desktop, has an English interface and light/dark mode.

## Modules

| Area | Module | What it does |
|---|---|---|
| Workshop | **Dashboard** | Income/expense, dues, active jobs, staff tasks, low stock, 6-month cash-flow chart |
| | **Jobs** | Kanban + list of work orders per work type (CNC, Carpentry, Board, Polish, Installation, or your own). Each type has its own detail fields. Assign team, track progress, record materials, issue from stock, create invoice, WhatsApp update to customer |
| | **Project tracker** | Every project has a code (prefix and format in Settings, e.g. TZ-26-001) and a stage timeline worked out from the data: Quotation accepted → Advance / billing → Work started (with % done) → Work finished → Installation done → Balance received, each with its date. The Tracker view lists all projects with stage dots, % done, the next step, due date, value, received and **balance to collect**, with filters (waiting quotation / advance, to start, in work, to install, balance pending, closed). Quick buttons move a project to the next stage; quotation and billing can be marked done by hand. The dashboard shows the balance still due on finished and installed projects |
| | **Tasks** | Assign tasks to staff, drag across To do → Done, send the task to staff on WhatsApp. *Hours actually worked* are costed to the project at the person's hourly cost |
| | **Expense chat** | A WhatsApp-style chat for every project (and one for general workshop costs). Snap the bill, type what it was — e.g. *“Marine ply 6 sheets 102.500”* — and send: the amount and category are read from the text and it is added to that project's expenses with the bill pictures. **Just send the bill photo**: the app reads it (free OCR that runs on the phone/computer — Tesseract, served from our own server) and fills the total, bill date, shop name, bill number and category, then adds it automatically (switch off “Read bill photos and add them automatically” to check first). Entries read from a bill are marked “please check” and can be corrected with Edit. The Accounts expense form also reads a bill photo. Staff bills arrive as claims the owner/manager approves or rejects; Undo takes an expense back out. Bill pictures show in Accounts and Project accounts |
| | **Material catalogue** | Laminates, boards, hardware and colours per company (brand) with picture, code, finish, size and price. Import from **pictures** (file name = code), a **PDF catalogue** (drag a box round each swatch), a **spreadsheet**, or **from the web** (search online, paste the page link, pick the pictures). **Send a link** to a customer: they see the pictures and codes on their phone without logging in, tick what they like with quantity / room, and send — you see it at once and turn it into a quotation |
| | **Service & warranty** | After-sales complaints and repair visits: assign a technician, schedule the visit, WhatsApp technician and customer, warranty detected from the project (warranty months run from completion), bill chargeable visits |
| | **Inventory** | Boards/sheets/hardware and products for sale, reorder alerts, purchases post to accounts |
| Team | **Staff** | Profiles, roles, skills, monthly/daily/hourly pay, end-of-service gratuity and annual-leave balance |
| | **Attendance** | Monthly grid (P/A/H/L) + overtime hours |
| | **Payroll** | Auto-calculated from attendance, overtime, allowance, bonus, deductions and advances. Payslip print; paying posts to accounts |
| Business | **Customers** | Contacts with billed/balance totals, call/WhatsApp/email, **statement of account** (print / WhatsApp) |
| | **Quotations** | Line items with work-type rates, VAT, discount, terms → print/PDF, WhatsApp, convert to job or invoice (once only), **revisions** (-R1, -R2…), past-validity quotes show as **Expired** |
| | **Invoices** | Partial payments through receipts, overdue tracking, print/PDF, WhatsApp reminders, **credit notes** (with automatic refund of any overpaid part) |
| | **Receipts & Delivery** | Receipts (void with reason), **cheques / PDC** follow-up (deposited → cleared / bounced), credit notes, delivery notes |
| | **Sales** | Point-of-sale for products (never more than in stock), prints receipt, posts income, **returns & refunds** put stock back |
| Money | **Accounts** | Income/expense ledger, **cash in hand & bank balance**, cash↔bank transfers, **recurring expenses** (rent, electricity… posted monthly), P&L by category, 12-month trend, CSV export |
| | **Reports** | **VAT return** (output vs input VAT by period), customer balances with aging (not due / 30 / 60 / 90+), supplier balances, staff gratuity & leave |
| Growth | **Social Media** | Accounts, content calendar, caption generator from jobs, hashtags, one-click share |
| | **Website** | Auto-built business website (services, gallery, shop, contact, WhatsApp button), 4 themes, live preview, download `index.html` |
| System | **Settings** | Business profile & logo, currency, VAT, opening cash/bank balances, work types & their fields, categories, payroll, gratuity & leave rules, backup/restore, **automatic daily backup** (kept on the server, optionally sent to Telegram / email), **activity log** (who changed what) |

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

- **Triggers:** new job, job status changed or completed, task assigned or completed, quotation created or accepted, invoice created, payment received, sale, expense, low stock, new customer, new service call. Daily triggers: morning summary, overdue invoices, tasks due today, jobs due within 2 days, cheques due today. The daily run also posts due recurring expenses and makes the automatic backup. The time zone and the summary hour are set in Settings.
- **Ready-made rules** are included and switched **off** until you enable them. Messages use `{{placeholders}}`, and every rule can be tested with sample data (▶).
- An **activity log** shows what ran and why anything failed.
- To add a trigger, fire it from `onChange` or `daily` in `server/automations.js` and add its label to `TRIGGERS`.

## Money stays consistent

Every money correction goes through `src/core/ledger.ts`, so Accounts, invoices, receipts and stock never disagree:

- An invoice's paid amount changes only through receipts (Record payment), advances or credit notes — it cannot be typed.
- **Create invoice** on a project bills what is not invoiced yet: the rest of the contract after advance/stage invoices, plus additional work. A quotation is invoiced once.
- **Void a receipt** instead of deleting it: its income leaves Accounts and the invoice owes again; a voided advance is taken back off the invoices it was credited to.
- An invoice with payments cannot be deleted; deleting an invoice gives back the advances and additional work it used.
- A bounced cheque voids its receipt (or reverses the supplier payment).
- Accounts refuses to delete entries that belong to a receipt, sale, advance or tracked cheque and says where to correct them.
- Customers, suppliers and staff with history cannot be deleted (staff can be set to Inactive); projects with money are cancelled, not deleted.

Photos are stored on the server (`/api/files/…`) instead of inside records, so syncing stays fast; older inline photos are moved automatically when the server starts.

## Customer selection links

`/pick/<token>` is a public page (no login). The token is 128-bit random. The page only receives the materials offered in that selection (no prices unless you allow them, nothing else from the database), can only choose among those items, is rate-limited, and is read-only once you close the selection. Web import downloads go through the server with checks that block private and internal addresses.

## ERP additions

- **Logins:** Owner (super admin, the only one who changes data), Manager, Staff, and **View only** — an *Owner viewer* sees everything read-only; other viewers see only the pages ticked for them. The server refuses every change from a viewer and only sends the data their pages need.
- **20-step project workflow:** New enquiry → Site inspection → Measurement → Quotation prepared → Quotation approved → Advance received → Design → Design approved → Material purchasing → Material ready → Production → Work in progress → Polishing & finishing → Quality inspection → Ready for delivery → Delivery → Installation → Completed → Final payment pending → Closed. Each change is saved with date, time and user (status history); quotation approved and advance received are set automatically, the last two follow the payments. Daily work updates with photos, drawings & designs (pictures or PDF), linked site measurements.
- **Project fields:** site address, description, estimated budget, expected completion.
- **Project costing:** categories Wood and Plywood, Hardware and Accessories, Labour, Carpenter Wages, Polishing, Painting, Transportation, Installation, Electricity, Outsourced Work, Other. Revenue = contract + additional work − credit notes; gross profit = revenue − direct costs; net profit = gross − overheads (Settings: % of value, with a suggestion from the last 12 months); estimated vs actual, budget vs actual, loss and over-budget alerts. Advances are never counted as revenue.
- **Customer profile:** Customer ID (C-0001…), WhatsApp number, projects, quotations, invoices, payments & advances, ledger, documents and photos.
- **Executive dashboard:** date and project filters; revenue, expenses, net profit, total sales, active / completed / pending projects, customer outstanding, supplier payables, cash, bank, delayed projects, project profitability, pending payments, upcoming deliveries.
- **Quotations:** item, material, labour and additional-charge lines with their own subtotals on the PDF.

## ERP additions (sections 8–23)
- **Customer ledger**: opening balance per customer, discounts and refunds in the statement, printable statements, **final account statement** per project and owner-only **project closing** (closed projects cannot be changed by anyone else — enforced on the server).
- **Enquiries / CRM**: Customers → Enquiries with source (Website, WhatsApp, Instagram, walk-in…), status, follow-up date and “Make project”. The website’s *Request a quotation* form posts to `/api/public/enquiry` and creates the lead (rate-limited, honeypot, same phone merged).
- **Purchases**: supplier ledger / statement, purchase returns (stock out, VAT and dues adjusted, optional refund), payment history, every purchase for a project or *General workshop stock*.
- **Inventory**: stock in, issue to project (adds to project cost), transfers between store locations, wastage, stock counts — every movement logged; usage per project, valuation by category, minimum stock alerts.
- **Production**: production orders through cutting → assembly → sanding → polishing → finishing → quality check → packing → delivery preparation; daily production log and project-wise progress.
- **Finance**: general ledger built from every entry, owner-only journal entries, trial balance, profit & loss (with previous-period comparison), balance sheet, cash-flow statement. Other currencies with rates (amounts kept in OMR), named VAT rates.
- **Assistant**: bill photos read by OCR (supplier, date, invoice no., items, VAT, total), category guessed, project asked, shown for checking and saved only on *Confirm*; duplicate bills flagged. Commands such as “Add 150 OMR wood purchase to Project 105”, “Show all projects with pending payments”, “How much profit did Project 105 make?”, “Show this month’s total expenses”. Answers only use figures from the books.
- **HR**: daily work reports with ratings, monthly staff performance (attendance, overtime, tasks on time, hours, advances).
- **Website**: service sections (custom furniture, kitchens, wardrobes, interiors), completed-project gallery, quote form; *Publish* serves it at `/site`.
- **WhatsApp Business Platform** plugin (Meta Cloud API, approved templates) with rules for enquiry welcome, invoice, payment reminder, project status and delivery notices.
- **Notifications** bell: delayed projects, upcoming deliveries, overdue customer and supplier payments, low stock, budget overruns, new enquiries, cheques and large money entries.
- **Reports**: business performance vs previous period, daily/monthly/yearly sales, project P&L, purchases, expenses, VAT, outstanding — all downloadable as Excel or PDF.
- **Security**: owner password reset with the server setup code, “sign out other devices”, a password change or reset signs the user out everywhere.

## Logins & online database

The app has a small Node.js server (`server/`) that provides logins and an online database, so every phone and computer sees the same data.

| Role | Can use |
|---|---|
| **Owner** | Everything, including payroll, settings, website and user logins |
| **Manager** | Jobs, tasks, stock, staff, attendance, customers, quotations, invoices, sales, accounts, social. No payroll, settings or logins |
| **Staff** | Jobs (without prices), their own tasks (status and hours worked), service visits assigned to them, their own site measurements, stock (without cost). No salaries, accounts or customer contacts |

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
               plugins (Telegram/email/webhooks), automations engine, iCal feed,
               photo storage (files.js), daily backup (backup.js), activity log
src/plugins/   plugin catalog, plugin hooks (QR, templates, calendar, CSV), PWA
src/core/      types, store (sync + offline outbox), session, api, calculations, ledger (money corrections),
               recurring expenses, i18n, router, website generator
src/components ui kit, document (quotation/invoice) editor & print layout
src/modules/   one file per module + registry.tsx
```
