import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole, requirePrimaryOwner } from "../middleware/auth.js";
import { sendEmail, sendSms } from "../utils/notify.js";

const router = express.Router();

// Public — the login page loads before anyone is authenticated, so it needs a way to
// fetch branding without a token. Deliberately returns only safe display fields, never
// TIN, address, payment instructions, or anything else sensitive.
router.get("/public", async (req, res) => {
  const { rows } = await pool.query(
    "SELECT business_name, logo_url, login_message, login_background_color, loading_background_color, theme_primary_color, theme_accent_color, theme_topbar_color, menu_icon_bg_color, menu_icon_color, hero_bg_color, hero_text_color, hero_bubble_opacity, print_header_font_size, print_footer_font_size, tile_bg_color, tile_text_color, tile_font_size, website_content FROM business_settings WHERE id = 1"
  );
  res.json(rows[0] || {});
});

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM business_settings WHERE id = 1");
  res.json(rows[0]);
});

// Lets the owner see, at a glance, whether email/SMS are actually configured —
// instead of guessing based on whether a password-reset email ever arrived.
router.get("/notification-status", requireAuth, requirePrimaryOwner, (req, res) => {
  res.json({
    emailConfigured: !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL),
    smsConfigured: !!(process.env.AFRICASTALKING_USERNAME && process.env.AFRICASTALKING_API_KEY),
  });
});

// Sends a real test email/SMS right now, so setting up SendGrid/Africa's Talking has an
// immediate, concrete "did it actually work" answer instead of waiting for the next
// password reset to find out.
router.post("/test-email", requireAuth, requirePrimaryOwner, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: "Enter an email address to send the test to." });
  const result = await sendEmail({ to, subject: "Wosha test email", text: "If you're reading this, email delivery is working correctly." });
  res.json(result);
});

router.post("/test-sms", requireAuth, requirePrimaryOwner, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: "Enter a phone number to send the test to." });
  const result = await sendSms({ to, message: "Wosha test SMS — if you're reading this, SMS delivery is working correctly." });
  res.json(result);
});

// Sets (or clears, when body is empty) the header/footer print attachment — kept as
// its own route since it's three related fields (type/url/html) that always change
// together, which doesn't fit cleanly into the general settings update above.
router.put("/print-attachment/:slot", requireAuth, requirePrimaryOwner, async (req, res) => {
  const { slot } = req.params;
  if (!["header", "footer"].includes(slot)) return res.status(400).json({ error: "Invalid attachment slot." });
  const { type, url, html } = req.body;
  const { rows } = await pool.query(
    `UPDATE business_settings SET
      print_${slot}_attachment_type = $1, print_${slot}_attachment_url = $2, print_${slot}_attachment_html = $3,
      updated_at = now()
     WHERE id = 1 RETURNING *`,
    [type || null, url || null, html || null]
  );
  res.json(rows[0]);
});

router.put("/", requireAuth, requirePrimaryOwner, async (req, res) => {
  const { businessName, address, phone, tin, invoicePrefix, taxRatePercent, logoUrl, logoSize, tagline, staffAttachmentsEnabled, clientAttachmentsEnabled, mission, vision, orgStructure, sidebarColor, paymentInstructions, loginMessage, loginBackgroundColor, loadingBackgroundColor, iconBackgroundColor, printHeaderEnabled, printHeaderShowLogo, printHeaderShowSlogan, printHeaderAlign, printFooterEnabled, printFooterText, printFooterAlign, websiteContent, themePrimaryColor, themeAccentColor, themeTopbarColor, menuIconBgColor, menuIconColor, heroBgColor, heroTextColor, heroBubbleOpacity, printHeaderFontSize, printFooterFontSize, tileBgColor, tileTextColor, tileFontSize } = req.body;
  const { rows } = await pool.query(
    `UPDATE business_settings SET
      business_name = COALESCE($1, business_name), address = COALESCE($2, address),
      phone = COALESCE($3, phone), tin = COALESCE($4, tin),
      invoice_prefix = COALESCE($5, invoice_prefix), tax_rate_percent = COALESCE($6, tax_rate_percent),
      logo_url = CASE WHEN $7 = '' THEN NULL WHEN $7 IS NOT NULL THEN $7 ELSE logo_url END,
      logo_size = COALESCE($8, logo_size), tagline = COALESCE($9, tagline),
      staff_attachments_enabled = COALESCE($10, staff_attachments_enabled),
      client_attachments_enabled = COALESCE($11, client_attachments_enabled),
      mission = COALESCE($12, mission), vision = COALESCE($13, vision), org_structure = COALESCE($14, org_structure),
      sidebar_color = COALESCE($15, sidebar_color), payment_instructions = COALESCE($16, payment_instructions),
      login_message = COALESCE($17, login_message), login_background_color = COALESCE($18, login_background_color),
      icon_background_color = COALESCE($19, icon_background_color),
      print_header_enabled = COALESCE($20, print_header_enabled), print_header_show_logo = COALESCE($21, print_header_show_logo),
      print_header_show_slogan = COALESCE($22, print_header_show_slogan), print_header_align = COALESCE($23, print_header_align),
      print_footer_enabled = COALESCE($24, print_footer_enabled), print_footer_text = COALESCE($25, print_footer_text),
      print_footer_align = COALESCE($26, print_footer_align),
      website_content = CASE WHEN $27::jsonb IS NOT NULL THEN website_content || $27::jsonb ELSE website_content END,
      loading_background_color = COALESCE($28, loading_background_color),
      theme_primary_color = COALESCE($29, theme_primary_color),
      theme_accent_color = COALESCE($30, theme_accent_color),
      theme_topbar_color = COALESCE($31, theme_topbar_color),
      menu_icon_bg_color = COALESCE($32, menu_icon_bg_color),
      menu_icon_color = COALESCE($33, menu_icon_color),
      hero_bg_color = COALESCE($34, hero_bg_color),
      hero_text_color = COALESCE($35, hero_text_color),
      hero_bubble_opacity = COALESCE($36, hero_bubble_opacity),
      print_header_font_size = COALESCE($37, print_header_font_size),
      print_footer_font_size = COALESCE($38, print_footer_font_size),
      tile_bg_color = CASE WHEN $39 = '' THEN NULL WHEN $39 IS NOT NULL THEN $39 ELSE tile_bg_color END,
      tile_text_color = CASE WHEN $40 = '' THEN NULL WHEN $40 IS NOT NULL THEN $40 ELSE tile_text_color END,
      tile_font_size = COALESCE($41, tile_font_size),
      updated_at = now()
     WHERE id = 1 RETURNING *`,
    [businessName, address, phone, tin, invoicePrefix, taxRatePercent, logoUrl, logoSize, tagline, staffAttachmentsEnabled, clientAttachmentsEnabled, mission, vision, orgStructure, sidebarColor, paymentInstructions, loginMessage, loginBackgroundColor, iconBackgroundColor, printHeaderEnabled, printHeaderShowLogo, printHeaderShowSlogan, printHeaderAlign, printFooterEnabled, printFooterText, printFooterAlign, websiteContent ? JSON.stringify(websiteContent) : null, loadingBackgroundColor, themePrimaryColor, themeAccentColor, themeTopbarColor, menuIconBgColor, menuIconColor, heroBgColor, heroTextColor, heroBubbleOpacity, printHeaderFontSize, printFooterFontSize, tileBgColor, tileTextColor, tileFontSize]
  );
  res.json(rows[0]);
});

export default router;
