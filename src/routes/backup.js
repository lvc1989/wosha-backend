import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// Every table that holds real business data — deliberately excludes nothing except
// password hashes, which are stripped out of the users table specifically below.
const TABLES = [
  "locations", "users", "customers", "vehicles", "services", "staff", "bookings", "booking_services",
  "invoices", "invoice_items", "products", "expenses", "suppliers", "purchase_orders", "purchase_order_items",
  "po_negotiation_notes", "po_quotation_requests", "po_catalog_items", "tasks", "tax_items", "promotions",
  "cash_entries", "team_messages", "client_messages", "categories", "custom_field_defs", "notification_prefs",
  "attachment_permissions", "business_settings", "business_plan_project_targets", "budget_lines",
  "payroll_rate_items", "manual_jobs", "printer_profiles",
];

async function dumpAllTables() {
  const dump = {};
  for (const table of TABLES) {
    try {
      const { rows } = await pool.query(`SELECT * FROM ${table}`);
      // Never let password hashes leave the server, even in an owner-triggered export.
      dump[table] = table === "users" ? rows.map(({ password_hash, ...rest }) => rest) : rows;
    } catch {
      dump[table] = []; // table doesn't exist in this deployment yet — safe to skip
    }
  }
  return dump;
}

router.get("/export", requireAuth, requireRole("owner"), async (req, res) => {
  const dump = await dumpAllTables();
  res.setHeader("Content-Disposition", `attachment; filename="wosha-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exportedAt: new Date().toISOString(), tables: dump });
});

// Restoring from an uploaded file replaces table contents — this is a real, destructive
// action, so it's owner-only and requires the person to explicitly pick a file first.
router.post("/restore", requireAuth, requireRole("owner"), async (req, res) => {
  const { tables } = req.body;
  if (!tables) return res.status(400).json({ error: "No backup data provided." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Login accounts are deliberately never touched by restore — the export never
    // contains password hashes (by design, so a backup file can't leak credentials),
    // so re-inserting those rows isn't possible without either breaking the login
    // system or reintroducing the exact risk the export was built to avoid.
    const restorableTables = TABLES.filter((t) => t !== "users");
    for (const table of [...restorableTables].reverse()) {
      if (tables[table]) await client.query(`DELETE FROM ${table}`);
    }
    for (const table of restorableTables) {
      const rows = tables[table];
      if (!rows?.length) continue;
      const columns = Object.keys(rows[0]);
      for (const row of rows) {
        const values = columns.map((c) => row[c]);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(",");
        await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
      }
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Restore failed — no changes were made." });
  } finally {
    client.release();
  }
});

// Quick restore point: same export/import machinery, just stored on the server itself
// so there's no file to manage — one tap to snapshot, one tap to roll back.
router.post("/quick-point", requireAuth, requireRole("owner"), async (req, res) => {
  const dump = await dumpAllTables();
  await pool.query(
    `INSERT INTO restore_points (id, snapshot) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET snapshot = $1, created_at = now()`,
    [JSON.stringify(dump)]
  );
  res.json({ ok: true });
});

router.get("/quick-point", requireAuth, requireRole("owner"), async (req, res) => {
  const { rows } = await pool.query("SELECT created_at FROM restore_points WHERE id = 1");
  res.json({ exists: !!rows[0], savedAt: rows[0]?.created_at });
});

router.post("/quick-point/restore", requireAuth, requireRole("owner"), async (req, res) => {
  const { rows } = await pool.query("SELECT snapshot FROM restore_points WHERE id = 1");
  if (!rows[0]) return res.status(404).json({ error: "No restore point has been saved yet." });
  const tables = rows[0].snapshot;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const restorableTables = TABLES.filter((t) => t !== "users");
    for (const table of [...restorableTables].reverse()) {
      if (tables[table]) await client.query(`DELETE FROM ${table}`);
    }
    for (const table of restorableTables) {
      const dataRows = tables[table];
      if (!dataRows?.length) continue;
      const columns = Object.keys(dataRows[0]);
      for (const row of dataRows) {
        const values = columns.map((c) => row[c]);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(",");
        await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
      }
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Restore failed — no changes were made." });
  } finally {
    client.release();
  }
});

export default router;
