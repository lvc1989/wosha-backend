import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();
const FLOW = ["Open", "In Progress", "Done"];

router.get("/", requireAuth, async (req, res) => {
  const { locationId } = req.query;
  const params = [];
  let where = "";
  if (locationId && locationId !== "all") { params.push(locationId); where = "WHERE location_id = $1"; }
  const { rows } = await pool.query(`SELECT * FROM manual_jobs ${where} ORDER BY created_at DESC`, params);
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { locationId, title, technicianId, dueTime, notes } = req.body;
  if (!title?.trim() || !technicianId) return res.status(400).json({ error: "Job title and an assigned staff member are required." });
  const { rows } = await pool.query(
    "INSERT INTO manual_jobs (location_id, title, technician_id, due_time, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [locationId, title, technicianId, dueTime, notes, req.user.id]
  );
  res.status(201).json(rows[0]);
});

router.patch("/:id/advance", requireAuth, async (req, res) => {
  const { rows: cur } = await pool.query("SELECT status FROM manual_jobs WHERE id = $1", [req.params.id]);
  if (!cur[0]) return res.status(404).json({ error: "Job not found." });
  const next = FLOW[Math.min(FLOW.indexOf(cur[0].status) + 1, FLOW.length - 1)];
  const { rows } = await pool.query("UPDATE manual_jobs SET status = $1 WHERE id = $2 RETURNING *", [next, req.params.id]);
  res.json(rows[0]);
});

router.patch("/:id/reassign", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { technicianId } = req.body;
  const { rows } = await pool.query("UPDATE manual_jobs SET technician_id = $1 WHERE id = $2 RETURNING *", [technicianId, req.params.id]);
  res.json(rows[0]);
});

export default router;
