import assert from "node:assert/strict";
import test from "node:test";
import { storeReturnLinks, storeReturnPage, stripeSession, thankYouShown } from "../support/checkout-text.mjs";

test("a Stripe Checkout address names its session, with or without Stripe's fragment", () => {
  assert.equal(stripeSession("https://checkout.stripe.com/c/pay/cs_test_a1B2c3#fidabc"), "cs_test_a1B2c3");
  assert.equal(stripeSession("https://checkout.stripe.com/c/pay/cs_live_Z9"), "cs_live_Z9");
});

test("no other address names a Stripe session", () => {
  for (const address of [
    "https://checkout.stripe.com.example/c/pay/cs_test_a1",
    "https://store.example/checkout/success?session_id=cs_test_a1",
    "https://checkout.stripe.com/c/pay/",
    "not an address",
    "",
  ]) assert.equal(stripeSession(address), null, address);
});

test("the thank-you page passes only with the order confirmed and the cart empty", () => {
  const confirmed = { shown: true, heading: "Thank you", confirmed: true, message: "Order confirmed.", items: 1, cart: 0 };
  assert.equal(thankYouShown(confirmed), '"Order confirmed." with 1 item(s) listed; cart empty');
  assert.throws(() => thankYouShown({ shown: false, heading: "Page not found" }), /without the store's order confirmation \("Page not found"\)/);
  assert.throws(() => thankYouShown({ ...confirmed, confirmed: false, heading: "We couldn't confirm your order", message: "Try again." }),
    /saw "We couldn't confirm your order: Try again\." instead of their order/);
  assert.throws(() => thankYouShown({ ...confirmed, cart: 1 }), /the cart shows 1 item\(s\)/);
  assert.throws(() => thankYouShown({ ...confirmed, cart: null }), /an unreadable number of item\(s\)/);
});

test("Stripe's way back is the store's cart or, from payments#79, its checkout page, and nothing else", () => {
  const store = "https://store.example";
  assert.equal(storeReturnPage("https://store.example/cart", store), "cart");
  assert.equal(storeReturnPage("https://store.example/checkout", store), "checkout page");
  assert.equal(storeReturnPage("https://store.example/checkout?from=stripe", store), "checkout page");
  for (const address of [
    "https://store.example/checkout/success?session_id=cs_test_a1",
    "https://store.example/checkout/cancel",
    "https://store.example/",
    "https://other.example/cart",
    "http://store.example/cart",
    "https://checkout.stripe.com/c/pay/cs_test_a1",
    "not an address",
  ]) assert.equal(storeReturnPage(address, store), null, address);
  const links = storeReturnLinks(store);
  assert.match(links, /a\[href="https:\/\/store\.example\/cart"\]:visible/);
  assert.match(links, /a\[href="https:\/\/store\.example\/checkout"\]:visible/);
  assert.doesNotMatch(links, /checkout\/success/);
});

test("settling keeps asking Commerce after a read it gave no answer to, and keeps its last answer", async () => {
  const { settle } = await import("../support/checkout.mjs");
  const page = { waits: 0, async waitForTimeout() { this.waits++; } };
  const pending = { attemptId: "att_1", checkout: { attemptId: "att_1", state: "pending" } };
  const paid = { attemptId: "att_1", checkout: { attemptId: "att_1", state: "paid", order: { orderId: "order:att_1" } } };
  const reads = [pending, { attemptId: null, unanswered: true }, { attemptId: null, unanswered: true }, paid];
  const settled = await settle(page, async () => reads.shift());
  assert.deepEqual(settled, paid);
  assert.equal(page.waits, 3);
  assert.equal(reads.length, 0);
});

test("settling stops at once when the browser's cart has no checkout", async () => {
  const { settle } = await import("../support/checkout.mjs");
  const page = { waits: 0, async waitForTimeout() { this.waits++; } };
  assert.deepEqual(await settle(page, async () => ({ attemptId: null })), { attemptId: null });
  assert.equal(page.waits, 0);
});
