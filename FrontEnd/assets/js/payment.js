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

  MG.renderQR = async (el, text, size) => {
    try {
      await loadScript(QR_SRC);
      el.innerHTML = "";
      new QRCode(el, { text, width: size, height: size, colorDark: "#0A0A0B", colorLight: "#FFFFFF", correctLevel: QRCode.CorrectLevel.M });
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

  // ---------- Ticket ----------
  // b is a booking or a PNR. Offline, the ticket comes from the saved copy (MG.tickets)
  // and cancelling is hidden since it needs the server.
  MG.showTicket = async (b, opts = {}) => {
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
          <div class="kv" style="flex:1">
            <div><div class="k">PNR</div><div class="v num">${MG.esc(b.pnr)}</div></div>
            <div><div class="k">Date</div><div class="v">${MG.esc(date)}</div></div>
            <div><div class="k">Seats</div><div class="v">${(b.seats || [b.seat]).filter(Boolean).map(MG.esc).join(", ") || "—"}</div></div>
            <div><div class="k">Paid</div><div class="v num">${MG.rupee(b.price)}</div></div>
          </div>
        </div>
      </div>
      ${b.legs && b.legs.length > 1 ? `<div class="notice" style="margin-top:14px">${MG.icon("route")}<span>Change at <b>${MG.esc(b.legs[1].from)}</b> to the ${MetroSim.LINES[b.legs[1].line].name} towards ${MG.esc(b.legs[1].towards)}.</span></div>` : ""}
      <div class="row" style="margin-top:16px">
        <a class="btn ghost" style="flex:1" href="live-metro.html?station=${encodeURIComponent(b.from)}">${MG.icon("live")} Live arrivals</a>
        ${canCancel ? `<button class="btn danger" id="cancelTrip">Cancel trip</button>` : ""}
      </div>
      ${canCancel ? `<p class="tiny faint" style="margin-top:10px;text-align:center">Cancel before departure for a full refund to your Metro Card.</p>` : ""}
    `, { label: "Ticket", onClose: opts.onClose, noFocus: true });

    MG.renderQR(MG.$("#ticketQr", sheet), `METRIGO|${b.pnr}|${b.from}|${b.to}|${b.travelDate || ""}|${b.departTime || ""}|${(b.seats || []).join(",")}`, 108);

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
