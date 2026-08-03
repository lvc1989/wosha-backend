import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { deleteFile } from "../utils/storage.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { supplierId } = req.query;
  const params = [];
  let where = "";
  if (supplierId) { params.push(supplierId); where = "WHERE sp.supplier_id = $1"; }
  const { rows } = await pool.query(`
    SELECT sp.*, s.name AS supplier_name FROM supplier_payments sp
    LEFT JOIN suppliers s ON s.id = sp.supplier_id
    ${where} ORDER BY sp.paid_at DESC
  `, params);
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { supplierId, poId, amount, method, receiptUrl, receiptName } = req.body;
  if (!supplierId || !amount) return res.status(400).json({ error: "Supplier and amount are required." });
  const { rows } = await pool.query(
    `INSERT INTO supplier_payments (supplier_id, po_id, amount, method, receipt_url, receipt_name, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [supplierId, poId || null, amount, method || null, receiptUrl || null, receiptName || null, req.user.id]
  );
  // Also logs as a real expense so it shows up in Cash Flow / Reports like any other outgoing cost.
  await pool.query(
    "INSERT INTO cash_entries (direction, category, amount, note) VALUES ('out','Supplier Payment',$1,$2)",
    [amount, `Payment to supplier${method ? ` via ${method}` : ""}`]
  );
  res.status(201).json(rows[0]);
});

// Same download-then-reclaim-storage pattern as message attachments — the file gets
// removed from storage once confirmed saved elsewhere, keeping only this text record.
router.patch("/:id/mark-downloaded", requireAuth, async (req, res) => {
  const { savedLocationNote } = req.body;
  const payment = (await pool.query("SELECT * FROM supplier_payments WHERE id = $1", [req.params.id])).rows[0];
  if (!payment) return res.status(404).json({ error: "Payment record not found." });
  if (payment.receipt_url) await deleteFile(payment.receipt_url);
  const { rows } = await pool.query(
    "UPDATE supplier_payments SET downloaded = true, downloaded_at = now(), saved_location_note = $1, receipt_url = NULL WHERE id = $2 RETURNING *",
    [savedLocationNote || "", req.params.id]
  );
  res.json(rows[0]);
});

export default router;
