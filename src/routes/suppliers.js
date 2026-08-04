import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM suppliers ORDER BY name");
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, contact, email, category, capacity, criteria, leadTime, shortlisted } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO suppliers (name, contact, email, category, capacity, criteria, lead_time, shortlisted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [name, contact, email, category, capacity, criteria, leadTime, !!shortlisted]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const f = req.body;
  const { rows } = await pool.query(
    `UPDATE suppliers SET name=COALESCE($1,name), contact=COALESCE($2,contact), email=COALESCE($3,email),
     category=COALESCE($4,category), capacity=COALESCE($5,capacity), criteria=COALESCE($6,criteria),
     lead_time=COALESCE($7,lead_time), shortlisted=COALESCE($8,shortlisted) WHERE id=$9 RETURNING *`,
    [f.name, f.contact, f.email, f.category, f.capacity, f.criteria, f.leadTime, f.shortlisted, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Supplier not found." });
  res.json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM suppliers WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
