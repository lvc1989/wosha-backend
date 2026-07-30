import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// ---- Team chat ----
router.get("/team", requireAuth, async (req, res) => {
  const { channel } = req.query;
  const params = [channel || "all"];
  const { rows } = await pool.query(
    `SELECT tm.*, u.name AS sender_name FROM team_messages tm LEFT JOIN users u ON u.id = tm.sender_id
     WHERE tm.channel = $1 ORDER BY tm.created_at`,
    params
  );
  res.json(rows);
});

router.post("/team", requireAuth, async (req, res) => {
  const { channel, text, attachmentUrl } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO team_messages (channel, sender_id, text, attachment_url) VALUES ($1,$2,$3,$4) RETURNING *",
    [channel || "all", req.user.id, text, attachmentUrl]
  );
  res.status(201).json(rows[0]);
});

// ---- Client messages ----
router.get("/client/:customerId", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM client_messages WHERE customer_id = $1 ORDER BY created_at",
    [req.params.customerId]
  );
  res.json(rows);
});

// All threads that have an unread (customer-sent, most recent) message — for notifications
router.get("/client-unread", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (customer_id) customer_id, sender, text, created_at
    FROM client_messages
    ORDER BY customer_id, created_at DESC
  `);
  res.json(rows.filter((r) => r.sender === "customer"));
});

router.post("/client/:customerId", requireAuth, async (req, res) => {
  const { text, attachmentUrl, sender } = req.body; // sender: 'staff' or 'customer'
  const { rows } = await pool.query(
    "INSERT INTO client_messages (customer_id, sender, text, attachment_url) VALUES ($1,$2,$3,$4) RETURNING *",
    [req.params.customerId, sender || "staff", text, attachmentUrl]
  );
  res.status(201).json(rows[0]);
});

// Bulk-send to every customer in a segment (logs to each thread)
router.post("/client-bulk", requireAuth, async (req, res) => {
  const { segment, text } = req.body;
  const { rows: customers } = await pool.query("SELECT id FROM customers WHERE $1 = ANY(segments)", [segment]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const c of customers) {
      await client.query(
        "INSERT INTO client_messages (customer_id, sender, text) VALUES ($1,'staff',$2)",
        [c.id, text]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true, count: customers.length });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Couldn't send to the group." });
  } finally {
    client.release();
  }
});

export default router;
