import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
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
      `INSERT INTO users (name, username, password_hash, role)
       VALUES ($1, $2, $3, 'owner')`,
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
