import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM notification_prefs ORDER BY is_custom, created_at");
  res.json(rows);
});

router.patch("/:id/toggle", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { rows } = await pool.query("UPDATE notification_prefs SET enabled = NOT enabled WHERE id = $1 RETURNING *", [req.params.id]);
  res.json(rows[0]);
});

// Custom categories are informational only — no automatic triggers, clearly separate from the
// 4 built-in ones that actually drive the reminders feed. Matches the original prototype's behavior.
router.post("/custom", requireAuth, requireRole("owner"), async (req, res) => {
  const { category } = req.body;
  if (!category?.trim()) return res.status(400).json({ error: "Category name is required." });
  const { rows } = await pool.query("INSERT INTO notification_prefs (category, is_custom) VALUES ($1, true) RETURNING *", [category.trim()]);
  res.status(201).json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner"), async (req, res) => {
  await pool.query("DELETE FROM notification_prefs WHERE id = $1 AND is_custom = true", [req.params.id]);
  res.json({ ok: true });
});

export default router;
