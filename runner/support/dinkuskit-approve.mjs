import { consentReading } from "./connect-dinkuskit.mjs";
import { config } from "./env.mjs";
import { mailBaseline, waitForMail } from "./mail.mjs";
import { filterPage } from "./request-policy.mjs";

// The approval every DinkusKit Connect ends with. Payments, Commerce and Ship each start a Connect from their
// own page in the store admin, which links the owner to DinkusKit.com's "Connect this store?" page for that
// one connection (dinkuskit/dinkuskit src/pages/account/connect.astro). Its button is "Approve <service>";
// Deny is never pressed. DinkusKit.com then sends the owner back to the plugin's page, whose own load
// finishes the Connect. The connect address is a bearer for that approval, so it is never written down.

const CONNECTION_ID = /^[A-Za-z0-9_-]{1,200}$/;
const SECRET = /dk_store_[A-Za-z0-9_-]{20,}|sk_(?:test|live)_[0-9A-Za-z]+|rk_(?:test|live)_[0-9A-Za-z]+|whsec_[0-9A-Za-z]+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

/** DinkusKit's connect page for one connection, and nothing else that could carry a token. */
export function authorizeHref(href, account) {
  let url;
  try { url = new URL(href); } catch { return false; }
  if (url.origin !== account || url.username || url.password || url.hash || url.pathname !== "/account/connect") return false;
  const keys = [...url.searchParams.keys()];
  const id = url.searchParams.get("connection_id");
  return keys.length === 1 && keys[0] === "connection_id" && url.searchParams.getAll("connection_id").length === 1 && CONNECTION_ID.test(id ?? "");
}

/** A store key or session token in text the proof might keep. */
export function showsSecret(text) {
  return SECRET.test(String(text ?? ""));
}

/** Proof text with store keys, session tokens and connection ids removed. */
export function redact(text) {
  return String(text ?? "")
    .replace(new RegExp(SECRET.source, "g"), "[secret]")
    .replace(/connection_id=[^&\s]+/gi, "connection_id=[redacted]");
}

/** Leaves a blank page so a later screenshot cannot keep a key, token or connection address. */
export async function failClosed(page, message) {
  await page.goto("about:blank").catch(() => {});
  throw new Error(redact(message).split("\n")[0]);
}

/** DinkusKit.com's magic-link sign-in. The link is opened and never written down. */
async function signInToAccount(popup) {
  if (!config.ownerEmail) await failClosed(popup, "DINKUS_E2E_OWNER_EMAIL is not set, so the test cannot ask DinkusKit.com for a sign-in link.");
  if (!config.mailCmd) await failClosed(popup, "DinkusKit.com asked for a sign-in link and no mail command is set.");
  const baseline = mailBaseline("dinkuskit");
  await popup.locator("#email").fill(config.ownerEmail);
  await popup.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
  const link = await waitForMail("dinkuskit", baseline);
  if (!link) await failClosed(popup, "No DinkusKit sign-in link arrived.");
  await popup.goto(link).catch(async () => {
    await failClosed(popup, "The DinkusKit sign-in link did not open.");
  });
}

/**
 * Opens the plugin page's `link` to DinkusKit.com and presses Approve <service>, only when that page asks to
 * connect this store to `service`. A signed-out account is signed in with the test inbox first; the connect
 * page sends that sign-in to /account with no way back, so the same connect address is opened again after.
 * DinkusKit.com must send the owner back to `landing`, the plugin's page on this store, and its own load
 * finishes the Connect, so the window stays open until `ready` (a locator on it) shows.
 */
export async function approveAtDinkusKit(page, { link, href, service, landing, ready }) {
  if (!authorizeHref(href, config.account)) await failClosed(page, `${link} does not open DinkusKit's connect page.`);
  const popupPromise = page.context().waitForEvent("page", { timeout: 15_000 }).catch(() => null);
  await page.locator("main").getByRole("link", { name: link, exact: true }).click();
  const popup = await popupPromise;
  const consent = popup ?? page;
  const approveName = `Approve ${service}`;
  try {
    if (popup) await filterPage(popup, config);
    await consent.waitForLoadState("domcontentloaded");
    if (consent.url().startsWith(`${config.account}/account/sign-in`)) {
      await signInToAccount(consent);
      await consent.goto(href);
      await consent.waitForLoadState("domcontentloaded");
    }
    const heading = consent.getByRole("heading", { name: "Connect this store?", exact: true });
    await heading.waitFor({ timeout: 30_000 }).catch(async () => {
      await failClosed(consent, "DinkusKit did not show Connect this store?.");
    });
    const reading = consentReading(await consent.locator("main").innerText(), config.store, service);
    if (!reading.ok) await failClosed(consent, reading.reason);
    const approve = consent.getByRole("button", { name: approveName, exact: true });
    if (!await approve.count()) {
      const said = (await consent.locator("body").innerText()).split("\n").map(line => line.trim()).find(Boolean) ?? "";
      await failClosed(consent, said || `DinkusKit's connect page has no ${approveName} button.`);
    }
    await approve.click();
    // DinkusKit answers by sending the page on: back to the store, back to the connect page with
    // ?error=<reason>, or to another account page (sites, sign-in) for a refusal it can't show there.
    const landed = await consent.waitForURL(next => {
      try {
        const url = new URL(next);
        if (url.origin === config.store) return true;
        return url.origin === config.account && (url.pathname !== "/account/connect" || url.searchParams.has("error"));
      } catch { return false; }
    }, { timeout: 60_000 }).then(() => new URL(consent.url()), () => null);
    if (!landed) await failClosed(consent, `DinkusKit did not answer ${approveName} within a minute.`);
    if (landed.origin !== config.store || landed.pathname !== landing) {
      const reason = landed.searchParams.get("error") ?? "";
      const where = landed.origin === config.store ? "another store page" : `DinkusKit's ${landed.pathname}`;
      await failClosed(consent, `DinkusKit.com did not approve this connection${/^[a-z_]{1,64}$/.test(reason) ? ` (${reason})` : ""}; it sent the owner to ${where}.`);
    }
    // The plugin page's own load finishes the Connect. Closing before it shows would cut that off.
    await ready(consent).waitFor({ timeout: 60_000 }).catch(async () => {
      await failClosed(consent, `The plugin's page did not open after ${approveName}.`);
    });
  } finally {
    if (popup) await popup.close().catch(() => {});
  }
}
