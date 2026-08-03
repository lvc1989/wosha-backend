import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM promotions ORDER BY created_at DESC");
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, discountPercent, targetSegment, mediaUrl, mediaType, expiresInDays } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO promotions (name, discount_percent, target_segment, media_url, media_type, expires_in_days)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, discountPercent || 0, targetSegment || "All", mediaUrl, mediaType, expiresInDays || "14"]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { name, discountPercent, targetSegment, mediaUrl, mediaType, expiresInDays } = req.body;
  const { rows } = await pool.query(
    `UPDATE promotions SET
      name = COALESCE($1,name), discount_percent = COALESCE($2,discount_percent),
      target_segment = COALESCE($3,target_segment), media_url = COALESCE($4,media_url),
      media_type = COALESCE($5,media_type), expires_in_days = COALESCE($6,expires_in_days)
     WHERE id = $7 RETURNING *`,
    [name, discountPercent, targetSegment, mediaUrl, mediaType, expiresInDays, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Promotion not found." });
  res.json(rows[0]);
});

router.patch("/:id/toggle", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE promotions SET status = CASE WHEN status = 'Active' THEN 'Ended' ELSE 'Active' END WHERE id = $1 RETURNING *",
    [req.params.id]
  );
  res.json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM promotions WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// Called periodically (or on read) to strip expired media and reclaim storage, keeping the promo itself
router.post("/expire-check", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    UPDATE promotions SET media_url = NULL, media_type = NULL
    WHERE media_url IS NOT NULL AND expires_in_days != 'never'
      AND created_at < now() - (expires_in_days || ' days')::interval
    RETURNING id
  `);
  res.json({ cleared: rows.length });
});

export default router;
