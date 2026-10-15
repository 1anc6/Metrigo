// MetriGo checkout sheet + ticket view.
// Server decides the amount (/payments/order) and confirms it (/payments/verify).
// Test mode simulates the gateway; with Razorpay keys on the server the
// UPI / card / net-banking methods open Razorpay Checkout instead.
(function () {
  "use strict";
  const MG = window.MG;

  const loadScript = (() => {
    const cache = {};
    return src => cache[src] || (cache[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("Could not load " + src));
      document.head.appendChild(s);
    }));
  })();
  // Vendored (qrcodejs 1.0.0) so tickets render a QR with no signal
  const QR_SRC = "assets/js/vendor/qrcode.min.js";
  const RAZORPAY_SRC = "https://checkout.razorpay.com/v1/checkout.js";

  // Drawn at 2x for sharpness; CSS scales it to exactly fill the white box
  MG.renderQR = async (el, text, size) => {
    try {
      await loadScript(QR_SRC);
      el.innerHTML = "";
      new QRCode(el, { text, width: size * 2, height: size * 2, colorDark: "#1E1F18", colorLight: "#FFFFFF", correctLevel: QRCode.CorrectLevel.M });
    } catch (e) {
      el.innerHTML = `<span style="color:#555;font-size:12px;text-align:center">QR unavailable</span>`;
    }
  };

  const BANKS = ["State Bank of India", "HDFC Bank", "ICICI Bank", "Axis Bank", "Punjab National Bank", "Kotak Mahindra Bank"];

  // opts: { order: {purpose,...request body}, title, onSuccess(result) }
  MG.checkout = async (opts) => {
    let order;
    try {
      order = await MG.api("/payments/order", { body: opts.order });
    } catch (e) {
      MG.toast(e.message, "bad");
      return;
    }
    if (!order.success) {
      MG.toast(order.message || "Could not start payment.", "bad");
      if (opts.onError) opts.onError(order);
      return;
    }

    const isTicket = opts.order.purpose !== "recharge";
    const test = order.provider === "test";
    const methods = [
      { id: "upi", icon: "phone", label: "UPI", sub: "GPay, PhonePe, Paytm" },
      { id: "card", icon: "card", label: "Card", sub: "Debit or credit" },
      { id: "netbanking", icon: "bank", label: "Net banking", sub: "All major banks" },
    ];
    if (isTicket) methods.push({ id: "metrocard", icon: "wallet", label: "Metro Card", sub: `${MG.rupee(order.cardBalance)} · 10% off` });
    let method = isTicket && order.cardBalance >= order.metroCardAmount ? "metrocard" : "upi";

    const s = order.summary;
    const rows = isTicket
      ? `<div class="summary-row"><span>Route</span><span>${MG.esc(s.from)} → ${MG.esc(s.to)}</span></div>
         <div class="summary-row"><span>Departure</span><span>${MG.fmtDate(s.date, { day: "numeric", month: "short" })} · ${MG.esc(s.departTime)}</span></div>
         <div class="summary-row"><span>Seats</span><span>${s.seats.map(MG.esc).join(", ")}</span></div>
         <div class="summary-row"><span>Fare</span><span>${MG.rupee(s.perPassenger)} × ${s.seats.length} · ${MetroSim.TIME_SLOTS[s.timeSlot].label}</span></div>`
      : `<div class="summary-row"><span>Metro Card recharge</span><span>${MG.rupee(s.amount)}</span></div>`;

    const expires = Date.now() + 15 * 60 * 1000;
    const sheet = MG.sheet.open(`
      <div class="sheet-head">
        <div><div class="eyebrow">Checkout</div><div class="h2">${MG.esc(opts.title || (isTicket ? "Pay for your trip" : "Recharge Metro Card"))}</div></div>
        ${MG.closeBtn()}
      </div>
      <div class="stack">
        ${test ? `<div class="test-banner">${MG.icon("info")}<span>Test mode — no real money moves. Add Razorpay keys on the server to take live payments.</span></div>` : ""}
        <div class="inset" style="padding:12px 16px">${rows}
          <div class="summary-row total"><span>Total</span><span id="payTotal">${MG.rupee(order.amount)}</span></div>
        </div>
        <div class="pay-methods" role="group" aria-label="Payment method">
          ${methods.map(m => `<button class="pay-method" data-m="${m.id}" aria-pressed="${m.id === method}">${MG.icon(m.icon)}<span>${m.label}<small>${MG.esc(m.sub)}</small></span></button>`).join("")}
        </div>
        <div id="payPanel"></div>
        <div id="payError"></div>
        <button class="btn block" id="payBtn"></button>
        <div class="row between tiny faint"><span class="row" style="gap:6px">${MG.icon("shield")} Secured by ${test ? "MetriGo test gateway" : "Razorpay"}</span><span class="num" id="payTimer">15:00</span></div>
      </div>`, { label: "Checkout", noFocus: true,
      // Closing without paying releases the held seats for other passengers
      onClose: () => MG.api("/payments/cancel", { body: { orderId: order.orderId } }).catch(() => {}) });

    const timer = setInterval(() => {
      const left = Math.max(0, expires - Date.now());
      const el = MG.$("#payTimer", sheet);
      if (!el || !document.body.contains(el)) return clearInterval(timer);
      el.textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
      if (!left) { clearInterval(timer); MG.$("#payBtn", sheet).disabled = true; showError("Payment session expired. Close and try again."); }
    }, 1000);

    function amountFor(m) { return m === "metrocard" ? order.metroCardAmount : order.amount; }
    function showError(msg) { MG.$("#payError", sheet).innerHTML = msg ? `<div class="notice bad">${MG.icon("info")}<span>${MG.esc(msg)}</span></div>` : ""; }

    function paint() {
      MG.$$(".pay-method", sheet).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.m === method)));
      MG.$("#payTotal", sheet).textContent = MG.rupee(amountFor(method));
      const btn = MG.$("#payBtn", sheet);
      btn.disabled = false;
      btn.innerHTML = `${MG.icon("lock")} Pay ${MG.rupee(amountFor(method))}`;
      showError("");
      const panel = MG.$("#payPanel", sheet);
      if (method === "metrocard") {
        const enough = order.cardBalance >= order.metroCardAmount;
        panel.innerHTML = `<div class="notice ${enough ? "ok" : "bad"}">${MG.icon(enough ? "check" : "info")}<span>${enough
          ? `${MG.rupee(order.amount - order.metroCardAmount)} saved with your Metro Card. Balance after trip: ${MG.rupee(order.cardBalance - order.metroCardAmount)}.`
          : `Balance ${MG.rupee(order.cardBalance)} is not enough. <a href="recharge.html" style="text-decoration:underline">Recharge your card</a>.`}</span></div>`;
        btn.disabled = !enough;
      } else if (!test) {
        panel.innerHTML = `<p class="small muted">You'll finish paying in the secure Razorpay window.</p>`;
      } else if (method === "upi") {
        panel.innerHTML = `<div class="stack-sm" style="align-items:center;text-align:center">
          <div class="qr-box" id="upiQr"></div>
          <div class="small muted">Scan with any UPI app, then tap pay to simulate approval.<br><b class="num" style="color:var(--text)">metrigo@upi</b></div></div>`;
        MG.renderQR(MG.$("#upiQr", panel), `upi://pay?pa=metrigo@upi&pn=MetriGo&am=${order.amount}&tr=${order.orderId}&cu=INR`, 180);
      } else if (method === "card") {
        panel.innerHTML = `<div class="notice">${MG.icon("card")}<span>Test mode doesn't collect card details. With Razorpay enabled, card entry happens in Razorpay's secure window.</span></div>`;
      } else {
        panel.innerHTML = `<div class="input-group"><label for="bankSel">Bank</label><select class="input" id="bankSel">${BANKS.map(b => `<option>${b}</option>`).join("")}</select></div>`;
      }
    }

    MG.$$(".pay-method", sheet).forEach(b => b.addEventListener("click", () => { method = b.dataset.m; paint(); }));
    paint();

    async function verify(extra) {
      const btn = MG.$("#payBtn", sheet);
      MG.setBusy(btn, true, "Confirming payment…");
      try {
        const r = await MG.api("/payments/verify", { body: { orderId: order.orderId, method, ...extra } });
        if (!r.success) { MG.setBusy(btn, false); paint(); showError(r.message); return; }
        clearInterval(timer);
        MG.me(true);
        MG.sheet.close(true);
        opts.onSuccess && opts.onSuccess(r);
      } catch (e) {
        MG.setBusy(btn, false);
        showError(e.message);
      }
    }

    MG.$("#payBtn", sheet).addEventListener("click", async () => {
      if (method === "metrocard" || test) {
        const btn = MG.$("#payBtn", sheet);
        MG.setBusy(btn, true, method === "metrocard" ? "Charging Metro Card…" : "Processing…");
        setTimeout(() => verify({}), test && method !== "metrocard" ? 900 : 0);
        return;
      }
      try {
        await loadScript(RAZORPAY_SRC);
      } catch (e) {
        showError("Couldn't load Razorpay. Check your connection.");
        return;
      }
      const rzp = new Razorpay({
        key: order.keyId,
        amount: order.amountPaise,
        currency: order.currency,
        order_id: order.orderId,
        name: "MetriGo",
        description: isTicket ? `${s.from} → ${s.to}` : "Metro Card recharge",
        prefill: { name: order.user.name, email: order.user.email, method },
        theme: { color: "#111113" },
        handler: resp => verify({ razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }),
        modal: { ondismiss: () => showError("Payment cancelled. You have not been charged.") },
      });
      rzp.on("payment.failed", resp => showError(resp.error && resp.error.description || "Payment failed."));
      rzp.open();
    });
  };

  // ---------- Ticket exports: QR text, PDF, share, calendar ----------
  const JSPDF_SRC = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";

  function ticketQRText(b) {
    return `METRIGO|${b.pnr}|${b.from}|${b.to}|${b.travelDate || ""}|${b.departTime || ""}|${(b.seats || []).join(",")}`;
  }

  // QR as a PNG data URL, drawn off-screen
  async function qrDataURL(text, px) {
    await loadScript(QR_SRC);
    const holder = document.createElement("div");
    new QRCode(holder, { text, width: px, height: px, colorDark: "#1E1F18", colorLight: "#FFFFFF", correctLevel: QRCode.CorrectLevel.M });
    return holder.querySelector("canvas").toDataURL("image/png");
  }

  const seatList = b => (b.seats || [b.seat]).filter(Boolean).join(", ") || "-";

  // A boarding-pass style PDF in the app's palette. Built-in PDF fonts have
  // no rupee sign, so amounts read "Rs.".
  MG.ticketPDF = async (b) => {
    await loadScript(JSPDF_SRC);
    const { jsPDF } = window.jspdf;
    // Measure first so the perforation, card and page height fit this trip
    const W = 100;
    const measure = new jsPDF({ unit: "mm" });
    measure.setFont("helvetica", "bold"); measure.setFontSize(13.5);
    const fromLines = measure.splitTextToSize(b.from, 36), toLines = measure.splitTextToSize(b.to, 36);
    const changeText = b.legs && b.legs.length > 1
      ? `Change at ${b.legs[1].from} to the ${MetroSim.LINES[b.legs[1].line].name} towards ${b.legs[1].towards}` : "";
    measure.setFont("helvetica", "normal"); measure.setFontSize(7.5);
    const changeLines = changeText ? measure.splitTextToSize(changeText, W - 24) : [];
    const timesY = 51 + Math.max(fromLines.length, toLines.length) * 5.4;
    const contentEnd = changeLines.length ? timesY + 6 + (changeLines.length - 1) * 3.4 : timesY;
    const cut = contentEnd + 10;
    const cardBottom = cut + 102;
    const H = cardBottom + 13;
    const doc = new jsPDF({ unit: "mm", format: [W, H], compress: true });
    const INK = [55, 56, 43], MUTED = [107, 108, 95], FAINT = [154, 155, 143];
    const BG = [231, 232, 228], CARD = [245, 245, 241], ACCENT = [153, 32, 23], OK = [63, 107, 58];
    const lineRGB = b.line === "blue" ? [47, 127, 224] : [242, 194, 0];
    const state = MG.bookingState(b);
    const rs = n => "Rs. " + Number(n || 0).toLocaleString("en-IN");
    const date = b.travelDate
      ? MG.fmtDate(b.travelDate, { weekday: "short", day: "numeric", month: "short", year: "numeric" })
      : new Date(b.bookedAt).toLocaleDateString("en-IN");
    doc.setProperties({ title: `MetriGo ticket ${b.pnr}`, subject: `${b.from} to ${b.to}`, creator: "MetriGo" });

    // Page + header
    doc.setFillColor(...BG); doc.rect(0, 0, W, H, "F");
    doc.setFillColor(...ACCENT); doc.roundedRect(8, 7.5, 8.5, 8.5, 2.2, 2.2, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(255, 255, 255);
    doc.text("M", 12.25, 13.2, { align: "center" });
    doc.setTextColor(...INK); doc.setFontSize(13); doc.text("MetriGo", 19.5, 13.6);
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
    doc.text("E-TICKET  ·  DELHI METRO", W - 8, 13, { align: "right" });

    // Card
    doc.setFillColor(...CARD); doc.roundedRect(6, 22, W - 12, cardBottom - 22, 5, 5, "F");

    // Status and train
    let y = 31;
    const stColor = state === "cancelled" ? ACCENT : state === "completed" ? FAINT : OK;
    doc.setFillColor(...stColor); doc.circle(13.6, y - 1.1, 1.1, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...stColor);
    doc.text(state === "confirmed" ? "CONFIRMED" : state === "cancelled" ? "CANCELLED" : "COMPLETED", 16.2, y);
    if (b.trainId) {
      const label = `${b.line ? MetroSim.LINES[b.line].name + "  ·  " : ""}${b.trainId}`;
      doc.setFont("helvetica", "normal"); doc.setTextColor(...MUTED);
      const w = doc.getTextWidth(label);
      doc.text(label, W - 12, y, { align: "right" });
      doc.setFillColor(...lineRGB); doc.circle(W - 12 - w - 2.4, y - 1.1, 1.1, "F");
    }

    // Route line: open circle → dashed → filled pin
    y = 42;
    doc.setDrawColor(...INK); doc.setLineWidth(0.35);
    doc.setLineDashPattern([0.9, 1.1], 0); doc.line(15.5, y, W - 15.5, y); doc.setLineDashPattern([], 0);
    doc.setFillColor(...CARD); doc.circle(13.5, y, 1.6, "FD");
    doc.setFillColor(...INK); doc.circle(W - 13.5, y, 1.9, "F");

    // Stations and times
    y = 51;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13.5); doc.setTextColor(...INK);
    doc.text(fromLines, 12, y);
    doc.text(toLines, W - 12, y, { align: "right" });
    y += Math.max(fromLines.length, toLines.length) * 5.4;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(`Departs ${b.departTime || "-"}`, 12, y);
    doc.text(`Arrives ${b.arriveTime || "-"}`, W - 12, y, { align: "right" });
    if (changeLines.length) {
      y += 6;
      doc.setFontSize(7.5); doc.setTextColor(...INK);
      doc.text(changeLines, W / 2, y, { align: "center" });
    }

    // Perforation
    doc.setDrawColor(...FAINT); doc.setLineWidth(0.3);
    doc.setLineDashPattern([1.2, 1.2], 0); doc.line(11, cut, W - 11, cut); doc.setLineDashPattern([], 0);
    doc.setFillColor(...BG); doc.circle(6, cut, 3, "F"); doc.circle(W - 6, cut, 3, "F");

    // QR
    const qr = await qrDataURL(ticketQRText(b), 480);
    doc.setFillColor(255, 255, 255); doc.roundedRect(W / 2 - 25, cut + 6, 50, 50, 3, 3, "F");
    doc.addImage(qr, "PNG", W / 2 - 22, cut + 9, 44, 44, "qr", "FAST");
    doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text("Show this QR at the AFC gate", W / 2, cut + 61, { align: "center" });

    // Details
    const cell = (label, value, x, cy) => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.2); doc.setTextColor(...FAINT);
      doc.text(label.toUpperCase(), x, cy);
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(...INK);
      doc.text(doc.splitTextToSize(String(value), 34)[0], x, cy + 4.6);
    };
    let dy = cut + 70;
    cell("PNR", b.pnr, 12, dy); cell("Date", date, W / 2 + 2, dy);
    dy += 10.5;
    cell("Seats", seatList(b), 12, dy); cell("Fare paid", rs(b.price), W / 2 + 2, dy);
    dy += 10.5;
    cell("Passengers", b.passengers || (b.seats || []).length || 1, 12, dy);
    cell("Booked on", new Date(b.bookedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }), W / 2 + 2, dy);

    // Footer
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.2); doc.setTextColor(...MUTED);
    doc.text(`${location.host}  ·  Valid for one journey  ·  Not transferable`, W / 2, H - 6, { align: "center" });
    return doc.output("blob");
  };

  // Native share sheet; shares the PDF itself where the phone supports files
  async function shareTicket(b) {
    const when = [b.travelDate && MG.fmtDate(b.travelDate, { day: "numeric", month: "short" }), b.departTime && `at ${b.departTime}`].filter(Boolean).join(" ");
    const text = `MetriGo ticket ${b.pnr}: ${b.from} → ${b.to}${when ? ", " + when : ""}. Seats ${seatList(b)}.`;
    const url = `${location.origin}/check-status.html?pnr=${encodeURIComponent(b.pnr)}`;
    try {
      if (navigator.share) {
        let files = null;
        try {
          const file = new File([await MG.ticketPDF(b)], `MetriGo-${b.pnr}.pdf`, { type: "application/pdf" });
          if (navigator.canShare && navigator.canShare({ files: [file] })) files = [file];
        } catch (e) { /* share text instead */ }
        await navigator.share(files ? { files, title: "MetriGo ticket", text } : { title: "MetriGo ticket", text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      MG.toast("Ticket details copied");
    } catch (e) {
      if (e.name !== "AbortError") MG.toast("Couldn't share the ticket", "bad");
    }
  }

  // Calendar event (.ics) with a 15-minute reminder
  function ticketICS(b) {
    const toMin = t => {
      const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(t || "");
      if (!m) return null;
      return ((+m[1] % 12) + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + +m[2];
    };
    const dep = toMin(b.departTime), arr = toMin(b.arriveTime);
    const minutes = dep != null && arr != null ? ((arr - dep + 1440) % 1440) || 30 : 45;
    const stamp = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const esc = s => String(s).replace(/[\\,;]/g, c => "\\" + c).replace(/\n/g, "\\n");
    const change = b.legs && b.legs.length > 1 ? ` · Change at ${b.legs[1].from}` : "";
    return [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MetriGo//Ticket//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${b.pnr}@metrigo`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(new Date(b.departAt))}`,
      `DTEND:${stamp(new Date(b.departAt + minutes * 60000))}`,
      `SUMMARY:${esc(`Metro: ${b.from} → ${b.to}`)}`,
      `LOCATION:${esc(`${b.from} Metro Station, Delhi`)}`,
      `DESCRIPTION:${esc(`PNR ${b.pnr} · ${b.trainName || "MetriGo"} · Seats ${seatList(b)}${change}`)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Your metro leaves in 15 minutes", "TRIGGER:-PT15M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
  }

  // ---------- Ticket ----------
  // b is a booking or a PNR. Offline, the ticket comes from the saved copy (MG.tickets)
  // and cancelling is hidden since it needs the server.
  MG.showTicket = async (b, opts = {}) => {
    if (opts.fresh) MG.sound("success");
    const offline = opts.offline ?? MG.isOffline();
    const pnr = typeof b === "string" ? b : b && b.pnr;
    if (offline || typeof b === "string") b = (await MG.tickets.get(pnr)) || (typeof b === "string" ? null : b);
    if (!b) return MG.toast(offline ? `No saved ticket for ${pnr}.` : `No ticket found for ${pnr}.`, "bad");
    if (!offline) MG.tickets.put(b);
    const state = MG.bookingState(b);
    const date = b.travelDate ? MG.fmtDate(b.travelDate, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : new Date(b.bookedAt).toLocaleDateString("en-IN");
    const canCancel = !offline && state === "confirmed" && b.departAt && b.departAt > Date.now() && opts.allowCancel !== false;
    const sheet = MG.sheet.open(`
      <div class="sheet-head">
        <div><div class="eyebrow">${opts.fresh ? "Booking confirmed" : "Your ticket"}</div><div class="h2">${MG.esc(b.from)} → ${MG.esc(b.to)}</div></div>
        ${MG.closeBtn()}
      </div>
      ${offline ? `<div style="margin-bottom:14px">${MG.offlineNotice()}</div>` : ""}
      ${opts.fresh ? `<div class="notice ok" style="margin-bottom:14px">${MG.icon("check")}<span>Paid ${MG.rupee(b.price)}. Show this QR at the AFC gate.</span></div>` : ""}
      <div class="ticket">
        <div class="ticket-top">
          <div class="row between" style="margin-bottom:6px">
            <span class="status ${state}">${state === "confirmed" ? "Confirmed" : state === "cancelled" ? "Cancelled" : "Completed"}</span>
            ${b.line ? `<span class="chip"><span class="line-dot ${b.line}"></span>${MG.esc(b.trainId || "")}</span>` : ""}
          </div>
          ${MG.curveSVG(b.pnr)}
          <div class="trip-ends">
            <div><div class="name">${MG.esc(b.from)}</div><div class="meta">${MG.icon("clock")}${MG.esc(b.departTime || "—")}</div></div>
            <div class="arrow">${MG.icon("arrowR")}</div>
            <div class="to"><div class="name">${MG.esc(b.to)}</div><div class="meta">${MG.icon("clock")}${MG.esc(b.arriveTime || "—")}</div></div>
          </div>
        </div>
        <div class="ticket-cut"></div>
        <div class="ticket-bottom">
          <div class="qr-box" id="ticketQr"></div>
          <div class="kv">
            <div class="wide"><div class="k">PNR</div><div class="v num pnr-v">${MG.esc(b.pnr)}</div></div>
            <div><div class="k">Date</div><div class="v">${MG.esc(date)}</div></div>
            <div><div class="k">Seats</div><div class="v">${(b.seats || [b.seat]).filter(Boolean).map(MG.esc).join(", ") || "—"}</div></div>
            <div><div class="k">Paid</div><div class="v num">${MG.rupee(b.price)}</div></div>
          </div>
        </div>
      </div>
      ${b.legs && b.legs.length > 1 ? `<div class="notice" style="margin-top:14px">${MG.icon("route")}<span>Change at <b>${MG.esc(b.legs[1].from)}</b> to the ${MetroSim.LINES[b.legs[1].line].name} towards ${MG.esc(b.legs[1].towards)}.</span></div>` : ""}
      <div class="ticket-actions">
        <button class="btn ghost" id="tkPdf">${MG.icon("download")}PDF</button>
        <button class="btn ghost" id="tkShare">${MG.icon("share")}Share</button>
        ${state === "confirmed" && b.departAt > Date.now() ? `<button class="btn ghost" id="tkCal">${MG.icon("calendar")}Calendar</button>` : ""}
      </div>
      <div class="row" style="margin-top:12px">
        <a class="btn ghost" style="flex:1" href="live-metro.html?station=${encodeURIComponent(b.from)}">${MG.icon("live")} Live arrivals</a>
        ${canCancel ? `<button class="btn danger" id="cancelTrip" style="flex:1">Cancel trip</button>` : ""}
      </div>
      ${canCancel ? `<p class="tiny faint" style="margin-top:10px;text-align:center">Cancel before departure for a full refund to your Metro Card.</p>` : ""}
    `, { label: "Ticket", onClose: opts.onClose, noFocus: true });

    MG.renderQR(MG.$("#ticketQr", sheet), ticketQRText(b), 108);

    MG.$("#tkPdf", sheet).addEventListener("click", async e => {
      const btn = e.currentTarget;
      MG.setBusy(btn, true);
      try {
        MG.download(await MG.ticketPDF(b), `MetriGo-${b.pnr}.pdf`);
        MG.toast("Ticket PDF downloaded");
      } catch (err) {
        MG.toast("Couldn't create the PDF. Check your connection and try again.", "bad");
      }
      MG.setBusy(btn, false);
    });
    MG.$("#tkShare", sheet).addEventListener("click", () => shareTicket(b));
    const calBtn = MG.$("#tkCal", sheet);
    if (calBtn) calBtn.addEventListener("click", () => {
      MG.download(new Blob([ticketICS(b)], { type: "text/calendar" }), `MetriGo-${b.pnr}.ics`);
      MG.toast("Open the file to add the trip to your calendar");
    });

    const cancelBtn = MG.$("#cancelTrip", sheet);
    if (cancelBtn) cancelBtn.addEventListener("click", async () => {
      if (cancelBtn.dataset.confirm !== "1") {
        cancelBtn.dataset.confirm = "1";
        cancelBtn.textContent = "Tap again to cancel";
        return;
      }
      MG.setBusy(cancelBtn, true);
      const r = await MG.api("/cancel-booking", { body: { pnr: b.pnr } });
      if (!r.success) { MG.setBusy(cancelBtn, false); MG.toast(r.message, "bad"); return; }
      MG.me(true);
      MG.sheet.close();
      MG.toast(`Cancelled. ${MG.rupee(r.refund)} refunded to your Metro Card.`);
      opts.onCancelled && opts.onCancelled();
    });
  };
})();
