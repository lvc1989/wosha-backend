import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requirePrimaryOwner } from "../middleware/auth.js";

const router = express.Router();
const STATUS_FLOW = ["Requested", "Confirmed", "Checked-in", "In Progress", "Completed", "Paid", "Closed"];

// Public — no login required. Matches the prototype's "Continue as Guest" flow.
router.post("/guest-request", async (req, res) => {
  const { name, phone, vehiclePlate, locationId, serviceIds, scheduledTime } = req.body;
  if (!name?.trim() || !phone?.trim() || !serviceIds?.length) {
    return res.status(400).json({ error: "Name, phone, and at least one service are required." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let customer = (await client.query("SELECT * FROM customers WHERE phone = $1", [phone])).rows[0];
    if (!customer) {
      const inserted = await client.query(
        "INSERT INTO customers (name, phone, tag) VALUES ($1,$2,'Guest Lead') RETURNING *",
        [name, phone]
      );
      customer = inserted.rows[0];
    }
    const booking = await client.query(
      `INSERT INTO bookings (location_id, customer_id, vehicle_plate, scheduled_time) VALUES ($1,$2,$3,$4) RETURNING *`,
      [locationId, customer.id, vehiclePlate, scheduledTime]
    );
    for (const sid of serviceIds) {
      await client.query("INSERT INTO booking_services (booking_id, service_id) VALUES ($1,$2)", [booking.rows[0].id, sid]);
    }
    await client.query("COMMIT");
    res.status(201).json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Couldn't send the request — please try again." });
  } finally {
    client.release();
  }
});

router.get("/", requireAuth, async (req, res) => {
  const { locationId, from, to, limit, offset, includeArchived } = req.query;
  const conditions = [];
  const params = [];
  if (!includeArchived) conditions.push("b.archived = false");
  if (locationId && locationId !== "all") { params.push(locationId); conditions.push(`b.location_id = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`b.created_at >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`b.created_at < $${params.length}::date + interval '1 day'`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const whereParamCount = params.length;

  // Without an explicit date range, default to the most recent 200 — without this,
  // a business running for years would eventually load its *entire* booking history
  // on every single page visit, getting slower and slower as records pile up.
  const safeLimit = Math.min(Number(limit) || 200, 500);
  const safeOffset = Number(offset) || 0;
  params.push(safeLimit, safeOffset);

  const { rows } = await pool.query(`
    SELECT b.*, COALESCE(json_agg(bs.service_id) FILTER (WHERE bs.service_id IS NOT NULL), '[]') AS service_ids
    FROM bookings b
    LEFT JOIN booking_services bs ON bs.booking_id = b.id
    ${where}
    GROUP BY b.id ORDER BY b.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM bookings b ${where}`, params.slice(0, whereParamCount));
  res.set("X-Total-Count", countRows[0].count);
  res.json(rows);
});

router.post("/", requireAuth, async (req, res) => {
  const { locationId, customerId, vehiclePlate, technicianId, scheduledTime, serviceIds } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO bookings (location_id, customer_id, vehicle_plate, technician_id, scheduled_time)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [locationId, customerId, vehiclePlate, technicianId, scheduledTime]
    );
    for (const sid of serviceIds || []) {
      await client.query("INSERT INTO booking_services (booking_id, service_id) VALUES ($1,$2)", [rows[0].id, sid]);
    }
    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Couldn't create booking." });
  } finally {
    client.release();
  }
});

router.patch("/:id/advance", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT status FROM bookings WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Booking not found." });
  const idx = STATUS_FLOW.indexOf(rows[0].status);
  const next = STATUS_FLOW[Math.min(idx + 1, STATUS_FLOW.length - 1)];
  const updated = await pool.query("UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *", [next, req.params.id]);
  res.json(updated.rows[0]);
});

// A client requested a booking and never showed up — a distinct end state from the
// normal Requested→Closed progression, not just another step forward in it.
router.patch("/:id/no-show", requireAuth, async (req, res) => {
  const { rows } = await pool.query("UPDATE bookings SET status = 'No Show' WHERE id = $1 RETURNING *", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Booking not found." });
  res.json(rows[0]);
});

// "Remove from list" — clears a finished or no-show booking off the active view without
// deleting the underlying record, so historical reports and cash flow stay accurate.
router.patch("/:id/archive", requireAuth, async (req, res) => {
  const booking = (await pool.query("SELECT status FROM bookings WHERE id = $1", [req.params.id])).rows[0];
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  if (!["Closed", "Paid", "No Show"].includes(booking.status)) {
    return res.status(400).json({ error: "Only a finished, paid, or no-show booking can be removed from the list." });
  }
  const { rows } = await pool.query("UPDATE bookings SET archived = true WHERE id = $1 RETURNING *", [req.params.id]);
  res.json(rows[0]);
});

// A General Manager (or the owner) marks a booking as ready for the owner's sign-off —
// typically once work is assigned and completed. Clears any previous review note so an
// old "needs improvement" comment doesn't linger after it's been addressed.
router.patch("/:id/send-for-review", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE bookings SET owner_review_status = 'Needs Review', review_note = NULL, assigned_by = $1 WHERE id = $2 RETURNING *",
    [req.user.id, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Booking not found." });
  res.json(rows[0]);
});

// The owner's actual decision — approve it, send it back with feedback for the GM/staff
// to fix, or reject it outright. Only the real owner signs off, never the GM themself,
// since the whole point is a second pair of eyes above the person who assigned the work.
router.patch("/:id/owner-review", requireAuth, requirePrimaryOwner, async (req, res) => {
  const { decision, note } = req.body;
  if (!["Approved", "Needs Improvement", "Rejected"].includes(decision)) {
    return res.status(400).json({ error: "Decision must be Approved, Needs Improvement, or Rejected." });
  }
  const { rows } = await pool.query(
    "UPDATE bookings SET owner_review_status = $1, review_note = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $4 RETURNING *",
    [decision, note || null, req.user.id, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Booking not found." });
  res.json(rows[0]);
});

router.put("/:id", requireAuth, async (req, res) => {
  const { locationId, customerId, vehiclePlate, technicianId, scheduledTime, status, serviceIds } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE bookings SET
        location_id = COALESCE($1,location_id), customer_id = COALESCE($2,customer_id),
        vehicle_plate = COALESCE($3,vehicle_plate), technician_id = COALESCE($4,technician_id),
        scheduled_time = COALESCE($5,scheduled_time), status = COALESCE($6,status)
       WHERE id = $7 RETURNING *`,
      [locationId, customerId, vehiclePlate, technicianId, scheduledTime, status, req.params.id]
    );
    if (!rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Booking not found." }); }
    if (serviceIds) {
      await client.query("DELETE FROM booking_services WHERE booking_id = $1", [req.params.id]);
      for (const sid of serviceIds) {
        await client.query("INSERT INTO booking_services (booking_id, service_id) VALUES ($1,$2)", [req.params.id, sid]);
      }
    }
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Couldn't update booking." });
  } finally {
    client.release();
  }
});

export default router;
