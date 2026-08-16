import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  // Runs as its own separate, independently-committed query — not folded into
  // the one big schema.sql batch below. A real production deploy failed once
  // because a pre-existing row with an unexpected category type made the
  // later ALTER TABLE ADD CONSTRAINT impossible to satisfy, and relying on
  // that repair being properly sequenced inside one giant multi-statement
  // batch wasn't reliable enough — this guarantees it actually lands first.
  try {
    await pool.query(`
      UPDATE categories SET type = 'service' WHERE type NOT IN
        ('service','product','expense','purchase_order','client_segment','cashflow','supplier','task_template','branch_target','roster_activity')
    `);
  } catch (err) {
    // The categories table doesn't exist yet on a genuinely first-ever deploy
    // (nothing to repair) — anything else should still surface normally.
    if (err.code !== "42P01") throw err;
  }

  console.log("Applying schema.sql...");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
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
