import { COMMERCE_CONNECT, mainButtons, mainText, readConnect } from "./plugin-connect.mjs";
import { pluginSettingsPath } from "./ship-settings.mjs";

// Commerce's settings form is EmDash's auto-generated one (admin.settingsSchema in
// dinkuskit/commerce emdash-plugin.jsonc), not the plugin's own Commerce Settings page.
// Labels and descriptions are that schema: both are pasted from the Set up Commerce box.
// From Commerce's Connect release the form holds only CONNECTION, which Connect on the plugin's own
// Commerce Settings page fills, and Commerce gets its checkout settings from DinkusKit.com itself.

export const CHECKOUT_SETTINGS = {
  label: "Checkout settings",
  description: "Paste from the Set up Commerce box on DinkusKit.com. Empty or switched off keeps checkout unavailable.",
};

export const STORE_KEY = {
  label: "Store key",
  description: "Paste from the Set up Commerce box on DinkusKit.com. Commerce trades it there for short passes to Payments and Ship; Replace key on DinkusKit.com stops this one.",
};

export const CONNECTION = {
  label: "DinkusKit connection",
  description: "Encrypted Store ID and this plugin's own DinkusKit store key. Managed by Connect on Commerce Settings; don't change it here.",
};

// What Commerce Settings says after Get checkout settings, or after Connect, when it got them.
export const SETTINGS_UP_TO_DATE = "Checkout settings are up to date";
// Its reason when DinkusKit.com no longer knows Commerce's key; Connect again gets a new one.
export const KEY_UNKNOWN = "DinkusKit.com no longer knows this store key. Press Connect again.";

/** Commerce's own Settings page in the store admin (a plugin page, not the settings form). */
export const commercePagePath = id => `/_emdash/admin/plugins/${encodeURIComponent(id)}/settings`;

// The release listing and the beta listing are the same plugin. A store runs one of them.
const COMMERCE_SLUG = /^dinkus-commerce(-beta)?$/;

/**
 * The Commerce plugin whose Settings control Plugins shows, from EmDash's plugin list
 * (GET /_emdash/api/admin/plugins). Anything else is an error and no path: the journey
 * stops instead of opening another plugin, switching Commerce on, or installing it.
 * The list names plugins, versions and ids, never a store key.
 */
export function commerceSettings(list) {
  const items = list?.data?.items;
  if (!Array.isArray(items)) return { error: "The store's plugin list couldn't be read." };
  const matches = items.filter(item => COMMERCE_SLUG.test(item?.registrySlug ?? ""));
  if (!matches.length) return { error: "The store doesn't run Commerce (dinkus-commerce or dinkus-commerce-beta)." };
  if (matches.length > 1) {
    return { error: `The store runs more than one Commerce plugin (${matches.map(item => item.registrySlug).join(", ")}).` };
  }
  const plugin = matches[0];
  const slug = plugin.registrySlug;
  const version = typeof plugin.version === "string" ? plugin.version : "(no version)";
  const named = `${slug} ${version}`;
  if (plugin.enabled === false) {
    return { error: `Commerce (${named}) is switched off, so Plugins doesn't show Settings for it. The test doesn't switch it on.` };
  }
  if (plugin.hasSettings !== true) return { error: `Commerce (${named}) has no settings form on Plugins.` };
  if (typeof plugin.id !== "string" || plugin.id === "") return { error: `Commerce (${named}) is listed without an id, so its settings page can't be opened.` };
  if (typeof plugin.name !== "string" || plugin.name === "") return { error: `Commerce (${named}) is listed without a name, so its card can't be picked out on Plugins.` };
  return { id: plugin.id, name: plugin.name, slug, version, path: pluginSettingsPath(plugin.id), page: commercePagePath(plugin.id) };
}

/**
 * Opens Commerce Settings and waits for it to draw, and says whether it has the DinkusKit section, which
 * only Commerce's Connect release shows. Its Catalog heading is on every release.
 */
export async function openCommercePage(page, url) {
  const { openAdmin } = await import("./store-admin.mjs");
  await openAdmin(page, url);
  const dinkus = page.getByRole("heading", { name: COMMERCE_CONNECT.section, exact: true });
  const catalog = page.getByRole("heading", { name: "Catalog", exact: true });
  const failed = page.getByRole("heading", { name: "Plugin Error", exact: true });
  await dinkus.or(catalog).or(failed).first().waitFor({ timeout: 60_000 });
  if (await failed.isVisible()) throw new Error("Commerce Settings didn't open: it shows Plugin Error.");
  return await dinkus.count() > 0;
}

/** Commerce Settings' DinkusKit section as { reading, buttons }. */
export async function readCommercePage(page) {
  return { reading: readConnect(await mainText(page, "Commerce"), COMMERCE_CONNECT), buttons: await mainButtons(page) };
}
