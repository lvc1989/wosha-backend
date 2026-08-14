import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// Public — the website reads only visible testimonials, oldest-display-order first.
router.get("/public", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, customer_name, quote, rating, photo_url FROM testimonials WHERE visible = true ORDER BY display_order, created_at DESC"
  );
  res.json(rows);
});

// Admin — sees everything, including hidden ones, so they can be reviewed before publishing.
router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM testimonials ORDER BY display_order, created_at DESC");
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { customerName, quote, rating, photoUrl, displayOrder } = req.body;
  if (!customerName?.trim() || !quote?.trim()) return res.status(400).json({ error: "Customer name and quote are required." });
  const { rows } = await pool.query(
    `INSERT INTO testimonials (customer_name, quote, rating, photo_url, display_order)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [customerName.trim(), quote.trim(), Math.min(5, Math.max(1, Number(rating) || 5)), photoUrl || null, Number(displayOrder) || 0]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { customerName, quote, rating, photoUrl, displayOrder, visible } = req.body;
  const { rows } = await pool.query(
    `UPDATE testimonials SET
      customer_name = COALESCE($1,customer_name), quote = COALESCE($2,quote),
      rating = COALESCE($3,rating), photo_url = COALESCE($4,photo_url),
      display_order = COALESCE($5,display_order), visible = COALESCE($6,visible)
     WHERE id = $7 RETURNING *`,
    [customerName, quote, rating, photoUrl, displayOrder, visible, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Testimonial not found." });
  res.json(rows[0]);
});

router.patch("/:id/toggle", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { rows } = await pool.query("UPDATE testimonials SET visible = NOT visible WHERE id = $1 RETURNING *", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Testimonial not found." });
  res.json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM testimonials WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
