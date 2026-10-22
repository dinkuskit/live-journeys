/** The Checkout Session a Stripe Checkout address opens (cs_test_...), or null for any other address. */
export function stripeSession(address) {
  try {
    const url = new URL(address);
    return url.hostname === "checkout.stripe.com" ? url.pathname.match(/\/(cs_(?:test|live)_[A-Za-z0-9]+)/)?.[1] ?? null : null;
  } catch {
    return null;
  }
}

/** The thank-you page's confirmation as one line for the proof; fails when it didn't confirm the order or left the cart full. */
export function thankYouShown(shown) {
  if (!shown?.shown) throw new Error(`Stripe sent the shopper to a page without the store's order confirmation ("${shown?.heading || "no heading"}").`);
  if (!shown.confirmed) throw new Error(`The shopper saw "${shown.heading}: ${shown.message}" instead of their order.`);
  if (shown.cart !== 0) throw new Error(`The order is confirmed, but the cart shows ${shown.cart ?? "an unreadable number of"} item(s).`);
  return `"${shown.message}" with ${shown.items} item(s) listed; cart empty`;
}

// Payments points Stripe's back link at the store's cart, and from payments#79 at the store's checkout
// page, which Template Store #127 adds to hold the checkout contact and delivery address.
const RETURN_PAGES = { "/cart": "cart", "/checkout": "checkout page" };

/** The store page an address opens when it is the store's cart or checkout page ("cart", "checkout page"), or null. */
export function storeReturnPage(address, store) {
  try {
    const url = new URL(address);
    return url.origin === new URL(store).origin ? RETURN_PAGES[url.pathname] ?? null : null;
  } catch {
    return null;
  }
}

/** Stripe's link back to the store, by the addresses storeReturnPage accepts. */
export const storeReturnLinks = store =>
  Object.keys(RETURN_PAGES).flatMap(path => [`a[href="${store}${path}"]:visible`, `a[href^="${store}${path}?"]:visible`]).join(", ");
