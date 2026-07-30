import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM locations ORDER BY created_at");
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner"), async (req, res) => {
  const { name, color, customData } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO locations (name, color, custom_data) VALUES ($1,$2,$3) RETURNING *",
    [name, color || "#2B6CF6", customData || {}]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireAuth, requireRole("owner"), async (req, res) => {
  const { name, customData } = req.body;
  const { rows } = await pool.query(
    "UPDATE locations SET name = COALESCE($1, name), custom_data = COALESCE($2, custom_data) WHERE id = $3 RETURNING *",
    [name, customData, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Branch not found." });
  res.json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner"), async (req, res) => {
  await pool.query("DELETE FROM locations WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
