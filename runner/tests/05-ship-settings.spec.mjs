import { expect, test } from "../support/browser.mjs";
import { config } from "../support/env.mjs";
import { SHIP_CONNECT, connectPlugin } from "../support/plugin-connect.mjs";
import { note } from "../support/proof.mjs";
import {
  CONNECTION, SHIP_PLUGIN_NAME, STORE_ID_LABEL, STORE_KEY_LABEL, openShippingPage, pluginIdFromSettingsUrl, pluginSettingsPath, readShippingPage,
  shippingDrawn, storeIdProblem,
} from "../support/ship-settings.mjs";
import { shippingAdmin } from "../support/shipping-admin.mjs";
import { openAdmin } from "../support/store-admin.mjs";
import { BETA_STORE } from "../support/store-updates.mjs";
import { journey, step } from "../support/steps.mjs";

// EmDash draws this form from admin.settingsSchema (packages/admin/src/components/PluginSettings.tsx).
// Plugins lists an enabled plugin's Settings link to /plugins-manager/$pluginId/settings
// (PluginManager.tsx). The secret field is a password input whose value stays empty. This journey
// never types, saves, or clears a setting, and it never buys a label. It leaves a blank page for
// Playwright's failure notes, as Commerce settings does.
// From Ship's Connect release the form holds only the DinkusKit connection, and the Shipping page is where
// Ship connects: Connect, then Approve ship at DinkusKit.com, only on the beta store and only when Ship
// isn't connected. Commerce connects first, earlier in the run.
test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => {});
});

test("Ship settings", { tag: "@running" }, journey(async ({ page }) => {
  expect(config.store, `Set DINKUS_E2E_STORE to the store's address (in ${config.settingsFile})`).not.toBe("");
  expect(config.siteId, `Set DINKUS_E2E_SITE_ID to the store's DinkusKit site id (in ${config.settingsFile})`).not.toBe("");
  const soft = { soft: true };
  let connectRelease = false;

  // Without the form there is nothing to read, so this step stops the journey.
  await step(page, "The owner opens Ship settings from Plugins", async () => {
    try {
      await openAdmin(page, `${config.store}/_emdash/admin/plugins-manager`);
      const ship = page.getByRole("heading", { level: 3, name: SHIP_PLUGIN_NAME });
      const empty = page.getByRole("heading", { name: "No plugins configured", exact: true });
      const failed = page.getByText(/^Failed to load plugins/);
      await ship.or(empty).or(failed).first().waitFor({ timeout: 30_000 }).catch(() => {});
      if (await failed.count()) throw new Error("Plugins did not load. The test does not install or change anything.");
      if (await empty.count() && !await ship.count()) throw new Error("Plugins has no plugins, so Ship's settings are not there.");
      const shipCount = await ship.count();
      if (shipCount !== 1) {
        throw new Error(shipCount
          ? `Plugins lists ${shipCount} Ship plugins; the test will not pick one.`
          : "Plugins has no Ship or Ship Beta plugin. The test does not install one.");
      }
      const opened = await shipSettingsLink(page);
      if (!opened) {
        throw new Error("Ship is listed, but no Settings control opens /_emdash/admin/plugins-manager/<plugin>/settings. The test does not enable the plugin or change its settings.");
      }
      const shipName = (await ship.innerText()).trim();
      await opened.link.click();
      await page.locator("#plugin-settings-form").waitFor({ timeout: 30_000 });
      await page.getByRole("heading", { name: `${shipName} Settings`, exact: true }).waitFor();
      const pluginId = pluginIdFromSettingsUrl(page.url(), config.store);
      if (pluginId !== opened.pluginId) throw new Error("Ship's Settings control opened a different page than its own settings form.");
      // The form's fields can draw after its heading. Ship's Connect release has only the DinkusKit connection.
      const form = page.locator("#plugin-settings-form");
      const storeId = form.getByLabel(STORE_ID_LABEL, { exact: true });
      const connection = form.getByLabel(CONNECTION.label, { exact: true });
      await storeId.or(connection).first().waitFor({ timeout: 30_000 }).catch(() => {});
      connectRelease = !await storeId.count() && await connection.count() === 1;
      note("ship settings plugin", pluginId);
      return pluginSettingsPath(pluginId);
    } finally {
      await blankPasswordFields(page);
    }
  });

  if (connectRelease) {
    await shipConnect(page);
    return;
  }

  await step(page, "Store ID is the site id Commerce uses", async () => {
    try {
      const field = page.getByLabel(STORE_ID_LABEL, { exact: true });
      if ((await field.count()) !== 1) throw new Error(`Ship settings has no single ${STORE_ID_LABEL} field.`);
      const problem = storeIdProblem(await field.inputValue(), config.siteId);
      if (problem) {
        await field.evaluate(input => { input.value = ""; });
        throw new Error(problem);
      }
      return "Store ID is the site id Commerce uses";
    } finally {
      await blankPasswordFields(page);
    }
  }, soft);

  await step(page, "Store key is a visible empty field", async () => {
    try {
      const field = page.getByLabel(STORE_KEY_LABEL, { exact: true });
      if ((await field.count()) !== 1) throw new Error(`Ship settings has no single ${STORE_KEY_LABEL} field.`);
      if (!await field.isVisible()) throw new Error("Store key field is not visible.");
      // The value stays in the page. Only a yes/no comes back, so the proof never receives the key.
      const emptyPassword = await field.evaluate(input =>
        input instanceof HTMLInputElement && input.type === "password" && input.value === "");
      if (!emptyPassword) throw new Error("Store key must be a visible empty password field. The test does not type, save, or record it.");
      return "Store key field is empty";
    } finally {
      await blankPasswordFields(page);
    }
  }, soft);
}));

/** Ship's Connect release: the settings form holds only the DinkusKit connection, and the Shipping page connects. */
async function shipConnect(page) {
  await step(page, "Ship settings holds only the DinkusKit connection", async () => {
    try {
      const form = page.locator("#plugin-settings-form");
      if (await form.getByLabel(STORE_KEY_LABEL, { exact: true }).count()) throw new Error("Ship settings still has a Store key field beside the DinkusKit connection.");
      // Only a yes/no comes back, so the proof never receives what the field holds.
      const emptyPassword = await form.getByLabel(CONNECTION.label, { exact: true }).evaluate(input =>
        input instanceof HTMLInputElement && input.type === "password" && input.value === "");
      if (!emptyPassword) throw new Error("The DinkusKit connection must be an empty password field. The test does not type, save, or record it.");
      if (!await form.getByText(CONNECTION.description, { exact: true }).isVisible()) throw new Error("The DinkusKit connection doesn't say Connect on the Shipping page manages it.");
      return "The form holds only the DinkusKit connection, empty and left alone. Store ID and Store key are gone.";
    } finally {
      await blankPasswordFields(page);
    }
  });

  await step(page, "The Shipping page is connected to this store", async () => {
    const url = await shippingAdmin(page);
    await openShippingPage(page, url);
    // Connect and Approve ship change which DinkusKit.com store Ship answers to.
    const result = await connectPlugin(page, {
      texts: SHIP_CONNECT,
      mayConnect: config.store === BETA_STORE.store && config.siteId === BETA_STORE.siteId,
      open: async () => { await openShippingPage(page, url); },
      read: shown => readShippingPage(shown, config.ship),
      landing: new URL(url).pathname,
      ready: shippingDrawn,
    });
    if (result.siteId !== config.siteId) throw new Error(`Ship is connected to DinkusKit.com store ${result.siteId}, not this store's ${config.siteId}.`);
    note("ship connect", result.connected ? "connected this run" : "already connected");
    return `Open Ship goes to this store's orders, store ${result.siteId}${result.connected ? ", after this run's Connect and Approve ship" : ""}.`;
  });
}

/** Ship's Settings link, when it points at EmDash's settings form. Null when Ship has no such link. */
async function shipSettingsLink(page) {
  const found = [];
  for (const link of await page.getByRole("link", { name: "Settings", exact: true }).all()) {
    const pluginId = pluginIdFromSettingsUrl(await link.getAttribute("href"), config.store);
    if (!pluginId) continue;
    const card = link.locator("xpath=ancestor::*[.//h3][1]");
    const named = card.getByRole("heading", { level: 3, name: SHIP_PLUGIN_NAME });
    if (await named.count() === 1) found.push({ link, pluginId });
  }
  if (found.length > 1) throw new Error(`Plugins has ${found.length} Ship settings links; the test will not pick one.`);
  return found[0] ?? null;
}

/** Clears password fields in the page, without an input event, so a screenshot cannot show a store key. */
async function blankPasswordFields(page) {
  await page.locator("input[type='password']").evaluateAll(inputs => {
    for (const input of inputs) input.value = "";
  }).catch(() => {});
}
