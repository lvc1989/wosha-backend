import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is not set in your .env file. The server can't start without a database connection string — see .env.example.");
  process.exit(1);
}

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Most free Postgres hosts (Supabase, Neon, Render) require SSL.
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("Unexpected database error", err);
});
