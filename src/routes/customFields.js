import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { entityType } = req.query;
  const params = entityType ? [entityType] : [];
  const { rows } = await pool.query(`SELECT * FROM custom_field_defs ${entityType ? "WHERE entity_type = $1" : ""} ORDER BY created_at`, params);
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner"), async (req, res) => {
  const { entityType, fieldName } = req.body;
  if (!fieldName?.trim()) return res.status(400).json({ error: "Field name is required." });
  const { rows } = await pool.query(
    "INSERT INTO custom_field_defs (entity_type, field_name) VALUES ($1,$2) RETURNING *",
    [entityType || "customer", fieldName.trim()]
  );
  res.status(201).json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner"), async (req, res) => {
  await pool.query("DELETE FROM custom_field_defs WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
