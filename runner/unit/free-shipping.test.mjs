import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedCharge, pricingProblems, quantityToReach, recordedPricing, recordedProblems, standingCharge, stripeProblems, thankYouProblems, typedCents,
} from "../support/free-shipping.mjs";

const usd = minor => ({ currency: "USD", minor: String(minor) });
const charge = { flat: 500, over: 7500 };

test("the form's dollar boxes read as cents, and anything else as nothing", () => {
  assert.equal(typedCents("75"), 7500);
  assert.equal(typedCents(" 75.5 "), 7550);
  assert.equal(typedCents("$5.00"), 500);
  for (const value of ["", null, "seventy", "7.555", "-5", "1,000"]) assert.equal(typedCents(value), null, String(value));
});

test("the journey runs only on a flat charge with a free-shipping amount, and says what to set otherwise", () => {
  assert.deepEqual(standingCharge({ mode: "flat", amount: "5.00", over: "75.00" }), charge);
  assert.throws(() => standingCharge({ mode: "flat", amount: "5.00", over: null }), /older than dinkuskit#93/);
  assert.throws(() => standingCharge({ mode: "free", amount: "", over: "" }), /on Free, not a flat amount\. Set it once .* The journey only reads it\./);
  assert.throws(() => standingCharge({ mode: null, amount: "", over: "" }), /on no choice/);
  assert.throws(() => standingCharge({ mode: "flat", amount: "0.00", over: "75" }), /flat charge of "0\.00"/);
  assert.throws(() => standingCharge({ mode: "flat", amount: "5", over: "" }), /no free-shipping amount/);
});

test("the second order buys the fewest that reach the amount, within a cart's 99", () => {
  assert.equal(quantityToReach(1200, 7500), 7);
  assert.equal(quantityToReach(2500, 7500), 3);
  assert.throws(() => quantityToReach(50, 7500), /takes 150 to reach \$75\.00, more than a cart's 99/);
});

test("shipping is the flat charge until the goods reach the amount, then nothing", () => {
  assert.deepEqual(expectedCharge(charge, 1200), { goods: 1200, shipping: 500, total: 1700, mode: "flat" });
  assert.deepEqual(expectedCharge(charge, 7499), { goods: 7499, shipping: 500, total: 7999, mode: "flat" });
  assert.deepEqual(expectedCharge(charge, 7500), { goods: 7500, shipping: 0, total: 7500, mode: "free" });
});

test("Stripe's page asks for the total, with a Shipping line of the flat charge only when shipping costs something", () => {
  const under = expectedCharge(charge, 1200);
  const over = expectedCharge(charge, 8400);
  assert.deepEqual(stripeProblems("Pay Test Store\n$17.00\nTee (quantity 1)\n$12.00\nShipping\nFlat shipping\n$5.00\nTotal due\n$17.00", under), []);
  assert.deepEqual(stripeProblems("Pay Test Store\n$84.00\nTee (quantity 7)\n$84.00\nTotal due\n$84.00\nShipping address", over), []);
  // The order summary's total, read from the page, counts as the amount asked for.
  assert.deepEqual(stripeProblems("Tee (quantity 7)\n$84.00\nShipping address", over, "$84.00"), []);
  assert.deepEqual(stripeProblems("Pay Test Store\n$12.00\nTee (quantity 1)\n$12.00", under),
    ["it asks for $12.00, not the $17.00 total", "it lists no Shipping line for the $5.00"]);
  assert.deepEqual(stripeProblems("$89.00\nTee (quantity 7)\nShipping\n$5.00", over),
    ["it shows no amount to pay, where the order's total is $84.00", "it lists a Shipping line"]);
  assert.deepEqual(stripeProblems("Pay Test Store\n$19.00\nTee (quantity 1)\n$12.00\nShipping\n$7.00\nTotal due $19.00", under),
    ["it asks for $19.00, not the $17.00 total", "its Total due is $19.00, not $17.00", "its Shipping line is $7.00, not $5.00"]);
});

test("Stripe's goods matching the order's total don't pass for the amount it asks for", () => {
  // Over the amount the order's total is the goods alone, so the item's own $84.00 must not count.
  const over = expectedCharge(charge, 8400);
  assert.deepEqual(stripeProblems("Tee (quantity 7)\n$84.00\nTotal due\n$89.00", over), ["its Total due is $89.00, not $84.00"]);
  assert.deepEqual(stripeProblems("Pay Test Store\n$89.00\nTee (quantity 7)\n$84.00\nTotal due\n$89.00", over),
    ["it asks for $89.00, not the $84.00 total", "its Total due is $89.00, not $84.00"]);
  assert.deepEqual(stripeProblems("Tee (quantity 7)\n$84.00", over, "$89.00"), ["it asks for $89.00, not the $84.00 total"]);
  assert.deepEqual(stripeProblems("Tee (quantity 7)\n$84.00", over), ["it shows no amount to pay, where the order's total is $84.00"]);
});

test("Commerce's checkout amounts must match the order's goods, shipping and total", () => {
  const under = expectedCharge(charge, 1200);
  const over = expectedCharge(charge, 8400);
  const pricing = (goods, mode, shipping) => ({ netMerchandise: usd(goods), shipping: { mode, charge: usd(shipping) }, finalTotal: usd(goods + shipping) });
  assert.deepEqual(pricingProblems(pricing(1200, "flat", 500), under), []);
  assert.deepEqual(pricingProblems(pricing(8400, "free", 0), over), []);
  // A Commerce before the free-shipping amount charges the flat amount on every order.
  assert.deepEqual(pricingProblems(pricing(8400, "flat", 500), over),
    ['shipping "flat", not "free"', "a shipping charge of $5.00, not $0.00", "a total of $89.00, not $84.00"]);
  assert.deepEqual(pricingProblems(null, under), ["no amounts"]);
  assert.deepEqual(pricingProblems({ netMerchandise: { currency: "EUR", minor: "1200" } }, under),
    ["goods of nothing, not $12.00", 'shipping "none", not "flat"', "a shipping charge of nothing, not $5.00", "a total of nothing, not $17.00"]);
});

test("the thank-you page shows the shipping as the template words it, and the total", () => {
  const under = expectedCharge(charge, 1200);
  const over = expectedCharge(charge, 8400);
  const page = (shipping, method, total) => ({ confirmed: true, totals: { Subtotal: "$0.00", Shipping: shipping, Total: total }, shippingMethod: method });
  assert.deepEqual(thankYouProblems(page("$5.00", "Flat rate ($5.00)", "$17.00"), under), []);
  assert.deepEqual(thankYouProblems(page("Free", "Free shipping", "$84.00"), over), []);
  assert.deepEqual(thankYouProblems(page("$5.00", "Flat rate ($5.00)", "$89.00"), over),
    ['its Shipping reads "$5.00", not "Free"', 'its shipping method reads "Flat rate ($5.00)"', "its Total reads $89.00, not $84.00"]);
  assert.deepEqual(thankYouProblems({ confirmed: true, totals: { Total: "$17.00" }, shippingMethod: "" }, under), ["it has no Shipping row", "it names no shipping method"]);
  assert.deepEqual(thankYouProblems({ confirmed: false }, under), ["it doesn't show the order"]);
});

test("an order's page in Commerce Orders records its shipping and total", () => {
  const shown = "Items\nItem\nTee\nUnit price\nUSD 12.00\nRecorded pricing\nItem subtotal\nUSD 84.00\nCoupon discount\nUSD 0.00\nShipping\nUSD 0.00\nPricing total\nUSD 84.00\nOrder total\nUSD 84.00";
  assert.deepEqual(recordedPricing(shown), { shipping: 0, total: 8400 });
  assert.deepEqual(recordedPricing("Order: #1012 (TEST)\nShip to: Test Shopper\nItem subtotal: USD 12.00\nShipping: USD 5.00\nOrder total: USD 17.00"), { shipping: 500, total: 1700 });
  assert.deepEqual(recordedPricing("Item subtotal, coupon and shipping breakdown not recorded.\nOrder total\nUSD 17.00"), { shipping: null, total: 1700 });
  assert.deepEqual(recordedProblems({ shipping: 0, total: 8400 }, expectedCharge(charge, 8400)), []);
  assert.deepEqual(recordedProblems({ shipping: null, total: 8900 }, expectedCharge(charge, 8400)), ["Shipping nothing, not $0.00", "Order total $89.00, not $84.00"]);
});
