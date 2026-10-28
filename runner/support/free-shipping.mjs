import { dollars, money } from "./storefront-text.mjs";

// The store's shipping charge lives on DinkusKit.com's Your Stores page, in each store's checkout
// settings form (dinkuskit/dinkuskit src/components/account/YourStores.astro): Free, or a flat amount
// in dollars with an optional amount at which an order's goods ship free (dinkuskit#93,
// checkout-free-shipping-over-20261027). Commerce reads it within 5 minutes, or at once on Get
// checkout settings, and from Commerce 0.7.0 charges no shipping once the goods reach that amount.

const SET_IT = "Set it once on DinkusKit.com's Your Stores page: Flat amount in dollars, a free-shipping amount (75.00, say), then Save checkout settings. The journey only reads it.";

/** Cents typed in one of the form's dollar boxes ("75" and "75.00" are 7500); null when empty or unreadable. */
export function typedCents(value) {
  const amount = String(value ?? "").trim().match(/^\$?(\d+)(?:\.(\d{1,2}))?$/);
  return amount ? Number(amount[1]) * 100 + Number((amount[2] ?? "0").padEnd(2, "0")) : null;
}

/**
 * The charge the form shows for the store, { flat, over } in cents, from its Shipping charge choice
 * (`mode`), flat amount and free-shipping amount (`over` is null when the form has no such box). The
 * journey never saves the form, so anything else stops it with what to set.
 */
export function standingCharge({ mode, amount, over }) {
  if (over === null) throw new Error("Your Stores has no free-shipping box, so DinkusKit.com is older than dinkuskit#93.");
  if (mode !== "flat") throw new Error(`Your Stores has this store's shipping charge on ${mode === "free" ? "Free" : "no choice"}, not a flat amount. ${SET_IT}`);
  const flat = typedCents(amount);
  const free = typedCents(over);
  if (!flat) throw new Error(`Your Stores shows a flat charge of "${amount}", not an amount above $0.00. ${SET_IT}`);
  if (!free) throw new Error(`Your Stores shows no free-shipping amount for this store. ${SET_IT}`);
  return { flat, over: free };
}

/** The fewest of a `unit`-cent product whose goods reach `over`; throws past the cart's 99. */
export function quantityToReach(unit, over) {
  const quantity = Math.ceil(over / unit);
  if (quantity > 99) throw new Error(`At ${dollars(unit)} each it takes ${quantity} to reach ${dollars(over)}, more than a cart's 99. Lower the free-shipping amount or set DINKUS_E2E_PRODUCT_PATH to a dearer product.`);
  return quantity;
}

/** What an order whose goods come to `goods` cents should pay under the charge: { goods, shipping, total, mode }. */
export function expectedCharge({ flat, over }, goods) {
  const shipping = goods >= over ? 0 : flat;
  return { goods, shipping, total: goods + shipping, mode: shipping ? "flat" : "free" };
}

const lines = text => String(text ?? "").split("\n").map(line => line.trim()).filter(Boolean);
const shown = cents => cents === null ? "nothing" : dollars(cents);

/** Where Stripe's page differs from the order: it asks for the total, with a Shipping line only when shipping is charged. */
export function stripeProblems(text, expected) {
  const shownLines = lines(text);
  const problems = [];
  if (!shownLines.some(line => line.includes(dollars(expected.total)))) problems.push(`it never shows the ${dollars(expected.total)} total`);
  // Payments adds shipping to Stripe as its own line, named "Shipping", only when it costs something.
  const shippingLine = shownLines.includes("Shipping");
  if (expected.shipping && !shippingLine) problems.push(`it lists no Shipping line for the ${dollars(expected.shipping)}`);
  if (!expected.shipping && shippingLine) problems.push("it lists a Shipping line");
  return problems;
}

/** A Commerce amount ({ currency: "USD", minor: "1700" }) in cents; null for anything else. */
const usd = value => value?.currency === "USD" && /^\d+$/.test(value?.minor ?? "") ? Number(value.minor) : null;

/** Where Commerce's amounts for the paid checkout (its status answer's `pricing`) differ from the order's. */
export function pricingProblems(pricing, expected) {
  if (!pricing) return ["no amounts"];
  const problems = [];
  const goods = usd(pricing.netMerchandise);
  if (goods !== expected.goods) problems.push(`goods of ${shown(goods)}, not ${dollars(expected.goods)}`);
  if (pricing.shipping?.mode !== expected.mode) problems.push(`shipping "${pricing.shipping?.mode ?? "none"}", not "${expected.mode}"`);
  const shipping = usd(pricing.shipping?.charge);
  if (shipping !== expected.shipping) problems.push(`a shipping charge of ${shown(shipping)}, not ${dollars(expected.shipping)}`);
  const total = usd(pricing.finalTotal);
  if (total !== expected.total) problems.push(`a total of ${shown(total)}, not ${dollars(expected.total)}`);
  return problems;
}

/** Where the thank-you page differs from the order: its Shipping row, shipping method and Total. */
export function thankYouProblems(thankYou, expected) {
  if (!thankYou?.confirmed) return ["it doesn't show the order"];
  const problems = [];
  const row = thankYou.totals?.Shipping;
  const wanted = expected.shipping ? dollars(expected.shipping) : "Free";
  if (row === undefined) problems.push("it has no Shipping row");
  else if (expected.shipping ? money(row) !== expected.shipping : row !== "Free") problems.push(`its Shipping reads "${row}", not "${wanted}"`);
  // The template names the method from Commerce's shipping mode: "Flat rate ($5.00)" or "Free shipping".
  const method = thankYou.shippingMethod ?? "";
  if (expected.shipping ? !method.includes(wanted) : method !== "Free shipping") {
    problems.push(method ? `its shipping method reads "${method}"` : "it names no shipping method");
  }
  const total = money(thankYou.totals?.Total);
  if (total !== expected.total) problems.push(`its Total reads ${shown(total)}, not ${dollars(expected.total)}`);
  return problems;
}

/** The shipping and order total an order's page in Commerce Orders records ("Shipping USD 5.00"), in cents. */
export function recordedPricing(text) {
  const amount = label => {
    const found = String(text ?? "").match(new RegExp(`(?:^|\\n)\\s*${label}:?\\s+USD\\s+(\\d+)\\.(\\d\\d)\\b`));
    return found ? Number(found[1]) * 100 + Number(found[2]) : null;
  };
  return { shipping: amount("Shipping"), total: amount("Order total") };
}

/** Where an order's recorded shipping and total in Commerce Orders differ from the order's. */
export function recordedProblems(recorded, expected) {
  const problems = [];
  if (recorded.shipping !== expected.shipping) problems.push(`Shipping ${shown(recorded.shipping)}, not ${dollars(expected.shipping)}`);
  if (recorded.total !== expected.total) problems.push(`Order total ${shown(recorded.total)}, not ${dollars(expected.total)}`);
  return problems;
}
