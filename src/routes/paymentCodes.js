import express from "express";
import crypto from "crypto";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

function generateCode() {
  return crypto.randomBytes(5).toString("hex").toUpperCase(); // 10-char code, e.g. "A1B2C3D4E5"
}

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT pc.*, s.name AS service_name, p.name AS product_name
    FROM payment_codes pc
    LEFT JOIN services s ON s.id = pc.service_id
    LEFT JOIN products p ON p.id = pc.product_id
    ORDER BY pc.created_at DESC
  `);
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { label, amount, serviceId, productId } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: "A label is required." });
  const code = generateCode();
  const { rows } = await pool.query(
    "INSERT INTO payment_codes (code, label, amount, service_id, product_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [code, label.trim(), amount || null, serviceId || null, productId || null, req.user.id]
  );
  res.status(201).json(rows[0]);
});

router.patch("/:id/toggle", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { rows } = await pool.query("UPDATE payment_codes SET active = NOT active WHERE id = $1 RETURNING *", [req.params.id]);
  res.json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM payment_codes WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// Public — anyone scanning the printed code with any phone camera lands here, no login.
router.get("/public/:code", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT pc.*, s.name AS service_name, s.price AS service_price,
           p.name AS product_name, p.sell_price AS product_price,
           bs.business_name, bs.logo_url, bs.payment_instructions
    FROM payment_codes pc
    LEFT JOIN services s ON s.id = pc.service_id
    LEFT JOIN products p ON p.id = pc.product_id
    LEFT JOIN business_settings bs ON bs.id = 1
    WHERE pc.code = $1 AND pc.active = true
  `, [req.params.code]);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: "This payment code isn't active or doesn't exist." });
  const amount = row.amount ?? row.service_price ?? row.product_price ?? null;
  res.json({
    label: row.label,
    amount,
    businessName: row.business_name,
    logoUrl: row.logo_url,
    paymentInstructions: row.payment_instructions,
  });
});

// Authenticated — used when staff scan a payment code from within Sales, to actually
// add the linked service/product to the basket (the public route above only returns
// display text, not the IDs needed for that).
router.get("/lookup/:code", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM payment_codes WHERE code = $1 AND active = true", [req.params.code]);
  if (!rows[0]) return res.status(404).json({ error: "No active payment code matches that." });
  res.json(rows[0]);
});

export default router;
