import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/public", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, title, media_url, media_type FROM media_gallery WHERE visible = true ORDER BY display_order, created_at DESC"
  );
  res.json(rows);
});

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM media_gallery ORDER BY display_order, created_at DESC");
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { title, mediaUrl, mediaType, displayOrder } = req.body;
  if (!mediaUrl) return res.status(400).json({ error: "A media file is required." });
  const { rows } = await pool.query(
    `INSERT INTO media_gallery (title, media_url, media_type, display_order)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [title || "", mediaUrl, mediaType === "video" ? "video" : "image", Number(displayOrder) || 0]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { title, displayOrder, visible } = req.body;
  const { rows } = await pool.query(
    `UPDATE media_gallery SET title = COALESCE($1,title), display_order = COALESCE($2,display_order), visible = COALESCE($3,visible)
     WHERE id = $4 RETURNING *`,
    [title, displayOrder, visible, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Media item not found." });
  res.json(rows[0]);
});

router.patch("/:id/toggle", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { rows } = await pool.query("UPDATE media_gallery SET visible = NOT visible WHERE id = $1 RETURNING *", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Media item not found." });
  res.json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM media_gallery WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
