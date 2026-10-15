// Payment gateway adapter.
// - With RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET set, orders are created on
//   Razorpay and payments are verified with Razorpay's HMAC signature.
// - Without them the app runs in test mode: orders are local and the
//   checkout sheet simulates the payment. No money moves in test mode.

const crypto = require("crypto");

const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";
const provider = KEY_ID && KEY_SECRET ? "razorpay" : "test";

function authHeader() {
  return "Basic " + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
}

function safeEqualHex(expected, given) {
  return typeof given === "string" && expected.length === given.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

async function createOrder(amountRupees, receipt) {
  const amount = Math.round(amountRupees * 100); // paise
  if (provider === "test") {
    return { id: "order_test_" + crypto.randomBytes(8).toString("hex"), amount, currency: "INR" };
  }
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader() },
    body: JSON.stringify({ amount, currency: "INR", receipt }),
  });
  if (!res.ok) throw new Error(`Razorpay order failed (${res.status})`);
  const order = await res.json();
  return { id: order.id, amount: order.amount, currency: order.currency };
}

function verifyPayment(orderId, paymentId, signature) {
  if (provider === "test") return true;
  if (!paymentId || !signature) return false;
  const expected = crypto.createHmac("sha256", KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return safeEqualHex(expected, signature);
}

// Full refund of a captured payment. Test mode has nothing to refund.
async function refundPayment(paymentId, amountRupees, notes) {
  if (provider === "test") return { id: null, status: "not_charged" };
  const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader() },
    body: JSON.stringify({ amount: Math.round(amountRupees * 100), notes: notes || {} }),
  });
  if (!res.ok) throw new Error(`Razorpay refund failed (${res.status}): ${await res.text()}`);
  const refund = await res.json();
  return { id: refund.id, status: refund.status };
}

// Webhooks are signed with the webhook secret over the raw request body
function verifyWebhook(rawBody, signature) {
  if (!WEBHOOK_SECRET || !rawBody) return false;
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

module.exports = {
  provider,
  publicKey: KEY_ID,
  webhookEnabled: Boolean(WEBHOOK_SECRET),
  createOrder,
  verifyPayment,
  refundPayment,
  verifyWebhook,
};
