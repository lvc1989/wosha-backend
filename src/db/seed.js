import bcrypt from "bcryptjs";
import { pool } from "./pool.js";

// This mirrors the exact demo data the original prototype shipped with — same staff
// names, same customers, same service menu and prices, same product catalog — so the
// real app starts populated instead of empty. Safe to run more than once: it checks
// for the seed marker (the "owner" username) and skips everything if already seeded.

async function seed() {
  // Your first deploy already created a bare "owner"/"Main Branch" starter pair via
  // migrate.js — this checks for something unique to the FULL seed instead, so it
  // won't be blocked by that, and cleans up the bare placeholder data first so you
  // don't end up with both "Main Branch" and "Mbeya Central" sitting there together.
  const alreadyRich = await pool.query("SELECT id FROM users WHERE username = 'mgr.dar'");
  if (alreadyRich.rows.length) {
    console.log("Already fully seeded — skipping. Delete the 'mgr.dar' account first if you want to reseed.");
    await pool.end();
    return;
  }

  const bareOwner = await pool.query("SELECT id FROM users WHERE username = 'owner' AND name = 'Owner'");
  const bareLoc = await pool.query("SELECT id FROM locations WHERE name = 'Main Branch'");
  if (bareOwner.rows.length) {
    try {
      await pool.query("DELETE FROM users WHERE id = $1", [bareOwner.rows[0].id]);
    } catch {
      console.log("The bare 'owner' account has real activity attached — leaving it as-is (the richer 'Amani Mushi' owner profile will be skipped to avoid a username clash).");
    }
  }
  if (bareLoc.rows.length) {
      // Safety check: only remove "Main Branch" if nothing real has been recorded against it yet.
      // If you've already been using the live app, this leaves it alone rather than risk deleting anything real —
      // you'd just have an extra empty branch, easy to remove yourself from the Staff/Branches page later.
      const locId = bareLoc.rows[0].id;
      const counts = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM staff WHERE location_id = $1) +
          (SELECT COUNT(*) FROM bookings WHERE location_id = $1) +
          (SELECT COUNT(*) FROM products WHERE location_id = $1) +
          (SELECT COUNT(*) FROM expenses WHERE location_id = $1) AS total
      `, [locId]);
      if (Number(counts.rows[0].total) === 0) {
        await pool.query("DELETE FROM locations WHERE id = $1", [locId]);
      } else {
        console.log("'Main Branch' has real data attached — leaving it in place rather than risk deleting anything.");
      }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ---- Branches ----
    const locRows = {};
    for (const [key, name, color] of [
      ["mbeya", "Mbeya Central", "#2B6CF6"],
      ["dar", "Dar — Masaki", "#FFC93C"],
      ["arusha", "Arusha North", "#6D5AE0"],
    ]) {
      const { rows } = await client.query("INSERT INTO locations (name, color) VALUES ($1,$2) RETURNING id", [name, color]);
      locRows[key] = rows[0].id;
    }

    // ---- Services ----
    const svcRows = {};
    const services = [
      ["s1", "Basic Exterior Wash", "Car Wash", 10000, 20],
      ["s2", "Full Wash (Ext + Int + Vacuum)", "Car Wash", 15000, 35],
      ["s2b", "Premium Wash (Wash + Wax + Polish + Tyre)", "Car Wash", 25000, 50],
      ["s3", "Interior Carpet Shampoo (per vehicle)", "Carpet Cleaning", 35000, 60],
      ["s4", "Home/Office Carpet Cleaning (per room)", "Carpet Cleaning", 25000, 45],
      ["s5", "Full Detail Package", "Detailing", 90000, 150],
      ["s6", "Ceramic Coating", "Detailing", 350000, 300],
      ["s7", "Engine Bay Clean", "Detailing", 18000, 30],
    ];
    for (const [key, name, category, price, duration] of services) {
      const { rows } = await client.query(
        "INSERT INTO services (name, category, price, duration_min) VALUES ($1,$2,$3,$4) RETURNING id",
        [name, category, price, duration]
      );
      svcRows[key] = rows[0].id;
    }

    // ---- Staff ----
    const staffRows = {};
    const staff = [
      ["t1", "Juma Mwakalinga", "Technician", "mbeya", ["Detailing", "Ceramic Coating"], 420000],
      ["t2", "Grace Kileo", "Technician", "mbeya", ["Car Wash", "Carpet Cleaning"], 380000],
      ["t3", "Ibrahim Suleiman", "Branch Manager", "dar", ["Detailing"], 1100000],
      ["t4", "Neema Massawe", "Technician", "dar", ["Car Wash"], 380000],
      ["t5", "Elia Mollel", "Technician", "arusha", ["Carpet Cleaning", "Detailing"], 380000],
      ["t6", "(Vacant) Supervisor / Cashier", "Supervisor / Cashier", "dar", ["Cash handling"], 550000],
      ["t7", "(Vacant) Bay Attendant", "Bay Attendant / Washer", "dar", ["Car Wash"], 380000],
      ["t8", "(Vacant) Detailing Specialist", "Detailing & Vacuum Specialist", "dar", ["Detailing"], 420000],
      ["t9", "(Vacant) Security Guard", "Security Guard", "dar", ["Security"], 380000],
    ];
    for (const [key, name, role, locKey, skills, salary] of staff) {
      const { rows } = await client.query(
        "INSERT INTO staff (name, role, location_id, skills, salary) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [name, role, locRows[locKey], skills, salary]
      );
      staffRows[key] = rows[0].id;
    }

    // ---- Customers + vehicles ----
    const custRows = {};
    const customers = [
      ["c1", "Happiness Mtei", "+255 754 112 233", "VIP", [["T 123 ABC", "Toyota", "Land Cruiser", "White"]]],
      ["c2", "Kelvin Nkya", "+255 713 890 210", "Fleet", [["T 456 DEF", "Toyota", "Hiace", "Silver"], ["T 457 DEF", "Toyota", "Hiace", "Silver"]]],
      ["c3", "Amina Ramadhani", "+255 767 004 511", "First-time", [["T 789 GHI", "Subaru", "Forester", "Blue"]]],
    ];
    for (const [key, name, phone, tag, vehicles] of customers) {
      const { rows } = await client.query("INSERT INTO customers (name, phone, tag) VALUES ($1,$2,$3) RETURNING id", [name, phone, tag]);
      custRows[key] = rows[0].id;
      for (const [plate, make, model, color] of vehicles) {
        await client.query("INSERT INTO vehicles (customer_id, plate, make, model, color) VALUES ($1,$2,$3,$4,$5)", [rows[0].id, plate, make, model, color]);
      }
    }

    // ---- Products ----
    const products = [
      ["dar", "Car Shampoo Concentrate (20L drum)", "Consumable", "drum", 3, 2, 8, "6001234500017", 180000, 0, false],
      ["dar", "Foam Wash Concentrate (20L drum)", "Consumable", "drum", 3, 2, 8, "6001234500024", 210000, 0, false],
      ["dar", "Tyre Shine / Dressing (5L)", "Consumable", "bottle", 6, 3, 12, "6001234500031", 45000, 0, false],
      ["dar", "Wax / Polish Compound (5kg)", "Consumable", "tub", 4, 2, 10, "6001234500048", 25000, 0, false],
      ["dar", "Air Freshener (assorted scents)", "Retail", "pcs", 30, 10, 40, "6001234500055", 3500, 6000, true],
      ["dar", "Microfiber Towel", "Retail", "pcs", 50, 15, 60, "6001234500062", 6000, 10000, true],
    ];
    for (const [locKey, name, category, unit, qty, reorder, par, barcode, cost, sell, sellable] of products) {
      await client.query(
        `INSERT INTO products (location_id, name, category, unit, qty, reorder_level, par_level, barcode, cost_price, sell_price, sellable)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [locRows[locKey], name, category, unit, qty, reorder, par, barcode, cost, sell, sellable]
      );
    }

    // ---- Suppliers ----
    await client.query(
      `INSERT INTO suppliers (name, contact, email, category, capacity, criteria, lead_time, shortlisted) VALUES
       ($1,$2,$3,$4,$5,$6,$7,true), ($8,$9,$10,$11,$12,$13,$14,true)`,
      [
        "CleanPro Chemicals Ltd", "+255 22 211 4090", "sales@cleanprochemicals.co.tz", "Car Wash Chemicals", "Bulk — 500L+/month", "ISO-certified, consistent stock, competitive pricing", "3 days",
        "Detail Supplies TZ", "+255 22 277 6621", "orders@detailsuppliestz.com", "Car Accessories", "Medium — retail + wholesale", "Wide product range, reliable delivery", "5 days",
      ]
    );

    // ---- Expenses ----
    await client.query(
      `INSERT INTO expenses (location_id, category, amount, note, status, expense_date) VALUES
       ($1,'Utilities',85000,'Water & electricity','Approved','2026-07-20'),
       ($2,'Equipment',210000,'Pressure washer repair','Approved','2026-07-22')`,
      [locRows.mbeya, locRows.dar]
    );

    // ---- Bookings + linked services ----
    const bookings = [
      ["mbeya", "c1", "T 123 ABC", "t1", "09:00", "In Progress", ["s5"]],
      ["mbeya", "c3", "T 789 GHI", "t2", "10:30", "Confirmed", ["s2"]],
      ["dar", "c2", "T 456 DEF", "t4", "08:30", "Completed", ["s2", "s3"]],
      ["arusha", "c2", "T 457 DEF", "t5", "11:00", "Requested", ["s4"]],
    ];
    let firstCompletedBookingId = null;
    for (const [locKey, custKey, plate, staffKey, time, status, svcKeys] of bookings) {
      const { rows } = await client.query(
        "INSERT INTO bookings (location_id, customer_id, reference_note, technician_id, scheduled_time, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [locRows[locKey], custRows[custKey], plate, staffRows[staffKey], time, status]
      );
      for (const svcKey of svcKeys) {
        await client.query("INSERT INTO booking_services (booking_id, service_id) VALUES ($1,$2)", [rows[0].id, svcRows[svcKey]]);
      }
      if (status === "Completed" && !firstCompletedBookingId) firstCompletedBookingId = rows[0].id;
    }

    // ---- One paid invoice, matching the completed booking ----
    if (firstCompletedBookingId) {
      const { rows } = await client.query(
        `INSERT INTO invoices (booking_id, location_id, subtotal, total, paid, status, control_number)
         VALUES ($1,$2,55000,55000,55000,'Paid',$3) RETURNING id`,
        [firstCompletedBookingId, locRows.dar, "99" + Math.floor(1000000000 + Math.random() * 8999999999)]
      );
      await client.query("INSERT INTO invoice_items (invoice_id, name, rate, qty, amount) VALUES ($1,'Full Wash (Ext + Int + Vacuum)',15000,1,15000), ($1,'Interior Carpet Shampoo (per vehicle)',35000,1,35000)", [rows[0].id]);
    }

    // Business plan project targets and the monthly operating budget are seeded
    // automatically by schema.sql itself now, with the real figures from the original
    // business plan — no manual seeding needed here.

    // ---- A couple of real compliance deadlines to start with ----
    await client.query(
      `INSERT INTO tax_items (name, due_date, recurrence) VALUES
       ('VAT Return', (CURRENT_DATE + interval '10 days')::date, 'monthly'),
       ('Skills Dev. Levy (SDL)', (CURRENT_DATE + interval '15 days')::date, 'monthly')`
    );

    // ---- Login accounts — passwords hashed for real, never stored in plain text ----
    const users = [
      ["Amani Mushi", "owner", "owner123", "owner", null, null],
      ["Ibrahim Suleiman", "mgr.dar", "mgr123", "manager", locRows.dar, null],
      ["Grace Kileo", "staff.mbeya", "staff123", "staff", locRows.mbeya, null],
      ["Happiness Mtei", "happiness", "client123", "client", null, custRows.c1],
    ];
    for (const [name, username, password, role, locationId, customerId] of users) {
      const conflict = await client.query("SELECT id FROM users WHERE username = $1", [username]);
      if (conflict.rows.length) {
        console.log(`Skipping "${username}" — that username already exists.`);
        continue;
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const { rows } = await client.query(
        "INSERT INTO users (name, username, password_hash, role, location_id, is_primary_owner) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [name, username, passwordHash, role, locationId, role === "owner"]
      );
      if (customerId) await client.query("UPDATE customers SET user_id = $1 WHERE id = $2", [rows[0].id, customerId]);
    }

    await client.query("COMMIT");
    console.log("Seed complete. Logins:");
    console.log("  owner / owner123        (Owner — sees everything)");
    console.log("  mgr.dar / mgr123        (Manager — Dar — Masaki)");
    console.log("  staff.mbeya / staff123  (Staff — Mbeya Central)");
    console.log("  happiness / client123   (Client — Happiness Mtei)");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
