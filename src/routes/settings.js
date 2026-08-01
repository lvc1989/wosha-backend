import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendEmail, sendSms } from "../utils/notify.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM business_settings WHERE id = 1");
  res.json(rows[0]);
});

// Lets the owner see, at a glance, whether email/SMS are actually configured —
// instead of guessing based on whether a password-reset email ever arrived.
router.get("/notification-status", requireAuth, requireRole("owner"), (req, res) => {
  res.json({
    emailConfigured: !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL),
    smsConfigured: !!(process.env.AFRICASTALKING_USERNAME && process.env.AFRICASTALKING_API_KEY),
  });
});

// Sends a real test email/SMS right now, so setting up SendGrid/Africa's Talking has an
// immediate, concrete "did it actually work" answer instead of waiting for the next
// password reset to find out.
router.post("/test-email", requireAuth, requireRole("owner"), async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: "Enter an email address to send the test to." });
  const result = await sendEmail({ to, subject: "Wosha test email", text: "If you're reading this, email delivery is working correctly." });
  res.json(result);
});

router.post("/test-sms", requireAuth, requireRole("owner"), async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: "Enter a phone number to send the test to." });
  const result = await sendSms({ to, message: "Wosha test SMS — if you're reading this, SMS delivery is working correctly." });
  res.json(result);
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
