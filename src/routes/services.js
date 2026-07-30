import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM services WHERE active = true ORDER BY category, name");
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, category, price, durationMin } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO services (name, category, price, duration_min) VALUES ($1,$2,$3,$4) RETURNING *",
    [name, category, price, durationMin || 30]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, category, price, durationMin } = req.body;
  const { rows } = await pool.query(
    `UPDATE services SET name = COALESCE($1,name), category = COALESCE($2,category),
     price = COALESCE($3,price), duration_min = COALESCE($4,duration_min) WHERE id = $5 RETURNING *`,
    [name, category, price, durationMin, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Service not found." });
  res.json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("UPDATE services SET active = false WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
