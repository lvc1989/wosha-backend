import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { scope } = req.query; // 'staff' | 'client'
  if (scope === "staff") {
    const { rows } = await pool.query(`
      SELECT ap.*, u.name AS person_name FROM attachment_permissions ap
      JOIN users u ON u.id = ap.person_id WHERE ap.scope = 'staff'
    `);
    return res.json(rows);
  }
  const { rows } = await pool.query(`
    SELECT ap.*, c.name AS person_name FROM attachment_permissions ap
    JOIN customers c ON c.id = ap.person_id WHERE ap.scope = 'client'
  `);
  res.json(rows);
});

router.put("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { scope, personId, allowed } = req.body;
  if (!["staff", "client"].includes(scope)) return res.status(400).json({ error: "Invalid scope." });
  const { rows } = await pool.query(
    `INSERT INTO attachment_permissions (scope, person_id, allowed) VALUES ($1,$2,$3)
     ON CONFLICT (scope, person_id) DO UPDATE SET allowed = $3 RETURNING *`,
    [scope, personId, allowed]
  );
  res.json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM attachment_permissions WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// The real check every message-send route uses — global default, overridden per-person if set
export async function canSendAttachment(scope, personId) {
  const override = personId
    ? (await pool.query("SELECT allowed FROM attachment_permissions WHERE scope = $1 AND person_id = $2", [scope, personId])).rows[0]
    : null;
  if (override) return override.allowed;
  const settings = (await pool.query("SELECT staff_attachments_enabled, client_attachments_enabled FROM business_settings WHERE id = 1")).rows[0];
  return scope === "staff" ? settings.staff_attachments_enabled : settings.client_attachments_enabled;
}

// Any logged-in user can check whether attachments are currently allowed — this is what
// the chat UI calls to decide whether to show the attach button at all.
router.get("/check", requireAuth, async (req, res) => {
  const { scope, personId } = req.query;
  const id = scope === "staff" ? req.user.id : personId;
  res.json({ allowed: await canSendAttachment(scope, id) });
});

export default router;
