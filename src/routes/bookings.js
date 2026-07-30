import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();
const STATUS_FLOW = ["Requested", "Confirmed", "Checked-in", "In Progress", "Completed", "Paid", "Closed"];

router.get("/", requireAuth, async (req, res) => {
  const { locationId } = req.query;
  const params = [];
  let where = "";
  if (locationId && locationId !== "all") { params.push(locationId); where = "WHERE b.location_id = $1"; }
  const { rows } = await pool.query(`
    SELECT b.*, COALESCE(json_agg(bs.service_id) FILTER (WHERE bs.service_id IS NOT NULL), '[]') AS service_ids
    FROM bookings b
    LEFT JOIN booking_services bs ON bs.booking_id = b.id
    ${where}
    GROUP BY b.id ORDER BY b.created_at DESC
  `, params);
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

router.put("/:id", requireAuth, async (req, res) => {
  const { technicianId, scheduledTime, status } = req.body;
  const { rows } = await pool.query(
    `UPDATE bookings SET technician_id = COALESCE($1,technician_id), scheduled_time = COALESCE($2,scheduled_time),
     status = COALESCE($3,status) WHERE id = $4 RETURNING *`,
    [technicianId, scheduledTime, status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Booking not found." });
  res.json(rows[0]);
});

export default router;
