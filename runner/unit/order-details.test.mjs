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
  assert.deepEqual(shown, { label: "#1042 (TEST)", test: true, orderId: "order:abc", status: "Processing", carrier: null, tracking: null });
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
