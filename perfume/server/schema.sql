-- Perfume Business Management System — relational schema (PostgreSQL / PGlite).
-- Money is stored as BIGINT in baisa (1 OMR = 1000 baisa) so no floating-point error ever reaches the books.
-- Quantities are integers (units). VAT rates are basis points (500 = 5.00 %).
-- Financial rows are never deleted: corrections are reversing journal entries, refunds and adjustments.

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value BIGINT NOT NULL DEFAULT 0);

-- ---------- organisation & security ----------
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, name_ar TEXT, address TEXT, phone TEXT,
  is_warehouse BOOLEAN NOT NULL DEFAULT false, active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, email TEXT, phone TEXT,
  hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','manager','accountant','hr','cashier','staff')),
  branch_id TEXT REFERENCES branches(id), employee_id TEXT,
  totp_secret TEXT, totp_enabled BOOLEAN NOT NULL DEFAULT false,
  pin_hash TEXT,                       -- optional supervisor PIN for approvals at the till
  active BOOLEAN NOT NULL DEFAULT true, failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- Per-user permission grants. Levels: view, create, edit, approve, manage, export.
-- Role defaults live in code (server/rbac.js); rows here override them for one user (e.g. owner tailoring a manager).
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id TEXT NOT NULL REFERENCES users(id), module TEXT NOT NULL, levels TEXT[] NOT NULL DEFAULT '{}',
  branch_ids TEXT[],                   -- NULL = all branches
  updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, module));

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), app TEXT NOT NULL DEFAULT 'admin',
  mfa_ok BOOLEAN NOT NULL DEFAULT false, ip TEXT, user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- Append-only audit trail: who, when, what.
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), user_id TEXT, user_name TEXT, user_role TEXT, app TEXT,
  action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail JSONB, ip TEXT);
CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS audit_user ON audit_log(user_id);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','executed','failed')),
  requested_by TEXT REFERENCES users(id), requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by TEXT REFERENCES users(id), decided_at TIMESTAMPTZ, reason TEXT, result JSONB);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
  user_id TEXT, roles TEXT[], branch_id TEXT, entity TEXT, entity_id TEXT, read_by TEXT[] NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS notifications_at ON notifications(at);

-- ---------- catalogue & inventory ----------
CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_ar TEXT, parent_id TEXT REFERENCES categories(id), sort INTEGER NOT NULL DEFAULT 0, web_visible BOOLEAN NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS brands (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, name_ar TEXT, country TEXT, logo_url TEXT, web_visible BOOLEAN NOT NULL DEFAULT true);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, brand_id TEXT REFERENCES brands(id), category_id TEXT REFERENCES categories(id),
  name TEXT NOT NULL, name_ar TEXT, description TEXT, description_ar TEXT,
  gender TEXT, concentration TEXT, notes_top TEXT, notes_heart TEXT, notes_base TEXT,
  image_url TEXT, images TEXT[] NOT NULL DEFAULT '{}', tags TEXT[] NOT NULL DEFAULT '{}',
  web_visible BOOLEAN NOT NULL DEFAULT true, active BOOLEAN NOT NULL DEFAULT true, is_test BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- A sellable unit: product + size. Cost uses the moving weighted average (avg_cost).
CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
  size_ml INTEGER, label TEXT, sku TEXT NOT NULL UNIQUE, barcode TEXT UNIQUE,
  avg_cost BIGINT NOT NULL DEFAULT 0, retail_price BIGINT NOT NULL DEFAULT 0, wholesale_price BIGINT, web_price BIGINT,
  vat_rate_bp INTEGER NOT NULL DEFAULT 500, min_stock INTEGER NOT NULL DEFAULT 0, track_expiry BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS variants_product ON variants(product_id);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL REFERENCES variants(id), batch_no TEXT NOT NULL, expiry_date DATE,
  unit_cost BIGINT NOT NULL DEFAULT 0, received_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (variant_id, batch_no));

CREATE TABLE IF NOT EXISTS stock_levels (
  branch_id TEXT NOT NULL REFERENCES branches(id), variant_id TEXT NOT NULL REFERENCES variants(id),
  qty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (branch_id, variant_id));

-- Every quantity change, signed. stock_levels is always the running sum of this ledger.
CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), branch_id TEXT NOT NULL REFERENCES branches(id),
  variant_id TEXT NOT NULL REFERENCES variants(id), batch_id TEXT REFERENCES batches(id), qty INTEGER NOT NULL,
  unit_cost BIGINT NOT NULL DEFAULT 0,
  reason TEXT NOT NULL CHECK (reason IN ('opening','purchase','purchase_return','sale','sale_return','transfer_in','transfer_out','adjustment','damage','loss','count','expired')),
  ref_type TEXT, ref_id TEXT, note TEXT, user_id TEXT);
CREATE INDEX IF NOT EXISTS stock_mov_variant ON stock_movements(variant_id, at);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, from_branch TEXT NOT NULL REFERENCES branches(id), to_branch TEXT NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'completed', note TEXT, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS stock_transfer_lines (id BIGSERIAL PRIMARY KEY, transfer_id TEXT NOT NULL REFERENCES stock_transfers(id), variant_id TEXT NOT NULL REFERENCES variants(id), qty INTEGER NOT NULL CHECK (qty > 0));

CREATE TABLE IF NOT EXISTS stock_counts (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, branch_id TEXT NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','posted','cancelled')), note TEXT,
  created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), posted_by TEXT, posted_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS stock_count_lines (count_id TEXT NOT NULL REFERENCES stock_counts(id), variant_id TEXT NOT NULL REFERENCES variants(id), system_qty INTEGER NOT NULL, counted_qty INTEGER, PRIMARY KEY (count_id, variant_id));

-- ---------- parties ----------
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT UNIQUE, email TEXT, birthday DATE, gender TEXT,
  address TEXT, city TEXT, segment TEXT NOT NULL DEFAULT 'regular', vip BOOLEAN NOT NULL DEFAULT false,
  loyalty_points INTEGER NOT NULL DEFAULT 0, credit_enabled BOOLEAN NOT NULL DEFAULT false, credit_limit BIGINT NOT NULL DEFAULT 0,
  favourite_brands TEXT[] NOT NULL DEFAULT '{}', preferences TEXT, notes TEXT, source TEXT, marketing_opt_in BOOLEAN NOT NULL DEFAULT false,
  is_test BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS loyalty_ledger (id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), customer_id TEXT NOT NULL REFERENCES customers(id), points INTEGER NOT NULL, reason TEXT NOT NULL, ref_type TEXT, ref_id TEXT);
CREATE TABLE IF NOT EXISTS customer_interactions (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), kind TEXT NOT NULL CHECK (kind IN ('note','complaint','follow_up','call','whatsapp','visit')),
  subject TEXT, body TEXT, status TEXT NOT NULL DEFAULT 'open', due_date DATE, assigned_to TEXT, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, contact_person TEXT, phone TEXT, email TEXT, address TEXT, country TEXT,
  vat_number TEXT, currency TEXT NOT NULL DEFAULT 'OMR', payment_terms_days INTEGER NOT NULL DEFAULT 30, credit_limit BIGINT NOT NULL DEFAULT 0,
  notes TEXT, active BOOLEAN NOT NULL DEFAULT true, is_test BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- ---------- accounting (double entry) ----------
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, name_ar TEXT,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  subtype TEXT, parent_id TEXT REFERENCES accounts(id), currency TEXT NOT NULL DEFAULT 'OMR',
  is_system BOOLEAN NOT NULL DEFAULT false, restricted BOOLEAN NOT NULL DEFAULT false, active BOOLEAN NOT NULL DEFAULT true);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, date DATE NOT NULL, memo TEXT,
  source_type TEXT NOT NULL, source_id TEXT, branch_id TEXT, reversal_of TEXT REFERENCES journal_entries(id), reversed_by TEXT,
  currency TEXT NOT NULL DEFAULT 'OMR', fx_rate NUMERIC(18,8) NOT NULL DEFAULT 1, is_test BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS je_date ON journal_entries(date);
CREATE INDEX IF NOT EXISTS je_source ON journal_entries(source_type, source_id);
CREATE TABLE IF NOT EXISTS journal_lines (
  id BIGSERIAL PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES journal_entries(id), account_id TEXT NOT NULL REFERENCES accounts(id),
  debit BIGINT NOT NULL DEFAULT 0 CHECK (debit >= 0), credit BIGINT NOT NULL DEFAULT 0 CHECK (credit >= 0),
  branch_id TEXT, party_type TEXT, party_id TEXT, memo TEXT,
  CHECK (debit = 0 OR credit = 0));
CREATE INDEX IF NOT EXISTS jl_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS jl_party ON journal_lines(party_type, party_id);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, date DATE NOT NULL, branch_id TEXT REFERENCES branches(id),
  account_id TEXT NOT NULL REFERENCES accounts(id), paid_from TEXT NOT NULL REFERENCES accounts(id),
  amount BIGINT NOT NULL CHECK (amount > 0), vat BIGINT NOT NULL DEFAULT 0, payee TEXT, description TEXT, reference TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')), journal_id TEXT, is_test BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- ---------- purchasing ----------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, supplier_id TEXT NOT NULL REFERENCES suppliers(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','partially_received','received','cancelled')),
  order_date DATE NOT NULL DEFAULT CURRENT_DATE, expected_date DATE, currency TEXT NOT NULL DEFAULT 'OMR', fx_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  subtotal BIGINT NOT NULL DEFAULT 0, vat BIGINT NOT NULL DEFAULT 0, total BIGINT NOT NULL DEFAULT 0, notes TEXT,
  created_by TEXT, approved_by TEXT, approved_at TIMESTAMPTZ, is_test BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS po_lines (
  id TEXT PRIMARY KEY, po_id TEXT NOT NULL REFERENCES purchase_orders(id), variant_id TEXT NOT NULL REFERENCES variants(id),
  qty INTEGER NOT NULL CHECK (qty > 0), received_qty INTEGER NOT NULL DEFAULT 0, unit_cost BIGINT NOT NULL CHECK (unit_cost >= 0), vat_rate_bp INTEGER NOT NULL DEFAULT 500);

-- A goods receipt creates the supplier bill (accounts payable).
CREATE TABLE IF NOT EXISTS supplier_bills (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, supplier_id TEXT NOT NULL REFERENCES suppliers(id), po_id TEXT REFERENCES purchase_orders(id),
  branch_id TEXT REFERENCES branches(id), supplier_ref TEXT, bill_date DATE NOT NULL, due_date DATE,
  goods BIGINT NOT NULL DEFAULT 0, landed_cost BIGINT NOT NULL DEFAULT 0, vat BIGINT NOT NULL DEFAULT 0, total BIGINT NOT NULL DEFAULT 0,
  paid BIGINT NOT NULL DEFAULT 0, returned BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_paid','paid','void')), journal_id TEXT,
  is_test BOOLEAN NOT NULL DEFAULT false, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS supplier_bill_lines (id BIGSERIAL PRIMARY KEY, bill_id TEXT NOT NULL REFERENCES supplier_bills(id), variant_id TEXT NOT NULL REFERENCES variants(id), batch_id TEXT REFERENCES batches(id), qty INTEGER NOT NULL, unit_cost BIGINT NOT NULL, landed_unit_cost BIGINT NOT NULL, vat BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, supplier_id TEXT NOT NULL REFERENCES suppliers(id), bill_id TEXT REFERENCES supplier_bills(id),
  amount BIGINT NOT NULL CHECK (amount > 0), paid_from TEXT NOT NULL REFERENCES accounts(id), method TEXT, reference TEXT, date DATE NOT NULL,
  journal_id TEXT, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS purchase_returns (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, supplier_id TEXT NOT NULL REFERENCES suppliers(id), bill_id TEXT REFERENCES supplier_bills(id),
  branch_id TEXT NOT NULL REFERENCES branches(id), amount BIGINT NOT NULL, vat BIGINT NOT NULL DEFAULT 0, reason TEXT, journal_id TEXT,
  created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS purchase_return_lines (id BIGSERIAL PRIMARY KEY, return_id TEXT NOT NULL REFERENCES purchase_returns(id), variant_id TEXT NOT NULL REFERENCES variants(id), qty INTEGER NOT NULL CHECK (qty > 0), unit_cost BIGINT NOT NULL);

-- ---------- promotions ----------
CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  type TEXT NOT NULL CHECK (type IN ('percent','fixed','buy_x_get_y','bundle_price','fixed_price')),
  value BIGINT NOT NULL DEFAULT 0,          -- percent in basis points, or an amount in baisa
  buy_qty INTEGER, get_qty INTEGER, bundle_qty INTEGER,
  scope TEXT NOT NULL DEFAULT 'items' CHECK (scope IN ('items','order')),
  product_ids TEXT[] NOT NULL DEFAULT '{}', variant_ids TEXT[] NOT NULL DEFAULT '{}', category_ids TEXT[] NOT NULL DEFAULT '{}', brand_ids TEXT[] NOT NULL DEFAULT '{}',
  channels TEXT[] NOT NULL DEFAULT '{pos,web,whatsapp,instagram}', branch_ids TEXT[],
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','customers','vip','segment','staff','wholesale')),
  customer_ids TEXT[] NOT NULL DEFAULT '{}', segment TEXT,
  coupon_code TEXT UNIQUE, min_purchase BIGINT NOT NULL DEFAULT 0, max_discount BIGINT,
  starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, usage_limit INTEGER, per_customer_limit INTEGER, used_count INTEGER NOT NULL DEFAULT 0,
  stackable BOOLEAN NOT NULL DEFAULT false, priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','disabled')),
  created_by TEXT, approved_by TEXT, approved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- ---------- sales (POS, website, WhatsApp, social — one table, one truth) ----------
CREATE TABLE IF NOT EXISTS registers (id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id), name TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS register_sessions (
  id TEXT PRIMARY KEY, register_id TEXT NOT NULL REFERENCES registers(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  opened_by TEXT NOT NULL, opened_at TIMESTAMPTZ NOT NULL DEFAULT now(), opening_float BIGINT NOT NULL DEFAULT 0,
  closed_by TEXT, closed_at TIMESTAMPTZ, expected_cash BIGINT, counted_cash BIGINT, variance BIGINT, close_note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')));
CREATE TABLE IF NOT EXISTS cash_movements (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES register_sessions(id), kind TEXT NOT NULL CHECK (kind IN ('pay_in','pay_out')), amount BIGINT NOT NULL CHECK (amount > 0), reason TEXT, account_id TEXT, journal_id TEXT, user_id TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, branch_id TEXT NOT NULL REFERENCES branches(id),
  channel TEXT NOT NULL CHECK (channel IN ('pos','web','whatsapp','instagram','snapchat','facebook','phone','wholesale')),
  customer_id TEXT REFERENCES customers(id), cashier_id TEXT, salesperson_id TEXT, register_session_id TEXT REFERENCES register_sessions(id),
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','completed','partially_refunded','refunded','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid','refunded')),
  fulfilment_status TEXT NOT NULL DEFAULT 'fulfilled' CHECK (fulfilment_status IN ('unfulfilled','packed','shipped','delivered','fulfilled','returned')),
  currency TEXT NOT NULL DEFAULT 'OMR', prices_include_vat BOOLEAN NOT NULL DEFAULT true,
  subtotal BIGINT NOT NULL DEFAULT 0,   -- before discounts, as priced
  discount BIGINT NOT NULL DEFAULT 0, net BIGINT NOT NULL DEFAULT 0, vat BIGINT NOT NULL DEFAULT 0, total BIGINT NOT NULL DEFAULT 0,
  paid BIGINT NOT NULL DEFAULT 0, refunded BIGINT NOT NULL DEFAULT 0, cost BIGINT NOT NULL DEFAULT 0,
  promotion_ids TEXT[] NOT NULL DEFAULT '{}', coupon_code TEXT, points_earned INTEGER NOT NULL DEFAULT 0, points_redeemed INTEGER NOT NULL DEFAULT 0,
  shipping_address TEXT, delivery_fee BIGINT NOT NULL DEFAULT 0, external_ref TEXT, notes TEXT,
  is_test BOOLEAN NOT NULL DEFAULT false, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS sales_customer ON sales(customer_id);
CREATE TABLE IF NOT EXISTS sale_lines (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), variant_id TEXT NOT NULL REFERENCES variants(id),
  qty INTEGER NOT NULL CHECK (qty > 0), refunded_qty INTEGER NOT NULL DEFAULT 0,
  unit_price BIGINT NOT NULL, list_price BIGINT NOT NULL, price_overridden BOOLEAN NOT NULL DEFAULT false,
  discount BIGINT NOT NULL DEFAULT 0, vat_rate_bp INTEGER NOT NULL, net BIGINT NOT NULL, vat BIGINT NOT NULL, total BIGINT NOT NULL,
  unit_cost BIGINT NOT NULL DEFAULT 0, promotion_id TEXT);
CREATE INDEX IF NOT EXISTS sale_lines_sale ON sale_lines(sale_id);
CREATE INDEX IF NOT EXISTS sale_lines_variant ON sale_lines(variant_id);

-- Card numbers are NEVER stored: only method, gateway reference / terminal approval code and status.
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, sale_id TEXT REFERENCES sales(id), customer_id TEXT REFERENCES customers(id),
  direction TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
  method TEXT NOT NULL CHECK (method IN ('cash','card','bank_transfer','wallet','payment_link','credit','loyalty')),
  amount BIGINT NOT NULL CHECK (amount > 0), status TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('pending','captured','failed','refunded','void')),
  provider TEXT, reference TEXT, account_id TEXT REFERENCES accounts(id), register_session_id TEXT, journal_id TEXT,
  received_by TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now(), reconciled BOOLEAN NOT NULL DEFAULT false, failure_reason TEXT);
CREATE INDEX IF NOT EXISTS payments_sale ON payments(sale_id);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, sale_id TEXT NOT NULL REFERENCES sales(id), reason TEXT NOT NULL,
  amount BIGINT NOT NULL, vat BIGINT NOT NULL, restock BOOLEAN NOT NULL DEFAULT true, method TEXT NOT NULL,
  approved_by TEXT, created_by TEXT, journal_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS refund_lines (id BIGSERIAL PRIMARY KEY, refund_id TEXT NOT NULL REFERENCES refunds(id), sale_line_id TEXT NOT NULL REFERENCES sale_lines(id), qty INTEGER NOT NULL CHECK (qty > 0), amount BIGINT NOT NULL, vat BIGINT NOT NULL);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), address TEXT, city TEXT, courier TEXT, tracking_no TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','packed','out_for_delivery','delivered','failed','returned')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- ---------- HR & staff ----------
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT, email TEXT, nationality TEXT,
  job_title TEXT, department TEXT, branch_id TEXT REFERENCES branches(id), joining_date DATE, probation_end DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('candidate','onboarding','probation','active','on_leave','resigned','terminated')),
  basic_salary BIGINT NOT NULL DEFAULT 0, housing_allowance BIGINT NOT NULL DEFAULT 0, transport_allowance BIGINT NOT NULL DEFAULT 0, other_allowance BIGINT NOT NULL DEFAULT 0,
  work_schedule TEXT, annual_leave_days INTEGER NOT NULL DEFAULT 30, sales_target BIGINT NOT NULL DEFAULT 0,
  id_number TEXT, id_expiry DATE, passport_expiry DATE, bank_iban TEXT, is_test BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), date DATE NOT NULL, check_in TIMESTAMPTZ, check_out TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present','absent','late','leave','holiday')), overtime_minutes INTEGER NOT NULL DEFAULT 0, note TEXT,
  UNIQUE (employee_id, date));
CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id), kind TEXT NOT NULL, from_date DATE NOT NULL, to_date DATE NOT NULL,
  days INTEGER NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by TEXT, decided_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, branch_id TEXT, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- ---------- files (product photos) ----------
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BYTEA NOT NULL, size INTEGER NOT NULL, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- ---------- barcodes & label printing ----------
ALTER TABLE variants ADD COLUMN IF NOT EXISTS symbology TEXT NOT NULL DEFAULT 'ean13';
ALTER TABLE variants ADD COLUMN IF NOT EXISTS compare_price BIGINT;
ALTER TABLE variants ADD COLUMN IF NOT EXISTS sale_blocked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE variants ADD COLUMN IF NOT EXISTS block_reason TEXT;

CREATE TABLE IF NOT EXISTS label_templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, spec JSONB NOT NULL, created_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- Printer settings. The connection is verified only by a real test (agent probe or a test label the user confirmed).
CREATE TABLE IF NOT EXISTS printers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, model TEXT, branch_id TEXT REFERENCES branches(id),
  connection TEXT NOT NULL CHECK (connection IN ('browser','network','usb','bluetooth')),
  language TEXT NOT NULL CHECK (language IN ('driver','zpl','tspl','escpos')),
  host TEXT, port INTEGER, queue TEXT, dpi INTEGER NOT NULL DEFAULT 203,
  density INTEGER NOT NULL DEFAULT 8, speed INTEGER NOT NULL DEFAULT 4, orientation INTEGER NOT NULL DEFAULT 0,
  label_width_mm NUMERIC(6,1) NOT NULL DEFAULT 38, label_height_mm NUMERIC(6,1) NOT NULL DEFAULT 25, gap_mm NUMERIC(5,1) NOT NULL DEFAULT 2,
  cols INTEGER NOT NULL DEFAULT 1, col_gap_mm NUMERIC(5,1) NOT NULL DEFAULT 2, offset_x_mm NUMERIC(5,1) NOT NULL DEFAULT 0, offset_y_mm NUMERIC(5,1) NOT NULL DEFAULT 0,
  template_id TEXT, is_default BOOLEAN NOT NULL DEFAULT false, active BOOLEAN NOT NULL DEFAULT true,
  last_test_at TIMESTAMPTZ, last_test_ok BOOLEAN, last_test_method TEXT, last_test_detail TEXT,
  created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, printer_id TEXT REFERENCES printers(id), printer_name TEXT, template_id TEXT, template_name TEXT,
  source TEXT NOT NULL, ref_id TEXT, reprint_of TEXT REFERENCES print_jobs(id), reason TEXT, labels INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','dialog_opened','failed')), detail TEXT,
  user_id TEXT, user_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS print_jobs_at ON print_jobs(created_at);
CREATE TABLE IF NOT EXISTS print_job_lines (
  id BIGSERIAL PRIMARY KEY, job_id TEXT NOT NULL REFERENCES print_jobs(id), variant_id TEXT REFERENCES variants(id),
  product_name TEXT, sku TEXT, barcode TEXT, batch_no TEXT, copies INTEGER NOT NULL CHECK (copies > 0));
CREATE INDEX IF NOT EXISTS print_job_lines_variant ON print_job_lines(variant_id);

-- ---------- digital marketing, website CMS & social automation ----------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner','admin','manager','accountant','hr','cashier','staff','marketing'));
ALTER TABLE files ADD COLUMN IF NOT EXISTS name TEXT;

CREATE TABLE IF NOT EXISTS mkt_campaigns (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','ended')),
  start_date DATE, end_date DATE, product_ids TEXT[] NOT NULL DEFAULT '{}', promotion_id TEXT REFERENCES promotions(id), coupon_code TEXT,
  discount_text TEXT, audience TEXT, platforms TEXT[] NOT NULL DEFAULT '{}', budget BIGINT NOT NULL DEFAULT 0, spend BIGINT NOT NULL DEFAULT 0,
  utm TEXT UNIQUE, notes TEXT, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS campaign_id TEXT;

CREATE TABLE IF NOT EXISTS mkt_assets (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('image','video','audio')), source TEXT NOT NULL, file_id TEXT REFERENCES files(id),
  product_id TEXT REFERENCES products(id), format TEXT, width INTEGER, height INTEGER, duration_s NUMERIC, title TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('processing','ready','failed')), provider TEXT, job_ref TEXT, detail TEXT,
  cost_usd NUMERIC NOT NULL DEFAULT 0, params JSONB, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_assets_product ON mkt_assets(product_id);

CREATE TABLE IF NOT EXISTS mkt_content (
  id TEXT PRIMARY KEY, number TEXT UNIQUE, kind TEXT NOT NULL CHECK (kind IN ('post','reel','story','facebook','whatsapp','web_product','blog','banner','landing','offer')),
  platform TEXT NOT NULL, title TEXT, caption TEXT, hashtags TEXT, body JSONB NOT NULL DEFAULT '{}', lang TEXT NOT NULL DEFAULT 'en', tone TEXT,
  product_id TEXT REFERENCES products(id), campaign_id TEXT REFERENCES mkt_campaigns(id), asset_ids TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ai_generated','under_review','approved','scheduled','published','failed','archived')),
  scheduled_at TIMESTAMPTZ, published_at TIMESTAMPTZ, external_id TEXT, external_url TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  auto_generated BOOLEAN NOT NULL DEFAULT false, fingerprint TEXT, review_note TEXT,
  created_by TEXT, approved_by TEXT, approved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_content_status ON mkt_content(status, scheduled_at);
CREATE INDEX IF NOT EXISTS mkt_content_product ON mkt_content(product_id);

CREATE TABLE IF NOT EXISTS mkt_content_history (
  id BIGSERIAL PRIMARY KEY, content_id TEXT NOT NULL REFERENCES mkt_content(id), action TEXT NOT NULL, from_status TEXT, to_status TEXT,
  note TEXT, user_id TEXT, user_name TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mkt_jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref_id TEXT, payload JSONB NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, run_after TIMESTAMPTZ NOT NULL DEFAULT now(), error TEXT, result JSONB,
  created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mkt_jobs_due ON mkt_jobs(status, run_after);

CREATE TABLE IF NOT EXISTS mkt_api_log (
  id BIGSERIAL PRIMARY KEY, provider TEXT NOT NULL, operation TEXT NOT NULL, ok BOOLEAN NOT NULL, status INTEGER, ms INTEGER, cost_usd NUMERIC NOT NULL DEFAULT 0,
  ref_id TEXT, detail TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_api_log_at ON mkt_api_log(at);

CREATE TABLE IF NOT EXISTS mkt_metrics (
  day DATE NOT NULL, source TEXT NOT NULL, metric TEXT NOT NULL, value NUMERIC NOT NULL, PRIMARY KEY (day, source, metric)
);
CREATE TABLE IF NOT EXISTS mkt_web_events (
  id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), kind TEXT NOT NULL, path TEXT, product_ref TEXT, visitor TEXT, utm TEXT, referrer TEXT
);
CREATE INDEX IF NOT EXISTS mkt_web_events_at ON mkt_web_events(at);

ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_title TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS seo_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS web_external_id TEXT;
