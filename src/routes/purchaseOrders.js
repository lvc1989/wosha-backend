import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendEmail } from "../utils/notify.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { locationId } = req.query;
  const params = [];
  let where = "";
  if (locationId && locationId !== "all") { params.push(locationId); where = "WHERE po.location_id = $1"; }
  const { rows } = await pool.query(`
    SELECT po.*, s.name AS supplier_name, s.email AS supplier_email, u.name AS requested_by_name,
      COALESCE(json_agg(poi.* ORDER BY poi.id) FILTER (WHERE poi.id IS NOT NULL), '[]') AS items,
      COALESCE((SELECT json_agg(n.* ORDER BY n.created_at) FROM po_negotiation_notes n WHERE n.po_id = po.id), '[]') AS negotiation_log
    FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN users u ON u.id = po.requested_by
    LEFT JOIN purchase_order_items poi ON poi.po_id = po.id
    ${where}
    GROUP BY po.id, s.name, s.email, u.name
    ORDER BY po.created_at DESC
  `, params);
  res.json(rows);
});

router.post("/", requireAuth, async (req, res) => {
  const { locationId, items, paymentTerms } = req.body;
  if (!items?.length) return res.status(400).json({ error: "At least one item is required." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO purchase_orders (location_id, requested_by, payment_terms) VALUES ($1,$2,$3) RETURNING *`,
      [locationId, req.user.id, paymentTerms || "Full payment"]
    );
    for (const it of items) {
      await client.query(
        "INSERT INTO purchase_order_items (po_id, name, spec, qty, rate) VALUES ($1,$2,$3,$4,$5)",
        [rows[0].id, it.name, it.spec || "", it.qty, it.rate || 0]
      );
    }
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Couldn't create purchase order." });
  } finally {
    client.release();
  }
});

// Approve or reject — owner/manager only
router.patch("/:id/decision", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { status } = req.body; // 'Approved' or 'Rejected'
  const { rows } = await pool.query("UPDATE purchase_orders SET status = $1 WHERE id = $2 RETURNING *", [status, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Purchase order not found." });
  res.json(rows[0]);
});

router.patch("/:id/supplier", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { supplierId } = req.body;
  const { rows } = await pool.query("UPDATE purchase_orders SET supplier_id = $1 WHERE id = $2 RETURNING *", [supplierId, req.params.id]);
  res.json(rows[0]);
});

// Actually emails the supplier the request for quotation — a real send, not just a mailto: link.
router.post("/:id/send-quotation", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const po = (await pool.query(`
    SELECT po.*, s.name AS supplier_name, s.email AS supplier_email
    FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = $1
  `, [req.params.id])).rows[0];
  if (!po) return res.status(404).json({ error: "Purchase order not found." });
  if (!po.supplier_email) return res.status(400).json({ error: "This supplier has no email on file." });

  const items = (await pool.query("SELECT * FROM purchase_order_items WHERE po_id = $1", [req.params.id])).rows;
  const body = `Request for Quotation — PO-${po.id.slice(-5).toUpperCase()}\n\n` +
    items.map((it, i) => `${i + 1}. ${it.name} (${it.spec || ""}) — Qty: ${it.qty}`).join("\n") +
    "\n\nPlease reply with your rate per item and total quotation. Thank you.";

  const result = await sendEmail({ to: po.supplier_email, subject: `RFQ — PO-${po.id.slice(-5).toUpperCase()}`, text: body });
  res.json({ ok: true, delivered: result.sent, deliveryNote: result.sent ? undefined : result.reason });
});

router.patch("/:id/payment-terms", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { paymentTerms } = req.body;
  const { rows } = await pool.query("UPDATE purchase_orders SET payment_terms = $1 WHERE id = $2 RETURNING *", [paymentTerms, req.params.id]);
  res.json(rows[0]);
});

// Attach a file URL (from /api/upload) as the supplier invoice or delivery note
router.patch("/:id/attachment", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { field, url } = req.body; // field: 'supplier_invoice_url' | 'delivery_note_url'
  if (!["supplier_invoice_url", "delivery_note_url"].includes(field)) return res.status(400).json({ error: "Invalid field." });
  const { rows } = await pool.query(`UPDATE purchase_orders SET ${field} = $1 WHERE id = $2 RETURNING *`, [url, req.params.id]);
  res.json(rows[0]);
});

router.patch("/:id/items/:itemId", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { rate } = req.body;
  const { rows } = await pool.query("UPDATE purchase_order_items SET rate = $1 WHERE id = $2 AND po_id = $3 RETURNING *", [rate, req.params.itemId, req.params.id]);
  res.json(rows[0]);
});

router.post("/:id/notes", requireAuth, async (req, res) => {
  const { text } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO po_negotiation_notes (po_id, author_id, text) VALUES ($1,$2,$3) RETURNING *",
    [req.params.id, req.user.id, text]
  );
  res.status(201).json(rows[0]);
});

// Mark received — adds every item's quantity into that branch's product stock
router.post("/:id/receive", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const po = (await client.query("SELECT * FROM purchase_orders WHERE id = $1", [req.params.id])).rows[0];
    if (!po) throw new Error("not found");
    const items = (await client.query("SELECT * FROM purchase_order_items WHERE po_id = $1", [req.params.id])).rows;

    for (const it of items) {
      const existing = await client.query(
        "SELECT id, qty FROM products WHERE location_id = $1 AND LOWER(name) = LOWER($2)",
        [po.location_id, it.name]
      );
      if (existing.rows[0]) {
        await client.query("UPDATE products SET qty = qty + $1 WHERE id = $2", [it.qty, existing.rows[0].id]);
      } else {
        await client.query(
          "INSERT INTO products (location_id, name, qty, reorder_level) VALUES ($1,$2,$3,3)",
          [po.location_id, it.name, it.qty]
        );
      }
    }
    await client.query("UPDATE purchase_orders SET status = 'Received' WHERE id = $1", [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Couldn't mark as received." });
  } finally {
    client.release();
  }
});

export default router;
