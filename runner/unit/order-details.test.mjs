import assert from "node:assert/strict";
import test from "node:test";
import { completionProblems, orderDetails } from "../support/order-details.mjs";

// An order's page as Commerce Orders' text reads, its details run together on one line.
const page = (...fields) => `Orders Back to orders ${fields.join(" ")} Complete order Items`;
const head = ["Order: #1042 (TEST)", "Order ID: order:abc", "Version: 2", "Receipt: rcpt_1", "Checkout attempt: att_1",
  "Payment: Provider-paid", "Provider payment: pi_1", "Paid at: 2026-10-30T02:30:00.000Z"];

test("a Processing order's status ends before Commerce 0.7.0-beta.3's Email, Phone and Bill to lines", () => {
  const shown = orderDetails(page(...head, "Status: Processing", "Email: shopper@example.com", "Phone: +15555550100",
    "Ship to: Test Shopper, 1 Main St, Asheville, NC, 28801, US", "Bill to: Same as delivery address"));
  assert.deepEqual(shown, { label: "#1042 (TEST)", test: true, orderId: "order:abc", status: "Processing", carrier: null, tracking: null, providerPaid: true });
});

test("a Completed order's carrier and tracking number end before its Email line", () => {
  const shown = orderDetails(page(...head, "Status: Completed", "Completed at: 2026-10-30T02:40:00.000Z", "Carrier: USPS",
    "Tracking number: 9400100000000000000000", "Email: Not recorded", "Phone: Not recorded", "Ship to: No address", "Bill to: Not recorded"));
  assert.equal(shown.status, "Completed");
  assert.deepEqual(completionProblems(shown, { carrier: "USPS", tracking: "9400100000000000000000" }), []);
});

test("an order page from before Commerce 0.7.0-beta.3 still reads the same", () => {
  const shown = orderDetails(page(...head, "Status: Processing", "Ship to: Test Shopper, 1 Main St, Asheville, NC, 28801, US"));
  assert.equal(shown.status, "Processing");
  assert.equal(shown.orderId, "order:abc");
});

// Commerce 0.9's order page, as main's innerText reads it with the Order record section open.
const page09 = (...lines) => ["Orders", "Back to orders", ...lines, "Ship to", "Test Shopper", "Customer", "agent@example.com",
  "1 item ready to ship", "Complete order", "Order record", "Order ID: order:fd3e9da1", "Version: 1", "Receipt: rcpt_1",
  "Checkout attempt: att_1", "Provider payment: pi_1"].join("\n");

test("Commerce 0.9's order page gives its number, status and order ID from its heading, status line and Order record", () => {
  const shown = orderDetails(page09("Order #1222 (TEST)", "Paid Nov 18, 2026, 5:37 PM UTC · Processing", "Test order"));
  assert.deepEqual(shown, { label: "#1222 (TEST)", test: true, orderId: "order:fd3e9da1", status: "Processing", carrier: null, tracking: null, providerPaid: true });
});

test("a completed Commerce 0.9 order gives its carrier and tracking number from its Shipped line", () => {
  const shown = orderDetails(page09("Order #1223 (TEST)", "Paid Nov 18, 2026, 5:40 PM UTC · Completed",
    "Shipped Nov 18, 2026, 5:41 PM UTC · USPS · 9400100000000000000000"));
  assert.equal(shown.status, "Completed");
  assert.deepEqual(completionProblems(shown, { carrier: "USPS", tracking: "9400100000000000000000" }), []);
});

test("a Commerce 0.9 order completed with nothing sent shows no carrier or tracking number", () => {
  const shown = orderDetails(page09("Order #1224 (TEST)", "Paid Nov 18, 2026, 5:42 PM UTC · Completed", "Shipped Nov 18, 2026, 5:43 PM UTC"));
  assert.deepEqual([shown.status, shown.carrier, shown.tracking], ["Completed", null, null]);
});

test("both page formats read a carrier and tracking number nobody gave as none", () => {
  const before = orderDetails(page(...head, "Status: Completed", "Completed at: 2026-10-30T02:40:00.000Z", "Carrier: Not recorded",
    "Tracking number: Not recorded", "Email: Not recorded"));
  const after = orderDetails(page09("Order #1224 (TEST)", "Paid Nov 18, 2026, 5:42 PM UTC · Completed", "Shipped Nov 18, 2026, 5:43 PM UTC"));
  for (const shown of [before, after]) assert.deepEqual(completionProblems(shown, { carrier: null, tracking: null }), []);
  assert.deepEqual(completionProblems(after, { carrier: "USPS", tracking: "9400" }),
    ['it shows no carrier, not carrier "USPS"', 'it shows no tracking number, not tracking number "9400"']);
});

test("an order whose provider recorded no payment reads as not provider-paid on both page formats", () => {
  const before = orderDetails(page("Order: #1042 (TEST)", "Order ID: order:abc", "Payment: Not recorded", "Status: Processing"));
  const after = orderDetails(page09("Order #1225 (TEST)", "Paid · Processing").replace("Provider payment: pi_1", "Provider payment: Not recorded"));
  assert.deepEqual([before.providerPaid, after.providerPaid], [false, false]);
});
