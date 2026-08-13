-- Wosha — PostgreSQL schema (core foundation)
-- Run this once against a fresh database to set up all tables.

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- ---------- Organizations & Branches ----------
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT DEFAULT '#2B6CF6',
  custom_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Users (login accounts) ----------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,       -- bcrypt hash
  role TEXT NOT NULL CHECK (role IN ('owner','manager','staff','client')),
  title TEXT,                        -- display label, e.g. "General Manager" — same permissions as owner either way
  is_primary_owner BOOLEAN DEFAULT false, -- the original owner account; only this one can create/remove other owner-tier accounts
  location_id UUID REFERENCES locations(id),
  active BOOLEAN DEFAULT true,
  profile_pic TEXT,                  -- URL to stored image (see /uploads)
  failed_login_attempts INT DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Customers & Vehicles ----------
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  tag TEXT DEFAULT 'First-time',
  segments TEXT[] DEFAULT '{}',      -- e.g. {"VIP","Loyal Customer"}
  custom_data JSONB DEFAULT '{}',
  user_id UUID REFERENCES users(id), -- linked login account, if the customer has one
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  plate TEXT NOT NULL,
  make TEXT, model TEXT, color TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Staff (HR records, distinct from login accounts) ----------
CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,                -- e.g. "Technician", "Branch Manager"
  location_id UUID REFERENCES locations(id),
  salary NUMERIC(14,2) DEFAULT 0,
  skills TEXT[] DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Services & Products ----------
CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC(14,2) NOT NULL,
  duration_min INT DEFAULT 30,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id),
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT DEFAULT 'pcs',
  qty NUMERIC(14,2) DEFAULT 0,
  reorder_level NUMERIC(14,2) DEFAULT 0,
  par_level NUMERIC(14,2) DEFAULT 0,
  barcode TEXT,
  cost_price NUMERIC(14,2) DEFAULT 0,
  sell_price NUMERIC(14,2) DEFAULT 0,
  sellable BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Bookings ----------
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id),
  customer_id UUID REFERENCES customers(id),
  vehicle_plate TEXT,
  technician_id UUID REFERENCES staff(id),
  scheduled_time TEXT,
  status TEXT NOT NULL DEFAULT 'Requested'
    CHECK (status IN ('Requested','Confirmed','Checked-in','In Progress','Completed','Paid','Closed','No Show')),
  archived BOOLEAN DEFAULT false,  -- hidden from the active list once a finished/no-show booking has been cleared, but the record itself is kept for reporting/history
  assigned_by UUID REFERENCES users(id),  -- who assigned/confirmed this booking (owner or General Manager)
  owner_review_status TEXT CHECK (owner_review_status IN ('Needs Review','Approved','Needs Improvement','Rejected')),
  review_note TEXT,  -- the owner's feedback when requesting improvement, or the GM's note when sending for review
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES users(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS owner_review_status TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_owner_review_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_owner_review_status_check
  CHECK (owner_review_status IN ('Needs Review','Approved','Needs Improvement','Rejected') OR owner_review_status IS NULL);
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('Requested','Confirmed','Checked-in','In Progress','Completed','Paid','Closed','No Show'));

CREATE TABLE IF NOT EXISTS booking_services (
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id),
  PRIMARY KEY (booking_id, service_id)
);

-- ---------- Manual jobs — ad-hoc tasks on the Job Board that aren't tied to a
-- customer booking (e.g. "Restock bay 2", "Deep-clean waiting area") ----------
CREATE TABLE IF NOT EXISTS manual_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id),
  title TEXT NOT NULL,
  technician_id UUID REFERENCES staff(id),
  due_time TEXT,
  notes TEXT,
  status TEXT DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Done')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Invoicing ----------
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  location_id UUID REFERENCES locations(id),
  subtotal NUMERIC(14,2) DEFAULT 0,
  discount_percent NUMERIC(5,2) DEFAULT 0,
  discount NUMERIC(14,2) DEFAULT 0,
  tax_percent NUMERIC(5,2) DEFAULT 0,
  tax NUMERIC(14,2) DEFAULT 0,
  total NUMERIC(14,2) DEFAULT 0,
  paid NUMERIC(14,2) DEFAULT 0,
  status TEXT DEFAULT 'Unpaid' CHECK (status IN ('Unpaid','Paid')),
  payment_method TEXT,
  control_number TEXT,
  bill_to TEXT,                      -- for company invoices
  company_tin TEXT,
  company_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rate NUMERIC(14,2) NOT NULL,
  qty NUMERIC(14,2) NOT NULL DEFAULT 1,
  amount NUMERIC(14,2) NOT NULL
);

-- ---------- Expenses ----------
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id),
  category TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  note TEXT,
  status TEXT DEFAULT 'Approved' CHECK (status IN ('Approved','Pending Approval','Rejected')),
  submitted_by UUID REFERENCES users(id),
  expense_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Suppliers & Purchase Orders ----------
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact TEXT, email TEXT,
  category TEXT, capacity TEXT, criteria TEXT, lead_time TEXT,
  shortlisted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id),
  supplier_id UUID REFERENCES suppliers(id),
  requested_by UUID REFERENCES users(id),
  status TEXT DEFAULT 'Pending Approval'
    CHECK (status IN ('Pending Approval','Approved','Rejected','Received')),
  payment_terms TEXT DEFAULT 'Full payment',
  supplier_invoice_url TEXT,
  delivery_note_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
  name TEXT NOT NULL, spec TEXT,
  qty NUMERIC(14,2) NOT NULL,
  rate NUMERIC(14,2) DEFAULT 0,
  received_qty NUMERIC(14,2) DEFAULT 0,
  matched_barcode TEXT
);

CREATE TABLE IF NOT EXISTS po_negotiation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- A PO can request quotations from several suppliers at once, and later be awarded to
-- one of them (purchase_orders.supplier_id stays as "the one we're actually buying from").
CREATE TABLE IF NOT EXISTS po_quotation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id),
  sent_at TIMESTAMPTZ DEFAULT now(),
  delivered BOOLEAN DEFAULT false,
  UNIQUE (po_id, supplier_id)
);

-- ---------- Messaging ----------
CREATE TABLE IF NOT EXISTS team_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL, -- 'all' or a location_id
  sender_id UUID REFERENCES users(id),
  text TEXT,
  attachment_url TEXT,
  attachment_type TEXT,        -- 'image' | 'audio' | 'video' | 'file'
  attachment_name TEXT,
  downloaded BOOLEAN DEFAULT false,
  downloaded_at TIMESTAMPTZ,
  saved_location_note TEXT,    -- self-reported by the person who downloaded it — browsers don't expose real file paths
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  sender TEXT NOT NULL CHECK (sender IN ('staff','customer')),
  text TEXT,
  attachment_url TEXT,
  attachment_type TEXT,
  attachment_name TEXT,
  downloaded BOOLEAN DEFAULT false,
  downloaded_at TIMESTAMPTZ,
  saved_location_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Marketing ----------
CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  discount_percent NUMERIC(5,2) DEFAULT 0,
  target_segment TEXT DEFAULT 'All',
  media_url TEXT,
  media_type TEXT,
  expires_in_days TEXT DEFAULT '14',
  status TEXT DEFAULT 'Active' CHECK (status IN ('Active','Ended')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Cash flow (manual entries; invoices/expenses feed in automatically) ----------
CREATE TABLE IF NOT EXISTS cash_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id),
  category TEXT NOT NULL,
  item TEXT,  -- the specific item within the category, e.g. category "Allowance" -> item "Lunch Allowance"
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount NUMERIC(14,2) NOT NULL,
  note TEXT,
  entry_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS item TEXT;

-- ---------- Tasks & Compliance ----------
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id),
  title TEXT NOT NULL,
  assigned_to UUID REFERENCES staff(id),
  due_date DATE,
  status TEXT DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Submitted','Done','Rejected')),
  attachment_url TEXT,          -- the completed form/document the assignee attaches
  attachment_name TEXT,
  submitted_at TIMESTAMPTZ,
  review_comment TEXT,          -- reviewer's note — required when rejecting, optional when approving
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('Open','In Progress','Submitted','Done','Rejected'));

-- ---------- Compliance & tax deadlines ----------
CREATE TABLE IF NOT EXISTS tax_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,          -- e.g. "VAT Return", "Skills Dev. Levy (SDL)"
  due_date DATE NOT NULL,
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending','Filed')),
  recurrence TEXT DEFAULT 'monthly',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Printer profiles ----------
CREATE TABLE IF NOT EXISTS printer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'Thermal',
  paper_size TEXT DEFAULT '80mm' CHECK (paper_size IN ('A4','80mm','58mm')),
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Business settings (single row — branding, invoice defaults) ----------
CREATE TABLE IF NOT EXISTS business_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- enforces a single row
  business_name TEXT DEFAULT 'Wosha',
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  tin TEXT DEFAULT '',
  invoice_prefix TEXT DEFAULT 'INV',
  tax_rate_percent NUMERIC(5,2) DEFAULT 18,
  logo_url TEXT,
  logo_size TEXT DEFAULT 'md' CHECK (logo_size IN ('sm','md','lg')),
  tagline TEXT DEFAULT '',
  staff_attachments_enabled BOOLEAN DEFAULT true,   -- global default for Team Chat
  client_attachments_enabled BOOLEAN DEFAULT true,  -- global default for Client Messages
  mission TEXT DEFAULT '',
  vision TEXT DEFAULT '',
  org_structure TEXT DEFAULT '',    -- free text, e.g. one role per line, top to bottom
  sidebar_color TEXT DEFAULT '#0B1B33',  -- customizable sidebar/topbar color, owner-set in Settings
  login_message TEXT DEFAULT '',    -- custom welcome text shown on the login page, separate from the sidebar tagline
  login_background_color TEXT DEFAULT '#0B1B33',  -- customizable login page background — defaults to the original dark navy look
  icon_background_color TEXT DEFAULT '#FFFFFF',  -- background behind the logo in the generated app icon — separate from sidebar_color, since a logo made for a white background shouldn't be forced onto the app's UI chrome color
  print_header_enabled BOOLEAN DEFAULT true,
  print_header_show_logo BOOLEAN DEFAULT true,
  print_header_show_slogan BOOLEAN DEFAULT true,
  print_header_align TEXT DEFAULT 'left' CHECK (print_header_align IN ('left','center','right')),
  print_footer_enabled BOOLEAN DEFAULT true,
  print_footer_text TEXT DEFAULT '',
  print_footer_align TEXT DEFAULT 'center' CHECK (print_footer_align IN ('left','center','right')),
  print_header_attachment_type TEXT CHECK (print_header_attachment_type IN ('image','docx') OR print_header_attachment_type IS NULL),
  print_header_attachment_url TEXT,
  print_header_attachment_html TEXT,
  print_footer_attachment_type TEXT CHECK (print_footer_attachment_type IN ('image','docx') OR print_footer_attachment_type IS NULL),
  print_footer_attachment_url TEXT,
  print_footer_attachment_html TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS sidebar_color TEXT DEFAULT '#0B1B33';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS payment_instructions TEXT DEFAULT '';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS login_message TEXT DEFAULT '';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS login_background_color TEXT DEFAULT '#0B1B33';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS icon_background_color TEXT DEFAULT '#FFFFFF';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS print_header_enabled BOOLEAN DEFAULT true;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS print_header_show_logo BOOLEAN DEFAULT true;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS print_header_show_slogan BOOLEAN DEFAULT true;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS print_header_align TEXT DEFAULT 'left';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS print_footer_enabled BOOLEAN DEFAULT true;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS print_footer_text TEXT DEFAULT '';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS print_footer_align TEXT DEFAULT 'center';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS print_header_attachment_type TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS print_header_attachment_url TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS print_header_attachment_html TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS print_footer_attachment_type TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS print_footer_attachment_url TEXT;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS print_footer_attachment_html TEXT;
UPDATE business_settings SET login_background_color = '#0B1B33' WHERE login_background_color = '#F5F7FA';
INSERT INTO business_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Per-person exceptions to the global attachment toggle above — e.g. attachments are off
-- for everyone by default, but this one staff member (or this one client) is allowed.
-- No row for a person = they simply follow the global setting.
CREATE TABLE IF NOT EXISTS attachment_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('staff','client')),
  person_id UUID NOT NULL,   -- users.id for staff, customers.id for clients
  allowed BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (scope, person_id)
);

-- ---------- Generic managed categories — one system for every category list in the app
-- (service categories, product categories, expense categories, PO categories, client
-- ---------- Payroll rate items — configurable employer-cost add-ons (NSSF, WCF, SDL,
-- or any custom cost), each individually toggleable and editable, not hardcoded ----------
CREATE TABLE IF NOT EXISTS payroll_rate_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  rate_percent NUMERIC(6,3) NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO payroll_rate_items (name, rate_percent)
SELECT * FROM (VALUES
  ('NSSF (employer)', 10.0::numeric),
  ('SDL', 3.5::numeric),
  ('WCF', 0.6::numeric)
) AS v(name, rate_percent)
WHERE NOT EXISTS (SELECT 1 FROM payroll_rate_items);

-- segments, cash flow categories), matching the prototype's single reusable category
-- manager pattern instead of a bespoke table per module. ----------
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('service','product','expense','purchase_order','client_segment','cashflow','supplier','task_template','branch_target')),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (type, name)
);

-- Specific selectable items within a cash flow category (e.g. category "Allowance"
-- might have items "Lunch Allowance", "Transport Fees") — a second, narrower level
-- of detail below the category itself, so a cash flow entry can record exactly what
-- it was for, not just which broad category it falls under.
CREATE TABLE IF NOT EXISTS cashflow_category_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (category, name)
);
-- Repairs an already-existing categories table from before 'supplier'/'task_template'
-- were added to the allowed list — CREATE TABLE IF NOT EXISTS above does nothing if
-- the table already exists, so without this, the seed data below fails with
-- "categories_type_check" on any database that was deployed before this change.
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_type_check;
ALTER TABLE categories ADD CONSTRAINT categories_type_check
  CHECK (type IN ('service','product','expense','purchase_order','client_segment','cashflow','supplier','task_template','branch_target'));
INSERT INTO categories (type, name) VALUES
  ('supplier','Car Wash Chemicals'), ('supplier','Car Accessories'), ('supplier','Tools & Equipment'),
  ('task_template','Deep-clean waiting area'), ('task_template','Restock chemicals'), ('task_template','Equipment maintenance check'),
  ('task_template','Renew business license'), ('task_template','File VAT return'), ('task_template','Safety inspection'),
  ('branch_target','Cars washed'), ('branch_target','Revenue'), ('branch_target','Staff lunch allowance'), ('branch_target','Customer satisfaction'),
  ('service','Car Wash'), ('service','Carpet Cleaning'), ('service','Detailing'),
  ('product','Consumable'), ('product','Retail'), ('product','Equipment'),
  ('expense','Utilities'), ('expense','Equipment'), ('expense','Rent'), ('expense','Payroll'),
  ('purchase_order','Car Wash Chemicals'), ('purchase_order','Car Accessories'), ('purchase_order','Tools & Equipment'),
  ('client_segment','VIP'), ('client_segment','Loyal Customer'), ('client_segment','Repeat Customer'),
  ('client_segment','Seasonal'), ('client_segment','One-time'), ('client_segment','Long Gone'),
  ('cashflow','Sales'), ('cashflow','Supplier Payment'), ('cashflow','Payroll'), ('cashflow','Allowance'), ('cashflow','Other')
ON CONFLICT (type, name) DO NOTHING;

INSERT INTO cashflow_category_items (category, name) VALUES
  ('Sales','Cash Sale'), ('Sales','Card Sale'), ('Sales','Mobile Money Sale'),
  ('Supplier Payment','Product Restock'), ('Supplier Payment','Equipment Purchase'),
  ('Payroll','Monthly Salary'), ('Payroll','Overtime Pay'), ('Payroll','Bonus'),
  ('Allowance','Lunch Allowance'), ('Allowance','Transport Fees'), ('Allowance','Airtime Allowance')
ON CONFLICT (category, name) DO NOTHING;

-- ---------- Purchase order catalog — pre-defined items per category, matching the
-- prototype's PO Builder (category filter → click catalog items → add to draft) ----------
CREATE TABLE IF NOT EXISTS po_catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  spec TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Custom fields (owner-defined extra fields, e.g. for customers) ----------
CREATE TABLE IF NOT EXISTS custom_field_defs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL DEFAULT 'customer' CHECK (entity_type IN ('customer','staff','booking','branch')),
  field_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE custom_field_defs DROP CONSTRAINT IF EXISTS custom_field_defs_entity_type_check;
ALTER TABLE custom_field_defs ADD CONSTRAINT custom_field_defs_entity_type_check
  CHECK (entity_type IN ('customer','staff','booking','branch'));

-- ---------- Notification preferences (built-in toggles + owner-added custom categories) ----------
CREATE TABLE IF NOT EXISTS notification_prefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT true,
  is_custom BOOLEAN DEFAULT false, -- custom categories are informational only, no automatic triggers
  created_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO notification_prefs (category, is_custom) VALUES
  ('Booking Reminders', false), ('Low-Stock Alerts', false),
  ('Compliance Deadlines', false), ('Task Reminders', false)
ON CONFLICT (category) DO NOTHING;

-- ---------- Business plan targets ----------
-- ---------- Business plan: project-level targets (a single record, editable) ----------
CREATE TABLE IF NOT EXISTS business_plan_project_targets (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  total_investment NUMERIC(16,2) DEFAULT 77797110,
  target_cars_per_week NUMERIC(10,2) DEFAULT 250,
  break_even_cars_per_week NUMERIC(10,2) DEFAULT 229.5,
  payback_years NUMERIC(5,2) DEFAULT 2,
  year1_net_profit_after_tax NUMERIC(16,2) DEFAULT 22791581,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO business_plan_project_targets (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------- Business plan: monthly operating budget line items ----------
CREATE TABLE IF NOT EXISTS budget_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO budget_lines (category, amount)
SELECT * FROM (VALUES
  ('Staff salaries & statutory contributions', 7850080::numeric),
  ('Water (DAWASA + borehole upkeep)', 600000::numeric),
  ('Electricity (TANESCO)', 1800000::numeric),
  ('Chemicals & consumables restock', 1900000::numeric),
  ('Generator diesel', 320000::numeric),
  ('Equipment maintenance & repairs', 700000::numeric),
  ('Site rent / land lease', 300000::numeric),
  ('Insurance', 300000::numeric),
  ('Marketing & promotions', 500000::numeric),
  ('Waste/sludge disposal', 200000::numeric),
  ('Admin, licence renewals & misc.', 400000::numeric)
) AS v(category, amount)
WHERE NOT EXISTS (SELECT 1 FROM budget_lines);

-- ---------- Message templates — quick-send library for Client Messages
-- (Booking reminder, Ready for pickup, Thank you, Promotion, custom event names) ----------
CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO message_templates (name, body)
SELECT * FROM (VALUES
  ('Booking reminder', 'Hi {name}, this is a reminder about your upcoming booking with Wosha. See you soon!'),
  ('Ready for pickup', 'Hi {name}, your vehicle is ready for pickup at Wosha. Thank you for your patience!'),
  ('Thank you', 'Hi {name}, thank you for choosing Wosha! We hope to see you again soon.'),
  ('Promotion', 'Hi {name}, check out our latest promotion at Wosha — ask us in-branch for details!')
) AS v(name, body)
WHERE NOT EXISTS (SELECT 1 FROM message_templates);

-- ---------- Incoming payment reconciliation — bank transfer, mobile money, or control
-- number payments logged as "expected", then confirmed (manually, or automatically via
-- a Flutterwave webhook if the business configures their own merchant credentials) —
-- confirming one creates a real income entry in cash flow automatically. ----------
CREATE TABLE IF NOT EXISTS incoming_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  method TEXT NOT NULL CHECK (method IN ('Bank Transfer','Mobile Money','Control Number')),
  reference_code TEXT,
  amount NUMERIC(14,2) NOT NULL,
  customer_id UUID REFERENCES customers(id),
  invoice_id UUID REFERENCES invoices(id),
  location_id UUID REFERENCES locations(id),
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending','Confirmed')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Supplier / vendor payments — with a receipt attachment that follows the
-- same download-then-reclaim-storage pattern as message attachments, so a paid
-- receipt's file doesn't sit taking up space forever once it's been saved elsewhere. ----------
CREATE TABLE IF NOT EXISTS supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id),
  po_id UUID REFERENCES purchase_orders(id),
  amount NUMERIC(14,2) NOT NULL,
  method TEXT,
  receipt_url TEXT,
  receipt_name TEXT,
  downloaded BOOLEAN DEFAULT false,
  downloaded_at TIMESTAMPTZ,
  saved_location_note TEXT,
  paid_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

-- ---------- Restock requests — staff can flag a product that's about to run out
-- (distinct from the automatic reorder-level/par-level alerts, since staff often
-- notice a shortage before the numbers cross a threshold) ----------
CREATE TABLE IF NOT EXISTS restock_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id),
  requested_by UUID REFERENCES users(id),
  note TEXT,
  status TEXT DEFAULT 'Open' CHECK (status IN ('Open','Fulfilled')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Quick restore point — one-tap snapshot/rollback, no file needed ----------
-- ---------- Branch targets — per-branch, per-period goals set by the owner
-- (e.g. "300 cars washed this month" for one branch), visible to that branch's
-- own manager, separate from the overall project-level targets above ----------
CREATE TABLE IF NOT EXISTS branch_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id),
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  target_value NUMERIC(14,2) NOT NULL,
  unit TEXT DEFAULT '',
  period TEXT DEFAULT 'Monthly' CHECK (period IN ('Weekly','Monthly','Quarterly','Yearly')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Payment codes — printable, scannable barcodes for a specific service,
-- product, or a custom amount. Scanning one (with any phone camera, not just Wosha's
-- own scanner) opens a public page showing exactly what's owed and how to pay it —
-- this is the real, honest version of "scan to pay": it displays the amount and the
-- business's own payment instructions (mobile money number, control number process,
-- bank details), rather than claiming to auto-charge a bank or mobile money account,
-- which no app can do without registering as a merchant with Tanzania's national
-- payment system (TIPS/Bank of Tanzania) — a real business step, same as SendGrid. ----------
CREATE TABLE IF NOT EXISTS payment_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  amount NUMERIC(14,2),
  service_id UUID REFERENCES services(id),
  product_id UUID REFERENCES products(id),
  active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Uploaded files (fallback storage) — when cloud storage (S3/R2) isn't
-- configured, uploaded files are stored here instead of on the backend's own disk.
-- This matters because Render (and most hosts) wipe the backend's local filesystem on
-- every redeploy or restart — anything saved there disappears the next time the code
-- changes. Postgres is a separate, persistent service, so anything stored here survives
-- redeploys, restarts, and time passing, with zero extra setup required. ----------
CREATE TABLE IF NOT EXISTS uploaded_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data BYTEA NOT NULL,
  mimetype TEXT,
  original_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS restore_points (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- REPAIR MIGRATIONS — bring an already-existing database fully up to date.
--
-- CREATE TABLE IF NOT EXISTS only does something on a brand-new database — if
-- the table already exists (which it will, on any database that's been
-- deployed before and is just being redeployed with newer code), it's a
-- complete no-op, even if columns or constraints were added to that table's
-- definition since. That's what caused the "categories_type_check" deploy
-- failure: 'task_template' was added to the allowed list in the CREATE TABLE
-- statement above, but on a database where `categories` already existed, that
-- change never actually applied — the old, narrower constraint stayed in
-- place and rejected the seed data.
--
-- Every ALTER below is safe to run on every single deploy, on any database,
-- old or brand new: ADD COLUMN IF NOT EXISTS does nothing if the column's
-- already there, and the constraint drop-and-recreate pattern just re-applies
-- the current rules every time, converging any existing database to the
-- exact same state as a fresh install.
-- ============================================================================

ALTER TABLE locations ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';

ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_primary_owner BOOLEAN DEFAULT false;
UPDATE users SET is_primary_owner = true
WHERE id = (SELECT id FROM users WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM users WHERE is_primary_owner = true);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS segments TEXT[] DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

ALTER TABLE products ADD COLUMN IF NOT EXISTS par_level NUMERIC(14,2) DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sellable BOOLEAN DEFAULT false;

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_terms TEXT DEFAULT 'Full payment';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_invoice_url TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_note_url TEXT;

ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS received_qty NUMERIC(14,2) DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS matched_barcode TEXT;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bill_to TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_tin TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS company_address TEXT;

ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS attachment_type TEXT;
ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS downloaded BOOLEAN DEFAULT false;
ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMPTZ;
ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS saved_location_note TEXT;

ALTER TABLE client_messages ADD COLUMN IF NOT EXISTS attachment_type TEXT;
ALTER TABLE client_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
ALTER TABLE client_messages ADD COLUMN IF NOT EXISTS downloaded BOOLEAN DEFAULT false;
ALTER TABLE client_messages ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMPTZ;
ALTER TABLE client_messages ADD COLUMN IF NOT EXISTS saved_location_note TEXT;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attachment_name TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_comment TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS logo_size TEXT DEFAULT 'md';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS tagline TEXT DEFAULT '';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS staff_attachments_enabled BOOLEAN DEFAULT true;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS client_attachments_enabled BOOLEAN DEFAULT true;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS mission TEXT DEFAULT '';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS vision TEXT DEFAULT '';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS org_structure TEXT DEFAULT '';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS loading_background_color TEXT DEFAULT '#2B6CF6';

-- ---------- Public website content management ----------
-- A single flexible column rather than a dozen narrow ones (hero override text,
-- default language, which sections are visible) — the set of "small settings for
-- the public site" will keep growing, and a JSON column means adding one more
-- doesn't need another migration every time.
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS website_content JSONB DEFAULT '{}';

CREATE TABLE IF NOT EXISTS testimonials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL,
  quote TEXT NOT NULL,
  rating INTEGER DEFAULT 5,
  photo_url TEXT,
  visible BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media_gallery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT DEFAULT '',
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image', -- 'image' | 'video'
  visible BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- One row, atomically incremented on every real website page load — a genuine
-- counter, not a number made up for marketing effect.
CREATE TABLE IF NOT EXISTS site_visit_counter (
  id INTEGER PRIMARY KEY DEFAULT 1,
  count BIGINT DEFAULT 0,
  CONSTRAINT single_row CHECK (id = 1)
);
INSERT INTO site_visit_counter (id, count) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_testimonials_visible ON testimonials(visible);
CREATE INDEX IF NOT EXISTS idx_media_gallery_visible ON media_gallery(visible);

-- ---------- Indexes for common lookups ----------
CREATE INDEX IF NOT EXISTS idx_bookings_location ON bookings(location_id);
CREATE INDEX IF NOT EXISTS idx_invoices_location ON invoices(location_id);
CREATE INDEX IF NOT EXISTS idx_products_location ON products(location_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_expenses_location ON expenses(location_id);
CREATE INDEX IF NOT EXISTS idx_po_location ON purchase_orders(location_id);
CREATE INDEX IF NOT EXISTS idx_staff_location ON staff(location_id);
CREATE INDEX IF NOT EXISTS idx_cash_entries_location ON cash_entries(location_id);
CREATE INDEX IF NOT EXISTS idx_tasks_location ON tasks(location_id);
-- Added to support date-range pagination (Bookings/Invoicing/Reports) and Job Board —
-- without these, those queries do a full table scan that gets slower as history grows.
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_technician ON bookings(technician_id);
CREATE INDEX IF NOT EXISTS idx_manual_jobs_location ON manual_jobs(location_id);
CREATE INDEX IF NOT EXISTS idx_manual_jobs_technician ON manual_jobs(technician_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
