import express from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const items = [];

  const prefRows = (await pool.query("SELECT category, enabled FROM notification_prefs WHERE is_custom = false")).rows;
  const enabled = (category) => prefRows.find((p) => p.category === category)?.enabled !== false;

  if (enabled("Task Reminders")) {
    const overdueTasks = (await pool.query(
      "SELECT id, title, due_date FROM tasks WHERE status != 'Done' AND due_date <= now() + interval '3 days'"
    )).rows;
    overdueTasks.forEach((t) => items.push({ id: "task-" + t.id, kind: "Task", label: t.title, urgent: new Date(t.due_date) < new Date() }));
  }

  if (enabled("Compliance Deadlines")) {
    const taxDeadlines = (await pool.query(
      "SELECT id, name, due_date FROM tax_items WHERE status != 'Filed' AND due_date <= now() + interval '7 days'"
    )).rows;
    taxDeadlines.forEach((t) => items.push({ id: "tax-" + t.id, kind: "Compliance", label: `${t.name} due ${new Date(t.due_date).toLocaleDateString()}`, urgent: new Date(t.due_date) < new Date() }));
  }

  if (enabled("Low-Stock Alerts")) {
    const lowStock = (await pool.query(
      "SELECT id, name, qty, reorder_level FROM products WHERE qty <= reorder_level"
    )).rows;
    lowStock.forEach((p) => items.push({ id: "stock-" + p.id, kind: "Stock", label: `Low stock: ${p.name} (${p.qty} left)`, urgent: true }));

    // A second, earlier warning: par_level is the target restock amount, so hitting
    // 25% of it is often a useful heads-up before the harder reorder_level line is
    // crossed — catches a product that's trending toward empty a bit sooner.
    const nearingEmpty = (await pool.query(
      "SELECT id, name, qty, par_level FROM products WHERE par_level > 0 AND qty <= par_level * 0.25 AND qty > reorder_level"
    )).rows;
    nearingEmpty.forEach((p) => items.push({ id: "stock-25pct-" + p.id, kind: "Stock", label: `${p.name} is down to ${p.qty} — 25% of its restock target (${p.par_level})`, urgent: false }));

    const openRequests = (await pool.query(
      `SELECT rr.id, p.name AS product_name FROM restock_requests rr JOIN products p ON p.id = rr.product_id WHERE rr.status = 'Open'`
    )).rows;
    openRequests.forEach((r) => items.push({ id: "restock-req-" + r.id, kind: "Stock", label: `Staff flagged "${r.product_name}" as running out`, urgent: true }));
  }

  const pendingExpenses = (await pool.query(
    "SELECT COUNT(*) FROM expenses WHERE status = 'Pending Approval'"
  )).rows[0].count;
  if (Number(pendingExpenses) > 0) items.push({ id: "exp-pending", kind: "Expense", label: `${pendingExpenses} expense claim(s) awaiting approval`, urgent: false });

  // Surfaces to every owner-tier account (the original owner AND any General Manager) —
  // this is exactly what lets the owner notice and step in if a General Manager hasn't
  // reviewed submitted work, without needing to ask them directly.
  const submittedTasks = (await pool.query(
    "SELECT COUNT(*) FROM tasks WHERE status = 'Submitted'"
  )).rows[0].count;
  if (Number(submittedTasks) > 0) items.push({ id: "task-review-pending", kind: "Task", label: `${submittedTasks} submitted task(s) awaiting review`, urgent: false });

  const pendingPOs = (await pool.query(
    "SELECT COUNT(*) FROM purchase_orders WHERE status = 'Pending Approval'"
  )).rows[0].count;
  if (Number(pendingPOs) > 0) items.push({ id: "po-pending", kind: "Purchase Order", label: `${pendingPOs} purchase order(s) awaiting approval`, urgent: false });

  res.json(items);
});

export default router;
