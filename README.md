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

## Run it

```bash
npm install
npm run dev      # development, open the printed URL
npm run build    # production build in dist/ — upload to any static host
```

Data is stored in the browser (localStorage). Use **Settings → Backup** regularly. Settings → Backup → *Clear all* removes the demo data.

## Adding a new feature later

1. Create `src/modules/MyFeature.tsx` (copy any module as a template).
2. Add one line to `src/modules/registry.tsx`.
3. If it stores data, add a collection to `DB` in `src/core/types.ts` and an empty array in `src/core/seed.ts` — old backups keep working because new collections are merged in on load.

New kinds of work (e.g. *Aluminium*, *Upholstery*) need **no code** — add them in Settings → Work types.

## Project layout

```
src/core/      types, store (persistence), calculations, i18n, router, website generator
src/components ui kit, document (quotation/invoice) editor & print layout
src/modules/   one file per module + registry.tsx
```
