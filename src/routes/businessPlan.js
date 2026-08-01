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
  const { category, amount } = req.body;
  if (!category?.trim() || amount == null) return res.status(400).json({ error: "Category and monthly amount are required." });
  const { rows } = await pool.query("INSERT INTO budget_lines (category, amount) VALUES ($1,$2) RETURNING *", [category.trim(), amount]);
  res.status(201).json(rows[0]);
});

router.put("/budget-lines/:id", requireAuth, requireRole("owner", "manager"), async (req, res) => {
  const { category, amount } = req.body;
  const { rows } = await pool.query(
    "UPDATE budget_lines SET category = COALESCE($1,category), amount = COALESCE($2,amount) WHERE id = $3 RETURNING *",
    [category, amount, req.params.id]
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

export default router;
