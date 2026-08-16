import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  // Each of these runs as its own separate, independently-committed query —
  // not folded into the one big schema.sql batch below. A real production
  // deploy failed once because a pre-existing row with an unexpected value
  // made a later ALTER TABLE ADD CONSTRAINT impossible to satisfy, and
  // relying on that repair being properly sequenced inside one giant
  // multi-statement batch wasn't reliable. This runs every such repair found
  // in a full audit of the schema, each guaranteed to actually commit first.
  const repairs = [
    { table: "categories", sql: `UPDATE categories SET type = 'service' WHERE type NOT IN
      ('service','product','expense','purchase_order','client_segment','cashflow','supplier','task_template','branch_target','roster_activity')` },
    { table: "bookings", sql: `UPDATE bookings SET owner_review_status = NULL WHERE owner_review_status IS NOT NULL
      AND owner_review_status NOT IN ('Needs Review','Approved','Needs Improvement','Rejected')` },
    { table: "bookings", sql: `UPDATE bookings SET status = 'Requested' WHERE status NOT IN
      ('Requested','Confirmed','Checked-in','In Progress','Completed','Paid','Closed','No Show')` },
    { table: "tasks", sql: `UPDATE tasks SET status = 'Open' WHERE status NOT IN
      ('Open','In Progress','Submitted','Done','Rejected')` },
    { table: "custom_field_defs", sql: `UPDATE custom_field_defs SET entity_type = 'customer' WHERE entity_type NOT IN
      ('customer','staff','booking','branch')` },
  ];
  for (const r of repairs) {
    try {
      await pool.query(r.sql);
    } catch (err) {
      // The table doesn't exist yet on a genuinely first-ever deploy (nothing
      // to repair) — anything else should still surface normally.
      if (err.code !== "42P01") throw err;
    }
  }

  console.log("Applying schema.sql...");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  // Executed one statement at a time, not as one giant multi-statement batch.
  // A real production deploy showed confusing, hard-to-diagnose behavior where
  // an error deep in one big batch got reported against an earlier statement
  // that had, in fact, already succeeded — this removes that ambiguity, and
  // pinpoints the exact failing statement if anything ever does fail again.
  // Comments are stripped line-by-line BEFORE splitting on semicolons — an
  // earlier version split first, which silently dropped entire statements
  // whenever a trailing inline comment sat after a semicolon on the same line.
  const noComments = schema
    .split("\n")
    .map((line) => { const idx = line.indexOf("--"); return idx === -1 ? line : line.slice(0, idx); })
    .join("\n");
  const statements = noComments.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
    } catch (err) {
      console.error("Failed statement:", stmt.slice(0, 300));
      throw err;
    }
  }
  console.log("Schema applied.");

  // Seed one branch and one owner account so you can log in immediately.
  const existing = await pool.query("SELECT id FROM users WHERE username = 'owner'");
  if (existing.rows.length === 0) {
    const loc = await pool.query(
      "INSERT INTO locations (name) VALUES ($1) RETURNING id",
      ["Main Branch"]
    );
    const passwordHash = await bcrypt.hash("owner123", 10);
    await pool.query(
      `INSERT INTO users (name, username, password_hash, role, is_primary_owner)
       VALUES ($1, $2, $3, 'owner', true)`,
      ["Owner", "owner", passwordHash]
    );
    console.log("Seeded starter branch and owner account (username: owner / password: owner123).");
    console.log("⚠️  Change this password immediately after your first login.");
  } else {
    console.log("Owner account already exists — skipping seed.");
  }

  await pool.end();
  console.log("Done.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
