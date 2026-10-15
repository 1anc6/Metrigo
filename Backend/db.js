// MetriGo storage — SQLite via better-sqlite3 (synchronous, so each
// db.transaction() runs atomically with respect to other requests).
// On first start the legacy data/users.json and data/bookings.json are
// imported once; after that the JSON files are never read or written.

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = process.env.METRIGO_DB || path.join(DATA_DIR, "metrigo.db");

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    email        TEXT PRIMARY KEY COLLATE NOCASE,
    password     TEXT NOT NULL,          -- bcrypt ($2…) or legacy scrypt "salt:hash"
    name         TEXT NOT NULL DEFAULT '',
    created_at   TEXT,
    favorites    TEXT NOT NULL DEFAULT '[]',  -- JSON array of station names
    card_balance INTEGER NOT NULL DEFAULT 0 CHECK (card_balance >= 0)
  );

  -- Metro Card ledger; newest first = highest id
  CREATE TABLE IF NOT EXISTS transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL REFERENCES users(email),
    type       TEXT NOT NULL,            -- recharge | ticket | refund
    amount     INTEGER NOT NULL,
    method     TEXT,
    payment_id TEXT,
    pnr        TEXT,
    at         TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS transactions_email ON transactions(email, id);

  -- The full booking object is kept in "data" (minus userEmail) so the API
  -- returns exactly what was stored; the columns are for lookups.
  CREATE TABLE IF NOT EXISTS bookings (
    pnr         TEXT PRIMARY KEY,
    user_email  TEXT NOT NULL,
    status      TEXT NOT NULL,
    travel_date TEXT,
    train_id    TEXT,
    depart_at   REAL,
    booked_at   TEXT,
    data        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS bookings_user ON bookings(user_email);

  -- One row per seat of a confirmed, dated booking. Rows are deleted when the
  -- booking is cancelled, so the unique index means a seat on a given
  -- train/date can belong to only one confirmed booking.
  CREATE TABLE IF NOT EXISTS booking_seats (
    pnr         TEXT NOT NULL REFERENCES bookings(pnr) ON DELETE CASCADE,
    travel_date TEXT NOT NULL,
    train_id    TEXT NOT NULL,
    seat        TEXT NOT NULL,
    UNIQUE (travel_date, train_id, seat)
  );
  CREATE INDEX IF NOT EXISTS booking_seats_pnr ON booking_seats(pnr);

  CREATE TABLE IF NOT EXISTS support_tickets (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket  TEXT NOT NULL,
    email   TEXT NOT NULL,
    topic   TEXT NOT NULL,
    message TEXT NOT NULL,
    at      TEXT NOT NULL
  );

  -- A pending, unreleased, unexpired ticket order holds its seats.
  -- status: pending -> settling (claimed by verify/webhook) -> settled (result stored)
  CREATE TABLE IF NOT EXISTS payment_orders (
    id                TEXT PRIMARY KEY,
    email             TEXT NOT NULL,
    purpose           TEXT NOT NULL,     -- ticket | recharge
    amount            INTEGER NOT NULL,
    metro_card_amount INTEGER NOT NULL,
    draft             TEXT NOT NULL,     -- JSON
    travel_date       TEXT,              -- ticket orders only, for seat-hold lookups
    train_id          TEXT,
    expires           INTEGER NOT NULL,  -- epoch ms; the seat hold ends here
    released          INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'pending',
    result            TEXT,              -- JSON response of the settlement
    refund            TEXT,              -- JSON
    last_error        TEXT
  );
  CREATE INDEX IF NOT EXISTS payment_orders_hold ON payment_orders(travel_date, train_id, status);

  -- One reset code per account, stored as a SHA-256 hash
  CREATE TABLE IF NOT EXISTS reset_tokens (
    email    TEXT PRIMARY KEY,
    hash     TEXT NOT NULL,
    expires  INTEGER NOT NULL,           -- epoch ms
    attempts INTEGER NOT NULL DEFAULT 0
  );
`);

// =============================
// ONE-TIME IMPORT OF THE LEGACY JSON FILES
// =============================
function readLegacy(file) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

const insertUser = db.prepare(`
  INSERT INTO users (email, password, name, created_at, favorites, card_balance)
  VALUES (@email, @password, @name, @createdAt, @favorites, @cardBalance)
`);
const insertTxn = db.prepare(`
  INSERT INTO transactions (email, type, amount, method, payment_id, pnr, at)
  VALUES (@email, @type, @amount, @method, @paymentId, @pnr, @at)
`);
const insertBooking = db.prepare(`
  INSERT INTO bookings (pnr, user_email, status, travel_date, train_id, depart_at, booked_at, data)
  VALUES (@pnr, @userEmail, @status, @travelDate, @trainId, @departAt, @bookedAt, @data)
`);
const insertSeat = db.prepare(`
  INSERT INTO booking_seats (pnr, travel_date, train_id, seat) VALUES (?, ?, ?, ?)
`);

function bookingRow(booking) {
  const { userEmail, ...data } = booking;
  return {
    pnr: booking.pnr,
    userEmail: String(userEmail).toLowerCase(),
    status: booking.status || "Confirmed",
    travelDate: booking.travelDate || null,
    trainId: booking.trainId || null,
    departAt: booking.departAt ?? null,
    bookedAt: booking.bookedAt || null,
    data: JSON.stringify(data),
  };
}

const migrateJSON = db.transaction(() => {
  const users = readLegacy("users.json");
  const bookings = readLegacy("bookings.json");
  const tickets = readLegacy("support.json");

  for (const u of users) {
    if (!u || !u.email || !u.password) continue;
    const email = String(u.email).toLowerCase();
    insertUser.run({
      email,
      password: u.password,
      name: u.name || "",
      createdAt: u.createdAt || null,
      favorites: JSON.stringify(Array.isArray(u.favorites) ? u.favorites : []),
      cardBalance: Math.max(0, Math.round(u.cardBalance || 0)),
    });
    // JSON stored newest first; insert oldest first so ids increase with time
    for (const t of [...(u.transactions || [])].reverse()) {
      insertTxn.run({
        email, type: t.type, amount: t.amount, method: t.method ?? null,
        paymentId: t.paymentId ?? null, pnr: t.pnr ?? null, at: t.at || new Date().toISOString(),
      });
    }
  }

  let skippedSeats = 0;
  for (const b of bookings) {
    if (!b || !b.pnr || !b.userEmail) continue;
    insertBooking.run(bookingRow(b));
    // Legacy bookings have no travelDate/trainId: they load, but hold no seat
    if ((b.status || "Confirmed") === "Confirmed" && b.travelDate && b.trainId) {
      for (const seat of b.seats || (b.seat ? [b.seat] : [])) {
        try {
          insertSeat.run(b.pnr, b.travelDate, b.trainId, seat);
        } catch (err) {
          if (err.code !== "SQLITE_CONSTRAINT_UNIQUE") throw err;
          skippedSeats++;
        }
      }
    }
  }

  const insertTicket = db.prepare(
    "INSERT INTO support_tickets (ticket, email, topic, message, at) VALUES (?, ?, ?, ?, ?)");
  for (const t of tickets) {
    if (t && t.ticket) insertTicket.run(t.ticket, t.email, t.topic, t.message, t.at);
  }

  db.prepare("INSERT INTO meta (key, value) VALUES ('json_migrated', ?)").run(new Date().toISOString());
  return { users: users.length, bookings: bookings.length, tickets: tickets.length, skippedSeats };
});

if (!db.prepare("SELECT 1 FROM meta WHERE key = 'json_migrated'").get()) {
  const r = migrateJSON();
  console.log(`Imported ${r.users} users, ${r.bookings} bookings, ${r.tickets} support tickets from JSON into SQLite` +
    (r.skippedSeats ? ` (${r.skippedSeats} double-booked seats skipped)` : ""));
}

// =============================
// QUERIES
// =============================
const q = {
  userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  updateName: db.prepare("UPDATE users SET name = ? WHERE email = ?"),
  updateFavorites: db.prepare("UPDATE users SET favorites = ? WHERE email = ?"),
  updatePassword: db.prepare("UPDATE users SET password = ? WHERE email = ?"),
  credit: db.prepare("UPDATE users SET card_balance = card_balance + ? WHERE email = ?"),
  // Only succeeds when the balance covers the debit
  debit: db.prepare("UPDATE users SET card_balance = card_balance - @amount WHERE email = @email AND card_balance >= @amount"),
  balance: db.prepare("SELECT card_balance FROM users WHERE email = ?").pluck(),
  recentTxns: db.prepare("SELECT type, amount, method, payment_id, pnr, at FROM transactions WHERE email = ? ORDER BY id DESC LIMIT ?"),

  bookingByPnr: db.prepare("SELECT * FROM bookings WHERE pnr = ?"),
  bookingsByUser: db.prepare("SELECT * FROM bookings WHERE user_email = ?"),
  pnrExists: db.prepare("SELECT 1 FROM bookings WHERE pnr = ?").pluck(),
  takenSeats: db.prepare("SELECT seat FROM booking_seats WHERE travel_date = ? AND train_id = ?").pluck(),
  cancelBooking: db.prepare("UPDATE bookings SET status = 'Cancelled', data = ? WHERE pnr = ? AND status = 'Confirmed'"),
  releaseSeats: db.prepare("DELETE FROM booking_seats WHERE pnr = ?"),

  insertTicket: db.prepare("INSERT INTO support_tickets (ticket, email, topic, message, at) VALUES (?, ?, ?, ?, ?)"),

  // Settlement lookups by payment id, so a payment is never settled twice
  bookingByPaymentId: db.prepare("SELECT * FROM bookings WHERE json_extract(data, '$.payment.paymentId') = ?"),
  txnByPaymentId: db.prepare("SELECT email FROM transactions WHERE payment_id = ? LIMIT 1"),

  insertOrder: db.prepare(`
    INSERT INTO payment_orders (id, email, purpose, amount, metro_card_amount, draft, travel_date, train_id, expires)
    VALUES (@id, @email, @purpose, @amount, @metroCardAmount, @draft, @travelDate, @trainId, @expires)`),
  orderById: db.prepare("SELECT * FROM payment_orders WHERE id = ?"),
  pruneOrders: db.prepare("DELETE FROM payment_orders WHERE expires < ?"),
  heldSeatDrafts: db.prepare(`
    SELECT draft FROM payment_orders
    WHERE travel_date = ? AND train_id = ? AND purpose = 'ticket' AND status = 'pending'
      AND released = 0 AND expires > ? AND email IS NOT ?`).pluck(),
  releaseOrder: db.prepare("UPDATE payment_orders SET released = 1 WHERE id = ? AND email = ?"),
  releaseUserTicketOrders: db.prepare("UPDATE payment_orders SET released = 1 WHERE email = ? AND purpose = 'ticket'"),
  claimOrder: db.prepare("UPDATE payment_orders SET status = 'settling' WHERE id = ? AND status = 'pending'"),
  finishOrder: db.prepare("UPDATE payment_orders SET status = 'settled', result = ?, refund = ? WHERE id = ?"),
  orderError: db.prepare("UPDATE payment_orders SET last_error = ? WHERE id = ?"),

  upsertResetToken: db.prepare("INSERT OR REPLACE INTO reset_tokens (email, hash, expires, attempts) VALUES (?, ?, ?, 0)"),
  resetToken: db.prepare("SELECT * FROM reset_tokens WHERE email = ?"),
  resetAttempt: db.prepare("UPDATE reset_tokens SET attempts = attempts + 1 WHERE email = ?"),
  deleteResetToken: db.prepare("DELETE FROM reset_tokens WHERE email = ?"),
  consumeResetToken: db.prepare("DELETE FROM reset_tokens WHERE email = ? AND hash = ?"),
  pruneResetTokens: db.prepare("DELETE FROM reset_tokens WHERE expires < ?"),
};

// Row → the user object shape the routes (and API) have always used
function toUser(row) {
  if (!row) return null;
  return {
    email: row.email,
    password: row.password,
    name: row.name,
    createdAt: row.created_at,
    favorites: JSON.parse(row.favorites),
    cardBalance: row.card_balance,
  };
}

// Same key order and omitted-when-absent fields as the old JSON ledger
function toTxn(row) {
  const t = { type: row.type, amount: row.amount };
  if (row.method != null) t.method = row.method;
  if (row.payment_id != null) t.paymentId = row.payment_id;
  if (row.pnr != null) t.pnr = row.pnr;
  t.at = row.at;
  return t;
}

// Row → booking object including userEmail, as it was stored in bookings.json
function toBooking(row) {
  if (!row) return null;
  const data = JSON.parse(row.data);
  return { pnr: data.pnr, userEmail: row.user_email, ...data };
}

module.exports = {
  db,
  q,
  toUser,
  toTxn,
  toBooking,
  bookingRow,
  insertUser,
  insertTxn,
  insertBooking,
  insertSeat,
};
