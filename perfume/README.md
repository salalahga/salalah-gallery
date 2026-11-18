# Belle Âme — Perfume Business Management System

One backend and one PostgreSQL database for a perfume retailer in Oman. Three apps use it:

| App | URL | Who uses it |
|---|---|---|
| **Main app** | `/` | Owner, admin, accountant, HR and cashiers (POS) |
| **Business Manager app** | `/manager` | The business manager. They have their own login and see only what the owner allows. Everything they do is audited |
| **Staff app** | `/staff` | Staff on their phones: check-in/out, leave requests, announcements, their own profile and sales |

The design is black, gold and white. The layout is responsive (phone, tablet, desktop). The interface is in English, Arabic (right-to-left) and Malayalam.

> **Status: phase 1 of a phased build.** The core of the business works end to end and is tested: POS, inventory, purchasing, promotions, CRM, finance, security, the Manager app and the Staff app. The storefront website, payroll and external integrations (WhatsApp API, payment gateways, social media APIs) are **not built yet**. See [Roadmap](#roadmap). Nothing here claims an external integration works until it has been connected with real credentials and tested.

---

## 1. Architecture

```
 Main app (/)     Manager app (/manager)     Staff app (/staff)        ← React + TypeScript (Vite, 3 entry pages)
        \                  |                       /
         └──────── HTTPS JSON API  /api ──────────┘                    ← Node.js + Express (server/app.js)
                           │
   auth & sessions · RBAC check on every route · audit log · approvals
                           │
   services: sales/POS · inventory · purchases · promotions engine · ledger · finance · analytics · assistant
                           │
              PostgreSQL (production)  /  PGlite (same engine, embedded, for dev & tests)
```

* **One source of truth.** Every channel (shop, website, WhatsApp, Instagram, phone, wholesale) writes to the same `sales` table, through the same pricing engine, stock ledger and accounting.
* **Transaction-safe.** A checkout runs in one database transaction: re-pricing, stock deduction, sale, payments, journal entry and loyalty. If any step fails (for example a bottle sold out on another till), the whole sale rolls back. Stock is deducted with a conditional atomic `UPDATE`, so two tills cannot both sell the last bottle.
* **The server is authoritative.** The client shows a price preview. The server recomputes every total, offer and VAT amount, and ignores totals sent by the browser.
* **Shared logic** (`shared/`) runs in both browser and server: money and VAT (`money.js`), the promotions engine (`pricing.js`) and the voice-command parser (`voice.js`).

## 2. Database

The full schema is in `server/schema.sql`. Key rules:

* **Money is stored as integers in baisa** (1 OMR = 1000), so there are no floating-point errors. VAT rates are basis points (500 = 5 %).
* **Financial records are never deleted.** Corrections are reversing journal entries, refunds, returns and adjustments. Expenses are reversed, not deleted. A sale is cancelled through a full refund.
* **Double-entry ledger** (`accounts`, `journal_entries`, `journal_lines`). Every entry must balance or it is refused. Automatic entries are posted for:

| Event | Entry |
|---|---|
| Sale | Dr cash/card/bank/wallet/gateway (or A/R), Cr revenue, Cr VAT output; Dr COGS, Cr inventory |
| Online order paid before confirmation | Dr cash, Cr customer deposits → moved into the sale on confirmation |
| Refund | Dr revenue, Dr VAT output, Cr payment method (owed balance reduced first); restocked items: Dr inventory, Cr COGS |
| Goods received | Dr inventory (goods + landed cost), Dr VAT input, Cr A/P (supplier), Cr accrued landed costs |
| Supplier payment / return | Dr A/P, Cr bank · Dr A/P, Cr inventory, Cr VAT input |
| Expense | Dr expense (+ VAT input), Cr cash/bank/A/P |
| Damage / loss / stock count | Dr shrinkage, Cr inventory (or the reverse) at average cost |
| Till close variance | Cash over/short |

* **Inventory**: `stock_levels` per branch × variant is always the running sum of `stock_movements` (tests check this). Cost uses the moving weighted average, including landed cost. Batches and expiry dates are tracked.
* **Test data**: demo records carry `is_test = true` and show a **TEST** badge on screen.

Main tables: branches, users, user_permissions, sessions, audit_log, approvals, notifications · categories, brands, products, variants (size / SKU / barcode / retail, web and wholesale prices), batches, stock_levels, stock_movements, stock_transfers, stock_counts · customers, loyalty_ledger, customer_interactions · suppliers, purchase_orders, po_lines, supplier_bills, supplier_payments, purchase_returns · promotions · registers, register_sessions, cash_movements, sales, sale_lines, payments, refunds, deliveries · accounts, journal_entries, journal_lines, expenses · employees, attendance, leave_requests, announcements · files.

## 3. Roles and permissions

Permission levels per area: **view, create, edit, approve, manage, export**. Every API route checks them on the server.

| Role | Default access |
|---|---|
| owner | Everything. Only the owner can set other users' permissions, change security settings and manage admins |
| admin | Everything except owner accounts and security settings |
| manager | Uses the Manager app. Starts as **view-only** monitoring of sales, inventory, purchases, offers, customers, staff and orders. **No finance** (profit, cash or bank figures are hidden) until the owner grants it. Can **never** manage users or change business settings, whatever is granted |
| accountant | Finance, payments, reports and exports; purchasing without approval |
| hr | Employees, attendance, leave, announcements |
| cashier | POS at their home branch, customers, stock (without cost prices), only their own sales |
| staff | Self-service and POS |

* **The owner tailors each user** under Users → Permissions: areas, levels and branches. Changes apply immediately.
* **Approval workflows:**
  * Refunds and cancellations by users without POS "approve" become requests.
  * Purchase orders need approval, and the approver must be someone other than the creator.
  * Offers need approval. An offer that combines with others needs owner or admin approval.
  * Leave requests need approval.
* **Audit log**: logins, failed logins, every change (with a body that has secrets removed), denied attempts, exports and assistant questions. It records who, role, app, time, IP and record.

## 4. Security

* Passwords are hashed with scrypt; 8+ characters, letters and numbers. After 5 wrong attempts the account locks for 15 minutes, plus a per-IP limit.
* Sessions are stored server-side (only a hash of the token). Cookies are httpOnly and SameSite=Strict. Users can see and revoke their sessions; deactivating a user signs them out everywhere.
* **Two-factor authentication**: TOTP (Google/Microsoft Authenticator, Authy). The owner can require it per role.
* **Encryption at rest** (AES-256-GCM) for 2FA secrets, employee IBANs and ID numbers. The key is `DATA_KEY`.
* **Card data:** raw card details are never stored. Only the method, the gateway reference or terminal approval code, and the status are kept. A reference that looks like a card number is rejected.
* Sensitive fields (cost, profit, salaries) are removed from responses for roles that may not see them.
* CSV export guards against formula injection. Security headers are set.

## 5. Modules — what works now

| # | Module | Status |
|---|---|---|
| 1 | Owner dashboard | ✅ Sales today/week/month/year · revenue, gross profit and net profit (defined separately) · expenses · cash, bank, receivables, payables · purchases · inventory value · low stock · best and slow sellers · sales by channel and staff · customer growth · pending orders · active offers · 30-day chart · branch filter · CSV · print/PDF |
| 2 | POS + voice | ✅ Barcode scan, search, quantities, price change (with permission), automatic offers, coupons, manual discount (with limits), VAT, split and partial (credit) payments, change, loyalty redemption, tax-invoice receipt (EN/AR), refunds and returns, cancellation with approval, till open, pay in/out and daily close with variance. **Voice/typed commands in English and Arabic** ("add two bottles of Khamrah", "apply 10% discount", "check availability of …", "show today's sales", "search customer 9123 4567", "generate the invoice"). Voice uses the browser's speech recognition (Chrome, Edge, Safari). **Nothing is charged by voice**: payment always needs on-screen confirmation |
| 3 | Purchasing | ✅ Suppliers, purchase orders, approval, partial receiving, batches and expiry, landed cost spread by value, foreign currency, supplier bills with due dates, payments, returns, balances and overdue amounts, performance (orders, on-time %, returns) |
| 4 | Inventory | ✅ Brands, categories, products with Arabic names, notes, photos, sizes (SKU, barcode, retail, web and wholesale prices, VAT, minimum stock), stock per branch, transfers, adjustments (damage, loss, expiry, correction), stock-taking, valuation, movement history, low-stock alerts |
| 5 | E-commerce website | ⏳ Phase 2. Backend ready: web prices, web visibility, `web` channel orders, coupons, delivery fee and tracking. The public storefront, cart and checkout are not built |
| 6 | WhatsApp | ◐ Staff can turn a WhatsApp conversation into an order (New order → WhatsApp), record payment-link payments, and confirm, deliver and track it. The Cloud API (automated replies, templates, catalogue) is **not connected** |
| 7 | Social media | ◐ Instagram, Snapchat and Facebook are tracked as separate sales channels. API connections and campaign scheduling are not built |
| 8 | Offers & promotions | ✅ Percent, fixed, buy-X-get-Y, bundle price, special price · products, categories, brands · per-channel and per-branch · audience (all, customers, VIP, segment, staff, wholesale, specific customers) · coupon codes · minimum spend, maximum discount, usage limit · scheduled start and automatic expiry · approval · **no stacking unless the owner allows it** · performance (orders, sales, discount given) |
| 9 | CRM | ✅ Profiles, history, spend, favourites, preferences, segments, automatic VIP, loyalty points and ledger, credit accounts with limits, complaints and follow-ups, birthday and lapsed-customer lists with one-tap WhatsApp |
| 10 | Finance | ✅ Chart of accounts, automatic journals, manual journal (balanced), expenses with VAT, P&L, balance sheet, cash flow, trial balance, general ledger, VAT summary (Oman 5 %, configurable), till closings, OMR base with FX rates for purchases. Reconciliation against bank statements is not built yet |
| 11 | Payments | ◐ Cash, card (terminal reference), bank transfer, wallet, payment link (manual), partial and split payments, refunds, payment exports. **Online gateways are not connected** (Phase 2) |
| 12–14 | Staff, HR, Staff app | ◐ Employees (pay, allowances, documents, encrypted IBAN and ID), attendance, check-in/out, leave and approvals, announcements, staff self-service and sales vs target. **Payroll, payslips, recruitment, reviews and final settlement are Phase 2** |
| 15 | Manager app | ✅ Separate login and app, owner-controlled permissions per area, level and branch, audited |
| 16 | Branches | ✅ Multiple branches, tills, branch stock, transfers, branch-limited users, branch filter |
| 17 | Notifications | ◐ In-app: low stock, new orders, approvals, leave, till variance. Scheduled e-mail/WhatsApp reports need SMTP or WhatsApp credentials |
| 18 | AI assistant | ✅ Answers only from live queries, with period and source. Separates revenue, gross profit and net profit. Finance questions need finance permission. Unknown questions get suggestions, not guesses |
| 19 | Reports & exports | ✅ CSV and Excel for 13 datasets with date ranges; print-to-PDF on every screen |
| 20 | Security | ✅ See section 4. Backups: use PostgreSQL managed backups or `pg_dump` (see Deployment) |
| 21 | Design, languages | ✅ Black/gold/white, mobile-first, EN/AR (RTL)/ML. Translations cover navigation and key labels; full screen-by-screen translation is ongoing |

## 5b. Barcodes & label printing

- **Every size is its own product variant** with a unique SKU (auto: brand-name-size) and a unique barcode. Leave the barcode empty and an in-store EAN-13 (`29…` prefix + check digit) is created. Supported: EAN-13, EAN-8, Code 128, Code 39, QR on labels. Check digits are validated, duplicates are refused, and changing an existing barcode needs **Barcodes → manage** (owner/admin).
- **Barcodes & labels screen** (`#/barcodes`): bulk printing (scan or search, copies per product), scan & verify (product, photo, price, stock per branch, batches, block/unblock from sale), printers, label designer (small/medium/large built-ins, copies editable: fields, font sizes, alignment, barcode type/height/thickness, QR content, live preview), printing history with authorised reprints (reason recorded), setup guide.
- **Where scanning works**: POS (adds to cart, repeat scan = +1, shows photo/size/price/stock, refuses no-stock and blocked items), purchase receiving (scan each bottle, then labels print with the batch number), stock counts (each scan counts one), transfers, supplier returns, sales returns (checks the bottle was on that receipt).
- **Printers**: “browser print” works with any printer that has a driver (label size set by `@page`, so labels never come out on A4). Raw printing (ZPL for Zebra; TSPL for TSC/Xprinter/Gprinter/HPRT/Rongta; ESC/POS for receipt printers) goes through the **print agent** on the shop computer, for USB, Bluetooth (paired in the OS) and network (IP:9100) printers.
- **Honest status**: a printer is shown as verified only after the agent reached it, or the user confirmed a test label printed correctly. Each print job is stored as `sent` (agent delivered it), `dialog_opened` (browser print window opened) or `failed` — never “printed” by assumption.

### Print agent (only for raw ZPL/TSPL/ESC-POS printing)
```
# on the shop computer, Node.js 18+ installed
node agent/print-agent.js            # shows a pairing code, listens on 127.0.0.1:9333 only
ALLOWED_ORIGINS=https://your-shop.example node agent/print-agent.js   # if the app runs on another address
```
Enter the pairing code in Barcodes → Printers → “Print agent on this computer”. Windows USB/Bluetooth printers: share the printer (e.g. `LABEL`) and use that share name. Mac/Linux: use the CUPS queue name.

## 5c. Marketing, website CMS & social automation (`#/marketing`)

**Screens:** Dashboard · Daily upload · Content & approvals · Calendar (+ daily automation) · Image & video studio · Campaigns · Website & SEO · AI assistant · Performance · Connections (tests, logs, usage, scheduler).

**Flow:** Daily upload creates a real catalogue product (photos, sizes, prices, auto SKU/barcode; stock still comes through Purchases) → AI prepares website text, Instagram post, Story, Reel, Facebook post and WhatsApp message → everything waits as *AI generated / Under review* → the owner (Marketing → approve) approves, schedules or publishes. The `marketing` role prepares content but cannot approve or publish unless the owner grants it. Auto-publishing is off by default and can be switched on per content type.

**Product identity:** creatives place the *original* product photo on a background (optionally background removed with remove.bg, optionally an AI-generated empty backdrop). The bottle, label, logo and packaging are never redrawn. Prices and text are rendered by the app, never by AI image/video models. Fonts for English, Arabic and Malayalam are bundled (`server/assets/fonts`, SIL OFL).

**Video:** luxury showcase videos are rendered on the server with ffmpeg (9:16, 1:1, 4:5, 16:9; H.264 + AAC as Instagram requires), optional licensed music upload and OpenAI voiceover. Optional Runway image-to-video clip, followed by exact price/CTA scenes.

**Integrations (official APIs only; credentials encrypted; each call logged with duration and estimated cost):**

| Service | Used for | Status |
|---|---|---|
| Claude (`claude-opus-5-5`) | copy in EN/AR/ML, SEO, assistant with tools over live ERP data | code + tests against a recording fake server; live key not yet connected |
| Instagram Graph API | posts, Reels (`REELS`), Stories (`STORIES`), followers/reach | same — needs Instagram professional account linked to a Facebook Page + Meta app permissions |
| Facebook Pages API | photo/video/text posts | same |
| WhatsApp Cloud API | approved templates to customers with marketing consent only, throttled | same — needs WhatsApp Business API number |
| Shopify Admin API / WooCommerce REST | products with sizes, prices, compare-at, SKU, barcode, images; blog; landing pages; offer prices | same — platform not yet chosen |
| remove.bg, OpenAI images & TTS, Runway | optional creative services | same |

Banners and homepage sliders belong to the website theme and are not changeable through the Shopify/WooCommerce APIs; the app makes the image and says so instead of pretending to publish. Search-indexing status needs Google Search Console (not connected).

**Scheduler:** runs every minute in-process; for hosts that sleep when idle, call `POST /api/marketing/cron` with header `x-cron-key` (key created in Connections or env `MKT_CRON_KEY`). Failed scheduled posts retry up to 3 times, then notify the owner.

**Website analytics:** paste `<script async src="https://<app>/api/t.js"></script>` into the site theme (random visitor ID, no personal data). Campaign sales are computed from real ERP orders that used the campaign's promotion or coupon within its dates — never copied into finance.

Env: `PUBLIC_URL` (optional; otherwise remembered from the browser address), `MKT_CRON_KEY`, `META_GRAPH_BASE` (tests only).

## 6. Integration plan (Phase 2 / 3)

The **Settings → Integrations** screen shows the honest status of each integration.

| Integration | Approach | What you need to provide |
|---|---|---|
| WhatsApp Business | Meta WhatsApp Cloud API: webhook for incoming messages and orders, approved templates for confirmations, payment links and delivery updates | Meta Business verification, phone number ID, permanent token, approved templates |
| Online payments | Gateway adapter with webhook confirmation; payments stay `pending` until the gateway confirms (e.g. Thawani, or your bank's OmanNet gateway) | Merchant account and API keys |
| Instagram / Facebook | Meta Graph API for messages, leads and catalogue | Meta app review, page tokens |
| Snapchat | Snap Marketing API for campaign stats | Snap business account |
| E-mail reports | SMTP | SMTP credentials |

## 7. Run it

Requires Node.js 22.13 or newer.

```bash
cd perfume
npm install
npm test              # 26 tests: workflows, permissions, ledger integrity, promotions, voice parser
npm run build
npm start             # http://localhost:8790  (/manager, /staff)
```

On first start the main app shows **Create owner account**. Tick *Load sample data* to get a demo catalogue, sales, suppliers and these demo logins (all marked TEST, password `Demo1234`): `cashier`, `manager` (Manager app), `accountant`, `staff` (Staff app). Don't load sample data into a live installation.

Development: run `npm run dev:server` and `npm run dev` (Vite proxies `/api`).

### Deployment (production)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL (required in production). Use a managed service with automatic backups and point-in-time recovery |
| `DATA_KEY` | 64 hex characters (`openssl rand -hex 32`). **Back it up**: encrypted fields cannot be read without it |
| `NODE_ENV=production` | Secure cookies; hides internal error details |
| `SETUP_CODE` | Stops a stranger from claiming the owner account on a fresh public server |
| `PORT` | Default 8790 |
| `DB_SCHEMA` | Optional: keep this app's tables in their own PostgreSQL schema (e.g. `perfume`) to share a database with another app |
| `DATABASE_SSL` | `require` for managed databases with a self-signed certificate (encrypted, certificate not verified) |

Serve over HTTPS behind a reverse proxy. Without `DATABASE_URL` the app uses embedded PGlite in `./data` (development only; refused in production).

## Roadmap

1. **Phase 2:** public storefront (catalogue, filters, product pages, cart, wishlist, guest checkout, accounts, reviews, order tracking) on the existing `web` channel; payment gateway; payroll and payslips; scheduled e-mailed reports; bank reconciliation; full UI translation.
2. **Phase 3:** WhatsApp Cloud API and Meta/Snap integrations, campaign tracking, recruitment, performance reviews and final settlement.

Oman-specific settings (5 % VAT, labour and payroll rules) are configurable starting points. Check them with the Oman Tax Authority and Ministry of Labour, or your advisers, before relying on them.
