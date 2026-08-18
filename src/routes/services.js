import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// Public — lets the guest booking form show the price list without requiring login.
router.get("/public", async (req, res) => {
  const { rows } = await pool.query("SELECT id, name, category, price, duration_min FROM services WHERE active = true ORDER BY category, name");
  res.json(rows);
});

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM services WHERE active = true ORDER BY category, name");
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, category, price, durationMin, iconUrl } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO services (name, category, price, duration_min, icon_url) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [name, category, price, durationMin || 30, iconUrl || null]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, category, price, durationMin, iconUrl } = req.body;
  const { rows } = await pool.query(
    `UPDATE services SET name = COALESCE($1,name), category = COALESCE($2,category),
     price = COALESCE($3,price), duration_min = COALESCE($4,duration_min),
     icon_url = CASE WHEN $6 = '' THEN NULL WHEN $6 IS NOT NULL THEN $6 ELSE icon_url END
     WHERE id = $5 RETURNING *`,
    [name, category, price, durationMin, req.params.id, iconUrl]
  );
  if (!rows[0]) return res.status(404).json({ error: "Service not found." });
  res.json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("UPDATE services SET active = false WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
