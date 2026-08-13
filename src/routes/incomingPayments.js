import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = "";
  if (status) { params.push(status); where = "WHERE ip.status = $1"; }
  const { rows } = await pool.query(`
    SELECT ip.*, c.name AS customer_name, i.control_number AS invoice_control_number
    FROM incoming_payments ip
    LEFT JOIN customers c ON c.id = ip.customer_id
    LEFT JOIN invoices i ON i.id = ip.invoice_id
    ${where} ORDER BY ip.created_at DESC
  `, params);
  res.json(rows);
});

router.post("/", requireAuth, async (req, res) => {
  const { method, referenceCode, amount, customerId, invoiceId, locationId, notes } = req.body;
  if (!method || !amount) return res.status(400).json({ error: "Method and amount are required." });
  if (!locationId) return res.status(400).json({ error: "A branch is required — otherwise this payment won't show up in that branch's Cash Flow report." });
  const { rows } = await pool.query(
    `INSERT INTO incoming_payments (method, reference_code, amount, customer_id, invoice_id, location_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [method, referenceCode || null, amount, customerId || null, invoiceId || null, locationId || null, notes || null, req.user.id]
  );
  res.status(201).json(rows[0]);
});

async function confirmPayment(client, payment, confirmedByUserId) {
  await client.query(
    "UPDATE incoming_payments SET status = 'Confirmed', confirmed_by = $1, confirmed_at = now() WHERE id = $2",
    [confirmedByUserId, payment.id]
  );
  await client.query(
    "INSERT INTO cash_entries (location_id, direction, category, amount, note) VALUES ($1,'in','Sales',$2,$3)",
    [payment.location_id, payment.amount, `${payment.method}${payment.reference_code ? ` — ref ${payment.reference_code}` : ""}`]
  );
  if (payment.invoice_id) {
    await client.query("UPDATE invoices SET status = 'Paid', paid = total, payment_method = $1 WHERE id = $2", [payment.method, payment.invoice_id]);
  }
}

router.patch("/:id/confirm", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const payment = (await client.query("SELECT * FROM incoming_payments WHERE id = $1 AND status = 'Pending'", [req.params.id])).rows[0];
    if (!payment) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Pending payment not found." }); }
    await confirmPayment(client, payment, req.user.id);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Couldn't confirm the payment." });
  } finally {
    client.release();
  }
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM incoming_payments WHERE id = $1 AND status = 'Pending'", [req.params.id]);
  res.json({ ok: true });
});

// Real automatic confirmation path — only reachable if the business has set up its own
// Flutterwave merchant account (mobile money collection) and pasted a webhook secret
// into .env. Without that, "automatic bank detection" isn't something any system can
// honestly do — this is the real version of that, not a simulated one.
router.post("/webhook/flutterwave", express.json(), async (req, res) => {
  const secretHash = process.env.FLUTTERWAVE_WEBHOOK_SECRET;
  if (!secretHash) return res.status(503).json({ error: "Automatic payment confirmation isn't configured." });
  const signature = req.headers["verif-hash"];
  if (!signature || signature !== secretHash) return res.status(401).json({ error: "Invalid signature." });

  const { data } = req.body;
  if (data?.status !== "successful") return res.json({ ok: true });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const payment = (await client.query(
      "SELECT * FROM incoming_payments WHERE reference_code = $1 AND status = 'Pending'",
      [data.tx_ref]
    )).rows[0];
    if (payment) await confirmPayment(client, payment, null);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Webhook processing failed." });
  } finally {
    client.release();
  }
});

export default router;
