import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { locationId } = req.query;
  const params = [];
  let where = "";
  if (locationId && locationId !== "all") { params.push(locationId); where = "WHERE location_id = $1"; }
  const { rows } = await pool.query(`SELECT * FROM products ${where} ORDER BY category, name`, params);
  res.json(rows);
});

// Look up a product by scanned barcode (used by Record Sale / Scan to Receive Stock)
router.get("/barcode/:code", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM products WHERE barcode = $1", [req.params.code]);
  if (!rows[0]) return res.status(404).json({ error: "No product matches that barcode." });
  res.json(rows[0]);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { locationId, name, category, unit, qty, reorderLevel, parLevel, barcode, costPrice, sellPrice, sellable } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO products (location_id, name, category, unit, qty, reorder_level, par_level, barcode, cost_price, sell_price, sellable)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [locationId, name, category, unit || "pcs", qty || 0, reorderLevel || 0, parLevel || 0, barcode, costPrice || 0, sellPrice || 0, !!sellable]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const f = req.body;
  const { rows } = await pool.query(
    `UPDATE products SET name = COALESCE($1,name), category = COALESCE($2,category), qty = COALESCE($3,qty),
     reorder_level = COALESCE($4,reorder_level), par_level = COALESCE($5,par_level), barcode = COALESCE($6,barcode),
     cost_price = COALESCE($7,cost_price), sell_price = COALESCE($8,sell_price), sellable = COALESCE($9,sellable),
     location_id = COALESCE($11,location_id)
     WHERE id = $10 RETURNING *`,
    [f.name, f.category, f.qty, f.reorderLevel, f.parLevel, f.barcode, f.costPrice, f.sellPrice, f.sellable, req.params.id, f.locationId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Product not found." });
  res.json(rows[0]);
});

// Adjust stock quantity (used by: sale deducts, receiving stock adds)
router.patch("/:id/adjust-qty", requireAuth, async (req, res) => {
  const { delta } = req.body; // positive to add stock, negative to deduct on sale
  const { rows } = await pool.query(
    "UPDATE products SET qty = GREATEST(0, qty + $1) WHERE id = $2 RETURNING *",
    [delta, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Product not found." });
  res.json(rows[0]);
});

// Staff flags a product as about to run out — separate from the automatic
// reorder-level/par-level alerts, since staff often notice this before the numbers do.
router.post("/:id/request-restock", requireAuth, async (req, res) => {
  const { note } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO restock_requests (product_id, requested_by, note) VALUES ($1,$2,$3) RETURNING *",
    [req.params.id, req.user.id, note || null]
  );
  res.status(201).json(rows[0]);
});

router.get("/restock-requests/open", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT rr.*, p.name AS product_name, p.qty, u.name AS requested_by_name
    FROM restock_requests rr
    JOIN products p ON p.id = rr.product_id
    LEFT JOIN users u ON u.id = rr.requested_by
    WHERE rr.status = 'Open' ORDER BY rr.created_at DESC
  `);
  res.json(rows);
});

router.patch("/restock-requests/:id/fulfill", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { rows } = await pool.query("UPDATE restock_requests SET status = 'Fulfilled' WHERE id = $1 RETURNING *", [req.params.id]);
  res.json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
