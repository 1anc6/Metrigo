# MetriGo

A smart metro booking web app for the Delhi Metro. Find the shortest route, pick a train and your seats, pay, and carry a QR ticket that works offline. A live map shows every train moving along the Yellow and Blue lines.

Built with Node.js, Express and SQLite on the backend and plain HTML, CSS and JavaScript on the frontend. No frontend framework or build step.

## Features

- **Shortest routes** using Dijkstra's algorithm over the metro network, including interchanges such as Rajiv Chowk
- **Journey planner**: departures for any date in the next 30 days, filtered by time of day, with duration, crowd level and fare
- **Seat booking** across four coaches (the first is women-only, as on Delhi Metro), with a "Best seats" button that keeps groups together
- **Dynamic pricing**: distance-based fares, cheaper off-peak and higher at peak hours, plus 10% off when paying with the Metro Card
- **Payments**: UPI, card, net banking or Metro Card. Runs in test mode by default; uses [Razorpay](https://razorpay.com) when keys are set
- **QR tickets**, PNR lookup, and cancellation before departure with a refund to the Metro Card
- **Live metro map** with every train's position and arrival countdowns for any station
- **Metro Card** wallet with top-ups and transaction history
- **Installable app (PWA)**: add it to your home screen, and your tickets open even without signal
- **Responsive design**: mobile-first, with a sidebar layout on desktop. Neumorphic look with light and dark themes

## Quick start

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
git clone https://github.com/1anc6/Metrigo.git
cd Metrigo/Backend
npm install
npm start
```

Open http://localhost:8080 and create an account. The server also serves the frontend, so there is nothing else to run.

To try it on your phone, connect it to the same Wi-Fi and open `http://<your-computer's-IP>:8080`.

## Configuration

Everything works out of the box. Set these environment variables to switch on the optional parts:

| Variable | What it does |
|---|---|
| `PORT` | Port to listen on. Default `8080` |
| `SESSION_SECRET` | Secret for login cookies. Without it a random one is used and everyone is signed out on restart |
| `METRIGO_DB` | Path to the SQLite database. Default `Backend/data/metrigo.db` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Take real payments through Razorpay Checkout instead of test mode |
| `RAZORPAY_WEBHOOK_SECRET` | Verify Razorpay webhooks sent to `/payments/webhook` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Email password-reset codes. Without SMTP, codes are printed in the server console for development |

In **test mode** no money moves: the checkout simulates the payment so you can try the full booking flow.

## How it works

### Routing: Dijkstra's algorithm
Stations are nodes and track sections are weighted edges (`Backend/data/stations.csv`, `edges.csv`). Dijkstra's algorithm with a binary heap finds the shortest path in O((V + E) log V).

### Timetable and live trains
`FrontEnd/assets/js/metro-sim.js` generates the timetable: trains every 3 minutes at peak (8–11 AM, 5–9 PM) and every 5 minutes otherwise, from 6 AM to 11 PM. The server and the browser share this file, so the train you book is the same one you see moving on the live map. Positions are simulated from the timetable, not GPS.

### Seat allocation: greedy, then backtracking
"Best seats" first tries a greedy pass for adjacent free seats in one row, which takes O(n). If none fit, a backtracking search scores groups by rows used, spread and gaps, and prunes groups that spread too far.

### Pricing
Fares follow distance bands, then a time-slot multiplier: early morning ×0.8, afternoon ×0.9, night ×1.0, morning peak ×1.3, evening peak ×1.4. The server always calculates the price, so the browser can't change it.

### Bookings and payments
1. The server creates an order and holds the chosen seats for 15 minutes.
2. The payment is confirmed: a Razorpay signature, a Metro Card debit, or a simulated payment in test mode.
3. The server issues a PNR (based on SHA-256) and saves the booking in a single database transaction, so a seat can't be sold twice.

### Security
- Passwords are hashed with bcrypt.
- Sessions are stored in SQLite.
- Login and password-reset requests are rate-limited.
- Reset codes are only ever emailed, never returned by the API.

## API

| Area | Endpoints |
|---|---|
| Auth | `POST /register`, `POST /login`, `GET /logout`, `POST /forgot-password`, `POST /reset-password` |
| Profile | `GET /profile`, `POST /update-profile` (name, password, saved stations) |
| Routing | `GET /stations`, `POST /shortest-path`, `POST /journey` |
| Seats | `POST /seat-map`, `POST /suggest-seats` |
| Payments | `GET /payments/config`, `POST /payments/order`, `POST /payments/verify`, `POST /payments/cancel`, `POST /payments/webhook` |
| Bookings | `GET /my-bookings`, `GET /check-pnr`, `POST /cancel-booking` |
| Metro Card | `GET /card-balance` (balance and recent activity) |
| Support | `POST /support` |

All endpoints take and return JSON. Endpoints that need a signed-in user return `401` without one.

## Project structure

```
Backend/
  server.js        Express app and every API route
  db.js            SQLite schema, queries and one-time import of old JSON data
  payments.js      Payment gateway adapter (test mode or Razorpay)
  data/            stations.csv, edges.csv; the database is created here
FrontEnd/
  *.html           Pages: home, booking, trips, live map, metro card, profile, help, sign-in
  assets/css/      Design system (app.css)
  assets/js/       core.js (shared UI), metro-sim.js (network + timetable), payment.js (checkout + tickets)
  sw.js            Service worker for offline tickets
  manifest.webmanifest
```

## Limitations

- Only the Yellow and Blue lines are included, with approximate station coordinates.
- Live train positions are simulated from the timetable, not real-time feeds.
- Payments are simulated unless Razorpay keys are configured.
