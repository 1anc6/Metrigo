// MetriGo service worker: offline app shell, cached static assets, network-first API.
// Bump VERSION whenever the shell list changes; old caches are dropped on activate.
const VERSION = "v5";
const SHELL = `mg-shell-${VERSION}`;
const RUNTIME = `mg-runtime-${VERSION}`;
const API = "mg-api"; // per-user API responses; cleared on logout

// Everything the pages load is self-hosted, so the whole app works offline
// and no third party sees a visitor until they open a map (OpenStreetMap
// tiles) or pay with Razorpay.
const SHELL_FILES = [
  "index.html", "bookings.html", "check-status.html", "live-metro.html", "profile.html",
  "recharge.html", "help.html", "login.html", "register.html",
  "privacy.html", "terms.html", "refunds.html", "cookies.html",
  "assets/css/app.css", "assets/js/core.js", "assets/js/metro-sim.js", "assets/js/payment.js",
  "assets/js/vendor/qrcode.min.js", "assets/js/vendor/jspdf.umd.min.js",
  "assets/vendor/leaflet/leaflet.css", "assets/vendor/leaflet/leaflet.js",
  "assets/fonts/plus-jakarta-sans-latin-wght-normal.woff2", "assets/fonts/plus-jakarta-sans-latin-ext-wght-normal.woff2",
  "metro.jpg", "manifest.webmanifest",
  "assets/icons/icon-192.png", "assets/icons/icon-512.png", "assets/icons/apple-touch-icon.png",
];

// Money and auth endpoints always go straight to the network, uncached.
// /my-bookings is kept offline in IndexedDB by the pages instead (see MG.tickets).
const NO_CACHE = /^\/(payments|logout|login|register|forgot-password|reset-password|cancel-booking|my-bookings|check-pnr|delete-account)(\/|$)/;

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES.map(f => new Request(f, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = [SHELL, RUNTIME, API];
    await Promise.all((await caches.keys()).filter(k => k.startsWith("mg-") && !keep.includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin !== location.origin) return; // map tiles and Razorpay pass through
  if (url.pathname === "/logout") { event.waitUntil(clearUserData()); return; }
  if (NO_CACHE.test(url.pathname)) return;
  if (req.mode === "navigate") return event.respondWith(page(req));
  if (/\.[a-z0-9]+$/i.test(url.pathname)) return event.respondWith(cacheFirst(req, true));
  event.respondWith(networkFirst(req));
});

// Pages: show the cached copy instantly and refresh it in the background
// (stale-while-revalidate), so switching tabs never waits on the network.
// A new deploy shows up on the next visit; bumping VERSION forces it at once.
async function page(req) {
  const key = req.url.split("?")[0];
  const shell = await caches.open(SHELL);
  const cached = await shell.match(key);
  const fresh = fetch(req).then(res => {
    if (res.ok && !res.redirected) shell.put(key, res.clone());
    return res;
  });
  if (cached) {
    fresh.catch(() => {});
    return cached;
  }
  try {
    return await fresh;
  } catch (e) {
    return (await caches.match("index.html")) || Response.error();
  }
}

// Static files: serve from cache; same-origin files also refresh in the background
async function cacheFirst(req, revalidate) {
  const shell = await caches.open(SHELL);
  const inShell = await shell.match(req, { ignoreSearch: true });
  const cached = inShell || (await caches.match(req, { ignoreVary: true }));
  if (cached && !revalidate) return cached;
  const target = inShell ? shell : await caches.open(RUNTIME);
  const update = fetch(req).then(res => {
    if (res.ok || res.type === "opaque") target.put(req, res.clone());
    return res;
  });
  if (cached) { update.catch(() => {}); return cached; }
  return update.catch(() => Response.error());
}

// API: network first; the last good response is served offline, tagged so pages can say so
async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(API)).put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await (await caches.open(API)).match(req);
    if (!cached) return Response.error();
    const headers = new Headers(cached.headers);
    headers.set("X-MetriGo-Offline", "1");
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }
}

// Signing out removes this user's cached profile data and saved tickets
async function clearUserData() {
  await caches.delete(API);
  await new Promise(resolve => {
    const r = indexedDB.deleteDatabase("metrigo");
    r.onsuccess = r.onerror = r.onblocked = resolve;
  });
}
