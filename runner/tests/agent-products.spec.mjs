import { createHash } from "node:crypto";
import { agentCall, deleteAgentKey, findListed, makeAgentKey, refusal } from "../support/agent-api.mjs";
import { closeShopper, expect, shopperPage, test } from "../support/browser.mjs";
import { catalogCategory } from "../support/catalog.mjs";
import { config } from "../support/env.mjs";
import { firstLine } from "../support/errors.mjs";
import { note, record } from "../support/proof.mjs";
import { openShopperPage } from "../support/shopper.mjs";
import { notePlugins, openAdmin } from "../support/store-admin.mjs";
import { journey, step } from "../support/steps.mjs";
import { after, catchUp, places, storeHides, storeShows } from "../support/store-check.mjs";
import { dollars } from "../support/storefront-text.mjs";

// What Commerce's catalog API says when a change comes from a preview the product has since moved past.
const STALE_PREVIEW = "The product changed since that preview";

/** This run's names, unique to the second and plainly the live test's. */
function runNames() {
  const stamp = new Date().toISOString().replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d).*$/, "$1$2-$3$4$5");
  return { stamp, product: `Live agent product ${stamp}`, sku: `LIVE-AGENT-${stamp}`, slug: `live-agent-product-${stamp}` };
}

/** Where an agent reaches the store: Commerce's catalog API beside its orders API, and EmDash's content and schema APIs. */
function storeApis() {
  const orders = config.ordersAdmin.replace("/_emdash/admin/plugins/", "/_emdash/api/plugins/");
  if (orders === config.ordersAdmin || !orders.endsWith("/orders")) {
    throw new Error("DINKUS_E2E_ORDERS_ADMIN isn't Commerce's Orders page in the store admin, so the test can't tell where Commerce's catalog API is.");
  }
  return {
    catalog: orders.replace(/\/orders$/, "/catalog"),
    products: `${config.store}/_emdash/api/content/products`,
    categories: `${config.store}/_emdash/api/content/categories`,
    fields: `${config.store}/_emdash/api/schema/collections/products/fields`,
  };
}

/** What the store answers the agent; a refusal fails with its reason. */
async function agentAsk(page, agent, input, { url, method = "POST", what }) {
  const { response, answer } = await agentCall(page, agent, input, { url, method, what });
  if (!response.ok || answer?.success !== true) throw new Error(`${what} refused the agent (${refusal(response, answer)}).`);
  return answer.data;
}

/** One `op` to Commerce's catalog API as the agent. */
const catalog = (page, agent, input) => agentAsk(page, agent, input, { url: agent.apis.catalog, what: `Commerce's catalog API ("${input.op}")` });

/** The product as Commerce's catalog API shows it, with the code a preview prints for it: the first 12 hex digits of SHA-256 over that answer. */
async function preview(page, agent) {
  const shown = await catalog(page, agent, { op: "get", catalogItemId: agent.productId });
  return { shown, expected: createHash("sha256").update(JSON.stringify(shown)).digest("hex").slice(0, 12) };
}

/** Waits for Commerce to say the product is on sale (or off it), as the store's publish check tells it. */
async function onSale(page, agent, want) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const { shown } = await preview(page, agent);
    const selling = !shown.product?.offSale && !shown.product?.archivedAt;
    if (selling === want || Date.now() > deadline) return selling;
    await page.waitForTimeout(3_000);
  }
}

// An agent manages a product the way any agent can, with an EmDash key and nothing else: it makes a
// Draft product and its page through Commerce's catalog API and EmDash's content API, the page in a
// category the store's other products are in (Full catalog's tees, when the store has them), publishes the
// page, changes the price from a preview, sees Commerce refuse a change made from an old preview, and
// archives the product, with the store following each change. It tidies up after itself.
test("An agent manages a product", { tag: "@next" }, journey(async ({ page }) => {
  expect(config.store, `Set DINKUS_E2E_STORE to the store's address (in ${config.settingsFile})`).not.toBe("");
  const run = runNames();
  const shopper = await shopperPage();
  // What the store should show, and what this run made, so the last steps can take it all off the store.
  // `shared` says the page went in a category other products are in, which stays on the store.
  const state = { id: "", name: run.product, cents: 1200, productPath: "", categoryPath: "", hasPhoto: false, photoHash: "", shared: false, beside: 0 };
  const made = { product: "", entry: "", archived: false };
  const soft = { soft: true };
  let agent;
  try {
    await step(page, "The owner opens Content > Products", async () => {
      await openAdmin(page, `${config.store}/_emdash/admin/content/products`);
      await notePlugins(page);
      return "the owner is signed in to the store admin, which the test needs to make the agent's key";
    });

    // Without a key the agent can do nothing, so this step stops the journey.
    await step(page, "The test makes a one-hour key for the agent", async () => {
      const apis = storeApis();
      agent = { ...await makeAgentKey(page, `Live test agent ${run.stamp}`), apis, api: apis.catalog };
      note("agent's key", `"${agent.name}", stops working at ${agent.expiresAt}`);
      return `EmDash made the admin key "${agent.name}", which stops working at ${agent.expiresAt.slice(11, 16)} UTC`;
    });

    // Nothing after this can run without the product and its page, so this step stops the journey too.
    await step(page, "An agent makes a Draft product and its page through the store's APIs", async () => {
      // The agent asks the store what a product page needs, as any agent would.
      const { items } = await agentAsk(page, agent, undefined, { url: agent.apis.fields, method: "GET", what: "EmDash's schema API" });
      const required = items.filter(field => field.required).map(field => field.slug);
      const data = { title: run.product, description: "Made by the live test's agent through the store's APIs." };
      // A store set up before the template sold anything still asks for placeholder art.
      if (required.includes("visual_label")) {
        data.visual_label = "TEE";
        note("placeholder art", "the store's Products still require visual_label, so the agent sent TEE");
      }
      const unknown = required.filter(slug => !(slug in data) && slug !== "commerce_item_id");
      if (unknown.length) throw new Error(`The store's product pages require ${unknown.join(", ")}, which the agent doesn't know how to fill.`);
      // A shop files a new product beside the ones like it, so the agent looks for the catalog's tees.
      const shared = catalogCategory("TEE");
      const category = await findListed(cursor => {
        const url = new URL(agent.apis.categories);
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("cursor", cursor);
        return agentAsk(page, agent, undefined, { url: url.href, method: "GET", what: "EmDash's content API (categories)" });
      }, item => item?.data?.title === shared && item.liveRevisionId);
      if (!category) note("category", `the store has no published "${shared}" (Full catalog adds it), so the agent's page goes in no category`);

      const { catalogItemId } = await catalog(page, agent, { op: "create", commandId: `live-agent-${run.stamp}`, name: run.product, sku: run.sku });
      if (!catalogItemId) throw new Error("Commerce's catalog API made a product but named no catalogItemId.");
      made.product = agent.productId = state.id = catalogItemId;
      note("agent's product", catalogItemId);

      // The store's publish check reads the page's own Commerce product field, so the page carries it from the start.
      // A product page names its categories through EmDash's references, not its data.
      const references = category ? { references: { categories: [category.id] } } : {};
      const { item } = await agentAsk(page, agent, { data: { ...data, commerce_item_id: catalogItemId }, slug: run.slug, ...references }, { url: agent.apis.products, what: "EmDash's content API" });
      if (!item?.id) throw new Error("EmDash's content API saved the page but named no entry id.");
      made.entry = item.id;
      if (item.slug !== run.slug) throw new Error(`EmDash saved the page at slug "${item.slug}" instead of "${run.slug}".`);
      state.productPath = `/products/${run.slug}`;
      if (category) Object.assign(state, { categoryPath: `/categories/${category.slug}`, shared: true });
      // The link is what the page's Dinkus Commerce panel shows.
      await catalog(page, agent, { op: "link", catalogItemId, entryId: item.id });

      const prices = await catalog(page, agent, { op: "prices", catalogItemId, regular: "12.00", sale: "", stockStatus: "in-stock" });
      if (prices?.saved !== true) throw new Error(`Commerce didn't save the price: "${prices?.message ?? "no reason given"}".`);
      const weight = await catalog(page, agent, { op: "weight", catalogItemId, weightOz: "8" });
      if (weight?.changed !== true) throw new Error("Commerce didn't save the weight.");

      const { shown } = await preview(page, agent);
      const problems = [
        ...shown.product?.name === run.product ? [] : [`it's named "${shown.product?.name ?? "nothing"}" instead of "${run.product}"`],
        ...shown.product?.sku === run.sku ? [] : [`its SKU is ${shown.product?.sku ?? "none"} instead of ${run.sku}`],
        ...shown.product?.offSale === true ? [] : ["it isn't a Draft"],
      ];
      if (problems.length) throw new Error(`Commerce's catalog API shows the new product, but ${problems.join("; ")}.`);
      return `Commerce made Draft ${catalogItemId} (SKU ${run.sku}) at $12.00 and 8 oz; EmDash saved its unpublished page ${made.entry} for ${state.productPath}${category ? ` in "${shared}" at ${state.categoryPath}` : ""}`;
    });

    await step(shopper, "A Draft product stays off the store", async () => {
      // A store that keeps every page behind Cloudflare Access gets a one-time PIN sign-in first.
      await openShopperPage(shopper, "/");
      const { problems, seconds } = await storeHides(shopper, state);
      if (problems.length) throw new Error(`While the page is unpublished, ${problems.join("; ")}${after(seconds)}.`);
      return `${places(state)} don't offer it while its page is unpublished`;
    }, soft);

    // Publishing is what puts a Draft on sale: the store's publish check tells Commerce.
    await step(shopper, "Publishing the page through EmDash's API puts the product on sale", async () => {
      await agentAsk(page, agent, undefined, { url: `${agent.apis.products}/${encodeURIComponent(made.entry)}/publish`, what: "EmDash's content API (publish)" });
      const problems = await onSale(page, agent, true) ? [] : ["Commerce still has the product off sale 30 s after the page was published"];
      const { problems: storeProblems, seconds } = await storeShows(shopper, state);
      problems.push(...storeProblems);
      if (problems.length) throw new Error(`${problems.join("; ")}${after(seconds)}.`);
      const beside = state.shared ? `; ${state.categoryPath} lists it beside ${state.beside} other product${state.beside === 1 ? "" : "s"}` : "";
      return `Commerce has it on sale; ${places(state)} show "${state.name}" at ${dollars(state.cents)} with Add to cart${beside}${after(seconds)}`;
    }, soft);

    let old;
    await step(shopper, "A price the agent changes from a preview shows on the store", async () => {
      old = await preview(page, agent);
      const saved = await catalog(page, agent, { op: "prices", catalogItemId: made.product, regular: "13.50", sale: "", expected: old.expected });
      if (saved?.saved !== true) throw new Error(`Commerce didn't save the new price: "${saved?.message ?? "no reason given"}".`);
      state.cents = 1350;
      const { problems, seconds } = await storeShows(shopper, state);
      if (problems.length) throw new Error(`${problems.join("; ")}${after(seconds)}.`);
      return `$13.50, confirmed with preview code ${old.expected}, on ${places(state)}${after(seconds)}`;
    }, soft);

    const staleStep = "Commerce refuses a change made from an old preview";
    if (!old) record(staleStep, "SKIP", "the agent made no preview the product has since moved past");
    else await step(page, staleStep, async () => {
      const before = await preview(page, agent);
      if (before.expected === old.expected) throw new Error("The product reads as it did before the price change, so an old preview can't be tried.");
      const { response, answer } = await agentCall(page, agent, { op: "prices", catalogItemId: made.product, regular: "9.99", sale: "", expected: old.expected },
        { url: agent.apis.catalog, what: "Commerce's catalog API (\"prices\")" });
      const reason = String(answer?.error?.message ?? "");
      if (response.ok || !reason.includes(STALE_PREVIEW)) throw new Error(`Sent with the old preview's code, Commerce answered ${refusal(response, answer)} instead of "${STALE_PREVIEW}".`);
      const now = await preview(page, agent);
      if (now.expected !== before.expected) throw new Error(`Commerce refused the change, but the product changed anyway (preview code ${before.expected} became ${now.expected}).`);
      return `HTTP ${response.status}, "${reason.slice(reason.indexOf(STALE_PREVIEW), 200)}"; the product still reads as preview ${now.expected}, at $13.50`;
    }, soft);

    await step(shopper, "Archiving the product through the API takes it off the store", async () => {
      const { expected } = await preview(page, agent);
      const archived = await catalog(page, agent, { op: "archive", catalogItemId: made.product, archived: true, expected });
      if (archived?.changed !== true) throw new Error("Commerce answered that archiving changed nothing.");
      made.archived = true;
      const { problems, seconds } = await storeHides(shopper, state, { archived: true });
      if (problems.length) throw new Error(`Archived through the API, but ${problems.join("; ")}${after(seconds)}.`);
      return `gone from the Shop list${state.categoryPath ? ` and ${state.categoryPath}` : ""}, and ${state.productPath} says it's no longer available (HTTP 404)${after(seconds)}`;
    }, soft);
  } finally {
    // Whatever this run added comes off the store again, even when a step above stopped the journey.
    if (agent && (made.product || made.entry)) await step(shopper, "The test takes its product and page off the store", async () => {
      const problems = [];
      if (made.product && !made.archived) {
        await catalog(page, agent, { op: "archive", catalogItemId: made.product, archived: true })
          .then(() => { made.archived = true; }, error => problems.push(`archiving ${made.product} failed, so look for SKU ${run.sku} under Commerce settings' Products: ${firstLine(error)}`));
      }
      // EmDash's DELETE moves the page to the Trash, where the owner can restore it.
      if (made.entry) {
        await agentAsk(page, agent, undefined, { url: `${agent.apis.products}/${encodeURIComponent(made.entry)}`, method: "DELETE", what: "EmDash's content API (delete)" })
          .catch(error => problems.push(`moving the page "${run.product}" to the Trash failed: ${firstLine(error)}`));
      }
      if (await openShopperPage(shopper, "/").then(() => true, error => { problems.push(`the test couldn't open the store as a shopper to check it: ${firstLine(error)}`); return false; })) {
        problems.push(...(await storeHides(shopper, state)).problems);
        if (state.productPath) problems.push(...(await catchUp(shopper, state.productPath, response => response.status() === 200 ? [`${state.productPath} still answers HTTP 200`] : [])).problems);
      }
      if (problems.length) throw new Error(`${problems.join("; ")}.`);
      return `archived ${made.product || "no product"}${made.entry ? " and moved its page to EmDash's Trash" : ""}; the store shows neither`;
    }, soft);
    if (agent) await step(page, "The test deletes the agent's key", () => deleteAgentKey(page, agent, () => agentCall(page, agent, { op: "list" }, { url: agent.apis.catalog, what: "Commerce's catalog API" })), soft);
    await closeShopper(shopper);
  }
}));
