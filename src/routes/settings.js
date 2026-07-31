import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM business_settings WHERE id = 1");
  res.json(rows[0]);
});

router.put("/", requireAuth, requireRole("owner"), async (req, res) => {
  const { businessName, address, phone, tin, invoicePrefix, taxRatePercent, logoUrl, logoSize, tagline, staffAttachmentsEnabled, clientAttachmentsEnabled, mission, vision, orgStructure } = req.body;
  const { rows } = await pool.query(
    `UPDATE business_settings SET
      business_name = COALESCE($1, business_name), address = COALESCE($2, address),
      phone = COALESCE($3, phone), tin = COALESCE($4, tin),
      invoice_prefix = COALESCE($5, invoice_prefix), tax_rate_percent = COALESCE($6, tax_rate_percent),
      logo_url = COALESCE($7, logo_url), logo_size = COALESCE($8, logo_size), tagline = COALESCE($9, tagline),
      staff_attachments_enabled = COALESCE($10, staff_attachments_enabled),
      client_attachments_enabled = COALESCE($11, client_attachments_enabled),
      mission = COALESCE($12, mission), vision = COALESCE($13, vision), org_structure = COALESCE($14, org_structure),
      updated_at = now()
     WHERE id = 1 RETURNING *`,
    [businessName, address, phone, tin, invoicePrefix, taxRatePercent, logoUrl, logoSize, tagline, staffAttachmentsEnabled, clientAttachmentsEnabled, mission, vision, orgStructure]
  );
  res.json(rows[0]);
});

export default router;
