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
  const { locationId, category, direction, amount, note, entryDate } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO cash_entries (location_id, category, direction, amount, note, entry_date)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE)) RETURNING *`,
    [locationId, category, direction, amount, note, entryDate]
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
