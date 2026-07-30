import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM business_plan_targets ORDER BY category, label");
  res.json(rows);
});

router.post("/", requireAuth, requireRole("owner"), async (req, res) => {
  const { label, category, targetAmount, period } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO business_plan_targets (label, category, target_amount, period) VALUES ($1,$2,$3,$4) RETURNING *",
    [label, category || "Revenue", targetAmount, period || "monthly"]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireAuth, requireRole("owner"), async (req, res) => {
  const { label, targetAmount } = req.body;
  const { rows } = await pool.query(
    "UPDATE business_plan_targets SET label = COALESCE($1,label), target_amount = COALESCE($2,target_amount) WHERE id = $3 RETURNING *",
    [label, targetAmount, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Target not found." });
  res.json(rows[0]);
});

router.delete("/:id", requireAuth, requireRole("owner"), async (req, res) => {
  await pool.query("DELETE FROM business_plan_targets WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// Actual progress vs target — pulled from real invoice/expense data, not manual entry
router.get("/progress", requireAuth, async (req, res) => {
  const { rows: targets } = await pool.query("SELECT * FROM business_plan_targets");
  const { rows: rev } = await pool.query("SELECT COALESCE(SUM(paid),0) AS total FROM invoices WHERE created_at > now() - interval '30 days'");
  const { rows: exp } = await pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE status = 'Approved' AND created_at > now() - interval '30 days'");
  res.json({
    targets,
    actuals: { revenue30d: Number(rev[0].total), expenses30d: Number(exp[0].total) },
  });
});

export default router;
