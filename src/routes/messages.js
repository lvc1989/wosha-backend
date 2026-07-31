import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { deleteFile } from "../utils/storage.js";
import { canSendAttachment } from "./attachmentPermissions.js";

const router = express.Router();

// ---- Team chat ----
router.get("/team", requireAuth, async (req, res) => {
  const { channel } = req.query;
  const { rows } = await pool.query(
    `SELECT tm.*, u.name AS sender_name FROM team_messages tm LEFT JOIN users u ON u.id = tm.sender_id
     WHERE tm.channel = $1 ORDER BY tm.created_at`,
    [channel || "all"]
  );
  res.json(rows);
});

router.post("/team", requireAuth, async (req, res) => {
  const { channel, text, attachmentUrl, attachmentType, attachmentName } = req.body;
  if (attachmentUrl && !(await canSendAttachment("staff", req.user.id))) {
    return res.status(403).json({ error: "Attachments are currently disabled for your account." });
  }
  const { rows } = await pool.query(
    "INSERT INTO team_messages (channel, sender_id, text, attachment_url, attachment_type, attachment_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [channel || "all", req.user.id, text, attachmentUrl, attachmentType, attachmentName]
  );
  res.status(201).json(rows[0]);
});

// Marks an attachment as downloaded, records where the person says they saved it
// (browsers don't expose real device file paths — this is self-reported), and deletes
// the actual file from storage to reclaim space, keeping only this text record behind.
router.patch("/team/:id/mark-downloaded", requireAuth, async (req, res) => {
  const { savedLocationNote } = req.body;
  const msg = (await pool.query("SELECT * FROM team_messages WHERE id = $1", [req.params.id])).rows[0];
  if (!msg) return res.status(404).json({ error: "Message not found." });
  if (msg.attachment_url) await deleteFile(msg.attachment_url);
  const { rows } = await pool.query(
    "UPDATE team_messages SET downloaded = true, downloaded_at = now(), saved_location_note = $1, attachment_url = NULL WHERE id = $2 RETURNING *",
    [savedLocationNote || "", req.params.id]
  );
  res.json(rows[0]);
});

// ---- Client messages ----
router.get("/client/:customerId", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM client_messages WHERE customer_id = $1 ORDER BY created_at",
    [req.params.customerId]
  );
  res.json(rows);
});

router.get("/client-unread", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (customer_id) customer_id, sender, text, created_at
    FROM client_messages
    ORDER BY customer_id, created_at DESC
  `);
  res.json(rows.filter((r) => r.sender === "customer"));
});

router.post("/client/:customerId", requireAuth, async (req, res) => {
  const { text, attachmentUrl, attachmentType, attachmentName, sender } = req.body;
  if (attachmentUrl) {
    const allowed = sender === "customer"
      ? await canSendAttachment("client", req.params.customerId)
      : await canSendAttachment("staff", req.user.id);
    if (!allowed) return res.status(403).json({ error: "Attachments are currently disabled for this conversation." });
  }
  const { rows } = await pool.query(
    "INSERT INTO client_messages (customer_id, sender, text, attachment_url, attachment_type, attachment_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [req.params.customerId, sender || "staff", text, attachmentUrl, attachmentType, attachmentName]
  );
  res.status(201).json(rows[0]);
});

router.patch("/client/:id/mark-downloaded", requireAuth, async (req, res) => {
  const { savedLocationNote } = req.body;
  const msg = (await pool.query("SELECT * FROM client_messages WHERE id = $1", [req.params.id])).rows[0];
  if (!msg) return res.status(404).json({ error: "Message not found." });
  if (msg.attachment_url) await deleteFile(msg.attachment_url);
  const { rows } = await pool.query(
    "UPDATE client_messages SET downloaded = true, downloaded_at = now(), saved_location_note = $1, attachment_url = NULL WHERE id = $2 RETURNING *",
    [savedLocationNote || "", req.params.id]
  );
  res.json(rows[0]);
});

// Bulk-send to every customer in a segment (logs to each thread) — the group messaging path
router.post("/client-bulk", requireAuth, async (req, res) => {
  const { segment, text } = req.body;
  const { rows: customers } = await pool.query("SELECT id, name, phone FROM customers WHERE $1 = ANY(segments)", [segment]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const c of customers) {
      await client.query("INSERT INTO client_messages (customer_id, sender, text) VALUES ($1,'staff',$2)", [c.id, text]);
    }
    await client.query("COMMIT");
    res.json({ ok: true, count: customers.length, customers });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Couldn't send to the group." });
  } finally {
    client.release();
  }
});

export default router;
