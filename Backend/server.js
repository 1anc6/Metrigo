// MetriGo backend — Express + express-session + bcrypt, libSQL/Turso storage
// (db.js) and CSV metro network. Locally it also serves the FrontEnd folder on
// the same origin; on Vercel the pages are static files and this app runs as
// a serverless function (see api/index.js and vercel.json).

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  ready, transaction, isUniqueViolation, LibsqlSessionStore,
  q, toUser, toTxn, toBooking, bookingRow, insertUser, insertTxn, insertBooking, insertSeat,
} = require("./db");
const payments = require("./payments");
const MetroSim = require("../FrontEnd/assets/js/metro-sim.js");

const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, "data");
const FRONTEND_DIR = path.join(__dirname, "..", "FrontEnd");

function readCSV(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(l => l.trim());
  const headers = lines.shift().split(",").map(h => h.trim());
  return lines.map(line => {
    const cols = line.split(",").map(c => c.trim());
    return Object.fromEntries(headers.map((h, i) => [h, cols[i]]));
  });
}

// =============================
// USERS — primary-key lookup
// =============================
async function getUser(email) {
  return toUser(await q.userByEmail.get(String(email || "").trim().toLowerCase()));
}

async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith("$2")) return bcrypt.compare(password, stored);
  // Legacy "salt:hash" format (scrypt, 64-byte key)
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return derived.length === hash.length &&
    crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(hash));
}

// =============================
// GRAPH — metro network
// =============================
const stations = readCSV(path.join(DATA_DIR, "stations.csv"))
  .map(s => ({ id: Number(s.ID), name: s.Name, line: s.Line }));
const stationById = new Map(stations.map(s => [s.id, s]));
const stationByName = new Map(stations.map(s => [s.name.toLowerCase(), s]));
// An interchange has one node per line; a trip may start or end on any of them
const idsByName = new Map();
stations.forEach(s => idsByName.set(s.name, [...(idsByName.get(s.name) || []), s.id]));

const adjacency = new Map(stations.map(s => [s.id, []]));
readCSV(path.join(DATA_DIR, "edges.csv")).forEach(e => {
  const a = Number(e.From), b = Number(e.To), d = Number(e.Distance);
  if (!adjacency.has(a) || !adjacency.has(b)) return;
  adjacency.get(a).push({ to: b, dist: d });
  adjacency.get(b).push({ to: a, dist: d });
});

// =============================
// DIJKSTRA — O((V + E) log V) with a binary heap
// =============================
// Interchange edges (same station, two lines) are 0 km in edges.csv. The
// search charges each change this much, so it doesn't hop lines to save a
// few hundred metres: roughly the walk plus wait of a change, at metro speed.
const TRANSFER_PENALTY_KM = 5;

function dijkstra(srcName, destName) {
  const sources = idsByName.get(srcName), targets = new Set(idsByName.get(destName));
  const dist = new Map(sources.map(id => [id, 0])); // search cost: km + transfer penalties
  const km = new Map(sources.map(id => [id, 0]));   // real distance travelled
  const prev = new Map();
  const heap = sources.map(id => [0, id]);
  let dest = null;

  const push = item => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  while (heap.length) {
    const [d, u] = pop();
    if (d > dist.get(u)) continue;
    if (targets.has(u)) { dest = u; break; }
    for (const { to, dist: w } of adjacency.get(u)) {
      const nd = d + (w === 0 ? TRANSFER_PENALTY_KM : w);
      if (nd < (dist.has(to) ? dist.get(to) : Infinity)) {
        dist.set(to, nd);
        km.set(to, km.get(u) + w);
        prev.set(to, u);
        push([nd, to]);
      }
    }
  }

  if (dest === null) return null;
  const pathIds = [];
  for (let at = dest; at !== undefined; at = prev.get(at)) pathIds.unshift(at);
  // Interchanges appear once per line (e.g. Rajiv Chowk), so collapse repeats
  const names = pathIds.map(id => stationById.get(id).name)
    .filter((name, i, arr) => i === 0 || name !== arr[i - 1]);
  return { distance: km.get(dest), path: names };
}

// Distance-slab fare (Delhi Metro style)
function calculateFare(km) {
  if (km <= 2) return 10;
  if (km <= 5) return 20;
  if (km <= 12) return 30;
  if (km <= 21) return 40;
  if (km <= 32) return 50;
  return 60;
}

function findRoute(fromName, toName) {
  const from = stationByName.get(String(fromName || "").trim().toLowerCase());
  const to = stationByName.get(String(toName || "").trim().toLowerCase());
  if (!from || !to || from.name === to.name) return null;
  const result = dijkstra(from.name, to.name);
  if (!result) return null;
  const distance = Math.round(result.distance * 10) / 10;
  return {
    from: from.name,
    to: to.name,
    path: result.path,
    stops: result.path.length - 1,
    distance,
    fare: calculateFare(distance),
  };
}

// =============================
// DYNAMIC PRICING — same multipliers as the frontend preview
// =============================
function slotForMinute(min) {
  const entry = Object.entries(MetroSim.TIME_SLOTS).find(([, s]) => min >= s.start && min < s.end);
  return entry ? entry[0] : "night";
}

function applyPeakPricing(baseFare, timeSlot) {
  const slot = MetroSim.TIME_SLOTS[timeSlot];
  return Math.round(baseFare * (slot ? slot.multiplier : 1));
}

const METRO_CARD_DISCOUNT = 0.1;

// =============================
// PNR — SHA-256 based, unique against existing bookings
// =============================
async function generatePNR(email) {
  let pnr;
  do {
    const digest = crypto.createHash("sha256")
      .update(`${email}|${Date.now()}|${crypto.randomBytes(8).toString("hex")}`)
      .digest("hex");
    pnr = "MG" + (parseInt(digest.slice(0, 12), 16) % 1e8).toString().padStart(8, "0");
  } while (await q.pnrExists.get(pnr));
  return pnr;
}

// =============================
// JOURNEYS — departures from the shared timetable
// =============================
const MAX_DAYS_AHEAD = 30;

function todayIST() {
  return MetroSim.istParts(Date.now()).date;
}

function validTravelDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return false;
  const days = (Date.parse(date) - Date.parse(todayIST())) / 86400000;
  return days >= 0 && days <= MAX_DAYS_AHEAD;
}

function departuresFor(route, date, startMin, endMin, limit) {
  let from = startMin;
  if (date === todayIST()) from = Math.max(from, MetroSim.istParts(Date.now()).minutes + 1);
  return MetroSim.departures(route.path, from, endMin, limit);
}

function findDeparture(route, date, trainId) {
  return departuresFor(route, date, 0, 1440, 1000).find(d => d.trainId === trainId) || null;
}

// =============================
// SEATS — 4 coaches x 10 rows x 4 seats (A B | C D)
// Occupancy = seeded "other passengers" + real MetriGo bookings
// =============================
const COACHES = ["C1", "C2", "C3", "C4"];
const SEAT_ROWS = 10;
const SEAT_COLS = ["A", "B", "C", "D"];
const OCCUPANCY = { early_morning: 0.12, morning_peak: 0.45, afternoon: 0.22, evening_peak: 0.5, night: 0.18 };
// General coaches first; the women-only coach is the last resort
const SUGGEST_ORDER = ["C2", "C3", "C4", "C1"];
const SEAT_ID_RE = /^C[1-4]-(10|[1-9])[A-D]$/;

function seededTaken(journeyKey, seatId, rate) {
  const h = crypto.createHash("sha1").update(journeyKey + "|" + seatId).digest();
  return h[0] / 256 < rate;
}

// Seats held by other users' unpaid orders (see PAYMENTS) count as taken.
// A user's own holds don't block them, so going back to change seats works.
async function takenSeats(date, trainId, timeSlot, forEmail) {
  const key = `${date}|${trainId}`;
  const taken = new Set();
  const rate = OCCUPANCY[timeSlot] ?? 0.25;
  COACHES.forEach(c => {
    for (let r = 1; r <= SEAT_ROWS; r++) {
      SEAT_COLS.forEach(col => {
        const id = `${c}-${r}${col}`;
        if (seededTaken(key, id, rate)) taken.add(id);
      });
    }
  });
  const [booked, held] = await Promise.all([
    q.takenSeats.all(date, trainId),
    q.heldSeatDrafts.all(date, trainId, Date.now(), forEmail ?? null),
  ]);
  booked.forEach(s => taken.add(s));
  held.forEach(draft => JSON.parse(draft).seats.forEach(s => taken.add(s)));
  return taken;
}

function crowdLevel(taken) {
  const ratio = taken.size / (COACHES.length * SEAT_ROWS * SEAT_COLS.length);
  return ratio < 0.25 ? "Low" : ratio < 0.45 ? "Medium" : "High";
}

// Greedy: first row with `count` adjacent free seats — O(n)
function greedyAllocate(free, count) {
  for (const coach of SUGGEST_ORDER) {
    for (let r = 1; r <= SEAT_ROWS; r++) {
      const row = free.filter(s => s.coach === coach && s.row === r).map(s => s.col).sort((a, b) => a - b);
      for (let i = 0; i + count <= row.length; i++) {
        if (row[i + count - 1] - row[i] === count - 1) {
          return row.slice(i, i + count).map(col => ({ coach, row: r, col }));
        }
      }
    }
  }
  return null;
}

// Lower score is better: rows spanned, gaps within rows, distance between rows
function scoreGroup(group) {
  const rows = new Set(group.map(s => s.row));
  const rowSpread = Math.max(...group.map(s => s.row)) - Math.min(...group.map(s => s.row));
  let gaps = 0;
  rows.forEach(r => {
    const cols = group.filter(s => s.row === r).map(s => s.col);
    gaps += Math.max(...cols) - Math.min(...cols) + 1 - cols.length;
  });
  return rows.size * 10 + rowSpread * 5 + gaps;
}

// Backtracking within one coach, pruning groups that spread too far
function backtrackAllocate(free, count) {
  let best = null, bestScore = Infinity;
  for (const coach of SUGGEST_ORDER) {
    const seats = free.filter(s => s.coach === coach);
    const pick = [];
    (function explore(start) {
      if (pick.length === count) {
        const s = scoreGroup(pick);
        if (s < bestScore) { bestScore = s; best = [...pick]; }
        return;
      }
      for (let i = start; i < seats.length; i++) {
        if (pick.length && seats[i].row - pick[0].row > count) break;
        pick.push(seats[i]);
        explore(i + 1);
        pick.pop();
      }
    })(0);
  }
  return best;
}

function suggestSeats(taken, count) {
  const free = [];
  COACHES.forEach(coach => {
    for (let r = 1; r <= SEAT_ROWS; r++) {
      SEAT_COLS.forEach((c, i) => {
        if (!taken.has(`${coach}-${r}${c}`)) free.push({ coach, row: r, col: i + 1 });
      });
    }
  });
  if (count < 1 || count > free.length) return null;
  const group = greedyAllocate(free, count) ||
    (count <= 6 ? backtrackAllocate(free, count) : free.slice(0, count));
  return group && group.map(s => `${s.coach}-${s.row}${SEAT_COLS[s.col - 1]}`);
}

// =============================
// APP
// =============================
const app = express();

// Behind Vercel's proxy: real client IPs for rate limits, HTTPS for cookies
if (process.env.VERCEL) app.set("trust proxy", 1);

// Every request waits for the schema (and the one-time JSON import)
app.use(async (req, res, next) => {
  try {
    await ready;
    next();
  } catch (err) {
    next(err);
  }
});

app.use(cors({ origin: true, credentials: true }));
// Keep the raw body for the Razorpay webhook signature check
app.use(express.json({ verify: (req, res, buf) => { if (req.originalUrl === "/payments/webhook") req.rawBody = buf; } }));
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  SESSION_SECRET = crypto.randomBytes(32).toString("hex");
  console.warn("WARNING: SESSION_SECRET is not set. Using a random secret, so every restart logs all users out. Set SESSION_SECRET in the environment.");
}

app.use(session({
  store: new LibsqlSessionStore(),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: "auto", maxAge: 24 * 60 * 60 * 1000 },
}));

function requireLogin(req, res, next) {
  if (!req.session.email) {
    return res.status(401).json({ success: false, message: "Not logged in" });
  }
  next();
}

app.get("/", (req, res) => {
  res.redirect(req.session.email ? "/index.html" : "/login.html");
});

// ---------- AUTH ----------
// Date of the terms and privacy policy now on the site (FrontEnd/terms.html,
// privacy.html). Change it when they change; each user row records the
// version they accepted.
const TERMS_VERSION = "2026-10-16";

app.post("/register", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const name = String(req.body.name || "").trim().slice(0, 100);

  // Consent is checked here too, not only by the sign-up form's checkboxes
  if (req.body.acceptTerms !== true) {
    return res.json({ success: false, message: "Please accept the terms and privacy policy to continue." });
  }
  if (req.body.ageConfirmed !== true) {
    return res.json({ success: false, message: "Please confirm you're 18 or older, or that a parent or guardian agrees." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.json({ success: false, message: "Please enter a valid email." });
  }
  if (password.length < 6) {
    return res.json({ success: false, message: "Password must be at least 6 characters." });
  }

  const exists = "An account with this email already exists.";
  if (await getUser(email)) return res.json({ success: false, message: exists });

  const now = new Date().toISOString();
  try {
    await insertUser.run({
      email,
      password: await bcrypt.hash(password, 10),
      name,
      createdAt: now,
      favorites: "[]",
      cardBalance: 0,
      termsVersion: TERMS_VERSION,
      consentedAt: now,
      ageConfirmed: 1,
    });
  } catch (err) {
    // Two registrations raced past the check above
    if (isUniqueViolation(err)) return res.json({ success: false, message: exists });
    throw err;
  }

  req.session.email = email;
  res.json({ success: true });
});

// Per-IP limits on the endpoints attackers would brute-force
function limiter(limit, message) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, message },
  });
}
const loginLimiter = limiter(10, "Too many sign-in attempts. Try again in 15 minutes.");
const forgotLimiter = limiter(5, "Too many reset requests. Try again in 15 minutes.");
const resetLimiter = limiter(10, "Too many reset attempts. Try again in 15 minutes.");
const deleteLimiter = limiter(10, "Too many attempts. Try again in 15 minutes.");

app.post("/login", loginLimiter, async (req, res) => {
  const user = await getUser(req.body.email);
  if (!user || !(await verifyPassword(String(req.body.password || ""), user.password))) {
    return res.json({ success: false, message: "Invalid email or password." });
  }
  req.session.email = user.email.toLowerCase();
  res.json({ success: true });
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/login.html");
  });
});

// Reset codes are emailed, never returned in a response. Without SMTP
// settings (dev mode) the code is printed to the server console instead.
// Codes are stored in SQLite keyed by email, as a SHA-256 hash, and allow
// a few wrong guesses before they are burned.
const RESET_TTL_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;
const RESET_SENT_MESSAGE = "If an account exists for this email, we've sent a reset code. It expires in 15 minutes.";
const RESET_BAD_MESSAGE = "Invalid or expired reset code.";

const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || "MetriGo <no-reply@metrigo.local>";

function hashResetCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function sendResetCode(email, name, code) {
  if (!mailer) {
    console.log(`[dev] Password reset code for ${email}: ${code} (set SMTP_HOST to email it)`);
    return;
  }
  // Not awaited: the response must not take longer when the account exists
  mailer.sendMail({
    from: MAIL_FROM,
    to: email,
    subject: "Your MetriGo password reset code",
    text: `Hi${name ? " " + name : ""},\n\nYour MetriGo password reset code is ${code}. It expires in 15 minutes.\n\nIf you didn't ask to reset your password, you can ignore this email.`,
  }).catch(err => console.error("Reset email failed:", err.message));
}

app.post("/forgot-password", forgotLimiter, async (req, res) => {
  await q.pruneResetTokens.run(Date.now());
  const user = await getUser(req.body.email);
  if (user) {
    const email = user.email;
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    await q.upsertResetToken.run(email, hashResetCode(code), Date.now() + RESET_TTL_MS);
    sendResetCode(email, user.name, code);
  }
  res.json({ success: true, message: RESET_SENT_MESSAGE });
});

app.post("/reset-password", resetLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const token = String(req.body.token || "").trim().toUpperCase();
  const newPassword = String(req.body.newPassword || "");
  const entry = await q.resetToken.get(email);

  if (!entry || entry.expires < Date.now() || entry.attempts >= RESET_MAX_ATTEMPTS) {
    await q.deleteResetToken.run(email);
    return res.json({ success: false, message: RESET_BAD_MESSAGE });
  }
  if (!crypto.timingSafeEqual(Buffer.from(hashResetCode(token)), Buffer.from(entry.hash))) {
    await q.resetAttempt.run(email);
    return res.json({ success: false, message: RESET_BAD_MESSAGE });
  }
  if (newPassword.length < 6) {
    return res.json({ success: false, message: "Password must be at least 6 characters." });
  }

  if (!(await getUser(email))) return res.json({ success: false, message: RESET_BAD_MESSAGE });
  const hash = await bcrypt.hash(newPassword, 10);
  // Burn the code and set the password together, so a code works only once
  const applied = await transaction(async () => {
    if (!(await q.consumeResetToken.run(email, entry.hash)).changes) return false;
    await q.updatePassword.run(hash, email);
    return true;
  })();
  if (!applied) return res.json({ success: false, message: RESET_BAD_MESSAGE });
  res.json({ success: true });
});

// ---------- PROFILE ----------
app.get("/profile", requireLogin, async (req, res) => {
  const user = await getUser(req.session.email);
  if (!user) return res.status(401).json({ success: false, message: "Not logged in" });
  const { password, ...data } = user;
  data.cardBalance = data.cardBalance || 0;
  data.upcomingTrips = (await q.upcomingPnrs.all(user.email, Date.now())).length;
  res.json({ success: true, data });
});

app.post("/update-profile", requireLogin, async (req, res) => {
  const email = req.session.email;
  if (!(await getUser(email))) return res.status(401).json({ success: false });

  let hash = null;
  if (req.body.password !== undefined) {
    const password = String(req.body.password);
    if (password.length < 6) {
      return res.json({ success: false, message: "Password must be at least 6 characters." });
    }
    hash = await bcrypt.hash(password, 10);
  }

  await transaction(async () => {
    if (typeof req.body.name === "string") {
      await q.updateName.run(req.body.name.trim().slice(0, 100), email);
    }
    if (Array.isArray(req.body.favorites)) {
      const favorites = req.body.favorites
        .filter(n => typeof n === "string" && stationByName.has(n.toLowerCase()))
        .slice(0, 10);
      await q.updateFavorites.run(JSON.stringify(favorites), email);
    }
    if (hash) await q.updatePassword.run(hash, email);
  })();
  res.json({ success: true });
});

// Deletes the account and everything tied to it: profile, Metro Card
// history, support messages, pending payments and sessions. Upcoming trips
// are cancelled so their seats free up. Past bookings are kept without the
// email (anonymous), because seat and payment records refer to them.
app.post("/delete-account", requireLogin, deleteLimiter, async (req, res) => {
  const email = req.session.email;
  const user = await getUser(email);
  if (!user) return res.status(401).json({ success: false, message: "Not logged in" });
  if (!(await verifyPassword(String(req.body.password || ""), user.password))) {
    return res.json({ success: false, message: "That password isn't right." });
  }
  if (req.body.confirm !== "DELETE") {
    return res.json({ success: false, message: "Type DELETE to confirm." });
  }

  const anonymous = "deleted-" + crypto.randomBytes(8).toString("hex");
  await transaction(async () => {
    const cancelledAt = new Date().toISOString();
    for (const pnr of await q.upcomingPnrs.all(email, Date.now())) {
      const { userEmail, ...data } = toBooking(await q.bookingByPnr.get(pnr));
      await q.cancelBooking.run(JSON.stringify({ ...data, status: "Cancelled", cancelledAt }), pnr);
      await q.releaseSeats.run(pnr);
    }
    await q.anonymizeBookings.run(anonymous, email);
    await q.deleteTxns.run(email);
    await q.deleteTickets.run(email);
    await q.deleteOrders.run(email);
    await q.deleteResetToken.run(email);
    await q.deleteUser.run(email);
    await q.deleteUserSessions.run(email);
  })();

  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

// ---------- METRO & ROUTING ----------
app.get("/stations", (req, res) => {
  res.json(stations);
});

app.post("/shortest-path", (req, res) => {
  const route = findRoute(req.body.from, req.body.to);
  if (!route) return res.json({ success: false, message: "Station not found" });
  res.json({ success: true, ...route });
});

// Route + fare + departures in a time slot on a date
app.post("/journey", async (req, res) => {
  const route = findRoute(req.body.from, req.body.to);
  if (!route) return res.json({ success: false, message: "Choose two different, valid stations." });

  const date = String(req.body.date || todayIST());
  if (!validTravelDate(date)) {
    return res.json({ success: false, message: `Pick a date within the next ${MAX_DAYS_AHEAD} days.` });
  }
  // A precise fare slot, a part of the day, or the rest of the day
  const slot = MetroSim.TIME_SLOTS[req.body.slot] || MetroSim.DAY_PARTS[req.body.slot] || { start: 0, end: 1440 };

  const list = await Promise.all(departuresFor(route, date, slot.start, slot.end, 12).map(async d => {
    const timeSlot = slotForMinute(d.depart);
    return {
      ...d,
      timeSlot,
      perPassenger: applyPeakPricing(route.fare, timeSlot),
      crowd: crowdLevel(await takenSeats(date, d.trainId, timeSlot, req.session.email)),
    };
  }));

  res.json({ success: true, route, date, departures: list });
});

// ---------- SMART SEAT SYSTEM ----------
function journeyContext(body) {
  const route = findRoute(body.from, body.to);
  const date = String(body.date || "");
  if (!route || !validTravelDate(date)) return null;
  const dep = findDeparture(route, date, String(body.trainId || ""));
  if (!dep) return null;
  const timeSlot = slotForMinute(dep.depart);
  return { route, date, dep, timeSlot };
}

app.post("/seat-map", async (req, res) => {
  const ctx = journeyContext(req.body);
  if (!ctx) return res.json({ success: false, message: "This departure is no longer available." });
  const taken = await takenSeats(ctx.date, ctx.dep.trainId, ctx.timeSlot, req.session.email);
  res.json({
    success: true,
    coaches: COACHES.map(c => ({ id: c, womenOnly: c === "C1" })),
    rows: SEAT_ROWS,
    cols: SEAT_COLS,
    taken: [...taken],
    crowd: crowdLevel(taken),
  });
});

app.post("/suggest-seats", async (req, res) => {
  const ctx = journeyContext(req.body);
  const count = parseInt(req.body.count, 10);
  if (!ctx || !Number.isInteger(count)) return res.json({ success: false, message: "No suitable seats" });
  const suggested = suggestSeats(await takenSeats(ctx.date, ctx.dep.trainId, ctx.timeSlot, req.session.email), count);
  if (!suggested) return res.json({ success: false, message: "No suitable seats" });
  res.json({ success: true, suggested });
});

// ---------- PAYMENTS ----------
// Pending orders are stored in SQLite. A ticket order holds its seats for 15
// minutes so nobody else can buy them while the buyer pays (takenSeats
// counts them). The record is kept a while longer so a late Razorpay
// payment or webhook can still be settled, or refunded if the seats went.
const ORDER_TTL_MS = 15 * 60 * 1000;
const ORDER_GRACE_MS = 45 * 60 * 1000;

function pruneOrders() {
  return q.pruneOrders.run(Date.now() - ORDER_GRACE_MS);
}

async function getOrder(id) {
  const row = await q.orderById.get(id);
  if (!row) return null;
  return {
    email: row.email, purpose: row.purpose, amount: Number(row.amount), metroCardAmount: Number(row.metro_card_amount),
    draft: JSON.parse(row.draft), expires: Number(row.expires), released: Boolean(Number(row.released)),
    status: row.status, result: row.result && JSON.parse(row.result),
  };
}

// Thrown inside a transaction() to roll it back and answer with `body`
class Reject extends Error {
  constructor(body) { super(body.message); this.body = body; }
}

// A payment already turned into a booking or recharge (e.g. before a restart)
async function settledPayment(paymentId) {
  const booking = toBooking(await q.bookingByPaymentId.get(paymentId));
  if (booking) return { booking };
  const txn = await q.txnByPaymentId.get(paymentId);
  return txn ? { user: await getUser(txn.email) } : null;
}

app.get("/payments/config", (req, res) => {
  res.json({
    success: true,
    provider: payments.provider,
    keyId: payments.publicKey || null,
    metroCardDiscount: METRO_CARD_DISCOUNT,
  });
});

app.post("/payments/order", requireLogin, async (req, res) => {
  await pruneOrders();
  const purpose = req.body.purpose === "recharge" ? "recharge" : "ticket";
  let amount, draft, ctx;

  if (purpose === "recharge") {
    amount = Math.round(Number(req.body.amount));
    if (!Number.isFinite(amount) || amount < 50 || amount > 5000) {
      return res.json({ success: false, message: "Recharge between ₹50 and ₹5,000." });
    }
    draft = { amount };
  } else {
    ctx = journeyContext(req.body);
    if (!ctx) return res.json({ success: false, message: "This departure is no longer available." });

    const seats = [...new Set((req.body.seats || []).map(String))];
    if (!seats.length || seats.length > 6 || !seats.every(s => SEAT_ID_RE.test(s))) {
      return res.json({ success: false, message: "Select between 1 and 6 seats." });
    }
    const taken = await takenSeats(ctx.date, ctx.dep.trainId, ctx.timeSlot, req.session.email);
    const clash = seats.filter(s => taken.has(s));
    if (clash.length) {
      return res.json({ success: false, message: `Seat ${clash.join(", ")} was just taken.`, taken: clash });
    }

    const perPassenger = applyPeakPricing(ctx.route.fare, ctx.timeSlot);
    amount = perPassenger * seats.length;
    draft = {
      from: ctx.route.from, to: ctx.route.to, path: ctx.route.path, distance: ctx.route.distance,
      date: ctx.date, dep: ctx.dep, timeSlot: ctx.timeSlot, seats,
      fare: ctx.route.fare, perPassenger,
    };
  }

  let order;
  try {
    order = await payments.createOrder(amount, `${purpose}-${Date.now()}`);
  } catch (err) {
    console.error(err);
    return res.json({ success: false, message: "Payment gateway unavailable. Try again shortly." });
  }

  const metroCardAmount = Math.round(amount * (1 - METRO_CARD_DISCOUNT));
  // Check again: another order may have taken the seats while we waited on
  // the gateway. The re-check, releasing this user's older hold and storing
  // the new hold commit as one transaction.
  const placeOrder = transaction(async () => {
    if (purpose === "ticket") {
      const taken = await takenSeats(ctx.date, ctx.dep.trainId, ctx.timeSlot, req.session.email);
      const clash = draft.seats.filter(s => taken.has(s));
      if (clash.length) {
        throw new Reject({ success: false, message: `Seat ${clash.join(", ")} was just taken.`, taken: clash });
      }
      // One checkout per user holds seats; a newer one replaces the older hold
      await q.releaseUserTicketOrders.run(req.session.email);
    }
    await q.insertOrder.run({
      id: order.id, email: req.session.email, purpose, amount, metroCardAmount,
      draft: JSON.stringify(draft),
      travelDate: purpose === "ticket" ? draft.date : null,
      trainId: purpose === "ticket" ? draft.dep.trainId : null,
      expires: Date.now() + ORDER_TTL_MS,
    });
  });
  try {
    await placeOrder();
  } catch (err) {
    if (err instanceof Reject) return res.json(err.body);
    throw err;
  }

  const user = await getUser(req.session.email);
  res.json({
    success: true,
    orderId: order.id,
    amount,
    amountPaise: order.amount,
    currency: order.currency,
    provider: payments.provider,
    keyId: payments.publicKey || null,
    metroCardAmount: purpose === "ticket" ? metroCardAmount : null,
    cardBalance: user.cardBalance || 0,
    summary: purpose === "ticket"
      ? { from: draft.from, to: draft.to, date: draft.date, departTime: draft.dep.departTime,
          seats: draft.seats, perPassenger: draft.perPassenger, timeSlot: draft.timeSlot }
      : { amount },
    user: { name: user.name || "", email: user.email },
  });
});

// Checkout closed without paying: free the seats straight away
app.post("/payments/cancel", requireLogin, async (req, res) => {
  await q.releaseOrder.run(String(req.body.orderId || ""), req.session.email);
  res.json({ success: true });
});

const PAY_METHODS = new Set(["upi", "card", "netbanking", "metrocard"]);

function publicResult(booking) {
  const { userEmail, ...publicBooking } = booking;
  return { success: true, pnr: booking.pnr, booking: publicBooking };
}

// Seats went to someone else after the buyer paid: refund real payments
async function refundClash(orderId, order, method, paymentId, clash) {
  const seats = `Seat ${clash.join(", ")} was taken by another passenger`;
  if (method === "metrocard" || payments.provider === "test") {
    return { result: { success: false, message: `${seats}. You have not been charged.` } };
  }
  try {
    const refund = await payments.refundPayment(paymentId, order.amount, { orderId, reason: "seat_unavailable" });
    console.warn(`Refunded ${paymentId} for ${orderId}: seats ${clash.join(", ")} unavailable (refund ${refund.id})`);
    return {
      refund,
      result: {
        success: false, refunded: true,
        message: `${seats} before your payment completed. We've refunded ₹${order.amount} to your original payment method; it usually arrives in 5–7 working days.`,
      },
    };
  } catch (err) {
    console.error(`REFUND NEEDED: ${paymentId} for ${orderId} (₹${order.amount}).`, err.message);
    return {
      result: {
        success: false,
        message: `${seats} before your payment completed. We couldn't start your ₹${order.amount} refund automatically — contact support with payment ID ${paymentId}.`,
      },
    };
  }
}

// Turns a confirmed payment into a recharge or booking. Called from both
// /payments/verify and the webhook. The order is claimed with an atomic
// pending -> settling update in the same SQLite transaction as the seat check,
// the Metro Card debit and the booking insert, and the result is stored on the
// order, so a payment is only ever settled once and later callers get the
// same response. A refund in progress is shared through `settling`.
const settling = new Map();
const PROCESSING = { success: false, message: "This payment is still being processed. Check My Bookings in a minute." };

function settleOrder(orderId, method, paymentId) {
  if (!settling.has(orderId)) {
    settling.set(orderId, doSettle(orderId, method, paymentId).finally(() => settling.delete(orderId)));
  }
  return settling.get(orderId);
}

const insertBookingWithSeats = transaction(async (booking, seats) => {
  await insertBooking.run(bookingRow(booking));
  for (const seat of seats) await insertSeat.run(booking.pnr, booking.travelDate, booking.trainId, seat);
});

async function doSettle(orderId, method, paymentId) {
  let clash = null, order;
  const now = new Date().toISOString();

  const settle = transaction(async () => {
    order = await getOrder(orderId);
    if (order.status === "settled") return order.result;
    if (order.status !== "pending") return PROCESSING;

    const done = await settledPayment(paymentId);
    let result;
    if (done && done.booking) result = publicResult(done.booking);
    else if (done) result = { success: true, balance: done.user.cardBalance || 0 };
    if (result) {
      await q.claimOrder.run(orderId);
      await q.finishOrder.run(JSON.stringify(result), null, orderId);
      return result;
    }

    if (!(await q.claimOrder.run(orderId)).changes) return PROCESSING;
    const email = order.email;
    const paid = method === "metrocard" ? order.metroCardAmount : order.amount;

    if (order.purpose === "recharge") {
      await q.credit.run(order.amount, email);
      await insertTxn.run({ email, type: "recharge", amount: order.amount, method, paymentId, pnr: null, at: now });
      result = { success: true, balance: Number(await q.balance.get(email)) };
      await q.finishOrder.run(JSON.stringify(result), null, orderId);
      return result;
    }

    const d = order.draft;
    const taken = await takenSeats(d.date, d.dep.trainId, d.timeSlot, email);
    clash = d.seats.filter(s => taken.has(s));
    if (clash.length) return null; // stays "settling" until the refund is recorded

    const pnr = await generatePNR(email);
    const booking = {
      pnr,
      userEmail: email,
      trainName: `${MetroSim.LINES[d.dep.line].name} · ${d.dep.trainId}`,
      trainId: d.dep.trainId,
      line: d.dep.line,
      towards: d.dep.towards,
      from: d.from,
      to: d.to,
      path: d.path,
      legs: d.dep.legs.map(l => ({ line: l.line, from: l.from, to: l.to, stops: l.stops, towards: l.towards, boardTime: l.boardTime, alightTime: l.alightTime })),
      distance: d.distance,
      travelDate: d.date,
      departTime: d.dep.departTime,
      arriveTime: d.dep.arriveTime,
      departAt: MetroSim.istDayStartMs(d.date) + d.dep.depart * 60000,
      timeSlot: d.timeSlot,
      cls: "Standard",
      passengers: d.seats.length,
      seats: d.seats,
      seat: d.seats[0],
      price: paid,
      payment: { method, provider: method === "metrocard" ? "metrocard" : payments.provider, orderId, paymentId },
      status: "Confirmed",
      bookedAt: now,
    };

    if (method === "metrocard") {
      // Only debits when the balance still covers the fare; otherwise the
      // whole settlement (including the claim) rolls back
      if (!(await q.debit.run({ amount: paid, email })).changes) {
        throw new Reject({ success: false, message: `Metro Card balance is ₹${Number(await q.balance.get(email))}. Recharge or pick another method.` });
      }
      await insertTxn.run({ email, type: "ticket", amount: -paid, method: null, paymentId: null, pnr, at: now });
    }
    try {
      await insertBookingWithSeats(booking, d.seats); // savepoint; the unique seat index is the backstop
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      clash = d.seats;
      if (method === "metrocard") throw new Reject({ success: false, message: `Seat ${clash.join(", ")} was taken by another passenger. You have not been charged.` });
      return null;
    }
    result = publicResult(booking);
    await q.finishOrder.run(JSON.stringify(result), null, orderId);
    return result;
  });

  let result;
  try {
    result = await settle();
  } catch (err) {
    if (err instanceof Reject) return err.body;
    throw err;
  }
  if (result) return result;

  const { refund, result: refused } = await refundClash(orderId, order, method, paymentId, clash);
  await q.finishOrder.run(JSON.stringify(refused), refund ? JSON.stringify(refund) : null, orderId);
  return refused;
}

app.post("/payments/verify", requireLogin, async (req, res) => {
  const orderId = String(req.body.orderId || "");
  const order = await getOrder(orderId);
  const expired = { success: false, message: "Payment session expired. Please start again." };
  if (!order || order.email !== req.session.email) return res.json(expired);
  // The webhook (or a double tap) got here first
  if (settling.has(orderId)) return res.json(await settling.get(orderId));
  if (order.status === "settled") return res.json(order.result);
  if (order.status !== "pending") return res.json(PROCESSING);

  const method = PAY_METHODS.has(req.body.method) ? req.body.method : "upi";
  // Money that really moved is always settled (booked or refunded), even
  // after the hold lapsed; test and Metro Card payments must be in time.
  const live = method !== "metrocard" && payments.provider === "razorpay";
  if (!live && (order.expires < Date.now() || order.released)) return res.json(expired);

  if (method === "metrocard") {
    if (order.purpose !== "ticket") return res.json({ success: false, message: "Use UPI, card or net banking to recharge." });
    const balance = (await getUser(req.session.email)).cardBalance || 0;
    if (balance < order.metroCardAmount) {
      return res.json({ success: false, message: `Metro Card balance is ₹${balance}. Recharge or pick another method.` });
    }
  } else if (!payments.verifyPayment(orderId, req.body.razorpay_payment_id, req.body.razorpay_signature)) {
    return res.json({ success: false, message: "Payment could not be verified." });
  }

  const paymentId = req.body.razorpay_payment_id || "pay_test_" + crypto.randomBytes(6).toString("hex");
  res.json(await settleOrder(orderId, method, paymentId));
});

// Razorpay webhook: settles captured payments even if the buyer's browser
// never reached /payments/verify. Needs RAZORPAY_WEBHOOK_SECRET.
app.post("/payments/webhook", async (req, res) => {
  if (!payments.verifyWebhook(req.rawBody, req.get("X-Razorpay-Signature"))) {
    return res.status(400).json({ success: false, message: "Invalid signature" });
  }
  const payment = req.body.payload && req.body.payload.payment && req.body.payload.payment.entity;
  if (!payment || !payment.id) return res.json({ success: true });
  const orderId = String(payment.order_id || "");
  const order = await getOrder(orderId);

  if (req.body.event === "payment.failed") {
    // The buyer can retry in the same checkout, so the hold stays until it expires or is cancelled
    if (order) await q.orderError.run(payment.error_description || "Payment failed", orderId);
    return res.json({ success: true });
  }
  if (req.body.event !== "payment.captured") return res.json({ success: true });

  if (!order) {
    if (!(await settledPayment(payment.id))) {
      console.error(`REVIEW NEEDED: captured payment ${payment.id} (₹${payment.amount / 100}) for unknown order ${payment.order_id}.`);
    }
    return res.json({ success: true });
  }
  const method = PAY_METHODS.has(payment.method) ? payment.method : "upi";
  const result = await settleOrder(orderId, method, payment.id);
  if (!result.success) console.warn(`Webhook ${payment.id}: ${result.message}`);
  res.json({ success: true });
});

// ---------- BOOKINGS ----------
app.get("/my-bookings", requireLogin, async (req, res) => {
  const bookings = (await q.bookingsByUser.all(req.session.email))
    .map(toBooking)
    .map(({ userEmail, ...b }) => ({ ...b, departAt: b.departAt || Date.parse(b.bookedAt) }))
    .sort((a, b) => b.departAt - a.departAt);
  res.json({ success: true, bookings });
});

app.get("/check-pnr", async (req, res) => {
  const pnr = String(req.query.pnr || "").trim().toUpperCase();
  const booking = toBooking(await q.bookingByPnr.get(pnr));
  if (!booking) return res.json({ success: false, message: "PNR not found" });
  const { userEmail, payment, ...publicBooking } = booking;
  res.json({ success: true, booking: publicBooking });
});

// Cancel before departure; the fare is refunded to the Metro Card
app.post("/cancel-booking", requireLogin, async (req, res) => {
  const pnr = String(req.body.pnr || "").trim().toUpperCase();
  const email = req.session.email;

  // Status change, seat release and refund commit together; the
  // "status = 'Confirmed'" guard stops a booking being refunded twice.
  const cancel = transaction(async () => {
    const booking = toBooking(await q.bookingByPnr.get(pnr));
    if (!booking || booking.userEmail !== email) throw new Reject({ success: false, message: "Booking not found." });
    if (booking.status !== "Confirmed") throw new Reject({ success: false, message: "This booking is already cancelled." });
    if (!booking.departAt || booking.departAt <= Date.now()) {
      throw new Reject({ success: false, message: "Trips can only be cancelled before departure." });
    }

    booking.status = "Cancelled";
    booking.cancelledAt = new Date().toISOString();
    const { userEmail, ...data } = booking;
    if (!(await q.cancelBooking.run(JSON.stringify(data), pnr)).changes) {
      throw new Reject({ success: false, message: "This booking is already cancelled." });
    }
    await q.releaseSeats.run(pnr);
    await q.credit.run(booking.price, email);
    await insertTxn.run({ email, type: "refund", amount: booking.price, method: null, paymentId: null, pnr, at: booking.cancelledAt });
    return { refund: booking.price, balance: Number(await q.balance.get(email)) };
  });

  try {
    res.json({ success: true, ...(await cancel()) });
  } catch (err) {
    if (err instanceof Reject) return res.json(err.body);
    throw err;
  }
});

// ---------- SMART CARD ----------
app.get("/card-balance", requireLogin, async (req, res) => {
  const user = await getUser(req.session.email);
  res.json({
    success: true,
    balance: user.cardBalance || 0,
    transactions: (await q.recentTxns.all(user.email, 30)).map(toTxn),
  });
});

// ---------- SUPPORT ----------
const SUPPORT_TOPICS = new Set(["Booking issue", "Payment problem", "Metro Card", "Route query", "Refund request", "Other"]);

app.post("/support", requireLogin, async (req, res) => {
  const message = String(req.body.message || "").trim().slice(0, 2000);
  if (message.length < 10) return res.json({ success: false, message: "Please write a little more so we can help." });
  const ticket = "SR" + String(Date.now()).slice(-6);
  await q.insertTicket.run(
    ticket,
    req.session.email,
    SUPPORT_TOPICS.has(req.body.topic) ? req.body.topic : "Other",
    message,
    new Date().toISOString(),
  );
  res.json({ success: true, ticket });
});

// Static frontend (after the API routes so /profile etc. aren't shadowed)
app.use(express.static(FRONTEND_DIR));

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MetriGo running at http://localhost:${PORT} (payments: ${payments.provider} mode)`);
  });
}
