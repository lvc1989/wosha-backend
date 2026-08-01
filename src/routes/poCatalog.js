import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM po_catalog_items ORDER BY category, name");
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { category, name, spec } = req.body;
  if (!category?.trim() || !name?.trim()) return res.status(400).json({ error: "Category and item name are required." });
  const { rows } = await pool.query("INSERT INTO po_catalog_items (category, name, spec) VALUES ($1,$2,$3) RETURNING *", [category.trim(), name.trim(), spec || ""]);
  res.status(201).json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM po_catalog_items WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
