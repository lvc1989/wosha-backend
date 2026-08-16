import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/entries", requireAuth, async (req, res) => {
  const { locationId } = req.query;
  const params = [];
  let where = "";
  if (locationId && locationId !== "all") { params.push(locationId); where = "WHERE location_id = $1"; }
  const { rows } = await pool.query(`SELECT * FROM cash_entries ${where} ORDER BY entry_date DESC`, params);
  res.json(rows);
});

router.post("/entries", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { locationId, category, item, direction, amount, note, entryDate } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO cash_entries (location_id, category, item, direction, amount, note, entry_date)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,CURRENT_DATE)) RETURNING *`,
    [locationId, category, item || null, direction, amount, note, entryDate]
  );
  res.status(201).json(rows[0]);
});

// The specific selectable items within a cash flow category (e.g. "Allowance" ->
// "Lunch Allowance", "Transport Fees") — a second, narrower list below the category
// itself, so an entry can record exactly what it was for.
router.get("/items", requireAuth, async (req, res) => {
  const { category } = req.query;
  const params = [];
  let where = "";
  if (category) { params.push(category); where = "WHERE category = $1"; }
  const { rows } = await pool.query(`SELECT * FROM cashflow_category_items ${where} ORDER BY name`, params);
  res.json(rows);
});

router.post("/items", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { category, name } = req.body;
  if (!category?.trim() || !name?.trim()) return res.status(400).json({ error: "A category and item name are both required." });
  const { rows } = await pool.query(
    "INSERT INTO cashflow_category_items (category, name) VALUES ($1,$2) ON CONFLICT (category, name) DO UPDATE SET name = EXCLUDED.name RETURNING *",
    [category.trim(), name.trim()]
  );
  res.status(201).json(rows[0]);
});

// A real combined cash flow summary per branch — invoices paid in, expenses + manual entries out,
// so this reflects actual money movement rather than requiring everything to be entered twice.
router.get("/summary", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      l.id AS location_id, l.name,
      COALESCE((SELECT SUM(paid) FROM invoices WHERE location_id = l.id), 0)
        + COALESCE((SELECT SUM(amount) FROM cash_entries WHERE location_id = l.id AND direction = 'in'), 0) AS cash_in,
      COALESCE((SELECT SUM(amount) FROM expenses WHERE location_id = l.id AND status = 'Approved'), 0)
        + COALESCE((SELECT SUM(amount) FROM cash_entries WHERE location_id = l.id AND direction = 'out'), 0) AS cash_out
    FROM locations l
  `);
  res.json(rows.map((r) => ({ ...r, net: Number(r.cash_in) - Number(r.cash_out) })));
});

export default router;
