import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole, requirePrimaryOwner } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT s.*, u.username AS login_username, u.active AS login_active
    FROM staff s LEFT JOIN users u ON u.id = s.user_id
    ORDER BY s.name
  `);
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, role, locationId, salary, skills, username, password } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let userId = null;

    if (username && password) {
      if (password.length < 8) throw Object.assign(new Error("Password must be at least 8 characters."), { status: 400 });
      const existing = await client.query("SELECT id FROM users WHERE username = $1", [username]);
      if (existing.rows.length) throw Object.assign(new Error("That username is taken."), { status: 409 });
      const passwordHash = await bcrypt.hash(password, 10);
      const userResult = await client.query(
        "INSERT INTO users (name, username, password_hash, role, location_id) VALUES ($1,$2,$3,'staff',$4) RETURNING id",
        [name, username, passwordHash, locationId]
      );
      userId = userResult.rows[0].id;
    }

    const { rows } = await client.query(
      "INSERT INTO staff (user_id, name, role, location_id, salary, skills) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [userId, name, role, locationId, salary || 0, skills || []]
    );
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(err.status || 500).json({ error: err.status ? err.message : "Couldn't add staff member." });
  } finally {
    client.release();
  }
});

router.put("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, role, salary, skills, active } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE staff SET name = COALESCE($1,name), role = COALESCE($2,role), salary = COALESCE($3,salary),
       skills = COALESCE($4,skills), active = COALESCE($5,active) WHERE id = $6 RETURNING *`,
      [name, role, salary, skills, active, req.params.id]
    );
    if (!rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Staff member not found." }); }
    if (active !== undefined && rows[0].user_id) {
      await client.query("UPDATE users SET active = $1 WHERE id = $2", [active, rows[0].user_id]);
    }
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Couldn't update staff member." });
  } finally {
    client.release();
  }
});

router.post("/:id/create-login", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 8) return res.status(400).json({ error: "Username and an 8+ character password are required." });
  const staff = (await pool.query("SELECT * FROM staff WHERE id = $1", [req.params.id])).rows[0];
  if (!staff) return res.status(404).json({ error: "Staff member not found." });
  if (staff.user_id) return res.status(409).json({ error: "This staff member already has a login." });

  const existing = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
  if (existing.rows.length) return res.status(409).json({ error: "That username is taken." });

  const passwordHash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userResult = await client.query(
      "INSERT INTO users (name, username, password_hash, role, location_id) VALUES ($1,$2,$3,'staff',$4) RETURNING id",
      [staff.name, username, passwordHash, staff.location_id]
    );
    await client.query("UPDATE staff SET user_id = $1 WHERE id = $2", [userResult.rows[0].id, req.params.id]);
    await client.query("COMMIT");
    res.status(201).json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Couldn't create the login." });
  } finally {
    client.release();
  }
});

router.patch("/:id/reset-password", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const staff = (await pool.query("SELECT user_id FROM staff WHERE id = $1", [req.params.id])).rows[0];
  if (!staff?.user_id) return res.status(404).json({ error: "This staff member doesn't have a login account." });
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool.query("UPDATE users SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL WHERE id = $2", [passwordHash, staff.user_id]);
  res.json({ ok: true });
});

router.delete("/:id", requireAuth, requirePrimaryOwner, async (req, res) => {
  const staff = (await pool.query("SELECT user_id FROM staff WHERE id = $1", [req.params.id])).rows[0];
  await pool.query("DELETE FROM staff WHERE id = $1", [req.params.id]);
  if (staff?.user_id) await pool.query("DELETE FROM users WHERE id = $1", [staff.user_id]);
  res.json({ ok: true });
});

export default router;
