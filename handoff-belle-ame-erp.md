# active-memory handoff: Belle Âme perfume ERP, website & marketing

**Handoff #1** · 2026-11-24 · Lineage: #1 (2026-11-24): built the ERP + website + marketing, moved hosting to a Hostinger VPS, then added Excel import with photos and the monthly stock register

## 0. Instructions for Claude (read first)

You are continuing work from a previous chat. That chat is gone; this file is the complete context and the source of truth.

1. Read this whole file before replying.
2. Follow sections 3 (Style), 4 (Hard rules) and 5 (Corrections) in every reply, for the rest of this chat. They override your defaults.
3. Use the values in section 8 exactly. Never round, re-estimate, or "correct" them.
4. Do not suggest anything listed in section 7 (Changed / rejected) again unless the user brings it up.
5. Code word: Start every reply with exactly "Yes Boss!"
6. Your first reply: at most 5 lines covering the goal, the current state, and the next step (section 11). Mention any files from section 13 that were not attached. Ask the questions in section 12 if there are any. End with "Ready to continue with <next step>?" Then wait for the user's go.

## 1. Mission
- **Goal:** Run the Belle Âme perfume shop (Salalah, Oman) on its own ERP — products, stock, POS, sales, finance, HR, marketing — plus a WooCommerce website connected to it.
- **Done looks like:** the owner can add and manage all products (one by one or from Excel, with photos), count stock monthly, and later open the online shop.
- **Why it matters / context:** replaces the old site https://belleameoman.com and manual stock keeping.

## 2. About the user (as relevant to this work)
- Owner of Belle Âme perfume shop: Shop G-72, Salalah Gallery mall, Saada, Salalah. Hours Sat–Wed 10am–11pm, Fri 3pm–11pm. WhatsApp +968 9986 0151. Instagram @belleame.om.
- Non-technical; uses an iPad/iPhone (Safari). Writes in Malayalam (often Manglish, e.g. "product add cheyyuka").
- Gave standing permission for infrastructure work: "avasyamullathu cheyyuka njan permission tharam" (do what's needed, I give permission).

## 3. Style & communication
- **Language:** reply in Malayalam (Malayalam script); UI/code stays English.
- **Tone:** clear, practical, step-by-step; exact menu paths (e.g. ☰ മെനു → Inventory → "+ Product").
- **Reply length:** short summary + numbered steps; tables welcome.
- **Formatting:** headings/bold/numbered steps; emojis OK sparingly.
- **Working style:** build it, test it (tests + browser screenshots on iPad size), commit, push, deploy, then explain in Malayalam how to use it; remind to reload the page.
- **Avoid:** technical jargon in replies; asking for things the user already answered.

## 4. Hard rules (word for word where given)
1. Never put passwords or tokens in chat. Secrets go through the secure credential form or a file sent to the user. Tell the user not to type passwords in chat.
2. Nothing is published (website live, social posts) without the user's approval. Website stays "Coming soon" until the user says go: "Web site pinne live Akam kooduthal product add cheyyanundu" (website goes live later; more products to add first).
3. Don't change the product's identity in product images.
4. Reply in Malayalam.
5. On the VPS, update code only with Docker **restart** — never `down` (down deletes volumes = all data).
6. Develop on git branch `claude/perfume-business-system-9c3pe0`; push only there. No pull requests unless asked.
7. Code word "Yes Boss!" at the start of every reply.

## 5. Corrections log
| # | Claude did | The user wanted |
|---|---|---|
| 1 | Add-product: sizes/prices table scrolled sideways on iPad, price fields hidden | Clear place to add product + price → each size now a card, price/stock first |
| 2 | Gave only one-by-one product add | A bulk window → Excel import built |
| 3 | Excel import without photos | "Photo upload cheyyanulla option koodi undakku" → photos in the import |
| 4 | Only "Stock-taking" existed | "montly stock register venam phisical stock enter cheyyan vendi" → Monthly register built |
| 5 | Could not give the owner username/password (user set them; never visible to Claude) | User said "venam" → built "Forgot username or password?" on the login page (setup code + new password) |

## 6. Decisions
| Decision | Why |
|---|---|
| ERP hosted on Hostinger VPS with Docker (Postgres 16 + Node 22 app pulled from GitHub + Caddy HTTPS) | Ample hosting had an outage; user said move to Hostinger |
| Business dates in Asia/Muscat (today(), DB session timezone; env BUSINESS_TZ overrides) | Sales 00:00–04:00 Oman time were landing on the wrong day |
| Excel import: one row = one size; same Name + Brand = one product; re-import is safe (existing sizes skipped) | Bulk adding many products |
| Photos matched by file name (Sauvage.jpg / Dior Sauvage.jpg) or "Photo file" column; shrunk to max 1600 px JPEG in browser | Phone photos are large |
| One stock count per month per branch; counts auto-save; Post (owner/manager) books differences | Monthly physical stock entry |
| Library read-excel-file pinned 9.3.12 (not 9.3.20) | Newer was only days old |

## 7. Changed / rejected
- Ample hosting (app + jobs) → Hostinger VPS (Ample outage: gateway_unreachable / 502)
- Hostinger connector sign-in → Hostinger API token via secure credential form (connector sign-in refused; 1st token unauthenticated, 2nd works)
- VPS OS without Docker Manager → recreated with template 1121 "Ubuntu 24.04 with Docker"
- Building a Docker image on the VPS → stock `node:22-bookworm` image that git-clones the branch (Docker manager can't build)
- hostinger-ai-theme on WordPress → custom `belleame` theme activated
- ❌ Website going live now (user: later, after more products)

## 8. Data & facts (exact)
| Item | Value |
|---|---|
| ERP URL | https://erp.belleameoman.com (alt: https://srv2187269.hstgr.cloud) |
| ERP Inventory | https://erp.belleameoman.com/#/inventory |
| Excel template | https://erp.belleameoman.com/product-import-template.xlsx (source: perfume/public/product-import-template.xlsx) |
| VPS | id 2187269, host srv2187269.hstgr.cloud, IP 2.25.19.113, Docker project `belleame-erp` |
| Hostinger API | developers.hostinger.com/api/vps/v1 — POST /virtual-machines/2187269/docker/belleame-erp/restart; GET …/logs (token injected by proxy) |
| DNS | erp.belleameoman.com A → 2.25.19.113 (done by user) |
| WooCommerce site | prosperous-white-anteater-57.hostingersite.com ("Coming soon") |
| Old site | https://belleameoman.com |
| Repo / branch | salalahga/salalah-gallery · claude/perfume-business-system-9c3pe0 · app in `perfume/` |
| Latest deployed commit | 228982b (legacy import job accepts setup code) |
| Tests | 64 pass (`cd perfume && npm test`) |
| Money | stored as integer baisa (1 OMR = 1000) |
| Owner login | created by the user on the setup page; username/password unknown to Claude — [secret removed: re-enter it] |
| VPS env secrets (DATA_KEY, SETUP_CODE, DB password) | [secret removed: re-enter it] — user has file belleame-server-secrets.txt |

Old-website products (baisa): Leo Hebrew Collection 15750; Luxury Edition Magic (Linea De Bella) 20000; Laid Back Girl (Paris) 15750; Sensu 11025; Sports Homme (Luxe) 13650; 3D Emperor (Luxe) 14700; Signature Collection Pantheon 8400; Signature Collection Charonne 8400. Plus 14 gallery perfumes with price 0 (Cartier, Versace, Dolce & Gabbana, YSL, Calvin Klein, Dior).

## 9. People, terms & names
- **People:** the user (shop owner).
- **Terms:** "Social media automation for perfume studio" = the ERP's Marketing → Studio; "pazhaya website" = belleameoman.com.
- **Names in use:** ERP modules src/modules/Inventory.tsx, ProductImport.tsx, StockRegister.tsx; server/app.js (POST /products/import, GET /inventory/register, PUT /inventory/counts/:id/lines, POST /inventory/counts/:id/cancel); server/services/inventory.js; perfume/docker-compose.yml.

## 10. Work state
| Item | Status | Version / location | Notes |
|---|---|---|---|
| ERP (22 modules, POS, finance, HR, marketing) | live | erp.belleameoman.com, d93b170 | owner account set up (setup default username was "owner") |
| Add product form (iPad-friendly) | done | Inventory → + Product | |
| Excel import + photos | done | Inventory → Import Excel | |
| Monthly stock register + physical count | done | Inventory → Monthly register | |
| Old-site + gallery product import | done 2026-11-24 | 8 old-site + 13 gallery created; "Sauvage" skipped (already in ERP) | 13 gallery items have price 0 → set prices |
| Website (WooCommerce, belleame theme) | Coming soon | hostingersite.com URL | go-live only on user's word |
| Ample jobs (marketing-scheduler, import-old-website, website-gallery) + old Ample app | still exist | Ample | stop when Ample is back |
| Owner "Forgot username or password?" | done, live | login page → needs SETUP_CODE from belleame-server-secrets.txt | shows the username, sets a new password |

## 11. Next steps
1. **Next action:** confirm the user can sign in (via "Forgot username or password?" if needed), then help the user set prices for the 13 imported gallery items (price 0) and import more products (Excel template).
2. Later, on the user's go: website live, payment/delivery, point belleameoman.com to the new site.
3. When Ample is back: stop the 3 Ample jobs, shut the old Ample app.

## 12. Open questions ⚠️
- Rasasi Hawas: add it or not? (undecided)
- Photos still needed as files: Lancôme ×3, Azzaro Chrome Legend, Hugo Boss Bottled.

## 13. Re-attach checklist
- [ ] belleame-server-secrets.txt: only if VPS env/setup code is needed (do not paste its contents in chat)
- [ ] Product photos (Lancôme ×3, Azzaro, Hugo Boss) when available

---
<sub>Audit: 13/13 sections · 7 rules · 5 corrections · 20 data points · secrets removed: yes · generated by active-memory</sub>
