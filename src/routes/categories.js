import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { type } = req.query;
  const params = type ? [type] : [];
  const { rows } = await pool.query(`SELECT * FROM categories ${type ? "WHERE type = $1" : ""} ORDER BY name`, params);
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { type, name } = req.body;
  if (!type || !name?.trim()) return res.status(400).json({ error: "Type and name are required." });
  try {
    const { rows } = await pool.query("INSERT INTO categories (type, name) VALUES ($1,$2) RETURNING *", [type, name.trim()]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "That category already exists." });
    throw err;
  }
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM categories WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
