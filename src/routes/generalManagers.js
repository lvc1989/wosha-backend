import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { requireAuth, requirePrimaryOwner } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, requirePrimaryOwner, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, username, email, phone, active, created_at FROM users WHERE role = 'owner' AND is_primary_owner = false ORDER BY created_at"
  );
  res.json(rows);
});

router.post("/", requireAuth, requirePrimaryOwner, async (req, res) => {
  const { name, username, password, email, phone } = req.body;
  if (!name || !username || !password) return res.status(400).json({ error: "Name, username, and password are required." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const existing = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
  if (existing.rows.length) return res.status(409).json({ error: "That username is taken." });

  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (name, username, email, phone, password_hash, role, title, is_primary_owner)
     VALUES ($1,$2,$3,$4,$5,'owner','General Manager', false) RETURNING id, name, username`,
    [name, username, email, phone, passwordHash]
  );
  res.status(201).json(rows[0]);
});

router.patch("/:id/deactivate", requireAuth, requirePrimaryOwner, async (req, res) => {
  await pool.query("UPDATE users SET active = false WHERE id = $1 AND role = 'owner' AND is_primary_owner = false", [req.params.id]);
  res.json({ ok: true });
});

router.patch("/:id/reactivate", requireAuth, requirePrimaryOwner, async (req, res) => {
  await pool.query("UPDATE users SET active = true WHERE id = $1 AND role = 'owner' AND is_primary_owner = false", [req.params.id]);
  res.json({ ok: true });
});

router.delete("/:id", requireAuth, requirePrimaryOwner, async (req, res) => {
  await pool.query("DELETE FROM users WHERE id = $1 AND role = 'owner' AND is_primary_owner = false", [req.params.id]);
  res.json({ ok: true });
});

export default router;
