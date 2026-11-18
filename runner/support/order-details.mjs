// An order's page in Commerce Orders, read from its text. Kept apart from the browser helpers so the
// offline checks can load it without Playwright.

// The labels on an order's page, in the order Commerce Orders shows them (Email, Phone and Bill to from
// Commerce 0.7.0-beta.3, dinkuskit/commerce#213).
const DETAIL_LABELS = ["Order", "Order ID", "Version", "Receipt", "Checkout attempt", "Payment", "Provider payment", "Paid at", "Status",
  "Completed at", "Carrier", "Tracking number", "Email", "Phone", "Ship to", "Bill to"];

/**
 * An order page's details from its text. From Commerce 0.9 the page reads "Order #1001 (TEST)" as its
 * heading, "Paid <when> · Processing" under it, "Shipped <when> · <carrier> · <tracking>" once
 * completed, and keeps the order ID in its "Order record" section; older pages ran labeled fields
 * together on one line.
 */
export function orderDetails(shown) {
  const lines = shown.split("\n").map(line => line.trim()).filter(Boolean);
  const heading = lines.map(line => line.match(/^Order (\S+(?: \(TEST\))?)$/)?.[1]).find(Boolean);
  if (heading) {
    const status = lines.map(line => line.match(/^Paid\b.* · (Processing|Completed)$/)?.[1]).find(Boolean) ?? null;
    // Commerce leaves out a carrier or tracking number the owner didn't give.
    const [, carrier = null, tracking = null] = lines.find(line => /^Shipped /.test(line))?.slice("Shipped ".length).split(" · ") ?? [];
    const orderId = lines.map(line => line.match(/^Order ID: (.+)$/)?.[1]).find(Boolean) ?? null;
    return { label: heading, test: / \(TEST\)$/.test(heading), orderId, status, carrier, tracking };
  }
  return labeledDetails(shown);
}

/** Before Commerce 0.9: the details as labeled fields run together on one line. */
function labeledDetails(shown) {
  // The page runs its details together on one line ("Order: #1001 (TEST) Order ID: order:..."), so a
  // value ends where the next label starts.
  const field = name => {
    const others = DETAIL_LABELS.filter(label => label !== name).join("|");
    return shown.match(new RegExp(`(?:^|\\s)${name}:\\s*(.*?)(?=\\s+(?:${others}):\\s|\\n|$)`))?.[1]?.trim() || null;
  };
  const label = field("Order");
  return { label, test: / \(TEST\)$/.test(label ?? ""), orderId: field("Order ID"), status: field("Status"), carrier: field("Carrier"), tracking: field("Tracking number") };
}

/** Where an open Completed order differs from the carrier and tracking number it should show. */
export function completionProblems(shown, { carrier, tracking }) {
  const problems = [];
  if (shown.status !== "Completed") problems.push(`it shows ${shown.status ?? "no status"}, not Completed`);
  if (shown.carrier !== carrier) problems.push(`its carrier reads "${shown.carrier ?? "nothing"}", not "${carrier}"`);
  if (shown.tracking !== tracking) problems.push(`its tracking number reads "${shown.tracking ?? "nothing"}", not "${tracking}"`);
  return problems;
}
