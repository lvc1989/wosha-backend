import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Looks up which customer a vehicle belongs to by its plate — used when scanning a
// plate/vehicle card in Record Sale to instantly identify a returning customer.
router.get("/by-plate/:plate", requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT c.* FROM customers c
    JOIN vehicles v ON v.customer_id = c.id
    WHERE UPPER(v.plate) = UPPER($1) LIMIT 1
  `, [req.params.plate]);
  if (!rows[0]) return res.status(404).json({ error: "No customer on file for that plate." });
  res.json(rows[0]);
});

// The "smart" scan behavior: if the plate matches an existing customer, just identify
// them (no duplicate created). If it doesn't match anyone, a new customer record is
// created automatically — tagged 'New (Scanned)' so it's easy to spot and shows up as
// a reminder until someone fills in their name/phone properly.
router.post("/find-or-create-by-plate", requireAuth, async (req, res) => {
  const { plate } = req.body;
  if (!plate?.trim()) return res.status(400).json({ error: "A plate number is required." });

  const existing = await pool.query(`
    SELECT c.* FROM customers c
    JOIN vehicles v ON v.customer_id = c.id
    WHERE UPPER(v.plate) = UPPER($1) LIMIT 1
  `, [plate]);
  if (existing.rows[0]) return res.json({ customer: existing.rows[0], created: false });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      "INSERT INTO customers (name, tag) VALUES ($1, 'New (Scanned)') RETURNING *",
      [`Customer — ${plate.trim().toUpperCase()}`]
    );
    const customer = inserted.rows[0];
    await client.query("INSERT INTO vehicles (customer_id, plate) VALUES ($1, $2)", [customer.id, plate.trim().toUpperCase()]);
    await client.query("COMMIT");
    res.status(201).json({ customer, created: true });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT c.*, COALESCE(json_agg(v.*) FILTER (WHERE v.id IS NOT NULL), '[]') AS vehicles FROM customers c LEFT JOIN vehicles v ON v.customer_id = c.id WHERE c.id = $1 GROUP BY c.id", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Customer not found." });
  res.json(rows[0]);
});

router.get("/", requireAuth, async (req, res) => {
  const { search, limit, offset } = req.query;
  const conditions = [];
  const params = [];
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    conditions.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const safeLimit = Math.min(Number(limit) || 200, 500);
  const safeOffset = Number(offset) || 0;
  const countParams = [...params];
  params.push(safeLimit, safeOffset);

  const { rows } = await pool.query(`
    SELECT c.*, COALESCE(json_agg(v.*) FILTER (WHERE v.id IS NOT NULL), '[]') AS vehicles
    FROM customers c
    LEFT JOIN vehicles v ON v.customer_id = c.id
    ${where}
    GROUP BY c.id ORDER BY c.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM customers c ${where}`, countParams);
  res.set("X-Total-Count", countRows[0].count);
  res.json(rows);
});

router.post("/", requireAuth, async (req, res) => {
  const { name, phone, email, tag, customData, vehicle } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "INSERT INTO customers (name, phone, email, tag, custom_data) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [name, phone, email, tag || "First-time", customData || {}]
    );
    if (vehicle?.plate) {
      await client.query(
        "INSERT INTO vehicles (customer_id, plate, make, model, color) VALUES ($1,$2,$3,$4,$5)",
        [rows[0].id, vehicle.plate, vehicle.make, vehicle.model, vehicle.color]
      );
    }
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Couldn't add customer." });
  } finally {
    client.release();
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  const { name, phone, email, tag, customData, segments } = req.body;
  const { rows } = await pool.query(
    `UPDATE customers SET
      name = COALESCE($1, name), phone = COALESCE($2, phone), email = COALESCE($3, email),
      tag = COALESCE($4, tag), custom_data = COALESCE($5, custom_data), segments = COALESCE($6, segments)
     WHERE id = $7 RETURNING *`,
    [name, phone, email, tag, customData, segments, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Customer not found." });
  res.json(rows[0]);
});

router.post("/:id/vehicles", requireAuth, async (req, res) => {
  const { plate, make, model, color } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO vehicles (customer_id, plate, make, model, color) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [req.params.id, plate, make, model, color]
  );
  res.status(201).json(rows[0]);
});

export default router;
