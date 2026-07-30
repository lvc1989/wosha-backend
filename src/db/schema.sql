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
    CHECK (status IN ('Requested','Confirmed','Checked-in','In Progress','Completed','Paid','Closed')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking_services (
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id),
  PRIMARY KEY (booking_id, service_id)
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
  rate NUMERIC(14,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS po_negotiation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Messaging ----------
CREATE TABLE IF NOT EXISTS team_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL, -- 'all' or a location_id
  sender_id UUID REFERENCES users(id),
  text TEXT,
  attachment_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  sender TEXT NOT NULL CHECK (sender IN ('staff','customer')),
  text TEXT,
  attachment_url TEXT,
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
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount NUMERIC(14,2) NOT NULL,
  note TEXT,
  entry_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Tasks & Compliance ----------
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES locations(id),
  title TEXT NOT NULL,
  assigned_to UUID REFERENCES staff(id),
  due_date DATE,
  status TEXT DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Done')),
  created_at TIMESTAMPTZ DEFAULT now()
);

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

-- ---------- Business plan targets ----------
CREATE TABLE IF NOT EXISTS business_plan_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,         -- e.g. "Monthly revenue target"
  category TEXT DEFAULT 'Revenue',
  target_amount NUMERIC(14,2) NOT NULL,
  period TEXT DEFAULT 'monthly',
  created_at TIMESTAMPTZ DEFAULT now()
);

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
