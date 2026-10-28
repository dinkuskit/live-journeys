import { test, expect } from "../support/browser.mjs";
import { confirmCheckout, openCheckout, payOnStripe } from "../support/checkout.mjs";
import { SITES_PATH } from "../support/connect-dinkuskit.mjs";
import { config } from "../support/env.mjs";
import { firstLine } from "../support/errors.mjs";
import {
  expectedCharge, pricingProblems, quantityToReach, recordedPricing, recordedProblems, standingCharge, stripeProblems, thankYouProblems,
} from "../support/free-shipping.mjs";
import { completeTestOrder, numberOf } from "../support/orders-admin.mjs";
import { note, record } from "../support/proof.mjs";
import { notePlugins } from "../support/store-admin.mjs";
import { journey, step } from "../support/steps.mjs";
import { dollars } from "../support/storefront-text.mjs";

/**
 * The store's shipping charge as DinkusKit.com's Your Stores page shows it in the store's checkout
 * settings form. The form also holds the Payments Test/Live choice, so the journey only reads it and
 * never presses Save checkout settings.
 */
async function readCharge(page) {
  await page.goto(`${config.account}${SITES_PATH}`, { waitUntil: "domcontentloaded" });
  const heading = page.getByRole("heading", { level: 1 }).first();
  await heading.waitFor({ timeout: 60_000 });
  if ((await heading.innerText()).trim() === "Sign in") {
    throw new Error('DinkusKit.com asks the owner to sign in; the journey "DinkusKit.com account and connect the store" signs in.');
  }
  const form = page.locator(`form:has(input[name="action"][value="checkout_settings"]):has(input[name="site_id"][value=${JSON.stringify(config.siteId)}])`);
  if (!await form.count()) throw new Error(`Your Stores shows no checkout settings for store ${config.siteId}; only the business's owner sees them.`);
  const chosen = form.locator('input[name="shipping_mode"]:checked');
  const over = form.locator('input[name="shipping_free_over"]');
  return standingCharge({
    mode: await chosen.count() ? await chosen.getAttribute("value") : null,
    amount: await form.locator('input[name="shipping_amount"]').inputValue(),
    over: await over.count() ? await over.inputValue() : null,
  });
}

/**
 * A shopper buys `quantity` of the store's product with the 4242 test card. Returns the product's
 * unit price, what Stripe's page said before paying, and the checkout as confirmCheckout reads it.
 * A checkout an earlier run left pending in Commerce is paid first, as Buy and ship would pay it, so
 * this one starts from an empty cart; its order goes in `orders` to be completed with this run's.
 */
async function buy(page, quantity, orders) {
  let opened = await openCheckout(page, { quantity });
  if (opened.resumed) {
    await payOnStripe(page, opened.email);
    const earlier = await confirmCheckout(page);
    note("earlier checkout paid first", earlier.orderId ?? "unknown order");
    if (earlier.state === "paid" && earlier.orderId) orders.push(earlier.orderId);
    opened = await openCheckout(page, { quantity });
    if (opened.resumed) throw new Error("The store went back to an earlier checkout again instead of starting this one.");
  }
  // Stripe draws its order summary with the card form.
  await expect.poll(async () => await page.locator("#cardNumber").isVisible() || await page.locator('[data-testid="card-accordion-item-button"]').isVisible(),
    { timeout: 60_000 }).toBe(true).catch(() => {});
  const stripe = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  await payOnStripe(page, opened.email);
  return { unit: opened.unitCents, stripe, placed: await confirmCheckout(page) };
}

/** Fails with what differs, when anything does. */
function fine(problems, what) {
  if (problems.length) throw new Error(`${what} ${problems.join(", ")}.`);
}

// Free shipping over an amount the owner sets beside a flat charge (dinkuskit#93, commerce#200): one
// TEST order under the amount pays the flat charge, and one whose goods reach it pays none, on
// Stripe, on the thank-you page and in Commerce Orders. The amount stands on DinkusKit.com's Your
// Stores page, set once for the store, and the journey only reads it. Both orders end Completed.
test("Free shipping over an amount", { tag: "@next" }, journey(async ({ page }) => {
  expect(config.store, `Set DINKUS_E2E_STORE to the store's address (in ${config.settingsFile})`).not.toBe("");
  expect(config.siteId, `Set DINKUS_E2E_SITE_ID to the store's DinkusKit site id (in ${config.settingsFile})`).not.toBe("");
  const soft = { soft: true };

  // Without the store's standing charge there is nothing to check, so this step stops the journey.
  let charge;
  await step(page, "DinkusKit.com shows the store's flat charge and free-shipping amount", async () => {
    charge = await readCharge(page);
    note("shipping charge", `${dollars(charge.flat)} flat, free from ${dollars(charge.over)} of goods`);
    return `${dollars(charge.flat)} flat, free once an order's goods reach ${dollars(charge.over)}`;
  });

  const orders = [];
  let unit = null;
  const cases = [
    {
      who: "under",
      quantity: () => 1,
      stripe: "One item under the amount pays the flat shipping on Stripe",
      thankYou: "Its thank-you page shows the flat shipping",
      commerce: "Commerce Orders records the flat shipping",
    },
    {
      who: "over",
      quantity: () => quantityToReach(unit, charge.over),
      stripe: "Enough items to reach the amount pay no shipping on Stripe",
      thankYou: "Its thank-you page says Free shipping",
      commerce: "Commerce Orders records free shipping",
    },
  ];

  for (const order of cases) {
    if (order.who === "over" && unit === null) {
      for (const name of [order.stripe, order.thankYou, order.commerce]) record(name, "SKIP", "the first order never showed the product's price, so the test can't tell how many reach the amount");
      continue;
    }
    let bought;
    let expected;
    await step(page, order.stripe, async () => {
      const quantity = order.quantity();
      bought = await buy(page, quantity, orders);
      if (bought.placed.state !== "paid") throw new Error(`Commerce reports the checkout as "${bought.placed.state}", not paid.`);
      if (!bought.placed.orderId) throw new Error("Commerce's checkout status named no order.");
      orders.push(bought.placed.orderId);
      if (bought.unit === null) throw new Error("The store's cart snapshot gave no price for the product.");
      unit ??= bought.unit;
      expected = expectedCharge(charge, bought.unit * quantity);
      note(`${order.who} order`, `${bought.placed.orderId}: ${quantity} × ${dollars(bought.unit)}`);
      if (order.who === "under" && expected.goods >= charge.over) {
        throw new Error(`The product costs ${dollars(bought.unit)}, at or over the ${dollars(charge.over)} free-shipping amount, so no order is under it. Set DINKUS_E2E_PRODUCT_PATH to a cheaper product.`);
      }
      if (order.who === "over" && expected.goods < charge.over) {
        throw new Error(`The product now costs ${dollars(bought.unit)}, so ${quantity} come to ${dollars(expected.goods)}, under the ${dollars(charge.over)} free-shipping amount.`);
      }
      fine(stripeProblems(bought.stripe, expected), "Stripe's page differs from the order:");
      const what = expected.shipping ? `${dollars(expected.shipping)} shipping` : "no shipping";
      return `${quantity} × ${dollars(bought.unit)} = ${dollars(expected.goods)}: Stripe asked for ${dollars(expected.total)} with ${what}, and Commerce recorded the payment`;
    }, soft);
    if (!expected) {
      for (const name of [order.thankYou, order.commerce]) record(name, "SKIP", "this order wasn't paid as the test expected");
      continue;
    }

    await step(page, order.thankYou, async () => {
      fine(thankYouProblems(bought.placed.thankYou, expected), "The thank-you page differs from the order:");
      const { totals, shippingMethod } = bought.placed.thankYou;
      return `Shipping ${totals.Shipping}, ${shippingMethod}, Total ${totals.Total}`;
    }, soft);

    await step(page, order.commerce, async () => {
      // numberOf leaves the order's page open in Commerce Orders.
      const number = await numberOf(page, bought.placed.orderId, "Processing");
      orders[orders.indexOf(bought.placed.orderId)] = number;
      const recorded = recordedPricing(await page.locator("main").innerText());
      await notePlugins(page);
      fine([
        ...pricingProblems(bought.placed.pricing, expected).map(problem => `Commerce's checkout status gives ${problem}`),
        ...recordedProblems(recorded, expected).map(problem => `its page shows ${problem}`),
      ], `Order #${number} differs from what it should pay:`);
      return `#${number} records Shipping ${dollars(recorded.shipping)} and Order total ${dollars(recorded.total)}, as Commerce's checkout status gave`;
    }, soft);
  }

  if (!orders.length) record("The owner marks both orders completed, so the run leaves no order open", "SKIP", "the run placed no order");
  else await step(page, "The owner marks both orders completed, so the run leaves no order open", async () => {
    const done = [];
    const failed = [];
    for (const order of orders) {
      try {
        // An order this run never numbered is found by its order ID.
        const number = typeof order === "number" ? order : await numberOf(page, order, "Processing");
        await completeTestOrder(page, number);
        done.push(`#${number}`);
      } catch (error) {
        failed.push(`${typeof order === "number" ? `#${order}` : order}: ${firstLine(error)}`);
      }
    }
    if (failed.length) throw new Error(`${failed.join(" ")}${done.length ? ` ${done.join(", ")} Completed.` : ""}`);
    return `${done.join(", ")} Completed, with no carrier or tracking number`;
  }, soft);
}));
