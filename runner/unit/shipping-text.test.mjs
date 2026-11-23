import assert from "node:assert/strict";
import test from "node:test";
import { boughtMessage, expectedWeight, labelProblems, orderPageText, ounces, servicePrice, shippingPages, statusText } from "../support/shipping-text.mjs";

const store = "https://store.example";

test("the admin menu's Shipping links name each of the store's Shipping pages once", () => {
  assert.deepEqual(shippingPages([
    "/_emdash/admin/plugins/dinkus-ship/shipping",
    `${store}/_emdash/admin/plugins/dinkus-ship/shipping`,
    "https://store.example/_emdash/admin/plugins/r_x7k2/shipping",
  ], store), [
    `${store}/_emdash/admin/plugins/dinkus-ship/shipping`,
    `${store}/_emdash/admin/plugins/r_x7k2/shipping`,
  ]);
});

test("no other link counts as a Shipping page", () => {
  assert.deepEqual(shippingPages([
    "https://other.example/_emdash/admin/plugins/dinkus-ship/shipping",
    "/_emdash/admin/plugins/dinkus-ship/shipping?order=1001",
    "/_emdash/admin/plugins/dinkus-ship/shipping#top",
    "/_emdash/admin/plugins/dinkus-ship/shipping/1001",
    "/_emdash/admin/plugins/dinkus-ship/settings",
    "/_emdash/admin/shipping",
    "http://[not a url",
  ], store), []);
});

test("the bought message for a sandbox label gives its price and tracking number", () => {
  assert.deepEqual(boughtMessage("Label bought, $5.12 sandbox. Tracking Z9TEST41."), { price: "$5.12", tracking: "Z9TEST41" });
  assert.deepEqual(boughtMessage("  Label bought, $10.40 sandbox. Tracking T42.\n"), { price: "$10.40", tracking: "T42" });
});

test("a live label, a half price or anything else is not a sandbox label's bought message", () => {
  for (const text of [
    "Label bought, $5.12. Tracking Z9TEST41.",
    "Label bought, $5.1 sandbox. Tracking Z9TEST41.",
    "Label bought, $5.12 sandbox. Tracking z9test41.",
    "Label bought, $5.12 sandbox. Tracking Z9TEST41. Refund requested.",
    "Label cancelled.",
    "",
    undefined,
  ]) assert.equal(boughtMessage(text), null, String(text));
});

test("the quoted services give the price of exactly the service asked for", () => {
  const options = ["USPS Priority Mail Express · $30.45", "USPS Priority Mail · $9.85", " USPS Ground Advantage · $5.12 "];
  assert.equal(servicePrice(options, "USPS Ground Advantage"), "$5.12");
  assert.equal(servicePrice(options, "USPS Priority Mail"), "$9.85");
  assert.equal(servicePrice(options, "USPS Priority Mail Express"), "$30.45");
});

test("a service with no quoted price has no price", () => {
  assert.equal(servicePrice(["USPS Ground Advantage", "USPS Ground Advantage · $5.1"], "USPS Ground Advantage"), null);
  assert.equal(servicePrice(["USPS Priority Mail Express · $30.45"], "USPS Priority Mail"), null);
  assert.equal(servicePrice(["USPS Priority Mail Express · not available for this package"], "USPS Priority Mail Express"), null);
  // Ship before 0.4 wrote "Service: $price" in a select; that list is gone.
  assert.equal(servicePrice(["USPS Ground Advantage: $5.12"], "USPS Ground Advantage"), null);
  assert.equal(servicePrice([], "USPS Ground Advantage"), null);
});

test("the label form starts with the items' weight plus the box's, to a tenth of an ounce", () => {
  assert.equal(expectedWeight("12.5 oz", "Mailer: 10 × 8 × 2 in, 3 oz empty"), 15.5);
  assert.equal(expectedWeight("0.1 oz", "Envelope: 9 × 6 × 1 in, 0.2 oz empty"), 0.3);
  assert.equal(expectedWeight("8 oz", "Small box: 8 × 6 × 4 in, 4 oz empty"), 12);
  // Ship writes 16 ounces and over in pounds, as Shopify and WooCommerce do.
  assert.equal(expectedWeight("1 lb 4.5 oz", "Mailer: 10 × 8 × 2 in, 3 oz empty"), 23.5);
  assert.equal(expectedWeight("2 lb", "Big box: 16 × 12 × 8 in, 1 lb 4.5 oz empty"), 52.5);
});

test("a weight as Ship writes it reads in ounces", () => {
  assert.equal(ounces("12.5 oz"), 12.5);
  assert.equal(ounces("2 lb"), 32);
  assert.equal(ounces("1 lb 4.5 oz"), 20.5);
  for (const text of ["", "12.5 lb", "oz", "1 lb 4.5", undefined]) assert.ok(Number.isNaN(ounces(text)), String(text));
});

test("the starting weight stays within Ship's 0.1 to 1120 ounces", () => {
  assert.equal(expectedWeight("0 oz", "Envelope: 9 × 6 × 1 in, 0 oz empty"), 0.1);
  assert.equal(expectedWeight("1200 oz", "Crate: 30 × 20 × 20 in, 40 oz empty"), 1120);
});

test("a weight the page doesn't give in ounces has no starting weight", () => {
  assert.equal(expectedWeight("12.5 lb", "Mailer: 10 × 8 × 2 in, 3 oz empty"), null);
  assert.equal(expectedWeight("12.5 oz", "Mailer: 10 × 8 × 2 in"), null);
  assert.equal(expectedWeight(undefined, "Mailer: 10 × 8 × 2 in, 3 oz empty"), null);
  assert.equal(expectedWeight("12.5 oz", ""), null);
});

test("a label's fields match the label Ship sold", () => {
  const sold = { service: "USPS Ground Advantage", tracking: "Z9TEST41", price: "$5.12" };
  const fields = {
    Service: "USPS Ground Advantage",
    "Tracking number": "Z9TEST41 (test, not trackable)",
    Box: "Mailer",
    Postage: "$5.12 sandbox price, nothing charged",
  };
  assert.deepEqual(labelProblems(fields, sold), []);
  assert.deepEqual(labelProblems({ ...fields, Service: "USPS Priority Mail", Postage: undefined }, sold), [
    'its Service reads "USPS Priority Mail", not "USPS Ground Advantage"',
    'its Postage reads "nothing", not "$5.12 sandbox price, nothing charged"',
  ]);
  assert.deepEqual(labelProblems({ ...fields, "Tracking number": "Z9TEST41" }, sold), [
    'its Tracking number reads "Z9TEST41", not "Z9TEST41 (test, not trackable)"',
  ]);
  assert.deepEqual(labelProblems(null, sold), ["the order's page shows no label"]);
});

test("a status reads without Ship's coloured dot", () => {
  assert.equal(statusText("🟡 Needs label"), "Needs label");
  assert.equal(statusText(" 🔵 Label bought\n"), "Label bought");
  assert.equal(statusText("⚪ Completed"), "Completed");
  assert.equal(statusText("Label cancelled"), "Label cancelled");
});

// The text of TEST order #1271's page as Ship 0.4.0-beta.3 draws it in EmDash 1.5 (dinkuskit/ship src/pages.ts orderPage).
const top = ["Shipments", "Back to Shipments", "Order #1271 (TEST)"];
const testBanner = ["TEST order", "Nothing ships and nothing is charged. A TEST order gets a free Pitney Bowes sandbox label, or a practice label, never live postage."];
const shipTo = ["Ship to", "Test Shopper", "1600 Pennsylvania Ave NW", "Washington, DC 20500"];
const items = ["Item\tQty\tWeight each\tWeight", "Live test product\t× 1\t8 oz\t8 oz", "Catalog Cap 01\t× 1\t12.5 oz\t12.5 oz"];
const liveLabel = ["Label", "USPS Ground Advantage", "Tracking 9400111899223197428490 (test, not trackable)", "Mailer, 1 lb 7.5 oz",
  "Label bought Nov 23, 2026, 1:20 AM UTC · $5.12 sandbox price, nothing charged", "Print label", "Cancel label"];
const labelRow = status => `Nov 23, 2026\tUSPS Ground Advantage, $5.12 sandbox, not charged\t9400111899223197428490 (test, not trackable)\t${status}`;

test("an order waiting for a label reads its status, ship-to, items' weight and no label", () => {
  const page = [...top, "2 items ready to ship · No label yet", ...testBanner, ...shipTo, "Package", "2 items", "Items weigh 1 lb 4.5 oz",
    "Plus the box, added when you buy", ...items, "Buy a label", "Box", "Mailer: 10 × 8 × 2 in, 3 oz empty", "Label kind", "See prices", "Open in Ship"];
  assert.deepEqual(orderPageText(page, 1271), { status: "ready to ship · No label yet", shipTo: "Test Shopper", itemsWeight: "1 lb 4.5 oz", label: null, labels: [] });
});

test("an order with a live label reads the label as Ship sold it and the Labels table", () => {
  const page = ["Label bought, $5.12 sandbox. Tracking 9400111899223197428490.", ...top, "2 items · Label bought", ...testBanner, ...shipTo, ...liveLabel,
    "Print label opens the PDF in a new tab.", ...items, "Labels", "Bought\tService\tTracking number\tStatus", labelRow("🔵 Bought"), "Open in Ship"];
  const read = orderPageText(page, 1271);
  assert.equal(read.status, "Label bought");
  assert.equal(read.itemsWeight, null);
  assert.deepEqual(labelProblems(read.label, { service: "USPS Ground Advantage", tracking: "9400111899223197428490", price: "$5.12" }), []);
  assert.deepEqual(read.labels, [{ Bought: "Nov 23, 2026", Service: "USPS Ground Advantage, $5.12 sandbox, not charged", "Tracking number": "9400111899223197428490 (test, not trackable)", Status: "Bought" }]);
});

test("a Completed order after its label is cancelled shows no live label and the label Cancelled", () => {
  const page = ["Label cancelled.", ...top, "2 items · Completed in Commerce", ...testBanner, ...shipTo, "Package", "2 items", "Items weigh 1 lb 4.5 oz",
    "This order is Completed in Commerce, so Ship makes no label for it.", ...items, "Labels", "Bought\tService\tTracking number\tStatus", labelRow("🔴 Cancelled"), "Open in Ship"];
  const read = orderPageText(page, 1271);
  assert.equal(read.status, "Completed in Commerce");
  assert.equal(read.label, null);
  assert.equal(read.labels[0].Status, "Cancelled");
});

test("another order's page, or a page that isn't an order, reads as nothing", () => {
  assert.equal(orderPageText([...top, "1 item ready to ship · No label yet"], 1272), null);
  assert.equal(orderPageText(["Shipments", "Refresh"], 1271), null);
});
