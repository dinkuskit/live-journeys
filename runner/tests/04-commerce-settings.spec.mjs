import { test, expect } from "../support/browser.mjs";
import {
  CHECKOUT_SETTINGS, CONNECTION, KEY_UNKNOWN, SETTINGS_UP_TO_DATE, STORE_KEY, commerceSettings, openCommercePage, readCommercePage,
} from "../support/commerce-settings.mjs";
import { config } from "../support/env.mjs";
import { COMMERCE_CONNECT, connectPlugin, pressButton, recordPresses } from "../support/plugin-connect.mjs";
import { note } from "../support/proof.mjs";
import { notePlugins, openAdmin } from "../support/store-admin.mjs";
import { BETA_STORE } from "../support/store-updates.mjs";
import { journey, mayRunTwice, step } from "../support/steps.mjs";

// Checkout settings is pasted setup text, and the Store key is write-only. This journey never types,
// clears or saves either field, nor the DinkusKit connection that takes their place from Commerce's
// Connect release. Playwright's failure notes include the open page. Leave a blank one, as the label
// journey does.
test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => {});
});

const settingsWrite = (request, id) => {
  if (request.method() === "GET" || request.method() === "HEAD") return false;
  let path;
  try { path = decodeURIComponent(new URL(request.url()).pathname); } catch { return false; }
  return path === `/_emdash/api/admin/plugins/${id}/settings`;
};

/** Empties the form's fields in the page only, so a screenshot can't keep a pasted value. Nothing is saved. */
async function blankFields(page) {
  await page.locator("#plugin-settings-form").locator("input, textarea").evaluateAll(fields => {
    for (const field of fields) field.value = "";
  });
}

/**
 * Presses Get checkout settings and waits for Commerce's answer: null once it says the checkout settings
 * are up to date, or the reason it shows under "Checkout settings not updated".
 */
async function getCheckoutSettings(page) {
  const button = page.locator("main").getByRole("button", { name: "Get checkout settings", exact: true });
  if (await button.count() !== 1) throw new Error("Commerce Settings doesn't offer one Get checkout settings button.");
  const done = page.getByText(SETTINGS_UP_TO_DATE, { exact: true }).first();
  const refused = page.locator("main").getByText("Checkout settings not updated", { exact: true }).first();
  // The answer is a toast, which goes away again, so the wait starts before the press.
  const answered = done.or(refused).waitFor({ timeout: 60_000 }).then(() => true, () => false);
  await button.click();
  if (!await answered) throw new Error("Commerce Settings gave no answer to Get checkout settings within a minute.");
  if (await done.isVisible()) return null;
  return (await readCommercePage(page)).reading.notUpdated || "no reason shown";
}

// The owner opens Commerce's settings from Plugins. Before Commerce's Connect release the Store key field
// is shown empty and left alone. From that release the form keeps only the DinkusKit connection, and the
// owner connects Commerce on its own Settings page: Connect, then Approve commerce at DinkusKit.com, only
// on the beta store and only when Commerce isn't connected. Then, on the beta store only, Get checkout
// settings. DinkusKit.com gives them only once Payments is connected, so this journey runs after Payments
// status. Before any of that, the same Connect runs as it would on any other store, and must press nothing.

// Places no order and pays nothing, so a failed try gets one retry in the same run.
mayRunTwice();

test("Commerce settings", { tag: "@running" }, journey(async ({ page }) => {
  expect(config.store, `Set DINKUS_E2E_STORE to the store's address (in ${config.settingsFile})`).not.toBe("");
  let plugin;
  let connectRelease = false;

  await step(page, "The owner can open Plugins", async () => {
    await openAdmin(page, `${config.store}/_emdash/admin/plugins-manager`);
    const found = commerceSettings(await notePlugins(page));
    if (found.error) throw new Error(found.error);
    plugin = found;
    note("commerce settings plugin", `${plugin.slug} ${plugin.version}`);
    return `${plugin.slug} ${plugin.version} is on, with settings`;
  });

  await step(page, "Commerce settings opens from Plugins", async () => {
    const writes = [];
    const onRequest = request => { if (settingsWrite(request, plugin.id)) writes.push(request.method()); };
    page.on("request", onRequest);
    try {
      // PluginManager renders this gear only when the plugin is on and has settings. Its href is
      // /plugins-manager/$pluginId/settings. The card is the plugin's own heading plus that link.
      const heading = page.getByRole("heading", { level: 3, name: plugin.name, exact: true });
      // Plugins renders its cards after the page loads, so wait for them (or its empty or failed
      // notice) before counting, as Ship settings does.
      const empty = page.getByRole("heading", { name: "No plugins configured", exact: true });
      const failed = page.getByText(/^Failed to load plugins/);
      await heading.or(empty).or(failed).first().waitFor({ timeout: 30_000 }).catch(() => {});
      if (await failed.count()) throw new Error("Plugins did not load. The test does not install or change anything.");
      const cards = await heading.count();
      if (cards !== 1) throw new Error(`Plugins shows ${cards} cards named "${plugin.name}", not one.`);
      const row = page.locator("div").filter({ has: heading }).filter({ has: page.getByRole("link", { name: "Settings", exact: true }) }).last();
      const gear = row.getByRole("link", { name: "Settings", exact: true });
      if (await gear.count() !== 1) throw new Error("Plugins doesn't show Commerce's Settings control.");
      const href = decodeURIComponent(await gear.getAttribute("href") ?? "");
      if (!href.includes(`/plugins-manager/${plugin.id}/settings`)) throw new Error("Commerce's Settings control doesn't open its settings page.");
      await gear.click();
      const form = page.locator("#plugin-settings-form");
      await form.waitFor({ timeout: 30_000 });
      const storeKey = form.getByLabel(STORE_KEY.label);
      const connection = form.getByLabel(CONNECTION.label);
      const headingName = `${plugin.name} Settings`;
      // The form's fields and heading can render after the form itself. A missing one is named below.
      await storeKey.or(connection).first().waitFor({ timeout: 30_000 }).catch(() => {});
      await page.getByRole("heading", { level: 1, name: headingName, exact: true }).waitFor({ timeout: 30_000 }).catch(() => {});
      const keyShown = await storeKey.count() === 1;
      connectRelease = !keyShown && await connection.count() === 1;
      const secret = keyShown ? storeKey : connection;
      const shown = keyShown || connectRelease;
      const keyType = shown ? await secret.getAttribute("type") : null;
      const keyEmpty = shown ? (await secret.inputValue()) === "" : false;
      const placeholder = shown ? await secret.getAttribute("placeholder") : null;
      // Blank before any later check can fail: the step's screenshot is this page.
      await blankFields(page);
      if (decodeURIComponent(new URL(page.url()).pathname) !== plugin.path) throw new Error("Commerce's Settings control didn't open its settings page.");
      if (writes.length) throw new Error("Commerce settings was written. The test does not save.");
      if (!shown) throw new Error("The form has neither a Store key field nor Commerce's DinkusKit connection.");
      const label = keyShown ? STORE_KEY.label : CONNECTION.label;
      if (keyType !== "password") throw new Error(`${label} is not a password field, so this step stopped before keeping it.`);
      if (!keyEmpty) throw new Error(`The ${label} field was not empty. Nothing was typed or saved.`);
      if (placeholder?.includes("Will be cleared")) throw new Error(`${label} is marked to be cleared. The test doesn't change it.`);
      const checkout = form.getByLabel(CHECKOUT_SETTINGS.label);
      if (await page.getByRole("heading", { level: 1, name: headingName, exact: true }).count() !== 1) throw new Error(`The page isn't headed "${headingName}".`);
      if (await page.getByRole("button", { name: "Save Settings" }).count() < 1) throw new Error("Save Settings isn't on the form. Nothing was saved.");
      if (connectRelease) {
        if (await checkout.count()) throw new Error("The form still has Checkout settings beside the DinkusKit connection.");
        if (!await form.getByText(CONNECTION.description, { exact: true }).isVisible()) throw new Error("The DinkusKit connection doesn't say Connect on Commerce Settings manages it.");
        return "The form holds only the DinkusKit connection, empty and left alone. Checkout settings and Store key are gone.";
      }
      if (await checkout.count() !== 1) throw new Error("Checkout settings is not on the form.");
      if (await checkout.getAttribute("type") === "password") throw new Error("Checkout settings is a password field.");
      if (!await form.getByText(CHECKOUT_SETTINGS.description, { exact: true }).isVisible()) throw new Error("Checkout settings doesn't show its Set up Commerce description.");
      if (!await form.getByText(STORE_KEY.description, { exact: true }).isVisible()) throw new Error("Store key doesn't show its Set up Commerce description.");
      const stored = placeholder?.includes("Currently set") ? "A store key is already stored."
        : placeholder?.includes("Not set") ? "No store key is stored."
          : "The Store key field is empty.";
      return `Checkout settings is on the form. The Store key field is empty. ${stored}`;
    } finally {
      page.off("request", onRequest);
    }
  });

  if (!connectRelease) return;
  // Connect and Approve commerce change which DinkusKit.com store Commerce answers to.
  const mayConnect = config.store === BETA_STORE.store && config.siteId === BETA_STORE.siteId;
  const url = `${config.store}${plugin.page}`;
  const connect = (started, allowed = mayConnect) => connectPlugin(page, {
    texts: COMMERCE_CONNECT, started, mayConnect: allowed,
    open: async () => { await openCommercePage(page, url); },
    read: readCommercePage,
    landing: plugin.page,
    ready: consent => consent.getByRole("heading", { name: COMMERCE_CONNECT.section, exact: true }),
  });
  const thisStore = ({ siteId }) => {
    if (siteId !== config.siteId) throw new Error(`Commerce is connected to DinkusKit.com store ${siteId}, not this store's ${config.siteId || "(DINKUS_E2E_SITE_ID not set)"}.`);
  };

  // A run on any other store may not press Connect, Cancel or Approve, and skips Get checkout settings. The
  // same walk with that permission must leave the browser sending no press and no settings save.
  await step(page, "On any other store, Commerce Settings presses nothing", async () => {
    const { outcome, sent } = await recordPresses(page.context(), config, async () => {
      if (!await openCommercePage(page, url)) throw new Error("Commerce Settings has no DinkusKit section, though the settings form is Commerce's Connect release.");
      return connect(false, false).then(
        ({ siteId }) => `Commerce is already connected, to store ${siteId}, and Get checkout settings was left alone`,
        error => `The run stopped before pressing anything: ${error.message}`);
    });
    if (sent.length) throw new Error(`Without the beta store's permission, the browser still sent ${sent.join(", ")}.`);
    note("commerce on another store", outcome);
    return `${outcome}. Nothing was pressed or saved.`;
  });

  await step(page, "Commerce Settings shows Commerce connected to this store", async () => {
    if (!await openCommercePage(page, url)) throw new Error("Commerce Settings has no DinkusKit section, though the settings form is Commerce's Connect release.");
    const result = await connect(false);
    thisStore(result);
    note("commerce connect", result.connected ? "connected this run" : "already connected");
    return `Connected to DinkusKit.com, store ${result.siteId}${result.connected ? ", after this run's Connect and Approve commerce" : ". Connect again was left alone"}.`;
  });

  // Get checkout settings writes what DinkusKit.com sends into Commerce's settings.
  if (!mayConnect) return;
  await step(page, "Get checkout settings brings this store's checkout settings", async () => {
    // A fresh page, so a toast from Connect's own fetch can't pass for this press's answer.
    await openCommercePage(page, url);
    let refused = await getCheckoutSettings(page);
    if (refused === KEY_UNKNOWN) {
      // DinkusKit.com stopped this key (Disconnect on Your Stores); Connect again gets Commerce a new one.
      await pressButton(page, "Connect again", "Commerce");
      thisStore(await connect(true));
      await openCommercePage(page, url);
      refused = await getCheckoutSettings(page);
    }
    if (refused) throw new Error(`Commerce Settings says "Checkout settings not updated": ${refused}`);
    return SETTINGS_UP_TO_DATE;
  });
}));
