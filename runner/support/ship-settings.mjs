import { APPROVE_LINK, SHIP_CONNECT, mainButtons, mainText, readConnect } from "./plugin-connect.mjs";

// Ship's settings, as EmDash's auto-generated form renders dinkuskit/ship emdash-plugin.jsonc
// admin.settingsSchema (emdash packages/admin/src/components/PluginSettings.tsx on main).
// siteId is "Store ID", a string. storeKey is "Store key", a secret: the form's password
// field stays empty, and the server never sends the stored key back.
// From Ship's Connect release (dinkuskit/ship#65) both are gone: the form holds only the "DinkusKit
// connection" secret, which Connect on the Shipping page fills.

// The release listing is "DinkusKit Ship"; the beta listing, which the beta store runs, is
// "DinkusKit Ship (Beta)" (dinkuskit/ship scripts/release-flow.mjs STABLE_PLUGIN_NAME and
// BETA_PLUGIN_NAME, since dinkuskit/ship#84).
export const SHIP_PLUGIN_NAME = /^DinkusKit Ship( \(Beta\))?$/;
export const STORE_ID_LABEL = "Store ID";
export const STORE_KEY_LABEL = "Store key";
export const CONNECTION = {
  label: "DinkusKit connection",
  description: "Encrypted Store ID and this plugin's own DinkusKit store key. Managed by Connect on the Shipping page; don't change it here.",
};

// packages/admin/src/lib/plugin-links.ts kind "plugin-settings", under the admin basepath.
const SETTINGS_PATH = /^\/_emdash\/admin\/plugins-manager\/([^/]+)\/settings$/;

/** The settings form's path for a plugin id. The id is one path segment, so slashes are encoded. */
export function pluginSettingsPath(pluginId) {
  return `/_emdash/admin/plugins-manager/${encodeURIComponent(pluginId)}/settings`;
}

/**
 * The plugin id in a settings-form address on `store`, or null. Other admin pages (a plugin's own
 * pages, Shipping) are not this form. A query or hash is not this form either.
 */
export function pluginIdFromSettingsUrl(href, store) {
  if (!href || !store) return null;
  let url;
  let origin;
  try {
    origin = new URL(store).origin;
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.search || url.hash) return null;
  const match = SETTINGS_PATH.exec(url.pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * Null when `shown` is the site id Commerce uses. Otherwise a problem that does not repeat `shown`,
 * so a value that is not the site id (including anything pasted into the wrong field) stays out of
 * the proof.
 */
export function storeIdProblem(shown, siteId) {
  const value = typeof shown === "string" ? shown.trim() : "";
  if (!siteId) return "Set DINKUS_E2E_SITE_ID to the store's DinkusKit site id.";
  if (value === siteId) return null;
  if (!value) return "Store ID is empty. It is the site id from the Set up Commerce box on DinkusKit.com, the same one Commerce uses. The test does not type it.";
  return "Store ID is not the site id Commerce uses. The test does not record the field or change it.";
}

/**
 * The store id in the Shipping page's Open Ship link, `<ship>/stores/<id>/orders`, which the Ship plugin
 * builds from the store it is connected to; null for any other address.
 */
export function shipStoreFromHref(href, ship) {
  let url;
  try { url = new URL(href); } catch { return null; }
  if (url.origin !== ship || url.search || url.hash) return null;
  const match = /^\/stores\/([^/]+)\/orders$/.exec(url.pathname);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

/**
 * What only the Ship plugin's own Shipping page draws, connected or not: Open Ship, the Approve link,
 * Connect or Connect again, or its note for Editors. The admin's menu also says Shipping.
 */
export function shippingDrawn(page) {
  const main = page.locator("main");
  return main.getByRole("link", { name: "Open Ship", exact: true })
    .or(main.getByRole("link", { name: APPROVE_LINK, exact: true }))
    .or(main.getByRole("button", { name: /^Connect( again)?$/ }))
    .or(main.getByText(SHIP_CONNECT.adminOnly, { exact: true }))
    .first();
}

/** Opens the Shipping page and waits for it to draw. */
export async function openShippingPage(page, url) {
  const { openAdmin } = await import("./store-admin.mjs");
  await openAdmin(page, url);
  const failed = page.getByRole("heading", { name: "Plugin Error", exact: true });
  await shippingDrawn(page).or(failed).first().waitFor({ timeout: 60_000 });
  if (await failed.isVisible()) throw new Error("The Shipping page didn't open: it shows Plugin Error.");
}

/** The Shipping page's Connect as { reading, buttons }; a connected page names its store in Open Ship. */
export async function readShippingPage(page, ship) {
  const reading = readConnect(await mainText(page, "Ship"), SHIP_CONNECT);
  const open = page.locator("main").getByRole("link", { name: "Open Ship", exact: true });
  const href = await open.count() === 1 ? await open.getAttribute("href") : null;
  return { reading: { ...reading, siteId: href ? shipStoreFromHref(href, ship) : null }, buttons: await mainButtons(page) };
}
