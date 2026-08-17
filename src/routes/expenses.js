import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { locationId, from, to } = req.query;
  const conditions = [];
  const params = [];
  if (locationId && locationId !== "all") { params.push(locationId); conditions.push(`e.location_id = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`e.expense_date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`e.expense_date <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(`
    SELECT e.*, s.name AS supplier_name
    FROM expenses e
    LEFT JOIN purchase_orders po ON po.id = e.purchase_order_id
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    ${where} ORDER BY e.expense_date DESC
  `, params);
  res.json(rows);
});

router.post("/", requireAuth, async (req, res) => {
  const { locationId, category, amount, note, expenseDate, purchaseOrderId } = req.body;
  // Staff submissions need approval; owner/manager submissions are auto-approved.
  const status = ["owner", "manager"].includes(req.user.role) ? "Approved" : "Pending Approval";
  const { rows } = await pool.query(
    `INSERT INTO expenses (location_id, category, amount, note, status, submitted_by, expense_date, purchase_order_id)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,CURRENT_DATE),$8) RETURNING *`,
    [locationId, category, amount, note, status, req.user.id, expenseDate, purchaseOrderId || null]
  );
  res.status(201).json(rows[0]);
});

router.patch("/:id/decision", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { status } = req.body; // 'Approved' or 'Rejected'
  const { rows } = await pool.query("UPDATE expenses SET status = $1 WHERE id = $2 RETURNING *", [status, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Expense not found." });
  res.json(rows[0]);
});

export default router;
