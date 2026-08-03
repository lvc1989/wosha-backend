import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM payroll_rate_items ORDER BY created_at");
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, ratePercent } = req.body;
  if (!name?.trim() || ratePercent == null) return res.status(400).json({ error: "Name and rate % are required." });
  const { rows } = await pool.query("INSERT INTO payroll_rate_items (name, rate_percent) VALUES ($1,$2) RETURNING *", [name.trim(), ratePercent]);
  res.status(201).json(rows[0]);
});

router.put("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, ratePercent, enabled } = req.body;
  const { rows } = await pool.query(
    "UPDATE payroll_rate_items SET name = COALESCE($1,name), rate_percent = COALESCE($2,rate_percent), enabled = COALESCE($3,enabled) WHERE id = $4 RETURNING *",
    [name, ratePercent, enabled, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Rate item not found." });
  res.json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM payroll_rate_items WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
