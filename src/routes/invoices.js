import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
const generateControlNumber = () => "99" + Math.floor(1000000000 + Math.random() * 8999999999).toString();

router.get("/", requireAuth, async (req, res) => {
  const { locationId, from, to, limit, offset } = req.query;
  const conditions = [];
  const params = [];
  if (locationId && locationId !== "all") { params.push(locationId); conditions.push(`i.location_id = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`i.created_at >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`i.created_at <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const safeLimit = Math.min(Number(limit) || 200, 500);
  const safeOffset = Number(offset) || 0;
  const countParams = [...params];
  params.push(safeLimit, safeOffset);

  const { rows } = await pool.query(`
    SELECT i.*, COALESCE(json_agg(ii.*) FILTER (WHERE ii.id IS NOT NULL), '[]') AS items
    FROM invoices i
    LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
    ${where}
    GROUP BY i.id ORDER BY i.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM invoices i ${where}`, countParams);
  res.set("X-Total-Count", countRows[0].count);
  res.json(rows);
});

// Create an invoice directly from a basket of items (Record Sale) or from a completed booking.
router.post("/", requireAuth, async (req, res) => {
  const { bookingId, locationId, items, discountPercent, taxPercent, billTo } = req.body;
  if (!items?.length) return res.status(400).json({ error: "At least one line item is required." });

  const subtotal = items.reduce((s, it) => s + it.rate * it.qty, 0);
  const discount = Math.round(subtotal * ((discountPercent || 0) / 100));
  const taxable = subtotal - discount;
  const tax = Math.round(taxable * ((taxPercent || 0) / 100));
  const total = taxable + tax;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO invoices (booking_id, location_id, subtotal, discount_percent, discount, tax_percent, tax, total, control_number, bill_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [bookingId || null, locationId, subtotal, discountPercent || 0, discount, taxPercent || 0, tax, total, generateControlNumber(), billTo || null]
    );
    for (const it of items) {
      await client.query(
        "INSERT INTO invoice_items (invoice_id, name, rate, qty, amount) VALUES ($1,$2,$3,$4,$5)",
        [rows[0].id, it.name, it.rate, it.qty, it.rate * it.qty]
      );
    }
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Couldn't create invoice." });
  } finally {
    client.release();
  }
});

router.patch("/:id/pay", requireAuth, async (req, res) => {
  const { method } = req.body;
  const { rows } = await pool.query(
    "UPDATE invoices SET status = 'Paid', paid = total, payment_method = $1 WHERE id = $2 RETURNING *",
    [method || "Cash", req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Invoice not found." });
  res.json(rows[0]);
});

export default router;
