import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM message_templates ORDER BY created_at");
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, body } = req.body;
  if (!name?.trim() || !body?.trim()) return res.status(400).json({ error: "Name and message body are required." });
  const { rows } = await pool.query("INSERT INTO message_templates (name, body) VALUES ($1,$2) RETURNING *", [name.trim(), body.trim()]);
  res.status(201).json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM message_templates WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
