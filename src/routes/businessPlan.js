import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/project-targets", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM business_plan_project_targets WHERE id = 1");
  res.json(rows[0]);
});

router.put("/project-targets", requireAuth, requireRole("owner"), async (req, res) => {
  const { totalInvestment, targetCarsPerWeek, breakEvenCarsPerWeek, paybackYears, year1NetProfitAfterTax } = req.body;
  const { rows } = await pool.query(
    `UPDATE business_plan_project_targets SET
      total_investment = COALESCE($1, total_investment),
      target_cars_per_week = COALESCE($2, target_cars_per_week),
      break_even_cars_per_week = COALESCE($3, break_even_cars_per_week),
      payback_years = COALESCE($4, payback_years),
      year1_net_profit_after_tax = COALESCE($5, year1_net_profit_after_tax),
      updated_at = now()
     WHERE id = 1 RETURNING *`,
    [totalInvestment, targetCarsPerWeek, breakEvenCarsPerWeek, paybackYears, year1NetProfitAfterTax]
  );
  res.json(rows[0]);
});

router.get("/budget-lines", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM budget_lines ORDER BY category");
  res.json(rows);
});

router.post("/budget-lines", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { category, amount, groupName } = req.body;
  if (!category?.trim() || amount == null) return res.status(400).json({ error: "Category and monthly amount are required." });
  const { rows } = await pool.query("INSERT INTO budget_lines (category, amount, group_name) VALUES ($1,$2,$3) RETURNING *", [category.trim(), amount, groupName || "General"]);
  res.status(201).json(rows[0]);
});

router.put("/budget-lines/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { category, amount, groupName } = req.body;
  const { rows } = await pool.query(
    "UPDATE budget_lines SET category = COALESCE($1,category), amount = COALESCE($2,amount), group_name = COALESCE($3,group_name) WHERE id = $4 RETURNING *",
    [category, amount, groupName, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Line item not found." });
  res.json(rows[0]);
});

router.delete("/budget-lines/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM budget_lines WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

router.get("/budget-summary", requireAuth, async (req, res) => {
  const { rows: budgetRows } = await pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM budget_lines");
  const { rows: expenseRows } = await pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE status = 'Approved'");
  const budgeted = Number(budgetRows[0].total);
  const actual = Number(expenseRows[0].total);
  res.json({ budgeted, actual, variance: budgeted - actual });
});

// Branch targets — the owner sees and manages every branch's targets; a branch manager
// only sees their own branch's, since that's what req.user.locationId scopes them to.
router.get("/branch-targets", requireAuth, async (req, res) => {
  const isOwnerTier = req.user.role === "owner";
  const params = [];
  let where = "";
  if (!isOwnerTier) {
    if (!req.user.locationId) return res.json([]); // a manager with no assigned branch has nothing to see
    params.push(req.user.locationId);
    where = "WHERE bt.location_id = $1";
  }
  const { rows } = await pool.query(`
    SELECT bt.*, l.name AS location_name FROM branch_targets bt
    LEFT JOIN locations l ON l.id = bt.location_id
    ${where} ORDER BY bt.created_at DESC
  `, params);
  res.json(rows);
});

router.post("/branch-targets", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { locationId, category, label, targetValue, unit, period } = req.body;
  if (!locationId || !category || !label || targetValue == null) return res.status(400).json({ error: "Branch, category, label, and target value are required." });
  const { rows } = await pool.query(
    "INSERT INTO branch_targets (location_id, category, label, target_value, unit, period) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [locationId, category, label, targetValue, unit || "", period || "Monthly"]
  );
  res.status(201).json(rows[0]);
});

router.put("/branch-targets/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { category, label, targetValue, unit, period } = req.body;
  const { rows } = await pool.query(
    `UPDATE branch_targets SET category = COALESCE($1,category), label = COALESCE($2,label),
     target_value = COALESCE($3,target_value), unit = COALESCE($4,unit), period = COALESCE($5,period)
     WHERE id = $6 RETURNING *`,
    [category, label, targetValue, unit, period, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Target not found." });
  res.json(rows[0]);
});

router.delete("/branch-targets/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  await pool.query("DELETE FROM branch_targets WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
