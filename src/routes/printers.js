import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM printer_profiles ORDER BY created_at");
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, type, paperSize, isDefault } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (isDefault) await client.query("UPDATE printer_profiles SET is_default = false");
    const { rows } = await client.query(
      "INSERT INTO printer_profiles (name, type, paper_size, is_default) VALUES ($1,$2,$3,$4) RETURNING *",
      [name, type || "Thermal", paperSize || "80mm", !!isDefault]
    );
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Couldn't add printer profile." });
  } finally {
    client.release();
  }
});

router.patch("/:id/set-default", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE printer_profiles SET is_default = false");
    const { rows } = await client.query("UPDATE printer_profiles SET is_default = true WHERE id = $1 RETURNING *", [req.params.id]);
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Couldn't set default printer." });
  } finally {
    client.release();
  }
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM printer_profiles WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
