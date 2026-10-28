import { AUTHORIZE_LINK, PAYMENTS_BETA_STATUS_PATH, PAYMENTS_FOLDER, PAYMENTS_STATUS_LABELS, betaPaymentsStatusLinks } from "./connect-dinkuskit.mjs";
import { approveAtDinkusKit, authorizeHref, failClosed, redact, showsSecret } from "./dinkuskit-approve.mjs";
import { config } from "./env.mjs";
import { pressAndAwait } from "./plugin-connect.mjs";
import { versionAtLeast } from "./store-plugins.mjs";

// Payments status in the store admin. The menu label and path are the plugin's admin page
// (dinkuskit/payments emdash-plugin.jsonc). The screen is Block Kit from
// src/registry/setup.ts renderSetupScreen: Connect, Connect again, Sign in again, Continue and Check
// connection are buttons; Authorize Payments at DinkusKit is an external link. That link opens
// dinkuskit.com/account/connect, whose submit button is "Approve payments"
// (src/pages/account/connect.astro). registry_session is written only by that flow.
// Reconnect, Deny, Sign in again and Set up or resume Stripe are on those pages, and this journey
// never presses them. Check connection is pressed only after this run's own approval.
// From Payments 0.3.0 (dinkuskit/payments#76) the page checks status with the Store key in the plugin's
// settings, the same key Commerce uses. Until the owner pastes it, the page shows the last check it read
// or Payment status not checked, and asks for the store key. This journey never types a key.
// From Payments' Connect release (dinkuskit/payments#82) there is no Store key to paste: Connect hands the
// plugin its own key, and a page without one, or with one DinkusKit.com no longer knows, says to select
// Connect again. That Connect again is pressed once, and approved like a first Connect.

export { AUTHORIZE_LINK, authorizeHref, redact, showsSecret };
// Payments says one of these when the store has no DinkusKit connection: the first before Payments
// is configured, the second once it is (src/registry/setup.ts, connection state "disconnected").
export const CONNECT_LINES = [
  "Connect your DinkusKit account to check payment setup.",
  "Connect your DinkusKit account to continue.",
];
const BANNERS = ["Not ready to sell", "Connected: Stripe test mode", "Payment status not checked"];
const PRESSABLE = ["Connect", "Connect again", "Continue", "Check connection"];
const STORE_KEY = /\bstore key\b/i;
// Payments 0.3.0 asks to paste the Store key; its Connect release asks to select Connect again instead.
const PASTE = /\bPaste\b/;
const CONNECT_AGAIN = "Select Connect again";
// The page's ask when DinkusKit.com wants Commerce connected first (store-connect-flow-081).
const COMMERCE_FIRST = "Connect the Commerce plugin first.";
// The first Payments version that checks status with the Store key, so its page needs no sign-in to check.
const STORE_KEY_READ = "0.3.0-0";

/** Whether a Payments plugin version checks its status with the Store key in its settings. */
export const readsWithStoreKey = version => versionAtLeast(version, STORE_KEY_READ);

/**
 * What the open Payments status page is saying, from its visible text. The connect line is the
 * unconfigured Connect payments step. Connected: Stripe test mode is the verified TEST banner.
 * A missing or refused store key is named on the page: Payments 0.3.0 asks to paste it, its Connect
 * release to select Connect again. Last checked opens the banner that shows an earlier check instead
 * of a new one.
 */
export function readStatusText(text) {
  const lines = String(text ?? "").split("\n").map(line => line.trim()).filter(Boolean);
  const connect = lines.find(line => line.startsWith("Connect payments:")) ?? "";
  const banner = lines.find(line => BANNERS.includes(line)) ?? "";
  return {
    header: lines.includes("Payment setup"),
    banner,
    connect,
    connectedTest: banner === "Connected: Stripe test mode" || connect.includes("Connected: Stripe test mode"),
    asksToConnect: CONNECT_LINES.some(line => connect.includes(line)),
    asksForStoreKey: lines.some(line => STORE_KEY.test(line) && PASTE.test(line)),
    asksToConnectAgain: lines.some(line => line.includes(CONNECT_AGAIN)),
    asksForCommerce: lines.some(line => line.includes(COMMERCE_FIRST)),
    lastCheck: lines.some(line => line.startsWith("Last checked ")),
  };
}

/**
 * The next connect control, or leave. A store is connected only when it is not connected at all:
 * Connect, Authorize Payments at DinkusKit, then Continue and Check connection once this run has
 * approved. Never Reconnect or Sign in again (both start a new connect), Check connection on a
 * connection this run didn't make, Deny, Set up or resume Stripe, or any other control, so the beta
 * store keeps its DinkusKit.com account and Stripe TEST account.
 * `approved` means DinkusKit's Approve payments was already pressed this run. `storeKeyRead` means the
 * page is Payments 0.3.0 or later, which checks with the Store key each time it opens: there a page that
 * shows only its last check, or offers Sign in again, hasn't checked. A page that asks to paste the store
 * key hasn't either, whatever its version. From Payments' Connect release a page that says to select
 * Connect again has no key of its own yet, or one DinkusKit.com no longer knows: Connect again is pressed
 * then, once, and approved like a first Connect, since that is how the plugin gets its key.
 */
export function nextPress(reading, controls, { approved = false, storeKeyRead = false } = {}) {
  const buttons = controls?.buttons ?? [];
  const links = controls?.links ?? [];
  if (reading?.asksForStoreKey) {
    return {
      action: "blocked",
      because: "Payments status asks for the store key, so it didn't check payment setup. The owner pastes the Store key in dinkus-payments-beta's settings; this journey never types it.",
    };
  }
  if (reading?.asksForCommerce) {
    return { action: "blocked", because: "Payments status says to connect the Commerce plugin first. Commerce's Connect registers the store at DinkusKit.com, then Payments can connect." };
  }
  if (reading?.asksToConnectAgain) {
    if (approved) return { action: "blocked", because: "Payments status still asks to select Connect again after this run's Approve payments, so the plugin has no store key from DinkusKit.com." };
    return buttons.includes("Connect again")
      ? { action: "press", name: "Connect again" }
      : { action: "blocked", because: "Payments status says to select Connect again, but it has no Connect again button." };
  }
  if (storeKeyRead && reading?.lastCheck) {
    return { action: "blocked", because: "Payments status shows only its last check. From Payments 0.3.0 it checks with the Store key each time it opens." };
  }
  if (storeKeyRead && buttons.includes("Sign in again")) {
    return {
      action: "blocked",
      because: "Payments status offers Sign in again when it opens, which this journey leaves to the owner. From Payments 0.3.0 a connected store's status check needs only the Store key.",
    };
  }
  if (reading?.connectedTest) {
    return {
      action: "leave",
      because: buttons.includes("Sign in again")
        ? "Last check was Connected: Stripe test mode. Sign in again was left alone."
        : "Connected: Stripe test mode. Reconnect and Stripe setup were left alone.",
    };
  }
  if (reading?.asksToConnect) {
    return buttons.includes("Connect")
      ? { action: "press", name: "Connect" }
      : { action: "blocked", because: "The page asks to connect a DinkusKit account, but it has no Connect button." };
  }
  if (!approved && links.includes(AUTHORIZE_LINK)) return { action: "authorize" };
  if (approved && buttons.includes("Continue")) return { action: "press", name: "Continue" };
  if (buttons.includes("Set up or resume Stripe") || links.includes("Continue setup at Stripe")) {
    return { action: "leave", because: "DinkusKit Payments status was checked. Set up or resume Stripe was left alone." };
  }
  // Reads the status of the connection this run just approved. It changes nothing.
  if (approved && buttons.includes("Check connection")) return { action: "press", name: "Check connection" };
  const left = ["Sign in again", "Check connection", "Continue"].filter(name => buttons.includes(name));
  return {
    action: "blocked",
    because: left.length
      ? `The store is connected, but Payments status doesn't show Connected: Stripe test mode. It offers ${left.join(", ")}, which this journey leaves to the owner.`
      : "The Payments status page shows no connect control from its status screen.",
  };
}

/**
 * The beta Payments plugin's status page among the admin menu's Payments links ("Payment settings" in
 * the Dinkus Payments folder, or "Payments status" before it). The beta store also runs the release
 * listing, which has its own page; that one is left alone.
 */
export async function paymentsStatusAdmin(page) {
  const { menuLinks, openAdmin } = await import("./store-admin.mjs");
  await openAdmin(page, `${config.store}/_emdash/admin`);
  const links = await menuLinks(page, PAYMENTS_STATUS_LABELS, [PAYMENTS_FOLDER]);
  const [beta] = betaPaymentsStatusLinks(await links.evaluateAll(anchors => anchors.map(anchor => anchor.href)), config.store);
  if (beta) return beta;
  throw new Error("The store admin's menu showed no Payments status page for dinkus-payments-beta within 30 seconds: the plugin isn't installed, is switched off, or the admin didn't finish loading. The release listing's page is not used.");
}

/** Opens Payments status and waits until Payment setup is on the page. A plugin error is not kept if it carries a secret. */
export async function openPaymentsStatus(page, url) {
  const { openAdmin } = await import("./store-admin.mjs");
  await openAdmin(page, url);
  const heading = page.getByRole("heading", { name: "Payment setup", exact: true });
  const failed = page.getByRole("heading", { name: "Plugin Error", exact: true });
  await heading.or(failed).first().waitFor({ timeout: 60_000 });
  if (await failed.isVisible()) await failClosed(page, `Payments status didn't open. ${await page.locator("main").innerText()}`);
}

/** The open page's reading and the button and link labels in main. Blanks the page if a secret is visible. */
export async function readPaymentsScreen(page) {
  const main = page.locator("main");
  const text = await main.innerText();
  if (showsSecret(text)) await failClosed(page, "Payments status showed a store key or session secret. It was not kept.");
  const buttons = (await main.getByRole("button").allInnerTexts()).map(label => label.trim()).filter(Boolean);
  const links = (await main.getByRole("link").allInnerTexts()).map(label => label.replace(/\s+/g, " ").trim()).filter(Boolean);
  return { reading: readStatusText(text), controls: { buttons, links } };
}

/** Presses one connect button. Any other name is refused. */
export async function pressNamed(page, name) {
  if (!PRESSABLE.includes(name)) throw new Error("That control is not part of the Payments status connect path.");
  // The loop opens the page again right after, which would cut off a press still on its way.
  await pressAndAwait(page, page.locator("main").getByRole("button", { name, exact: true }), name, "Payments");
}

/** The Authorize link's address, when it is DinkusKit's connect page and nothing else. */
export async function authorizeLink(page) {
  const href = await page.locator("main").getByRole("link", { name: AUTHORIZE_LINK, exact: true }).getAttribute("href");
  if (!authorizeHref(href, config.account)) await failClosed(page, "Authorize Payments at DinkusKit does not open DinkusKit's connect page.");
  return href;
}

/**
 * Opens Authorize Payments at DinkusKit and presses Approve payments, only when the page asks to
 * connect this store to Payments. Deny is never pressed. Only dinkus-payments-beta's page counts as
 * the way back: the beta store's release listing has its own.
 */
export async function approvePayments(page, href) {
  await approveAtDinkusKit(page, {
    link: AUTHORIZE_LINK, href, service: "payments", landing: PAYMENTS_BETA_STATUS_PATH,
    ready: consent => consent.getByRole("heading", { name: "Payment setup", exact: true }),
  });
}
