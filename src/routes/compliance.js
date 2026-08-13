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
    SELECT t.*, s.name AS assigned_to_name, u.name AS reviewed_by_name FROM tasks t
    LEFT JOIN staff s ON s.id = t.assigned_to
    LEFT JOIN users u ON u.id = t.reviewed_by
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

// Staff moves a task to "In Progress" — no attachment needed yet, just a status change
router.patch("/tasks/:id/status", requireAuth, async (req, res) => {
  const { status } = req.body;
  if (!["Open", "In Progress"].includes(status)) return res.status(400).json({ error: "Use /submit to finish a task, not this endpoint." });
  const { rows } = await pool.query("UPDATE tasks SET status = $1 WHERE id = $2 RETURNING *", [status, req.params.id]);
  res.json(rows[0]);
});

// The assignee submits their finished work — attaches the completed form/document,
// moves the task to "Submitted" for the manager/owner to actually check, rather than
// just trusting a "Done" checkbox with nothing behind it.
router.patch("/tasks/:id/submit", requireAuth, async (req, res) => {
  const { attachmentUrl, attachmentName } = req.body;
  const { rows } = await pool.query(
    "UPDATE tasks SET status = 'Submitted', attachment_url = $1, attachment_name = $2, submitted_at = now() WHERE id = $3 RETURNING *",
    [attachmentUrl, attachmentName, req.params.id]
  );
  res.json(rows[0]);
});

// Owner/manager reviews the submission — approve marks it genuinely Done, reject sends
// it back with a required comment explaining what needs fixing.
router.patch("/tasks/:id/review", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { approved, comment } = req.body;
  if (!approved && !comment?.trim()) return res.status(400).json({ error: "A comment is required when rejecting a task." });
  const { rows } = await pool.query(
    "UPDATE tasks SET status = $1, review_comment = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $4 RETURNING *",
    [approved ? "Done" : "Rejected", comment || null, req.user.id, req.params.id]
  );
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
