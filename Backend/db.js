// MetriGo storage — libSQL (SQLite) through @libsql/client.
// - Production (Vercel): a Turso database, set TURSO_DATABASE_URL and
//   TURSO_AUTH_TOKEN.
// - Local: the SQLite file data/metrigo.db (or METRIGO_DB).
// Every query is async. transaction(fn) runs fn inside one write
// transaction; queries made anywhere inside it (found through
// AsyncLocalStorage) join that transaction, and a nested transaction()
// becomes a savepoint. On first start the legacy data/users.json and
// data/bookings.json are imported once.

const { AsyncLocalStorage } = require("async_hooks");
const session = require("express-session");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DB_URL = process.env.TURSO_DATABASE_URL ||
  "file:" + (process.env.METRIGO_DB || path.join(DATA_DIR, "metrigo.db"));
const IS_FILE = DB_URL.startsWith("file:");

// Turso goes over HTTP with the pure-JS web client (no native module to
// bundle on Vercel); local files need the Node client
const { createClient } = IS_FILE ? require("@libsql/client") : require("@libsql/client/web");

const client = createClient({ url: DB_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// =============================
// QUERY + TRANSACTION HELPERS
// =============================
const txStore = new AsyncLocalStorage();
let savepointSeq = 0;

function executor() {
  return txStore.getStore() || client;
}

function rowToObject(columns, row) {
  const o = {};
  columns.forEach((c, i) => { o[c] = row[i]; });
  return o;
}

// stmt(sql) → { run, get, all }. "@name" placeholders take one object
// argument; "?" placeholders take positional arguments.
function stmt(sql, opts = {}) {
  const names = [];
  const text = sql.replace(/@(\w+)/g, (_, n) => { names.push(n); return "?"; });
  const bind = args => names.length
    ? names.map(n => args[0][n] ?? null)
    : args.map(v => (v === undefined ? null : v));
  const exec = args => executor().execute({ sql: text, args: bind(args) });
  return {
    async run(...args) {
      const rs = await exec(args);
      return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid };
    },
    async get(...args) {
      const rs = await exec(args);
      const row = rs.rows[0];
      if (!row) return undefined;
      return opts.pluck ? row[0] : rowToObject(rs.columns, row);
    },
    async all(...args) {
      const rs = await exec(args);
      return rs.rows.map(r => (opts.pluck ? r[0] : rowToObject(rs.columns, r)));
    },
  };
}

// transaction(fn) → async (...args) => result, committed atomically
function transaction(fn) {
  return async (...args) => {
    const outer = txStore.getStore();
    if (outer) {
      const sp = `sp${++savepointSeq}`;
      await outer.execute(`SAVEPOINT ${sp}`);
      try {
        const result = await fn(...args);
        await outer.execute(`RELEASE ${sp}`);
        return result;
      } catch (err) {
        await outer.execute(`ROLLBACK TO ${sp}`);
        await outer.execute(`RELEASE ${sp}`);
        throw err;
      }
    }
    const tx = await client.transaction("write");
    try {
      const result = await txStore.run(tx, () => fn(...args));
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    } finally {
      tx.close();
    }
  };
}

function isUniqueViolation(err) {
  return /UNIQUE constraint failed/i.test(String(err && err.message)) ||
    /CONSTRAINT_(UNIQUE|PRIMARYKEY)/.test(String(err && (err.extendedCode || err.code)));
}

// =============================
// SCHEMA
// =============================
const SCHEMA = `
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

  -- Login sessions (express-session store below)
  CREATE TABLE IF NOT EXISTS web_sessions (
    sid     TEXT PRIMARY KEY,
    sess    TEXT NOT NULL,
    expires INTEGER NOT NULL             -- epoch ms
  );
`;

// =============================
// STATEMENTS
// =============================
const insertUser = stmt(`
  INSERT INTO users (email, password, name, created_at, favorites, card_balance)
  VALUES (@email, @password, @name, @createdAt, @favorites, @cardBalance)
`);
const insertTxn = stmt(`
  INSERT INTO transactions (email, type, amount, method, payment_id, pnr, at)
  VALUES (@email, @type, @amount, @method, @paymentId, @pnr, @at)
`);
const insertBooking = stmt(`
  INSERT INTO bookings (pnr, user_email, status, travel_date, train_id, depart_at, booked_at, data)
  VALUES (@pnr, @userEmail, @status, @travelDate, @trainId, @departAt, @bookedAt, @data)
`);
const insertSeat = stmt("INSERT INTO booking_seats (pnr, travel_date, train_id, seat) VALUES (?, ?, ?, ?)");

const q = {
  userByEmail: stmt("SELECT * FROM users WHERE email = ?"),
  updateName: stmt("UPDATE users SET name = ? WHERE email = ?"),
  updateFavorites: stmt("UPDATE users SET favorites = ? WHERE email = ?"),
  updatePassword: stmt("UPDATE users SET password = ? WHERE email = ?"),
  credit: stmt("UPDATE users SET card_balance = card_balance + ? WHERE email = ?"),
  // Only succeeds when the balance covers the debit
  debit: stmt("UPDATE users SET card_balance = card_balance - @amount WHERE email = @email AND card_balance >= @amount"),
  balance: stmt("SELECT card_balance FROM users WHERE email = ?", { pluck: true }),
  recentTxns: stmt("SELECT type, amount, method, payment_id, pnr, at FROM transactions WHERE email = ? ORDER BY id DESC LIMIT ?"),

  bookingByPnr: stmt("SELECT * FROM bookings WHERE pnr = ?"),
  bookingsByUser: stmt("SELECT * FROM bookings WHERE user_email = ?"),
  pnrExists: stmt("SELECT 1 FROM bookings WHERE pnr = ?", { pluck: true }),
  takenSeats: stmt("SELECT seat FROM booking_seats WHERE travel_date = ? AND train_id = ?", { pluck: true }),
  cancelBooking: stmt("UPDATE bookings SET status = 'Cancelled', data = ? WHERE pnr = ? AND status = 'Confirmed'"),
  releaseSeats: stmt("DELETE FROM booking_seats WHERE pnr = ?"),

  insertTicket: stmt("INSERT INTO support_tickets (ticket, email, topic, message, at) VALUES (?, ?, ?, ?, ?)"),

  // Settlement lookups by payment id, so a payment is never settled twice
  bookingByPaymentId: stmt("SELECT * FROM bookings WHERE json_extract(data, '$.payment.paymentId') = ?"),
  txnByPaymentId: stmt("SELECT email FROM transactions WHERE payment_id = ? LIMIT 1"),

  insertOrder: stmt(`
    INSERT INTO payment_orders (id, email, purpose, amount, metro_card_amount, draft, travel_date, train_id, expires)
    VALUES (@id, @email, @purpose, @amount, @metroCardAmount, @draft, @travelDate, @trainId, @expires)`),
  orderById: stmt("SELECT * FROM payment_orders WHERE id = ?"),
  pruneOrders: stmt("DELETE FROM payment_orders WHERE expires < ?"),
  heldSeatDrafts: stmt(`
    SELECT draft FROM payment_orders
    WHERE travel_date = ? AND train_id = ? AND purpose = 'ticket' AND status = 'pending'
      AND released = 0 AND expires > ? AND email IS NOT ?`, { pluck: true }),
  releaseOrder: stmt("UPDATE payment_orders SET released = 1 WHERE id = ? AND email = ?"),
  releaseUserTicketOrders: stmt("UPDATE payment_orders SET released = 1 WHERE email = ? AND purpose = 'ticket'"),
  claimOrder: stmt("UPDATE payment_orders SET status = 'settling' WHERE id = ? AND status = 'pending'"),
  finishOrder: stmt("UPDATE payment_orders SET status = 'settled', result = ?, refund = ? WHERE id = ?"),
  orderError: stmt("UPDATE payment_orders SET last_error = ? WHERE id = ?"),

  upsertResetToken: stmt("INSERT OR REPLACE INTO reset_tokens (email, hash, expires, attempts) VALUES (?, ?, ?, 0)"),
  resetToken: stmt("SELECT * FROM reset_tokens WHERE email = ?"),
  resetAttempt: stmt("UPDATE reset_tokens SET attempts = attempts + 1 WHERE email = ?"),
  deleteResetToken: stmt("DELETE FROM reset_tokens WHERE email = ?"),
  consumeResetToken: stmt("DELETE FROM reset_tokens WHERE email = ? AND hash = ?"),
  pruneResetTokens: stmt("DELETE FROM reset_tokens WHERE expires < ?"),

  sessionGet: stmt("SELECT sess FROM web_sessions WHERE sid = ? AND expires > ?", { pluck: true }),
  sessionSet: stmt("INSERT OR REPLACE INTO web_sessions (sid, sess, expires) VALUES (?, ?, ?)"),
  sessionTouch: stmt("UPDATE web_sessions SET expires = ? WHERE sid = ?"),
  sessionDestroy: stmt("DELETE FROM web_sessions WHERE sid = ?"),
  sessionPrune: stmt("DELETE FROM web_sessions WHERE expires < ?"),
};

// =============================
// ROW SHAPES
// =============================
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

// Row → the user object shape the routes (and API) have always used
function toUser(row) {
  if (!row) return null;
  return {
    email: row.email,
    password: row.password,
    name: row.name,
    createdAt: row.created_at,
    favorites: JSON.parse(row.favorites),
    cardBalance: Number(row.card_balance),
  };
}

// Same key order and omitted-when-absent fields as the old JSON ledger
function toTxn(row) {
  const t = { type: row.type, amount: Number(row.amount) };
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

const migrateJSON = transaction(async () => {
  const users = readLegacy("users.json");
  const bookings = readLegacy("bookings.json");
  const tickets = readLegacy("support.json");

  for (const u of users) {
    if (!u || !u.email || !u.password) continue;
    const email = String(u.email).toLowerCase();
    await insertUser.run({
      email,
      password: u.password,
      name: u.name || "",
      createdAt: u.createdAt || null,
      favorites: JSON.stringify(Array.isArray(u.favorites) ? u.favorites : []),
      cardBalance: Math.max(0, Math.round(u.cardBalance || 0)),
    });
    // JSON stored newest first; insert oldest first so ids increase with time
    for (const t of [...(u.transactions || [])].reverse()) {
      await insertTxn.run({
        email, type: t.type, amount: t.amount, method: t.method ?? null,
        paymentId: t.paymentId ?? null, pnr: t.pnr ?? null, at: t.at || new Date().toISOString(),
      });
    }
  }

  let skippedSeats = 0;
  for (const b of bookings) {
    if (!b || !b.pnr || !b.userEmail) continue;
    await insertBooking.run(bookingRow(b));
    // Legacy bookings have no travelDate/trainId: they load, but hold no seat
    if ((b.status || "Confirmed") === "Confirmed" && b.travelDate && b.trainId) {
      for (const seat of b.seats || (b.seat ? [b.seat] : [])) {
        try {
          await transaction(() => insertSeat.run(b.pnr, b.travelDate, b.trainId, seat))();
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          skippedSeats++;
        }
      }
    }
  }

  for (const t of tickets) {
    if (t && t.ticket) await q.insertTicket.run(t.ticket, t.email, t.topic, t.message, t.at);
  }

  await stmt("INSERT INTO meta (key, value) VALUES ('json_migrated', ?)").run(new Date().toISOString());
  return { users: users.length, bookings: bookings.length, tickets: tickets.length, skippedSeats };
});

// =============================
// STARTUP
// =============================
async function init() {
  if (IS_FILE) {
    await client.execute("PRAGMA journal_mode = WAL");
    await client.execute("PRAGMA busy_timeout = 5000");
  }
  await client.executeMultiple(SCHEMA);
  // METRIGO_SKIP_JSON_IMPORT is set by scripts/copy-to-turso.js, which copies
  // the database itself instead
  const migrated = await stmt("SELECT 1 FROM meta WHERE key = 'json_migrated'", { pluck: true }).get();
  if (!migrated && !process.env.METRIGO_SKIP_JSON_IMPORT) {
    const r = await migrateJSON();
    if (r.users || r.bookings || r.tickets) {
      console.log(`Imported ${r.users} users, ${r.bookings} bookings, ${r.tickets} support tickets from JSON` +
        (r.skippedSeats ? ` (${r.skippedSeats} double-booked seats skipped)` : ""));
    }
  }
}
const ready = init();
ready.catch(err => console.error("Database setup failed:", err));

// =============================
// SESSION STORE (express-session)
// =============================
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

class LibsqlSessionStore extends session.Store {
  static expiry(sess) {
    const cookieExpiry = sess && sess.cookie && sess.cookie.expires;
    return cookieExpiry ? new Date(cookieExpiry).getTime() : Date.now() + SESSION_TTL_MS;
  }
  get(sid, cb) {
    q.sessionGet.get(sid, Date.now())
      .then(sess => cb(null, sess ? JSON.parse(sess) : null), cb);
  }
  set(sid, sess, cb) {
    // Clear out expired sessions now and then instead of on a timer, since
    // serverless functions don't keep timers running
    if (Math.random() < 0.02) q.sessionPrune.run(Date.now()).catch(() => {});
    q.sessionSet.run(sid, JSON.stringify(sess), LibsqlSessionStore.expiry(sess))
      .then(() => cb && cb(null), err => cb && cb(err));
  }
  touch(sid, sess, cb) {
    q.sessionTouch.run(LibsqlSessionStore.expiry(sess), sid)
      .then(() => cb && cb(null), err => cb && cb(err));
  }
  destroy(sid, cb) {
    q.sessionDestroy.run(sid).then(() => cb && cb(null), err => cb && cb(err));
  }
}

module.exports = {
  client,
  ready,
  stmt,
  transaction,
  isUniqueViolation,
  LibsqlSessionStore,
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
