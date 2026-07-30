import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// ---- Tasks ----
router.get("/tasks", requireAuth, async (req, res) => {
  const { locationId } = req.query;
  const params = [];
  let where = "";
  if (locationId && locationId !== "all") { params.push(locationId); where = "WHERE t.location_id = $1"; }
  const { rows } = await pool.query(`
    SELECT t.*, s.name AS assigned_to_name FROM tasks t
    LEFT JOIN staff s ON s.id = t.assigned_to
    ${where} ORDER BY t.due_date NULLS LAST
  `, params);
  res.json(rows);
});

router.post("/tasks", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { locationId, title, assignedTo, dueDate } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO tasks (location_id, title, assigned_to, due_date) VALUES ($1,$2,$3,$4) RETURNING *",
    [locationId, title, assignedTo, dueDate]
  );
  res.status(201).json(rows[0]);
});

router.patch("/tasks/:id/status", requireAuth, async (req, res) => {
  const { status } = req.body;
  const { rows } = await pool.query("UPDATE tasks SET status = $1 WHERE id = $2 RETURNING *", [status, req.params.id]);
  res.json(rows[0]);
});

// ---- Compliance / tax deadlines ----
router.get("/tax-items", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM tax_items ORDER BY due_date");
  res.json(rows);
});

router.post("/tax-items", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, dueDate, recurrence } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO tax_items (name, due_date, recurrence) VALUES ($1,$2,$3) RETURNING *",
    [name, dueDate, recurrence || "monthly"]
  );
  res.status(201).json(rows[0]);
});

router.patch("/tax-items/:id/file", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { rows } = await pool.query("UPDATE tax_items SET status = 'Filed' WHERE id = $1 RETURNING *", [req.params.id]);
  res.json(rows[0]);
});

export default router;
