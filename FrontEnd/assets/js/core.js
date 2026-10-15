// MetriGo shared runtime: theme, API, icons, shell (top bar + dock), sheets, toasts.
(function () {
  "use strict";

  const MG = (window.MG = window.MG || {});

  // ---------- Utilities ----------
  MG.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  MG.rupee = n => "₹" + Number(n || 0).toLocaleString("en-IN");
  MG.$ = (sel, root) => (root || document).querySelector(sel);
  MG.$$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  MG.params = new URLSearchParams(location.search);
  MG.lineColor = id => (id === "blue" ? "var(--blue)" : "var(--yellow)");
  MG.lineHex = id => (id === "blue" ? "#2F7FE0" : "#F2C200");

  MG.fmtDate = (dateStr, opts) =>
    new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", opts || { weekday: "long", day: "numeric", month: "long" });

  // ---------- Icons (24px grid, stroke) ----------
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="17" rx="3"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    train: '<rect x="5" y="3" width="14" height="14" rx="4"/><path d="M5 10h14M9 21l-2-3.5M15 21l2-3.5"/><path d="M9 13.5h.01M15 13.5h.01"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    origin: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8.5"/>',
    arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowL: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    swap: '<path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    ticket: '<path d="M3 8.5V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5z"/><path d="M14 5v2.5M14 11v2M14 16.5V19"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.4"/><path d="M12 17h.01"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
    chevL: '<path d="m15 18-6-6 6-6"/>',
    chevR: '<path d="m9 18 6-6-6-6"/>',
    chevD: '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    live: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.6-5 6.5-5s5.5 1.5 6.5 5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.2 2.2 3.5 5"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    bank: '<path d="M3 10h18L12 4zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/>',
    bookmark: '<path d="M6 3.5h12v17l-6-4-6 4z"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    seat: '<path d="M7 4h8a2 2 0 0 1 2 2v7H7z"/><path d="M5 13h14v3H5zM7 16v4M17 16v4"/>',
    route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/>',
    wallet: '<path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A2.5 2.5 0 0 0 3 6.5v11A2.5 2.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/><path d="M21 9h-5a3 3 0 0 0 0 6h5z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
    offline: '<path d="m3 3 18 18"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.4-1.8"/><path d="M2 8.8a15 15 0 0 1 4.3-2.7M22 8.8A15 15 0 0 0 10.6 5.1"/><path d="M12 20h.01"/>',
    navigation: '<path d="m3 11 18-8-8 18-2-8z"/>',
    message: '<path d="M4 5h16v11H8l-4 4z"/>',
    crowd: '<circle cx="7" cy="8" r="2.5"/><circle cx="17" cy="8" r="2.5"/><circle cx="12" cy="6.5" r="2.5"/><path d="M3 19c.5-3 2-4.5 4-4.5M21 19c-.5-3-2-4.5-4-4.5M7.5 20c.5-3.5 2.2-5.5 4.5-5.5s4 2 4.5 5.5"/>',
  };
  MG.icon = (name, cls) => `<svg class="i ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ""}</svg>`;
  // <span data-icon="pin"></span> → inline SVG
  MG.hydrateIcons = (root) => MG.$$("[data-icon]", root).forEach(el => {
    el.outerHTML = MG.icon(el.dataset.icon, el.className);
  });
  // core.js loads at the end of <body>, so the page markup is already parsed
  MG.hydrateIcons();

  // ---------- Theme ----------
  MG.theme = {
    get: () => document.documentElement.dataset.theme || "light",
    set(t) {
      document.documentElement.dataset.theme = t;
      try { localStorage.setItem("mg-theme", t); } catch (e) { /* storage blocked */ }
      MG.$$("[data-theme-toggle]").forEach(MG.theme.paint);
      MG.theme.bar();
      document.dispatchEvent(new CustomEvent("mg:theme", { detail: t }));
    },
    // Installed-app title bar follows the page surface (--bg in app.css)
    bar() {
      const meta = MG.$('meta[name="theme-color"]');
      if (meta) meta.content = MG.theme.get() === "dark" ? "#2B2C23" : "#E7E8E4";
    },
    toggle() { MG.theme.set(MG.theme.get() === "dark" ? "light" : "dark"); },
    paint(btn) {
      const dark = MG.theme.get() === "dark";
      btn.innerHTML = MG.icon(dark ? "sun" : "moon");
      btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      btn.title = btn.getAttribute("aria-label");
    },
    bind(btn) { MG.theme.paint(btn); btn.addEventListener("click", MG.theme.toggle); },
  };
  MG.theme.bar();

  // ---------- API ----------
  // Offline = the browser says so, or the last API call couldn't reach the server
  // (sw.js tags responses it served from cache with X-MetriGo-Offline).
  let netDown = false;
  MG.isOffline = () => !navigator.onLine || netDown;

  MG.api = async (path, opts = {}) => {
    const init = { method: opts.method || (opts.body ? "POST" : "GET"), headers: {}, credentials: "same-origin" };
    if (opts.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    let res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      netDown = true;
      throw new Error(navigator.onLine ? "Can't reach the MetriGo server. Is it running?" : "You're offline.");
    }
    netDown = !!res.headers.get("X-MetriGo-Offline");
    if (res.status === 401 && !opts.allow401) {
      location.href = "login.html?next=" + encodeURIComponent(location.pathname.slice(1) + location.search);
      throw new Error("Not signed in");
    }
    const data = await res.json();
    if (netDown && data && typeof data === "object") data.offline = true;
    if (path === "/my-bookings" && data.success && !data.offline) MG.tickets.replace(data.bookings);
    // A new sign-in starts clean, even if the last rider's session expired without /logout
    if ((path === "/login" || path === "/register") && data.success) await MG.tickets.forget();
    return data;
  };

  // ---------- Bookings ----------
  MG.bookingState = (b) => {
    if (b.status === "Cancelled") return "cancelled";
    return b.departAt && b.departAt < Date.now() - 2 * 3600 * 1000 ? "completed" : "confirmed";
  };

  // Confirmed upcoming tickets kept in IndexedDB so they open with no signal.
  // sw.js deletes the database (and cached API data) on /logout; forget() does the same on sign-in.
  MG.tickets = (() => {
    const DB = "metrigo", STORE = "tickets";
    const open = () => new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "pnr" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => { db.close(); resolve(req && req.result); };
        t.onerror = t.onabort = () => { db.close(); reject(t.error); };
      });
    };
    const keep = b => b && b.pnr && MG.bookingState(b) === "confirmed";
    const strip = ({ payment, ...b }) => b;
    return {
      replace: list => run("readwrite", s => { s.clear(); list.filter(keep).forEach(b => s.put(strip(b))); }).catch(() => {}),
      put: b => (keep(b) ? run("readwrite", s => { s.put(strip(b)); }).catch(() => {}) : Promise.resolve()),
      all: () => run("readonly", s => s.getAll()).then(l => (l || []).filter(keep)).catch(() => []),
      get: pnr => run("readonly", s => s.get(pnr)).then(b => (keep(b) ? b : null)).catch(() => null),
      forget: () => Promise.all([
        run("readwrite", s => { s.clear(); }).catch(() => {}),
        window.caches ? caches.delete("mg-api").catch(() => {}) : null,
      ]),
    };
  })();

  MG.offlineNotice = () => `<div class="notice offline">${MG.icon("offline")}<span>Offline — showing saved tickets</span></div>`;

  let mePromise = null;
  MG.me = (fresh) => {
    if (!mePromise || fresh) mePromise = MG.api("/profile").then(r => (r.success ? r.data : null));
    return mePromise;
  };
  MG.displayName = u => (u && (u.name || u.email.split("@")[0])) || "Rider";

  // ---------- Shell: bottom tab bar ----------
  const TABS = [
    { href: "index.html", icon: "home", label: "Home", key: "home" },
    { href: "check-status.html", icon: "calendar", label: "Trips", key: "trips" },
    { href: "live-metro.html", icon: "clock", label: "Live metro", key: "live" },
    { href: "profile.html", icon: "user", label: "Profile", key: "profile" },
  ];

  MG.shell = (active) => {
    const bar = document.createElement("nav");
    bar.className = "tabbar";
    bar.setAttribute("aria-label", "Main");
    // Brand, labels, Book button and footer only show in the desktop sidebar
    bar.innerHTML = `
      <a class="tb-brand" href="index.html" aria-label="MetriGo home"><span class="mark">${MG.icon("train")}</span>MetriGo</a>
      ${TABS.map(t =>
        `<a class="tb-item" href="${t.href}" ${t.key === active ? 'aria-current="page"' : ""} aria-label="${t.label}" title="${t.label}">${MG.icon(t.icon)}<span>${t.label}</span></a>`
      ).join("")}
      <a class="btn tb-book" href="bookings.html">${MG.icon("plus")}Book a trip</a>
      <div class="tb-foot">
        <a class="tb-user" href="profile.html"><span class="avatar-sm" id="tbAvatar">·</span><span class="tb-name"><b id="tbName">—</b><small id="tbBal">Metro Card</small></span></a>
        <button class="icon-btn plain" data-theme-toggle></button>
      </div>`;
    document.body.appendChild(bar);
    MG.$$("[data-theme-toggle]").forEach(MG.theme.bind);
    MG.me().then(u => {
      if (!u) return;
      MG.$("#tbAvatar").textContent = MG.displayName(u)[0].toUpperCase();
      MG.$("#tbName").textContent = MG.displayName(u);
      MG.$("#tbBal").textContent = `Metro Card · ${MG.rupee(u.cardBalance)}`;
    }).catch(() => {});
  };

  // True when the desktop layout (sidebar, side-by-side panels) is active
  MG.desk = window.matchMedia("(min-width: 1024px)");

  // ---------- Toast ----------
  let toastEl, toastTimer;
  MG.toast = (msg, kind) => {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.className = "toast" + (kind === "bad" ? " bad" : "");
    toastEl.innerHTML = MG.icon(kind === "bad" ? "info" : "check") + `<span>${MG.esc(msg)}</span>`;
    requestAnimationFrame(() => toastEl.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
  };

  // ---------- Sheets ----------
  MG.sheet = {
    open(html, opts = {}) {
      MG.sheet.close(true);
      const bd = document.createElement("div");
      bd.className = "sheet-backdrop";
      bd.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" ${opts.label ? `aria-label="${MG.esc(opts.label)}"` : ""}><div class="grabber"></div>${html}</div>`;
      bd.addEventListener("click", e => { if (e.target === bd && !opts.locked) MG.sheet.close(); });
      document.body.appendChild(bd);
      document.body.style.overflow = "hidden";
      MG.sheet.current = bd;
      MG.sheet.onClose = opts.onClose || null;
      requestAnimationFrame(() => bd.classList.add("open"));
      MG.$$("[data-close]", bd).forEach(b => b.addEventListener("click", () => MG.sheet.close()));
      const focusable = MG.$("input, button:not([data-close]), [href]", bd);
      if (focusable && !opts.noFocus) setTimeout(() => focusable.focus({ preventScroll: true }), 50);
      return MG.$(".sheet", bd);
    },
    close(silent) {
      const bd = MG.sheet.current;
      if (!bd) return;
      MG.sheet.current = null;
      bd.classList.remove("open");
      setTimeout(() => bd.remove(), 250);
      document.body.style.overflow = "";
      const cb = MG.sheet.onClose;
      MG.sheet.onClose = null;
      if (cb && !silent) cb();
    },
  };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && MG.sheet.current) MG.sheet.close(); });

  MG.closeBtn = () => `<button class="icon-btn" data-close aria-label="Close">${MG.icon("x")}</button>`;

  MG.setBusy = (btn, busy, label) => {
    if (busy) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span>${label ? `<span>${MG.esc(label)}</span>` : ""}`;
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  };

  // ---------- Station inputs ----------
  MG.stationDatalist = (id) => {
    if (document.getElementById(id)) return;
    const dl = document.createElement("datalist");
    dl.id = id;
    dl.innerHTML = MetroSim.stationNames().map(n => `<option value="${MG.esc(n)}">`).join("");
    document.body.appendChild(dl);
  };
  MG.isStation = name => !!MetroSim.stationIndex[name];
  MG.matchStation = name => {
    const n = String(name || "").trim().toLowerCase();
    return MetroSim.stationNames().find(s => s.toLowerCase() === n) || null;
  };
  MG.stationLines = name => (MetroSim.stationIndex[name] || []).map(s => s.line);

  // ---------- Route visuals ----------
  // Dashed curve between an origin diamond and a destination pin (trip cards)
  MG.curveSVG = (seed) => {
    const s = Math.abs(hash(String(seed || "x")));
    const up = 8 + (s % 18), down = 52 + ((s >> 3) % 14);
    return `<svg class="curve" viewBox="0 0 300 76" preserveAspectRatio="none" aria-hidden="true">
      <path class="dash" d="M18 52 C 70 ${down + 18}, 110 ${up}, 160 30 S 250 ${up + 4}, 282 18"/>
      <g transform="translate(18 52) rotate(45)"><rect x="-5" y="-5" width="10" height="10" rx="2" fill="currentColor"/></g>
      <g transform="translate(282 18)"><path d="M0 4c0 0 6-5.4 6-10.2a6 6 0 1 0-12 0C-6-1.4 0 4 0 4z" fill="currentColor"/><circle cx="0" cy="-6.2" r="2.2" fill="var(--card)"/></g>
    </svg>`;
  };

  // Static grayscale map with the route drawn on it (destination cards).
  // Route colours come from CSS classes so they follow the theme.
  MG.miniMap = (el, path) => {
    const coords = path.map(n => (MetroSim.stationIndex[n] || [])[0]).filter(Boolean).map(s => s.coord);
    const map = L.map(el, {
      zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
      doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, tap: false, zoomSnap: 0.25, fadeAnimation: false,
    });
    MG.map.tiles().addTo(map);
    MG.map.keepSized(map);
    if (coords.length < 2) { map.setView([28.62, 77.2], 12); return map; }
    L.polyline(coords, { className: "mg-route", weight: 3.5, lineCap: "round", lineJoin: "round" }).addTo(map);
    L.circleMarker(coords[0], { className: "mg-route-start", radius: 5, weight: 3, fillOpacity: 1 }).addTo(map);
    L.circleMarker(coords[coords.length - 1], { className: "mg-route-end", radius: 6, weight: 0, fillOpacity: 1 }).addTo(map);
    // Fit the route, but stay at street level so the card reads as a map
    const bounds = L.latLngBounds(coords);
    const fit = map.getBoundsZoom(bounds, false, L.point(80, 120));
    map.setView(bounds.getCenter(), Math.max(fit, 12), { animate: false });
    map.panBy([0, 22], { animate: false });
    return map;
  };

  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return h;
  }

  // Station path as a timeline, coloured per line, collapsible
  MG.timelineHTML = (path, legs, collapse) => {
    const lineAt = i => {
      if (!legs) return null;
      for (const l of legs) {
        const names = path.slice(path.indexOf(l.from), path.indexOf(l.to) + 1);
        if (names.includes(path[i]) && path[i] !== l.to) return l.line;
      }
      return legs[legs.length - 1].line;
    };
    const changes = new Set((legs || []).slice(1).map(l => l.from));
    return `<ol class="timeline ${collapse && path.length > 6 ? "collapsed" : ""}">${path.map((name, i) => {
      const end = i === 0 || i === path.length - 1;
      const change = changes.has(name);
      const lc = lineAt(i);
      const leg = (legs || []).find(l => l.from === name);
      const note = leg ? `<span class="note">${MetroSim.LINES[leg.line].name} towards ${MG.esc(leg.towards)}${leg.boardTime ? " · " + leg.boardTime : ""}</span>` : "";
      return `<li class="${end ? "end" : change ? "change" : "mid"}" style="${lc ? `--lc:${MG.lineColor(lc)}` : ""}">${MG.esc(name)}${change ? ' <span class="chip" style="height:22px;margin-left:6px">Change</span>' : ""}${note}</li>`;
    }).join("")}</ol>${collapse && path.length > 6 ? `<button class="link-btn" style="margin-top:6px" onclick="this.previousElementSibling.classList.toggle('collapsed');this.textContent=this.previousElementSibling.classList.contains('collapsed')?'Show all ${path.length} stations':'Hide stations'">Show all ${path.length} stations</button>` : ""}`;
  };

  // ---------- Map ----------
  MG.map = {
    // Leaflet measures its container once; re-measure when layout settles or changes
    keepSized(map) {
      const el = map.getContainer();
      let w = el.clientWidth, h = el.clientHeight;
      new ResizeObserver(() => {
        if (el.clientWidth === w && el.clientHeight === h) return;
        w = el.clientWidth; h = el.clientHeight;
        map.invalidateSize({ pan: false });
      }).observe(el);
      setTimeout(() => map.invalidateSize({ pan: false }), 0);
    },
    // OpenStreetMap tiles; app.css turns them monochrome for each theme
    tiles() {
      return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      });
    },
    create(el, opts = {}) {
      const map = L.map(el, { fadeAnimation: false, zoomControl: opts.zoom !== false, attributionControl: true, minZoom: 10, maxZoom: 17, scrollWheelZoom: opts.scroll !== false })
        .setView([28.615, 77.18], opts.zoomLevel || 11);
      if (map.zoomControl) map.zoomControl.setPosition("bottomright");
      MG.map.tiles().addTo(map);
      MG.map.keepSized(map);
      return map;
    },
    // Line polylines + station dots; returns { layers: {yellow, blue} }
    network(map, opts = {}) {
      const layers = {};
      Object.values(MetroSim.LINES).forEach(line => {
        const g = L.layerGroup();
        L.polyline(line.coords, { color: line.color, weight: opts.weight || 4, opacity: opts.opacity ?? 0.9, lineCap: "round", lineJoin: "round" }).addTo(g);
        line.stations.forEach(([name, lat, lng]) => {
          const multi = (MetroSim.stationIndex[name] || []).length > 1;
          L.marker([lat, lng], {
            icon: L.divIcon({ className: "", html: `<div class="mg-station${multi ? " big" : ""}" style="--lc:${line.color}"></div>`, iconSize: multi ? [14, 14] : [10, 10], iconAnchor: multi ? [7, 7] : [5, 5] }),
            title: name, keyboard: false,
          }).bindPopup(`<b>${MG.esc(name)}</b><br><span style="color:var(--text-2)">${multi ? "Interchange · Yellow & Blue" : line.name}</span>${opts.popupExtra ? opts.popupExtra(name) : ""}`)
            .on("click", () => opts.onStation && opts.onStation(name))
            .addTo(g);
        });
        g.addTo(map);
        layers[line.id] = g;
      });
      return layers;
    },
    trainIcon(lineId, focus) {
      return L.divIcon({
        className: "",
        html: `<div class="mg-train${focus ? " focus" : ""}" style="--lc:${MG.lineHex(lineId)}">${focus ? MG.icon("train") : ""}</div>`,
        iconSize: focus ? [26, 26] : [12, 12], iconAnchor: focus ? [13, 13] : [6, 6],
      });
    },
    endpointIcon(kind) {
      return L.divIcon({ className: "", html: `<div class="mg-end">${MG.icon(kind === "start" ? "origin" : "pin")}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
    },
    // Highlight a station path; returns a layer group
    route(map, path) {
      const g = L.layerGroup();
      const coords = path.map(n => (MetroSim.stationIndex[n] || [])[0]).filter(Boolean).map(s => s.coord);
      if (coords.length < 2) return g;
      L.polyline(coords, { className: "mg-route-glow", weight: 12, lineCap: "round" }).addTo(g);
      L.polyline(coords, { className: "mg-route", weight: 4, dashArray: "1 9", lineCap: "round" }).addTo(g);
      L.marker(coords[0], { icon: MG.map.endpointIcon("start") }).addTo(g);
      L.marker(coords[coords.length - 1], { icon: MG.map.endpointIcon("end") }).addTo(g);
      g.addTo(map);
      map.fitBounds(L.latLngBounds(coords), { padding: [50, 50] });
      return g;
    },
  };

  // Live trains on a map; call .tick() on an interval
  MG.liveTrains = (map, opts = {}) => {
    const markers = new Map();
    let filter = null;
    const api = {
      focusId: null,
      setFilter(f) { filter = f; api.tick(); },
      tick() {
        const now = Date.now();
        const trains = MetroSim.livePositions(now).filter(t => !filter || t.line === filter);
        const seen = new Set();
        trains.forEach(t => {
          seen.add(t.id);
          let m = markers.get(t.id);
          const focus = api.focusId === t.id;
          if (!m) {
            m = L.marker([t.lat, t.lng], { icon: MG.map.trainIcon(t.line, focus), zIndexOffset: 500, keyboard: false })
              .on("click", () => opts.onClick && opts.onClick(t.id))
              .addTo(map);
            m._focus = focus;
            markers.set(t.id, m);
          } else {
            m.setLatLng([t.lat, t.lng]);
            if (m._focus !== focus) { m.setIcon(MG.map.trainIcon(t.line, focus)); m._focus = focus; }
          }
          const tip = `<b>${t.id}</b> · to ${MG.esc(t.towards)}<br>Next: ${MG.esc(t.nextStation)} in ${MG.etaLabel(t.nextInMin)}`;
          if (m.getTooltip()) m.setTooltipContent(tip);
          else m.bindTooltip(tip, { direction: "top", offset: [0, -8] });
        });
        markers.forEach((m, id) => { if (!seen.has(id)) { map.removeLayer(m); markers.delete(id); } });
        if (opts.onTick) opts.onTick(trains);
        return trains;
      },
    };
    return api;
  };

  // Countdown label for arrivals
  MG.etaLabel = (min) => (min < 0.75 ? "Now" : Math.ceil(min) + " min");

  // ---------- Offline app (sw.js) + install prompt ----------
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // Chrome offers install via beforeinstallprompt; Home shows the prompt (MG.install.prompt)
  MG.install = {
    event: null,
    async prompt() {
      const e = MG.install.event;
      if (!e) return false;
      MG.install.event = null;
      e.prompt();
      return (await e.userChoice).outcome === "accepted";
    },
  };
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    MG.install.event = e;
    document.dispatchEvent(new CustomEvent("mg:installable"));
  });
  window.addEventListener("appinstalled", () => {
    MG.install.event = null;
    document.dispatchEvent(new CustomEvent("mg:installed"));
  });
})();
