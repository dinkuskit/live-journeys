import { test } from "../support/browser.mjs";
import { commerceSettings, openCommercePage, readCommercePage } from "../support/commerce-settings.mjs";
import {
  AUTHORIZE_LINK, CONNECTED_PLUGINS, PAYMENT_SETUP_HEADING, PAYMENTS_STATUS_LABEL, SITES_PATH, accountReading, betaPaymentsStatusLinks,
  isSignInLink, storePlugins,
} from "../support/connect-dinkuskit.mjs";
import { failClosed, showsSecret } from "../support/dinkuskit-approve.mjs";
import { config } from "../support/env.mjs";
import { mailBaseline, waitForMail } from "../support/mail.mjs";
import { approvePayments, authorizeHref as isConnectLink } from "../support/payments-status.mjs";
import { COMMERCE_CONNECT, connectPlugin } from "../support/plugin-connect.mjs";
import { note } from "../support/proof.mjs";
import { notePlugins, openAdmin } from "../support/store-admin.mjs";
import { BETA_STORE } from "../support/store-updates.mjs";
import { journey, mayRunTwice, step } from "../support/steps.mjs";

// Long enough that a person watching can read each screen. A film sets DINKUS_E2E_VIDEO=1.
const FOLLOW = 3_500;
const HUMAN_WAIT_MS = 10 * 60 * 1000;

const pause = page => page.waitForTimeout(FOLLOW);
const accountUrl = () => `${config.account}/account`;
const mainText = page => page.locator("main").innerText();
const heading = page => page.getByRole("heading", { level: 1 }).first();

// The connect address is a bearer for that approval and the sign-in link opens the account, so the
// journey leaves a blank page for Playwright's failure notes, as Payments status does.
test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => {});
});

/** Opens a mailed sign-in link and leaves that address before anything is recorded or pictured. */
async function openSignInLink(page, link) {
  if (!isSignInLink(link)) throw new Error("The new email was not a DinkusKit sign-in link.");
  try {
    await page.goto(link, { waitUntil: "domcontentloaded" });
  } catch {
    await page.goto(accountUrl(), { waitUntil: "domcontentloaded" }).catch(() => {});
    throw new Error("The sign-in link did not open.");
  }
  const finished = await page.waitForURL(url => !isSignInLink(url.href), { timeout: 60_000 }).then(() => true, () => false);
  if (!finished || isSignInLink(page.url())) {
    await page.goto(accountUrl(), { waitUntil: "domcontentloaded" }).catch(() => {});
    throw new Error("The sign-in link did not finish.");
  }
}

// The owner's DinkusKit.com account, then this store connected there. From Commerce's Connect
// release Commerce's own Connect registers the store: Connect on Commerce Settings, then Approve
// commerce on DinkusKit.com's "Connect this store?" page, and Your Stores lists Commerce connected.
// Before that release the Payments plugin's Connect does, and a store the account already lists is
// left as it is. Disconnect, Replace key and Show checkout settings on Your Stores are never pressed.
// Checkout settings, Payments status checks, and Ship are later episodes.

// Places no order and pays nothing, so a failed try gets one retry in the same run.
mayRunTwice();

test("DinkusKit.com account and connect the store", { tag: "@running" }, journey(async ({ page }) => {
  if (config.store !== BETA_STORE.store || config.siteId !== BETA_STORE.siteId) {
    throw new Error(`Only the beta store, ${BETA_STORE.store} (site ${BETA_STORE.siteId}), gets this connect; this run is set to ${config.store || "no store"} (site ${config.siteId || "not set"}).`);
  }

  let needsSignIn = false;
  await step(page, "The owner opens the DinkusKit account", async () => {
    await page.goto(accountUrl(), { waitUntil: "domcontentloaded" });
    await heading(page).waitFor({ timeout: 60_000 });
    await pause(page);
    needsSignIn = (await heading(page).innerText()).trim() === "Sign in";
    return needsSignIn ? "The sign-in page is up" : "Already signed in";
  });

  if (needsSignIn) {
    if (!config.ownerEmail) throw new Error("DINKUS_E2E_OWNER_EMAIL is not set, so the test cannot ask DinkusKit.com for a sign-in link.");
    const baseline = mailBaseline("dinkuskit");
    await step(page, "Email me a sign-in link", async () => {
      await page.locator("#email").fill(config.ownerEmail);
      await pause(page);
      await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
      await page.getByRole("heading", { name: "Check your email", exact: true }).waitFor({ timeout: 60_000 });
      await pause(page);
      return "Check your email";
    });
    await step(page, "The sign-in link opens the account", async () => {
      const link = await waitForMail("dinkuskit", baseline);
      if (link) {
        await openSignInLink(page, link);
      } else {
        console.log(`\n>>> Open the "Sign in to DinkusKit" email for ${config.ownerEmail} and paste its link into this test's browser window.\n`);
        await page.waitForURL(url => !url.href.startsWith(`${config.account}/account/sign-in`) && !isSignInLink(url.href), { timeout: HUMAN_WAIT_MS });
      }
      if (!page.url().startsWith(accountUrl())) await page.goto(accountUrl(), { waitUntil: "domcontentloaded" });
      await heading(page).waitFor({ timeout: 60_000 });
      await pause(page);
      if ((await heading(page).innerText()).trim() === "Sign in") throw new Error("DinkusKit.com is still asking the owner to sign in.");
      return "Signed in";
    });
  }

  let reading;
  await step(page, "The account shows whether this store is connected", async () => {
    if (!page.url().startsWith(accountUrl())) await page.goto(accountUrl(), { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /Your store is connected|Connect your store|Waiting for approval|Finish creating your account|You're on the staff of/ })
      .first().waitFor({ timeout: 30_000 }).catch(() => {});
    await pause(page);
    reading = accountReading(await mainText(page), config.store);
    if (reading.next === "stop") throw new Error(reading.reason);
    if (reading.next === "connected") return `The account lists ${config.store} as connected.`;
    return `This store is not connected yet. The account says to press Connect in ${reading.plugin === "Commerce" ? "Commerce" : "the Payments plugin"}.`;
  });

  let commerce;
  await step(page, "Commerce Settings shows whether Commerce connects the store", async () => {
    await openAdmin(page, `${config.store}/_emdash/admin/plugins-manager`);
    const found = commerceSettings(await notePlugins(page));
    if (found.error) throw new Error(found.error);
    const url = `${config.store}${found.page}`;
    commerce = { ...found, url, connectRelease: await openCommercePage(page, url) };
    await pause(page);
    if (!commerce.connectRelease) return `${found.slug} ${found.version} has no Connect of its own, so the Payments plugin connects the store.`;
    const { siteId } = (await readCommercePage(page)).reading;
    return siteId ? `Commerce is connected to DinkusKit.com, store ${siteId}.` : "Commerce has its own Connect and isn't connected yet.";
  });

  if (commerce.connectRelease) {
    await step(page, "Commerce is connected to this store", async () => {
      const result = await connectPlugin(page, {
        texts: COMMERCE_CONNECT, mayConnect: true,
        open: async () => { await openCommercePage(page, commerce.url); },
        read: readCommercePage,
        landing: commerce.page,
        ready: consent => consent.getByRole("heading", { name: COMMERCE_CONNECT.section, exact: true }),
      });
      if (result.siteId !== config.siteId) throw new Error(`Commerce is connected to DinkusKit.com store ${result.siteId}, not this store's ${config.siteId}.`);
      await pause(page);
      note("commerce connect", result.connected ? "connected this run" : "already connected");
      return result.connected
        ? `The owner approved commerce on DinkusKit.com, and Commerce is connected to store ${result.siteId}.`
        : `Commerce was already connected to store ${result.siteId}. Connect again was left alone.`;
    });

    await step(page, "Your Stores shows Commerce connected for this store", async () => {
      await page.goto(`${config.account}${SITES_PATH}`, { waitUntil: "domcontentloaded" });
      const lists = page.locator(`ul[aria-label="${CONNECTED_PLUGINS}"]`);
      await lists.first().waitFor({ timeout: 30_000 }).catch(() => {});
      // Your Stores shows a store key only after Replace key, which this journey never presses.
      if (showsSecret(await mainText(page))) await failClosed(page, "Your Stores showed a store key. It was not kept.");
      await pause(page);
      // Each store's list sits under its web address; a line's Disconnect button is left out.
      const stores = await lists.evaluateAll(uls => uls.map(ul => ({
        origin: ul.parentElement?.querySelector("h3")?.textContent?.trim() ?? "",
        items: [...ul.children].map(item => item.innerText.split("\n").map(line => line.trim()).find(Boolean) ?? ""),
      })));
      const found = storePlugins(stores, config.store);
      if (found.error) throw new Error(found.error);
      if (found.plugins.commerce !== true) throw new Error("Your Stores doesn't show Commerce connected for this store, though Commerce Settings does.");
      const others = ["Payments", "Ship"].map(plugin => `${plugin} ${found.plugins[plugin.toLowerCase()] ? "connected" : "not connected yet"}`);
      return `Commerce plugin: connected. ${others.join(", ")}.`;
    });
    return;
  }

  if (reading.next === "connected") return;

  let authorizeHref;
  await step(page, "Payment setup offers Connect", async () => {
    await openAdmin(page, `${config.store}/_emdash/admin`);
    const links = page.getByRole("link", { name: PAYMENTS_STATUS_LABEL, exact: true });
    await links.first().waitFor({ timeout: 30_000 }).catch(() => {});
    const hrefs = await links.evaluateAll(anchors => anchors.map(anchor => anchor.href));
    const matches = betaPaymentsStatusLinks(hrefs, config.store);
    if (!matches.length) throw new Error("The admin menu has no Payments status page for the beta Payments plugin. This journey will not open another plugin.");
    await pause(page);
    const count = await links.count();
    let opened = false;
    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      if (await link.evaluate(anchor => anchor.href) !== matches[0]) continue;
      await link.click();
      opened = true;
      break;
    }
    if (!opened) throw new Error("The beta Payments status link was not clicked.");
    await page.getByRole("heading", { name: PAYMENT_SETUP_HEADING, exact: true }).waitFor({ timeout: 60_000 });
    await pause(page);
    const reconnect = page.getByRole("button", { name: "Reconnect", exact: true });
    const connect = page.getByRole("button", { name: "Connect", exact: true });
    const authorize = page.getByRole("link", { name: AUTHORIZE_LINK, exact: true });
    if (await reconnect.isVisible().catch(() => false)) throw new Error("Payment setup offers Reconnect. This journey will not press it.");
    if (!await authorize.isVisible().catch(() => false)) {
      if (!await connect.isVisible().catch(() => false)) {
        throw new Error("Payment setup has no Connect button. This journey will not press Check connection or Set up or resume Stripe.");
      }
      await pause(page);
      await connect.click();
    }
    await authorize.waitFor({ timeout: 60_000 });
    await pause(page);
    authorizeHref = await authorize.getAttribute("href");
    if (!isConnectLink(authorizeHref, config.account)) throw new Error("Authorize Payments at DinkusKit does not open this account's connect page. It was not followed.");
    return "Authorize Payments at DinkusKit is on the page";
  });

  await step(page, "The owner approves this store on DinkusKit.com", async () => {
    await pause(page);
    // Approve payments is pressed only on Connect this store? for this store and Payments, and the
    // store's Payments status page is let load after it, since that load saves the connection.
    await approvePayments(page, authorizeHref);
    await pause(page);
    await page.goto(accountUrl(), { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Your store is connected", exact: true }).waitFor({ timeout: 60_000 });
    await pause(page);
    const after = accountReading(await mainText(page), config.store);
    if (after.next !== "connected") throw new Error(after.reason ?? "The account still does not list this store.");
    return `${config.store} is connected. Checkout settings and the store key were not opened.`;
  });
}));
