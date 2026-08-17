import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();
const FLOW = ["Scheduled", "In Progress", "Done"];

// A week (or any date range) of the roster, joined with staff/location names
// so the frontend doesn't need a second round-trip just to show who's who.
router.get("/", requireAuth, async (req, res) => {
  const { locationId, from, to } = req.query;
  const params = [];
  const where = [];
  if (locationId && locationId !== "all") { params.push(locationId); where.push(`dr.location_id = $${params.length}`); }
  if (from) { params.push(from); where.push(`dr.roster_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`dr.roster_date <= $${params.length}`); }
  const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
  const { rows } = await pool.query(
    `SELECT dr.*, s.name AS technician_name, l.name AS location_name
     FROM duty_roster dr
     LEFT JOIN staff s ON s.id = dr.technician_id
     LEFT JOIN locations l ON l.id = dr.location_id
     ${whereClause}
     ORDER BY dr.roster_date, s.name`,
    params
  );
  res.json(rows);
});

router.get("/settings", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM roster_settings WHERE id = 1");
  res.json(rows[0]);
});

router.put("/settings", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { autoSchedulerEnabled } = req.body;
  const { rows } = await pool.query(
    "UPDATE roster_settings SET auto_scheduler_enabled = COALESCE($1, auto_scheduler_enabled) WHERE id = 1 RETURNING *",
    [autoSchedulerEnabled]
  );
  res.json(rows[0]);
});

// Manual entry — always available regardless of the auto-scheduler's pause state.
router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { locationId, technicianId, activity, rosterDate, notes } = req.body;
  if (!technicianId || !activity?.trim() || !rosterDate) {
    return res.status(400).json({ error: "Staff member, activity, and date are required." });
  }
  const { rows } = await pool.query(
    `INSERT INTO duty_roster (location_id, technician_id, activity, roster_date, notes, auto_generated, created_by)
     VALUES ($1,$2,$3,$4,$5,false,$6) RETURNING *`,
    [locationId, technicianId, activity.trim(), rosterDate, notes || null, req.user.id]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { technicianId, activity, rosterDate, notes, status } = req.body;
  const { rows } = await pool.query(
    `UPDATE duty_roster SET
      technician_id = COALESCE($1, technician_id), activity = COALESCE($2, activity),
      roster_date = COALESCE($3, roster_date), notes = COALESCE($4, notes), status = COALESCE($5, status)
     WHERE id = $6 RETURNING *`,
    [technicianId, activity, rosterDate, notes, status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Roster entry not found." });
  res.json(rows[0]);
});

router.patch("/:id/advance", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT status FROM duty_roster WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Roster entry not found." });
  const idx = FLOW.indexOf(rows[0].status);
  const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : rows[0].status;
  const { rows: updated } = await pool.query("UPDATE duty_roster SET status = $1 WHERE id = $2 RETURNING *", [next, req.params.id]);
  res.json(updated[0]);
});

router.delete("/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM duty_roster WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

// Randomly assigns each active staff member at the branch to one activity per
// day across the requested date range — the "automatic, random" assignment
// described. Blocked while the scheduler is paused; manual entries above are
// never affected by that pause.
router.post("/auto-generate", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { locationId, from, to } = req.body;
  if (!locationId || !from || !to) return res.status(400).json({ error: "Branch and a date range are required." });

  const { rows: settingsRows } = await pool.query("SELECT auto_scheduler_enabled FROM roster_settings WHERE id = 1");
  if (!settingsRows[0]?.auto_scheduler_enabled) {
    return res.status(409).json({ error: "The auto-scheduler is currently paused. Resume it in Settings, or add roster entries manually." });
  }

  const { rows: staffRows } = await pool.query(
    "SELECT id FROM staff WHERE location_id = $1 AND active = true", [locationId]
  );
  if (staffRows.length === 0) return res.status(400).json({ error: "No active staff at this branch to assign." });

  const { rows: activityRows } = await pool.query("SELECT name FROM categories WHERE type = 'roster_activity'");
  if (activityRows.length === 0) return res.status(400).json({ error: "No roster activities configured yet." });
  const activities = activityRows.map((r) => r.name);

  const dates = [];
  let d = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (d <= end) { dates.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }

  // One batched multi-row INSERT instead of one round-trip per staff member
  // per day — for a real branch (say 10 staff, a full week), that's the
  // difference between 1 database round-trip and 70 sequential ones.
  const values = [];
  const params = [];
  let p = 0;
  for (const date of dates) {
    const shuffled = [...activities].sort(() => Math.random() - 0.5);
    for (let i = 0; i < staffRows.length; i++) {
      const activity = shuffled[i % shuffled.length];
      values.push(`($${++p},$${++p},$${++p},$${++p},true,$${++p})`);
      params.push(locationId, staffRows[i].id, activity, date, req.user.id);
    }
  }
  const { rows: created } = await pool.query(
    `INSERT INTO duty_roster (location_id, technician_id, activity, roster_date, auto_generated, created_by)
     VALUES ${values.join(",")} RETURNING *`,
    params
  );
  res.status(201).json({ count: created.length });
});

export default router;
