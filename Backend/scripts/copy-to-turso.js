// Copies the local SQLite database (data/metrigo.db, or METRIGO_DB) into the
// Turso database named by TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.
// Run from Backend/:  npm run copy-to-turso
// Safe to re-run: rows that already exist in Turso are left as they are.
// Login sessions, unpaid orders and reset codes are not copied.

const path = require("path");
const { createClient } = require("@libsql/client");

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN first (see README, \"Deploying to Vercel\").");
  process.exit(1);
}

// The copy brings the "json_migrated" marker along, so skip the JSON import
process.env.METRIGO_SKIP_JSON_IMPORT = "1";
const { client: dest, ready } = require("../db");

const SOURCE = process.env.METRIGO_DB || path.join(__dirname, "..", "data", "metrigo.db");
const src = createClient({ url: "file:" + SOURCE });

// Parents before children, for the foreign keys
const TABLES = ["meta", "users", "transactions", "bookings", "booking_seats", "support_tickets"];

(async () => {
  await ready;
  console.log(`Copying ${SOURCE} → ${process.env.TURSO_DATABASE_URL}`);
  for (const table of TABLES) {
    let rs;
    try {
      rs = await src.execute(`SELECT * FROM ${table}`);
    } catch {
      console.log(`  ${table}: not in the local database, skipped`);
      continue;
    }
    if (!rs.rows.length) {
      console.log(`  ${table}: empty`);
      continue;
    }
    const cols = rs.columns;
    const sql = `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    await dest.batch(rs.rows.map(row => ({ sql, args: cols.map((_, i) => row[i]) })), "write");
    console.log(`  ${table}: ${rs.rows.length} rows`);
  }
  console.log("Done.");
})().catch(err => {
  console.error("Copy failed:", err.message);
  process.exit(1);
});
