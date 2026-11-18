import { newPage, get } from "./browser.mjs";
import { expect } from "@playwright/test";
import { config } from "./env.mjs";
import { openStorePage } from "./signin.mjs";
import { settleCheckout } from "./checkout-settle.mjs";
import { ADD_TO_CART } from "./storefront-page.mjs";
import { cartCount } from "./storefront-text.mjs";
import { storeReturnLinks, storeReturnPage } from "./checkout-text.mjs";

// Commerce keeps the cart (Template Store #229); the browser holds only its key, in the store's HttpOnly
// dk_cart cookie, and the item count in dk_cart_count (template-store guest-cart server-cart.ts).
const CART_COOKIES = ["dk_cart", "dk_cart_count"];
const HUMAN_WAIT_MS = 10 * 60 * 1000;
// The Add to cart button findPhysicalProduct chose, when the page shows more than one.
let productId = null;

/**
 * Buys one physical product as a guest, the way a shopper does: product page, Add to cart, /cart,
 * /checkout with a US delivery address, Stripe's hosted Checkout with the 4242 test card, and back.
 *
 * Returns { number, orderId, checkoutToken, state, pricing, thankYou }. The storefront never
 * learns the short order number: Commerce's guest checkout status carries only `order:<attempt id>`,
 * and Orders numbers the order (1001, 1002...) when it keeps its copy. So `number` is normally null
 * and the caller finds the newest TEST order in Commerce Orders; Ship's order links end in `orderId`,
 * so that also picks the order there. `checkoutToken` is the Stripe Checkout Session id from the
 * return URL, `state` is Commerce's checkout state ("paid" once it has recorded the order), and
 * `pricing` is Commerce's amounts for it. `thankYou` is what the thank-you page showed.
 */
export async function placeTestOrder(page) {
  const { email } = await openCheckout(page);
  await payOnStripe(page, email);
  return confirmCheckout(page);
}

/**
 * Takes a guest shopper to Stripe's hosted Checkout for one physical product: product page, Add to
 * cart, /cart, then /checkout with a US delivery address and Continue to secure checkout. `quantity`
 * is typed into the cart's quantity box and Update pressed, as a shopper buying several would. Returns the checkout contact's
 * email, the product's unit price in cents from the store's cart snapshot (`unitCents`, null when
 * unreadable), and `resumed` when the browser already had a checkout pending in Commerce and went
 * back to its Stripe session instead.
 */
export async function openCheckout(page, { quantity = 1 } = {}) {
  const email = config.shopper.email || config.ownerEmail;
  if (!email) throw new Error("Set DINKUS_E2E_SHOPPER_EMAIL (or DINKUS_E2E_OWNER_EMAIL) for the checkout contact.");

  let path = config.productPath || null;
  let unitCents = null;
  // Never two checkouts at once: a checkout an earlier run left pending in Commerce is paid on its
  // own Stripe session instead of starting another.
  const resumed = await resumeCheckout(page);
  if (!resumed) {
    // The saved profile keeps an earlier run's cart and checkout; a leftover checkout locks the cart, so
    // the shopper starts a new cart, as one whose cookies were cleared does.
    for (const name of CART_COOKIES) await page.context().clearCookies({ name });
    path = config.productPath || await findPhysicalProduct(page);

    await page.goto(new URL(path, config.store).href);
    await orFail(page.locator(ADD_TO_CART).first().waitFor({ timeout: 15_000 }), async () =>
      `${path} offers no Add to cart: ${await texts(page, ".product-detail__notice, [data-product-status]")}`);
    const add = page.locator(productId ? `form[data-add-to-cart-form] [data-add-to-cart="${productId}"]` : ADD_TO_CART).first();
    unitCents = await unitPrice(page, await add.getAttribute("data-add-to-cart"));
    await add.click();
    // The message beside the pressed button: a Shop list draws one beside each card's button.
    const status = add.locator("xpath=ancestor::*[.//*[@data-add-to-cart-status]][1]").locator("[data-add-to-cart-status]");
    await orFail(expect(status).toHaveText(ADDED, { timeout: 10_000 }), async () =>
      `Add to cart failed: ${(await status.innerText({ timeout: 5_000 }).catch(() => "")).trim() || "no message beside the button"}`);

    // The server draws the cart from Commerce, so the page as loaded is the cart.
    await page.goto(config.store + "/cart");
    if (quantity !== 1) {
      const field = page.locator("[data-guest-cart-qty]").first();
      await orFail(field.waitFor({ timeout: 15_000 }), async () => `The cart shows no quantity box to change: ${await cartMessage(page)}`);
      await field.fill(String(quantity));
      // The line's Update button sends the new quantity, as a shopper presses it.
      await page.locator("[data-guest-cart-update]").first().click();
      await orFail(expect(page.locator("[data-guest-cart-qty]").first()).toHaveValue(String(quantity), { timeout: 10_000 }), async () =>
        `The cart wouldn't keep quantity ${quantity}: ${await cartMessage(page)}`);
    }
    // The cart's checkout is a link to /checkout, which asks for the contact and delivery address.
    const proceed = page.locator("[data-guest-cart-proceed]");
    await orFail(expect(proceed).toHaveAttribute("href", "/checkout", { timeout: 5_000 }), async () => `The cart never offered checkout: ${await cartMessage(page)}`);
    await proceed.click();
    await orFail(page.waitForURL(url => storeReturnPage(url.href, config.store) === "checkout page", { timeout: 30_000 }), async () =>
      `The cart's checkout button didn't open the store's checkout page: ${await cartMessage(page)}`);
    const checkout = page.locator("[data-guest-cart-checkout]");
    await orFail(expect(checkout).toBeEnabled({ timeout: 15_000 }), async () => `The checkout page never offered checkout: ${await cartMessage(page)}`);
    await orFail(page.locator("[data-guest-cart-delivery]").waitFor({ timeout: 5_000 }), async () =>
      `The checkout page asks for no delivery address, so ${path} is not a physical product; set DINKUS_E2E_PRODUCT_PATH.`);
    const { shopper } = config;
    await page.locator("[data-guest-cart-email]").fill(email);
    await page.locator("[data-guest-cart-delivery-name]").fill(shopper.name);
    await page.locator("[data-guest-cart-delivery-line1]").fill(shopper.line1);
    await page.locator("[data-guest-cart-delivery-city]").fill(shopper.city);
    await page.locator("[data-guest-cart-delivery-region]").fill(shopper.region);
    await page.locator("[data-guest-cart-delivery-postal-code]").fill(shopper.postalCode);
    await page.locator("[data-guest-cart-delivery-country]").selectOption("US");
    await checkout.click();
    await orFail(page.waitForURL(url => url.hostname === "checkout.stripe.com", { timeout: 60_000 }), async () =>
      `The store did not open Stripe Checkout: ${await cartMessage(page)}`);
  }
  return { email, resumed, unitCents };
}

/** What one of a product costs a shopper, in cents, from the store's cart snapshot; null when unreadable. */
async function unitPrice(page, id) {
  if (!id) return null;
  const response = await get(page, `${config.store}/api/guest-cart/snapshot?ids=${encodeURIComponent(id)}`).catch(() => null);
  const product = response?.ok() ? (await response.json().catch(() => null))?.products?.[0] : null;
  const minor = product?.price?.unitMinor;
  return typeof minor === "string" && /^\d+$/.test(minor) ? Number(minor) : null;
}

/**
 * Goes back to the Stripe page of the checkout this browser left pending in Commerce, as a shopper
 * returning to it would. False, leaving the browser on the store's homepage, when there is none.
 */
export async function resumeCheckout(page) {
  // A store behind Cloudflare Access sends the browser to Access's login once the saved sign-in lapses.
  await openStorePage(page, config.store + "/");
  const earlier = await readStatus(page);
  const resume = earlier.checkout?.state === "pending" ? earlier.checkout.redirectUrl : null;
  if (!resume || new URL(resume).hostname !== "checkout.stripe.com") return false;
  await page.goto(resume);
  return true;
}

/**
 * Once Stripe has sent the shopper back to the store: what the thank-you page shows, and Commerce's
 * word on the checkout. See placeTestOrder for what it returns.
 */
export async function confirmCheckout(page) {
  // Payments sends Stripe back to <store>/checkout/success?session_id=cs_test_...
  const sessionId = new URL(page.url()).searchParams.get("session_id");
  // What the shopper sees comes first: the test's own status call below would record the order
  // even when the thank-you page can't.
  const thankYou = await readThankYou(page);
  const status = await settle(page);
  const shown = await page.locator("main").innerText({ timeout: 5_000 }).catch(() => "");
  // A number only, never the digits that start a UUID ("Order 1234abcd-...").
  const number = shown.match(/(?:#|\bOrder\s+#?)(\d{4,})(?![\w-])/)?.[1] ?? null;
  return {
    number,
    orderId: status.checkout?.order?.orderId ?? (status.attemptId ? `order:${status.attemptId}` : null),
    checkoutToken: sessionId ?? status.attemptId ?? null,
    state: status.checkout?.state ?? "unknown",
    // Commerce's own amounts for the checkout: goods, shipping ({ mode, charge }) and final total.
    pricing: status.checkout?.pricing ?? null,
    thankYou,
  };
}

/**
 * The store's thank-you page as the shopper sees it once its own status check has answered:
 * heading, message, whether the order is shown, and the cart count in the header. While it says
 * the checkout is still pending, it presses "Check status again" the way a shopper would.
 */
async function readThankYou(page) {
  // Every read here is optional, so each gets a short limit: a page missing this markup costs a few
  // seconds per read, not the runner's one-minute action limit.
  const quick = { timeout: 5_000 };
  const root = page.locator("[data-guest-checkout-return]");
  const heading = async () => (await page.locator("main h1").first().innerText(quick).catch(() => "")).trim();
  if (!await root.count()) return { shown: false, heading: await heading() };
  const status = root.locator("[data-guest-checkout-return-status]");
  const recheck = root.locator("[data-guest-checkout-status-retry]");
  for (let presses = 0; ; presses++) {
    await expect(status).not.toHaveText(/^Checking the saved checkout status/, { timeout: 30_000 }).catch(() => {});
    if (presses === 4 || !await recheck.isVisible() || !await recheck.isEnabled(quick).catch(() => false)) break;
    await page.waitForTimeout(5_000);
    if (!await recheck.click(quick).then(() => true, () => false)) break;
  }
  return {
    shown: true,
    heading: await heading(),
    message: (await status.innerText(quick).catch(() => "")).trim(),
    confirmed: await root.locator("[data-guest-checkout-order]").isVisible(),
    items: await root.locator("[data-guest-checkout-order-items] li").count(),
    // The order's totals ("Shipping" → "$5.00" or "Free", "Total" → "$17.00") and its shipping method.
    totals: Object.fromEntries(await root.locator("[data-guest-checkout-order-totals] > *").evaluateAll(rows => rows.map(row =>
      [row.querySelector("dt")?.textContent?.trim() ?? "", row.querySelector("dd")?.textContent?.trim() ?? ""]))),
    shippingMethod: (await root.locator("[data-guest-checkout-shipping-method]").filter({ visible: true }).first().innerText(quick).catch(() => "")).trim(),
    cart: cartCount(await page.locator("[data-guest-cart-nav]").first().getAttribute("aria-label", quick).catch(() => null)),
  };
}

/**
 * With no DINKUS_E2E_PRODUCT_PATH: the first catalog product that can be added and is not digital.
 * Product pages come first; a storefront whose shop cards carry Add to cart but no product links
 * falls back to the page it is on, remembering which button to press.
 */
async function findPhysicalProduct(page) {
  const listing = new URL(page.url()).pathname;
  const paths = await page.locator("a[data-product-link]").evaluateAll(links => links.map(link => link.getAttribute("href")));
  for (const path of [...paths, listing]) {
    await page.goto(new URL(path, config.store).href);
    // From Template Store #125 a product sold only by its options also draws a locked Add to cart, which this journey can't use.
    const ids = await page.locator(ADD_TO_CART).evaluateAll(buttons => buttons.filter(button => !button.disabled).map(button => button.getAttribute("data-add-to-cart")));
    for (const id of ids.filter(Boolean)) {
      const response = await get(page, `${config.store}/api/guest-cart/snapshot?ids=${encodeURIComponent(id)}`);
      const product = response.ok() ? (await response.json()).products?.[0] : null;
      if (product?.found && product.fulfillment !== "digital") { productId = id; return path; }
    }
  }
  throw new Error(`No product on ${config.store} can be added to the cart and shipped; set DINKUS_E2E_PRODUCT_PATH.`);
}

/** Pays on Stripe's hosted Checkout with the 4242 test card and waits for Stripe to send the shopper back. */
export async function payOnStripe(page, email) {
  await submitCard(page, email, "4242424242424242");
  const back = url => url.origin === config.store;
  await page.waitForURL(back, { timeout: 120_000 }).catch(async () => {
    const problem = await framesTexts(page, FIELD_ERRORS);
    if (await captchaShown(page)) throw new CaptchaShown();
    if (config.headless) throw new Error(`Stripe did not send the shopper back to the store: ${problem}`);
    console.log("\n>>> Finish paying on the Stripe page in this test's browser window (card 4242 4242 4242 4242, 12/34, CVC 123).\n");
    await page.waitForURL(back, { timeout: HUMAN_WAIT_MS });
  });
}

/**
 * Pays with the 4242 test card, then leaves the way a shopper who closes the tab does: Stripe's
 * redirect back to the store is stopped before it reaches the store, and the tab goes blank. The
 * store never hears from the shopper again, so only Commerce's background check can make the order.
 */
export async function payAndCloseTab(page, email) {
  const toStore = request => new URL(request.url()).origin === config.store;
  const storeUrl = url => url.origin === config.store;
  await page.route(storeUrl, route => route.abort());
  try {
    // Settles either way, so a submitCard failure leaves no waiter to reject unhandled later.
    const redirected = page.waitForRequest(toStore, { timeout: 120_000 }).then(() => true, () => false);
    await submitCard(page, email, "4242424242424242");
    if (!(await redirected)) {
      if (await captchaShown(page)) throw new CaptchaShown();
      const problem = await framesTexts(page, FIELD_ERRORS);
      throw new Error(`Stripe did not send the shopper back toward the store: ${problem}`);
    }
  } finally {
    await page.unroute(storeUrl).catch(() => {});
    await page.goto("about:blank").catch(() => {});
  }
}

/**
 * Fills Stripe's hosted Checkout with one of Stripe's test cards and submits it. Stripe keeps the
 * fields on the page itself, not in frames, under stable ids.
 */
export async function submitCard(page, email, cardNumber) {
  requireTestMode(page);
  await orCaptcha(page, fillCard(page, email, cardNumber));
}

/** Only ever a TEST session: its URL carries a cs_test_ session id. Anything else stops the run unpaid. */
export function requireTestMode(page) {
  if (!/\/cs_test_/.test(new URL(page.url()).pathname)) throw new Error("Stripe opened a session that is not in test mode; nothing was paid.");
}

// Stripe's card fields, by the ids its Checkout page used and by the names and autofill hints its payment
// form uses when it draws the payment methods in a frame of their own (as on 18 Nov 2026).
const CARD = '#cardNumber, input[name="number"], input[autocomplete="cc-number"]';
const EXPIRY = '#cardExpiry, input[name="expiry"], input[autocomplete="cc-exp"]';
const CVC = '#cardCvc, input[name="cvc"], input[autocomplete="cc-csc"]';
const NAME = '#billingName, input[autocomplete="cc-name"], input[autocomplete="billing name"]';
const COUNTRY = '#billingCountry, select[name="country"], select[autocomplete="billing country"]';
const POSTAL = '#billingPostalCode, input[name="postalCode"], input[autocomplete="billing postal-code"], input[autocomplete="postal-code"]';
// Where Stripe says what is wrong with the card or one of its fields.
const FIELD_ERRORS = '[role="alert"], .FieldError, .p-FieldError';

/** The first of `make`'s locators a shopper can see, in Stripe's page or any frame in it, or null. */
async function shownInFrames(page, make) {
  for (const frame of page.frames()) {
    for (const choice of make(frame)) {
      for (const one of await choice.all().catch(() => [])) if (await one.isVisible().catch(() => false)) return one;
    }
  }
  return null;
}
const field = (page, selector) => shownInFrames(page, frame => [frame.locator(selector)]);

/** Whether Stripe shows its card form or a Card choice yet, in its page or a frame. */
export async function stripeCardReady(page) {
  return Boolean(await field(page, CARD) || await visibleCardChoice(page));
}

async function fillCard(page, email, cardNumber) {
  // A card-only session shows the card form at once. With more methods on, Card is a row in Stripe's
  // list of payment methods, drawn as an accordion button or, as on 18 Nov 2026, a radio row in a frame.
  await expect.poll(() => stripeCardReady(page), { timeout: 60_000 })
    .toBe(true).catch(async () => { throw new Error(`Stripe's Checkout page showed neither the card form nor a Card choice to open it (its payment choices: ${await paymentChoices(page)}).`); });
  if (!await field(page, CARD)) {
    await (await visibleCardChoice(page)).click();
    await expect.poll(async () => Boolean(await field(page, CARD)), { timeout: 15_000 }).toBe(true)
      .catch(() => { throw new Error("Choosing Card on Stripe's Checkout page didn't open the card form."); });
  }
  // A prefilled email is shown as text, not an input.
  const emailInput = await field(page, '#email, input[type="email"], input[name="email"], input[autocomplete="email"]');
  if (emailInput && await emailInput.isEditable() && !await emailInput.inputValue()) await emailInput.fill(email);
  await retype(await field(page, CARD), cardNumber);
  await retype(await field(page, EXPIRY), "1234");
  await retype(await field(page, CVC), "123");
  const name = await field(page, NAME);
  if (name) await name.fill(config.shopper.name);
  const country = await field(page, COUNTRY);
  if (country) await country.selectOption("US");
  // The postal code field shows only once the country asks for one.
  const zip = await field(page, POSTAL);
  if (zip) await zip.fill(config.shopper.postalCode);
  // Link's "save my information" would also ask for a phone number.
  const saveInfo = await shownInFrames(page, frame => [frame.locator("#enableStripePass"), frame.getByRole("checkbox", { name: /save my information/i })]);
  if (saveInfo && await saveInfo.isChecked()) await saveInfo.uncheck();
  const pay = await payButton(page);
  if (!pay) throw new Error("Stripe's Checkout page showed no Pay button after the card was filled in.");
  await pay.click();
}

/** Stripe's Pay button, never "Pay securely with Link", in its page or a frame, or null. */
function payButton(page) {
  return shownInFrames(page, frame => [frame.getByTestId("hosted-payment-submit-button"), frame.locator(".SubmitButton"),
    frame.getByRole("button", { name: /^(pay|pay \$[\d.,]+|complete order|place order)$/i })]);
}

/**
 * Stripe's complaint about a card field the test filled in full, or null. After it turns a card down
 * and the test types the next one, Stripe can keep a complaint it made mid-typing ("Your security code
 * is incomplete.") beside a complete field and ignore that press of Pay, as 18 Nov 2026's run showed.
 */
async function staleFieldError(page) {
  const shown = await framesTexts(page, FIELD_ERRORS);
  return /\bincomplete\b/i.test(shown) ? shown : null;
}

/**
 * The Card choice in Stripe's list of payment methods that a shopper can see, in its page or a frame,
 * or null. Stripe draws it as an accordion button or a radio row; it also renders the accordion button
 * hidden while Card is open, so only a visible one counts.
 */
function visibleCardChoice(page) {
  return shownInFrames(page, frame => [
    frame.locator('[data-testid="card-accordion-item-button"]'),
    frame.locator('[data-testid="card-accordion-item"]'),
    frame.locator('label[for="payment-method-accordion-item-title-card"]'),
    // The radio's name can carry the card brands' names too, so it only has to start with Card.
    frame.getByRole("radio", { name: /^(pay with )?card\b/i }),
    // The row's own visible label, which selects the row like a press anywhere on it.
    frame.getByText("Card", { exact: true }),
  ]);
}

/** Stripe's payment-method controls as its page and frames draw them, so a failure names what to look for next. */
async function paymentChoices(page) {
  const found = [];
  for (const frame of page.frames()) {
    const controls = await frame.locator('input, select, [data-testid*="accordion"], [role="radio"]').evaluateAll(nodes => nodes.slice(0, 12).map(node =>
      [node.tagName.toLowerCase(), node.id && `#${node.id}`, node.getAttribute("name") && `name=${node.getAttribute("name")}`,
        node.getAttribute("type") && `type=${node.getAttribute("type")}`, node.getAttribute("data-testid") && `testid=${node.getAttribute("data-testid")}`,
        node.getAttribute("value") && `value=${node.getAttribute("value")}`, node.getClientRects().length ? "shown" : "hidden"].filter(Boolean).join(" "))).catch(() => []);
    if (controls.length) found.push(`${frame === page.mainFrame() ? "page" : `frame ${new URL(frame.url()).pathname || frame.url()}`}: ${controls.join(", ")}`);
  }
  return found.length ? found.join(" | ") : `none found in ${page.frames().length} frames`;
}

/** Types into one of Stripe's card fields, emptying it first: after Stripe turns a card down, its fields can still hold that card. */
async function retype(field, value) {
  if (!field) throw new Error("Stripe's card form lost one of its fields before the test could fill it.");
  if (await field.inputValue()) await field.clear();
  await field.pressSequentially(value);
}

/**
 * After a card Stripe should turn down: Stripe's message saying why, as the shopper reads it. Returns
 * { paid: true } instead when Stripe took the payment and sent the shopper back to the store. With
 * `bankCheck`, Stripe's test bank check still open after a press of Fail is failed again: a press
 * that lands while Stripe is still drawing or swapping its test page changes nothing.
 */
export async function stripeRefusal(page, says, { bankCheck = false } = {}) {
  const deadline = Date.now() + 60_000;
  let pressed = Date.now(); // submitCard or failBankCheck has just pressed Pay or Fail.
  let repressed = 0;
  for (;;) {
    if (new URL(page.url()).origin === config.store) return { paid: true };
    if (await captchaShown(page)) throw new CaptchaShown();
    const shown = await stripeText(page);
    const message = shown.split("\n").map(line => line.trim()).find(line => says.test(line));
    if (message) return { message };
    const fail = bankCheck ? await bankCheckFail(page) : null;
    if (Date.now() > deadline) {
      throw new Error(fail ? "Stripe's test bank check stayed open after the test pressed Fail."
        : `Stripe showed no message saying why it turned the card down: ${await framesTexts(page, FIELD_ERRORS)}`);
    }
    // Stripe closes its test page within seconds of a press it takes, so one open 8 seconds later never got it.
    if (fail && Date.now() - pressed >= 8_000) {
      await fail.click({ timeout: 5_000 }).catch(() => {});
      pressed = Date.now();
    }
    // A shopper who sees Stripe still complaining about a field they filled in presses Pay again.
    if (!fail && repressed < 2 && Date.now() - pressed >= 8_000 && await staleFieldError(page)) {
      const pay = await payButton(page);
      if (pay) {
        await pay.click({ timeout: 5_000 }).catch(() => {});
        repressed += 1;
        pressed = Date.now();
      }
    }
    await page.waitForTimeout(1_000);
  }
}

/**
 * Fails Stripe's test bank check (3D Secure) as a shopper who can't verify would. Stripe's test page
 * opens in frames inside Checkout and offers Complete and Fail; the test only ever presses Fail.
 * Returns at once if Stripe takes the payment without asking, which stripeRefusal then reports.
 */
export async function failBankCheck(page) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (new URL(page.url()).origin === config.store) return;
    if (await captchaShown(page)) throw new CaptchaShown();
    const fail = await bankCheckFail(page);
    // A press Stripe misses, in a frame it swapped mid-press say, is made again by stripeRefusal.
    if (fail) return void await fail.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
  }
  throw new Error("Stripe never showed its test bank check with a Fail button.");
}

/** The Fail button on Stripe's test bank check, in whichever frame shows it, or null while none shows. */
async function bankCheckFail(page) {
  for (const frame of page.frames()) {
    for (const fail of [frame.locator("#test-source-fail-3ds"), frame.getByRole("button", { name: /^Fail( authentication)?$/i })]) {
      if (await fail.first().isVisible().catch(() => false)) return fail.first();
    }
  }
  return null;
}

/**
 * Leaves Stripe Checkout unpaid by its link back to the store, and returns the store page it opened:
 * Payments gives Stripe the store's cart as the way back, or from payments#79 the store's checkout page.
 */
export async function leaveStripe(page) {
  return orCaptcha(page, followBackLink(page));
}

async function followBackLink(page) {
  const back = page.locator(storeReturnLinks(config.store)).first();
  await orFail(back.waitFor({ timeout: 15_000 }), async () => "Stripe's page shows no link back to the store.");
  await back.click();
  // A Stripe address carries the session, so only a store page is named by its path.
  await orFail(page.waitForURL(url => storeReturnPage(url.href, config.store) !== null, { timeout: 30_000 }), async () => {
    const at = new URL(page.url());
    return `Stripe's link back led to ${at.origin === config.store ? at.pathname : at.hostname}, not the store's cart or checkout page.`;
  });
  const landed = storeReturnPage(page.url(), config.store);
  // Both pages hold the shopper's cart; a store without the page Payments named shows none.
  await orFail(page.locator("[data-guest-cart]").first().waitFor({ timeout: 30_000 }), async () =>
    `Stripe's link back opened ${new URL(page.url()).pathname}, which shows no cart, so the store has no ${landed}.`);
  return landed;
}

// A visible captcha is for a person to answer, never the test.
const captchaShown = page => page.locator('iframe[title*="hCaptcha challenge"]').isVisible().catch(() => false);

/** Throws CaptchaShown when Stripe has a captcha up. */
export async function stopIfCaptcha(page) {
  if (await captchaShown(page)) throw new CaptchaShown();
}

/**
 * Awaits `work`, actions on Stripe's page. A captcha over the page can make a click time out, or catch
 * it so nothing happens, before anything looks for the captcha, so when `work` fails with one up,
 * throws CaptchaShown instead.
 */
async function orCaptcha(page, work) {
  try {
    return await work;
  } catch (error) {
    await stopIfCaptcha(page);
    throw error;
  }
}

/** Stripe showed a captcha. Nobody answers it for the test, so a journey that meets one stops unpaid. */
export class CaptchaShown extends Error {
  constructor() {
    super("Stripe showed a captcha challenge; stopped without answering it.");
    this.name = "CaptchaShown";
  }
}

/** Commerce's status for this browser's cart's checkout, read from a store page opened beside the shopper's. */
export async function checkoutStatus(page) {
  const storePage = await newPage(page.context());
  try {
    await openStorePage(storePage, config.store + "/");
    return await readStatus(storePage);
  } finally {
    await storePage.close();
  }
}

/** Asks Commerce for this checkout's status until it leaves "pending" (see checkout-settle.mjs). */
const settle = page => settleCheckout(page, readStatus);

/**
 * Commerce's word on this browser's cart and its checkout, read the way the store reads it: the cart
 * key from the dk_cart cookie, sent to Commerce's cart route from a store page. An empty body only
 * reads the cart, and a read also runs Commerce's payment check. { attemptId: null } when the browser
 * has no cart or Commerce's cart has no checkout; `unanswered: true` as well when Commerce gave no answer.
 */
async function readStatus(page) {
  const key = (await page.context().cookies(config.store)).find(cookie => cookie.name === CART_COOKIES[0])?.value ?? "";
  const plugin = config.ordersAdmin.match(/\/plugins\/([^/]+)\//)?.[1];
  if (!key || !plugin) return { attemptId: null };
  const answer = await page.evaluate(async ({ key, route }) => {
    try {
      const response = await fetch(route, {
        method: "POST", cache: "no-store", redirect: "error",
        headers: { "content-type": "application/json", accept: "application/json", "x-commerce-guest-capability": key },
        body: "{}",
      });
      const body = await response.json();
      const value = body?.success === true ? body.data : body;
      return value?.ok ? { checkout: value.checkout ?? null } : null;
    } catch {
      return null;
    }
  }, { key, route: `/_emdash/api/plugins/${plugin}/checkout/guest/cart` }).catch(() => null);
  if (!answer) return { attemptId: null, unanswered: true };
  return answer.checkout?.attemptId ? { attemptId: answer.checkout.attemptId, checkout: answer.checkout } : { attemptId: null };
}

// The store's word beside Add to cart once the cart has the product ("Added to your cart.").
const ADDED = /added to (?:your )?cart/i;

/** Awaits `work`; on failure throws `reason()` instead, so the proof report's one line says what happened. */
async function orFail(work, reason) {
  try { return await work; } catch { throw new Error(await reason()); }
}

/** Every line Stripe's page and its frames show, since its card messages can sit in the payment frame. */
async function stripeText(page) {
  const parts = await Promise.all(page.frames().map(frame => frame.locator("body").innerText({ timeout: 5_000 }).catch(() => "")));
  return parts.join("\n");
}

/** `texts` across Stripe's page and its frames. */
async function framesTexts(page, selector) {
  const found = [];
  for (const frame of page.frames()) found.push(...await frame.locator(selector).allInnerTexts().catch(() => []));
  return found.map(text => text.trim()).filter(Boolean).join(" / ") || "no message on the page";
}

async function texts(page, selector) {
  const found = await page.locator(selector).allInnerTexts().catch(() => []);
  return found.map(text => text.trim()).filter(Boolean).join(" / ") || "no message on the page";
}

const cartMessage = page => texts(page, "[data-guest-cart-status], [data-guest-cart-checkout-reason], [data-store-demo-banner]");
