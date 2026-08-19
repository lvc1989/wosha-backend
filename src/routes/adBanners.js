import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// Public — the website reads only visible ad banners, in display order.
router.get("/public", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, title, description, image_url, link_text FROM ad_banners WHERE visible = true ORDER BY display_order, created_at DESC"
  );
  res.json(rows);
});

// Admin — sees everything, including hidden ones, so they can be reviewed before publishing.
router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM ad_banners ORDER BY display_order, created_at DESC");
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { title, description, imageUrl, linkText, displayOrder } = req.body;
  if (!title?.trim() || !imageUrl?.trim()) return res.status(400).json({ error: "A title and image are required." });
  const { rows } = await pool.query(
    `INSERT INTO ad_banners (title, description, image_url, link_text, display_order)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [title.trim(), description || null, imageUrl.trim(), linkText || null, Number(displayOrder) || 0]
  );
  res.status(201).json(rows[0]);
});

router.patch("/:id/toggle", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { rows } = await pool.query("UPDATE ad_banners SET visible = NOT visible WHERE id = $1 RETURNING *", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Banner not found." });
  res.json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM ad_banners WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
