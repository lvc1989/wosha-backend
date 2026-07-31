import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM staff ORDER BY name");
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, role, locationId, salary, skills } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO staff (name, role, location_id, salary, skills) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [name, role, locationId, salary || 0, skills || []]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, role, salary, skills, active } = req.body;
  const { rows } = await pool.query(
    `UPDATE staff SET name = COALESCE($1,name), role = COALESCE($2,role), salary = COALESCE($3,salary),
     skills = COALESCE($4,skills), active = COALESCE($5,active) WHERE id = $6 RETURNING *`,
    [name, role, salary, skills, active, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Staff member not found." });
  res.json(rows[0]);
});

// Permanent removal — distinct from deactivating (active = false)
router.delete("/:id", requireAuth, requireRole("owner"), async (req, res) => {
  await pool.query("DELETE FROM staff WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
