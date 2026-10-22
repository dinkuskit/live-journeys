// What the DinkusKit.com account, connect and Your Stores pages actually show, and the one
// Payments control that starts a connection. Decisions only. The journey clicks.

// /account, when the owner is signed in and the business is approved with no store yet.
export const CONNECT_INSTRUCTION = "Install the DinkusKit Payments plugin in your EmDash store, open its setup page and press Connect. You'll come back here to approve it.";
// The same from dinkuskit#70, where Commerce's Connect registers the store and Payments and Ship follow it.
export const COMMERCE_INSTRUCTION = "Install the DinkusKit Commerce plugin in your EmDash store, open Commerce Settings and press Connect. You'll come back here to approve it. Then do the same in Payments and Ship.";

// /account/connect. The service name is the registered id ("payments", "commerce", "ship"), not a label,
// and the button is "Approve <service>". What each service gets is the start of its own paragraph. From
// dinkuskit#70, Payments' own key can start checkout payments, and its paragraph says so; the paragraph
// before it said Payments got no checkout access, and no longer counts.
export const CONSENT_HEADING = "Connect this store?";
export const CONSENT_PAYMENTS = "Payments status and processor setup access. The Payments plugin also gets its own store key, which can start checkout payments for this store (payments:checkout)";
const CONSENTS = {
  payments: { label: "Payments", says: CONSENT_PAYMENTS },
  commerce: { label: "Commerce", says: "Commerce gets its own store key." },
  ship: { label: "Ship", says: "The Ship plugin gets its own store key" },
};
// What the consent check says once a connection has been used, cancelled or denied.
export const NO_LONGER_WAITING = "This connection is no longer waiting for consent. Approve was not pressed.";
// Any store but this one, for trying the consent check as the wrong store. .invalid never resolves.
const ANOTHER_STORE = "https://another-store.invalid";

// Your Stores (/account/sites) from dinkuskit#70: each store's "Connected plugins" list has a line per
// plugin, "Commerce plugin: connected <time>, last used <time>" or "Commerce plugin: not connected. Press
// Connect in the Commerce plugin in EmDash.", and a Disconnect button for a connected one, never pressed.
export const SITES_PATH = "/account/sites";
export const CONNECTED_PLUGINS = "Connected plugins";

// dinkus-payments-beta's admin page. The menu label is "Payments status".
// dinkuskit/payments src/registry/identity.ts and emdash-plugin.jsonc.
export const PAYMENTS_BETA_STATUS_PATH = "/_emdash/admin/plugins/r_sffx6l4z6mpqliki/status";
export const PAYMENTS_STATUS_LABEL = "Payments status";
export const PAYMENT_SETUP_HEADING = "Payment setup";
export const AUTHORIZE_LINK = "Authorize Payments at DinkusKit";

const linesOf = text => text.split("\n").map(line => line.trim()).filter(Boolean);
const originOf = value => {
  try { return new URL(value).origin; } catch { return ""; }
};

/**
 * What to do with the account page. "connected" means this store is already listed.
 * "connect" means the page says to press Connect, in `plugin`: the Payments plugin, or from
 * dinkuskit#70 Commerce. Anything else stops, so the journey never switches business,
 * approves a business, or starts Connect.
 */
export function accountReading(text, store) {
  const storeOrigin = originOf(store);
  const lines = linesOf(text);
  const listed = lines.some(line => line === storeOrigin);
  if (lines.includes("Finish creating your account")) return { next: "stop", reason: "The account isn't finished. This journey does not create one." };
  if (lines.includes("Your store is connected") && listed) return { next: "connected" };
  if (lines.includes("Your store is connected")) return { next: "stop", reason: "The account says a store is connected, but not this one. This journey will not switch business or press Connect." };
  if (lines.includes("Waiting for approval")) return { next: "stop", reason: "This business is waiting for approval. A store can connect after that. This journey does not approve a business." };
  if (lines.includes("Your businesses")) return { next: "stop", reason: "This account has more than one business. This journey will not pick one." };
  if (lines.includes("Connect your store")) {
    if (text.includes(COMMERCE_INSTRUCTION)) return { next: "connect", plugin: "Commerce" };
    if (text.includes(CONNECT_INSTRUCTION)) return { next: "connect", plugin: "Payments" };
    return { next: "stop", reason: "The account says to connect a store, but not by pressing Connect in Commerce or the Payments plugin." };
  }
  if (lines.some(line => line.startsWith("You're on the staff of"))) return { next: "stop", reason: "This sign-in is staff, not the owner. Only the owner can approve a store connection." };
  return { next: "stop", reason: "The account page did not say this store is connected or ask to connect it." };
}

/** The consent page is this store and `service`, still waiting. Otherwise Approve stays unpressed. */
export function consentReading(text, store, service = "payments") {
  const lines = linesOf(text);
  const { label, says } = CONSENTS[service] ?? {};
  if (!label) return { ok: false, reason: `This journey doesn't approve ${service}. Approve was not pressed.` };
  if (!lines.includes(CONSENT_HEADING)) return { ok: false, reason: "The page is not Connect this store? Approve was not pressed." };
  if (!lines.includes(`Service: ${service}`)) return { ok: false, reason: `The page is not asking to connect ${label}. Approve was not pressed.` };
  if (!text.includes(says)) return { ok: false, reason: `The page does not describe ${label} access the way DinkusKit.com does. Approve was not pressed.` };
  if (!lines.includes(`Site origin: ${originOf(store)}`)) return { ok: false, reason: "The page is not this store. Approve was not pressed." };
  if (lines.includes("This connection is no longer waiting for consent.")) return { ok: false, reason: NO_LONGER_WAITING };
  return { ok: true };
}

/**
 * The consent check tried on the same page as another store, and as each other plugin, before Approve is
 * pressed. Every one must refuse, or the check that keeps Approve unpressed isn't doing its job:
 * { summary } says what it refused, { error } names the wrong approval it would have let through.
 */
export function wrongConsentRefusals(text, store, service) {
  if (consentReading(text, ANOTHER_STORE, service).ok) return { error: `The consent check would approve this page for another store. Approve ${service} was not pressed.` };
  const others = Object.keys(CONSENTS).filter(name => name !== service);
  const accepted = others.find(other => consentReading(text, store, other).ok);
  if (accepted) return { error: `The consent check would approve this ${service} page as ${accepted}. Approve ${service} was not pressed.` };
  return { summary: `Refused as another store and as ${others.join(" and ")}.` };
}

/**
 * Which plugins Your Stores shows connected for one store, from its Connected plugins lines (each line's
 * text, a Disconnect button's label below it or not): { commerce: true } for "Commerce plugin: connected
 * ...", false for "... not connected ...". A plugin without a line is left out.
 */
export function connectedPlugins(items) {
  const found = {};
  for (const item of items ?? []) {
    const match = String(item).trim().match(/^(Commerce|Payments|Ship) plugin: (connected|not connected)\b/);
    if (match) found[match[1].toLowerCase()] = match[2] === "connected";
  }
  return found;
}

/**
 * This store's plugins on Your Stores, from each store's web address (its heading) and the lines of its
 * Connected plugins list: { plugins } as connectedPlugins reads them, or { error } unless exactly one list
 * is this store's.
 */
export function storePlugins(stores, store) {
  const origin = originOf(store);
  const mine = (stores ?? []).filter(entry => entry?.origin === origin);
  if (mine.length !== 1) return { error: mine.length ? `Your Stores shows ${mine.length} Connected plugins lists for ${origin}, not one.` : `Your Stores shows no Connected plugins list for ${origin}.` };
  return { plugins: connectedPlugins(mine[0].items) };
}

/** A DinkusKit.com magic-link address. The journey never records one. */
export function isSignInLink(href) {
  try { return new URL(href).pathname.startsWith("/api/auth/magic-link/"); } catch { return false; }
}

/** Menu links that are the beta Payments status page on this store, and no other, each once. */
export function betaPaymentsStatusLinks(hrefs, store) {
  const storeOrigin = originOf(store);
  const pages = new Set();
  for (const href of hrefs) {
    let url;
    try { url = new URL(href, store); } catch { continue; }
    if (url.origin === storeOrigin && url.pathname === PAYMENTS_BETA_STATUS_PATH && !url.search && !url.hash) pages.add(url.href);
  }
  return [...pages];
}
