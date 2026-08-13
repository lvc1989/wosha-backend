import express from "express";
import { pool } from "../db/pool.js";

const router = express.Router();

// Public, no auth — called once per real browser session on the website (the
// website itself is responsible for not calling this more than once per visit,
// via sessionStorage). Atomic increment, not read-then-write, so concurrent
// visitors can never race each other into an undercount.
router.post("/track", async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE site_visit_counter SET count = count + 1 WHERE id = 1 RETURNING count"
  );
  res.json({ count: Number(rows[0].count) });
});

router.get("/count", async (req, res) => {
  const { rows } = await pool.query("SELECT count FROM site_visit_counter WHERE id = 1");
  res.json({ count: Number(rows[0]?.count || 0) });
});

export default router;
