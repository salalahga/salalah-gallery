# WoodWorks Pro — Carpentry Workshop Manager

An all-in-one app for a carpentry / CNC workshop: jobs, staff, payroll, quotations, invoices, accounts, stock, product sales, social media and website. Runs in the browser, works on phone and desktop, supports **English / മലയാളം** and light/dark mode.

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
| *(not set)* | SQLite file at `DATA_DIR/workshop.db` (default `./data`). Good for one machine; this needs a persistent disk |
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
server/        Node server: API, logins, role permissions, Postgres/SQLite storage
src/core/      types, store (sync + offline outbox), session, api, calculations, i18n, router, website generator
src/components ui kit, document (quotation/invoice) editor & print layout
src/modules/   one file per module + registry.tsx
```
