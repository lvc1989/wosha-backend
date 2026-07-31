import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { sendEmail, sendSms } from "../utils/notify.js";

const router = express.Router();
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

// In-memory OTP store (fine for a single-server deployment; move to Redis if you scale to multiple instances)
const otpStore = new Map(); // username -> { code, expiresAt }

router.post("/login", async (req, res) => {
  const { username, password, allowedRoles } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

  const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  const user = rows[0];

  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    return res.status(423).json({ error: `Too many failed attempts. Try again in ${mins} minute(s).` });
  }

  const valid = user && (await bcrypt.compare(password, user.password_hash));
  if (!valid) {
    if (user) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      const locked = attempts >= LOCKOUT_THRESHOLD;
      await pool.query(
        "UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3",
        [locked ? 0 : attempts, locked ? new Date(Date.now() + LOCKOUT_MINUTES * 60000) : null, user.id]
      );
      if (locked) return res.status(423).json({ error: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.` });
    }
    return res.status(401).json({ error: "No account matches that username and password." });
  }

  if (!user.active) return res.status(403).json({ error: "This account has been deactivated." });
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return res.status(403).json({ error: `This is a ${user.role} account — use the matching login tab.` });
  }

  await pool.query("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1", [user.id]);
  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role, title: user.title, isPrimaryOwner: user.is_primary_owner, locationId: user.location_id, profilePic: user.profile_pic },
  });
});

router.post("/signup", async (req, res) => {
  const { name, phone, email, username, password } = req.body;
  if (!name || !username || !password) return res.status(400).json({ error: "Name, username, and password are required." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const existing = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
  if (existing.rows.length) return res.status(409).json({ error: "That username is taken." });

  const passwordHash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const custResult = await client.query(
      "INSERT INTO customers (name, phone, email, tag) VALUES ($1,$2,$3,'First-time') RETURNING id",
      [name, phone, email]
    );
    const userResult = await client.query(
      `INSERT INTO users (name, username, email, phone, password_hash, role)
       VALUES ($1,$2,$3,$4,$5,'client') RETURNING *`,
      [name, username, email, phone, passwordHash]
    );
    await client.query("UPDATE customers SET user_id = $1 WHERE id = $2", [userResult.rows[0].id, custResult.rows[0].id]);
    await client.query("COMMIT");
    const token = signToken(userResult.rows[0]);
    res.json({ token, user: { id: userResult.rows[0].id, name, role: "client", customerId: custResult.rows[0].id } });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Couldn't create the account." });
  } finally {
    client.release();
  }
});

router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });

  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
  const user = rows[0];
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect." });

  const newHash = await bcrypt.hash(newPassword, 10);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, user.id]);
  res.json({ ok: true });
});

// ---- Forgot password: request a code ----
router.post("/forgot-password/request", async (req, res) => {
  const { identifier, channel } = req.body; // channel: 'email' or 'sms'
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE username = $1 OR email = $1 OR phone = $1",
    [identifier]
  );
  const user = rows[0];
  if (!user) return res.status(404).json({ error: "No account found with that username, email, or phone." });
  if (!user.email && !user.phone) return res.status(400).json({ error: "No contact info on file for this account." });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(user.username, { code, expiresAt: Date.now() + 60000 });

  let delivery;
  if (channel === "sms" && user.phone) {
    delivery = await sendSms({ to: user.phone, message: `Your Wosha password reset code is ${code}. It expires in 60 seconds.` });
  } else if (user.email) {
    delivery = await sendEmail({ to: user.email, subject: "Your Wosha password reset code", text: `Your password reset code is ${code}. It expires in 60 seconds.` });
  } else {
    delivery = { sent: false, reason: "No matching contact method for the requested channel." };
  }

  res.json({
    ok: true,
    username: user.username,
    hasEmail: !!user.email,
    hasPhone: !!user.phone,
    delivered: delivery.sent,
    deliveryNote: delivery.sent ? undefined : delivery.reason, // shown to the requester so they know to check the server console during setup/testing
  });
});

router.post("/forgot-password/verify", async (req, res) => {
  const { username, code, newPassword } = req.body;
  const entry = otpStore.get(username);
  if (!entry || entry.expiresAt < Date.now()) return res.status(400).json({ error: "Code expired — request a new one." });
  if (entry.code !== code) return res.status(400).json({ error: "Incorrect code." });
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const newHash = await bcrypt.hash(newPassword, 10);
  await pool.query("UPDATE users SET password_hash = $1 WHERE username = $2", [newHash, username]);
  otpStore.delete(username);
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, username, email, phone, role, title, is_primary_owner, location_id, profile_pic FROM users WHERE id = $1",
    [req.user.id]
  );
  res.json(rows[0]);
});

export default router;
