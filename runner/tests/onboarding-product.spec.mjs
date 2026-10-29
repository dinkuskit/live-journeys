import { createHash } from "node:crypto";
import { get, newPage, test, expect, shopperPage, closeShopper } from "../support/browser.mjs";
import { config } from "../support/env.mjs";
import { firstLine } from "../support/errors.mjs";
import { PAGE_ROOM, paceStore } from "../support/pace.mjs";
import {
  addCategory, addPriceAndStock, addProductPage, archive, choosePhoto, openPhotoPanel, openProductPanel, panelProduct, publishProductPage, publishedLink,
  setPrice, setWeight, trash, uploadPhoto,
} from "../support/products-admin.mjs";
import { openShopperPage } from "../support/shopper.mjs";
import { notePlugins, openAdmin } from "../support/store-admin.mjs";
import { journey, step } from "../support/steps.mjs";
import { photo, photoProblem, quick, readCard, text } from "../support/storefront-page.mjs";
import { dollars, money } from "../support/storefront-text.mjs";

// How long the store gets to show a change the owner just made. Same wait as Manage products.
const CATCH_UP_MS = 60_000;

/** This run's names, unique to the second. Not Manage products' "Live test" names, so this run never opens those. */
function runNames() {
  const stamp = new Date().toISOString().replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d).*$/, "$1$2-$3$4$5");
  return {
    product: `Onboarding product ${stamp}`,
    sku: `ONBOARD-${stamp}`,
    category: `Onboarding category ${stamp}`,
    photo: `onboarding-${stamp}.png`,
  };
}

/**
 * A fingerprint of the image file at `src`, fetched with `page`'s sign-ins, or "" when it can't be
 * fetched. Commerce's admin and the store address the same Media library file differently, so the
 * test compares the files themselves.
 */
async function imageHash(page, src) {
  if (!src) return "";
  const response = await get(page, new URL(src, config.store).href).catch(() => null);
  return response?.ok() ? createHash("sha256").update(await response.body()).digest("hex") : "";
}

/**
 * Reloads a store page until `check` finds nothing wrong, giving the store a minute to show a change
 * the owner just made. Returns the last problems found (none once the page caught up) and the wait.
 */
async function catchUp(shopper, path, check) {
  const started = Date.now();
  for (;;) {
    // Each reload brings the page's photos again, so on a store with many products it waits its turn.
    await paceStore(PAGE_ROOM);
    const response = await shopper.goto(new URL(path, config.store).href).catch(error => error);
    const problems = response instanceof Error ? [`${path} didn't answer (${firstLine(response)})`]
      : new URL(shopper.url()).origin !== config.store ? [`${path} sent the shopper away from the store`]
        : await check(response);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (!problems.length || Date.now() - started > CATCH_UP_MS) return { problems, seconds };
    await shopper.waitForTimeout(3_000);
  }
}

/** This run's product among a page's product cards: by its Commerce ID, the page it links to, or its name. */
async function findCard(cards, { id, path, name }) {
  for (const card of await cards.all()) {
    if (id && (await card.getAttribute("data-commerce-product") === id || await card.locator(`img[data-commerce-image="${id}"]`).count())) return card;
    if (path && (await card.getAttribute("href") === path || await card.locator(`a[href="${path}"]`).count())) return card;
    if (!id && name && await text(card.locator("h2, h3, h4")) === name) return card;
  }
  return null;
}

const shopCards = page => page.locator("[data-commerce-catalog] [data-commerce-product]");

/**
 * Why the homepage's Shop list can't be read, or "" when it lists products or says it has none. A card
 * missing from a Shop list that couldn't have shown it proves nothing.
 */
async function unreadableShop(shopper) {
  const catalog = shopper.locator("[data-commerce-catalog]");
  if (!await catalog.count()) return "the homepage has no Shop list";
  if (await catalog.locator("[data-commerce-product], [data-commerce-empty]").count()) return "";
  const said = await text(catalog.locator('[role="alert"]'));
  return said ? `the Shop list says "${said}"` : "the Shop list shows neither products nor that it has none";
}
const categoryCards = page => page.locator("main").locator("[data-commerce-product], [data-merch-item]");

/**
 * What's wrong with the photo a product card or page shows, given what `photo` made of it: it must be
 * the photo the owner chose, the file with fingerprint `hash`.
 */
async function photoProblems(media, where, image, hash) {
  if (image !== "photo") return [`${where} ${photoProblem[image]}`];
  const src = await media.locator("img[data-commerce-image]").first().getAttribute("src");
  return await imageHash(media.page(), src) === hash ? [] : [`${where} shows another photo (${new URL(src ?? "", config.store).pathname}) than the one the owner chose`];
}

/** What's wrong with how one product card shows this run's product. */
async function cardProblems(card, where, { name, cents, hasPhoto, photoHash, path }) {
  if (!card) return [`${where} doesn't list it`];
  const shown = await readCard(card, { withPhoto: hasPhoto });
  const problems = [];
  if (shown.name !== name) problems.push(`${where} names it "${shown.name || "nothing"}" instead of "${name}"`);
  if (money(shown.price) !== cents) problems.push(`${where} shows ${shown.price ? `"${shown.price}"` : "no price"} instead of ${dollars(cents)}`);
  if (hasPhoto) problems.push(...await photoProblems(card, where, shown.image, photoHash));
  if (path && shown.href !== path) problems.push(`${where} links to ${shown.href ?? "no product page"} instead of ${path}`);
  return problems;
}

/** What's wrong with how the product page shows this run's product. */
async function productPageProblems(shopper, response, { name, cents, hasPhoto, photoHash, categoryPath }) {
  if (response.status() !== 200) return [`the product page answered HTTP ${response.status()}`];
  const product = shopper.locator("[data-product-page]");
  if (!await product.count()) return ["the product page shows no product"];
  const problems = [];
  const heading = await text(product.locator("h1"));
  if (heading !== name) problems.push(`the product page's heading says "${heading || "nothing"}" instead of "${name}"`);
  const price = await text(product.locator("[data-product-price]"));
  if (money(price) !== cents) problems.push(`the product page shows ${price ? `"${price}"` : "no price"} instead of ${dollars(cents)}`);
  if (hasPhoto) {
    const visual = product.locator(".product-detail__visual");
    problems.push(...await photoProblems(visual, "the product page", await photo(visual), photoHash));
  }
  // Ready means wired to the cart and pressable; the journey never presses it.
  const add = shopper.locator('[data-add-to-cart][data-guest-cart-ready="1"]').first();
  if (!await add.waitFor({ timeout: 15_000 }).then(() => true, () => false)) problems.push("the product page has no working Add to cart button");
  else if (!await add.isEnabled()) problems.push("the product page's Add to cart button can't be pressed");
  if (categoryPath && !await shopper.locator(`.browse-breadcrumb a[href="${categoryPath}"]`).count()) problems.push(`the product page doesn't link to its category ${categoryPath}`);
  return problems;
}

/**
 * Everything wrong with how the store shows this run's product now (the Shop list, and its page and
 * category page once published), with the longest the store took to catch up.
 */
/** Waits up to 15 seconds for the page's Dinkus Commerce panel to show its product as `want`. */
async function panelSays(page, editor, want) {
  let shown;
  for (let tries = 0; tries < 4; tries++) {
    if (tries) await page.waitForTimeout(5_000);
    shown = await panelProduct(await openProductPanel(page, editor));
    if (shown.state === want) return;
  }
  throw new Error(`the page's Dinkus Commerce panel shows the product as ${shown.state === "none" ? "not a product yet" : shown.state} instead of ${want}`);
}

async function storeShows(shopper, state) {
  const { id, name, cents, hasPhoto, photoHash, productPath, categoryPath } = state;
  const checks = [await catchUp(shopper, "/", async response => {
    if (response.status() !== 200) return [`the homepage answered HTTP ${response.status()}`];
    const card = await findCard(shopCards(shopper), { id, name });
    const unreadable = card ? "" : await unreadableShop(shopper);
    if (unreadable) return [unreadable];
    // A product shown without its own ID still tells the journey which ID the Shop list gave it.
    if (card && !state.id) state.id = await card.getAttribute("data-commerce-product") ?? "";
    return cardProblems(card, "the Shop list", { name, cents, hasPhoto, photoHash, path: productPath });
  })];
  if (productPath) {
    checks.push(await catchUp(shopper, productPath, response => productPageProblems(shopper, response, state)));
    checks.push(await catchUp(shopper, categoryPath, async response => response.status() !== 200 ? [`${categoryPath} answered HTTP ${response.status()}`]
      : cardProblems(await findCard(categoryCards(shopper), { id, path: productPath }), `the category page ${categoryPath}`, { name, cents, hasPhoto, photoHash, path: productPath })));
  }
  return { problems: checks.flatMap(check => check.problems), seconds: Math.max(...checks.map(check => check.seconds)) };
}

/**
 * Everything that still offers this run's product to shoppers after the tidy. The product page must
 * stop offering a price and Add to cart. The category page, once trashed, may stop answering; while
 * it still answers it must not list the product.
 */
async function storeHides(shopper, { id, name, productPath, categoryPath }) {
  // A homepage that doesn't answer, or whose Shop list can't be read, shows no cards either, which proves nothing.
  const checks = [await catchUp(shopper, "/", async response => {
    if (response.status() !== 200) return [`the homepage answered HTTP ${response.status()}`];
    if (await findCard(shopCards(shopper), { id, name })) return ["the Shop list still lists it"];
    const unreadable = await unreadableShop(shopper);
    return unreadable ? [unreadable] : [];
  })];
  if (productPath) {
    checks.push(await catchUp(shopper, productPath, async response => {
      const product = shopper.locator("[data-product-page]");
      const price = await text(product.locator("[data-product-price]"));
      const offers = [...money(price) !== null ? [`shows ${price}`] : [], ...await product.locator("[data-add-to-cart]").count() ? ["offers Add to cart"] : []];
      return offers.length ? [`${productPath} still ${offers.join(" and ")}`] : [];
    }));
    checks.push(await catchUp(shopper, categoryPath, async response => response.status() !== 200 ? []
      : await findCard(categoryCards(shopper), { id, path: productPath }) ? [`the category page ${categoryPath} still lists it`] : []));
  }
  return { problems: checks.flatMap(check => check.problems), seconds: Math.max(...checks.map(check => check.seconds)) };
}

const after = seconds => seconds ? ` after ${seconds} s` : "";
/**
 * A passing step's word on the photo: the store showed it, or the step didn't look for it, since none
 * was chosen or an earlier step found the store showing the product wrong.
 */
const withPhoto = state => state.hasPhoto ? " with its photo"
  : state.photoHash ? " (its photo not looked for, since an earlier store check failed)" : " (no photo to look for, since none was chosen)";

// Onboarding episode: one product with a category. The owner adds a product page in a new category,
// gives it its Commerce product with a price and a weight and a photo in the page's Dinkus Commerce
// panel, and publishes it, which puts it on sale. Manage products proves those controls and then
// renames, archives and restores; this journey stops once the store sells the product. The tidy at the
// end is how Manage products takes its own product off the store. Archive is not a step of this story.
test("One product with a category", { tag: "@running" }, journey(async ({ page }) => {
  expect(config.store, `Set DINKUS_E2E_STORE to the store's address (in ${config.settingsFile})`).not.toBe("");
  const run = runNames();
  // The product page's editor, with its panel, stays in the saved profile's page; Media and categories work in a second tab.
  const content = await newPage(page.context());
  const shopper = await shopperPage();
  // What the store should show, and what this run made, so the tidy can take it off the store.
  const state = { id: "", name: run.product, cents: 1200, productPath: "", categoryPath: "", archived: false, hasPhoto: false, photoHash: "" };
  // `product` is "asked" from the moment the panel may make it, and true once the page is saved with
  // it; the page and category keep their store addresses from just before each is saved and their
  // editor's once it opens. `lost` names an entry saved without the test learning where its editor is.
  const made = { product: false, page: "", category: "", pagePath: "", categoryPath: "", lost: [] };
  const soft = { soft: true };
  try {
    await step(page, "The owner adds a product page in a new category", async () => {
      await openAdmin(page, `${config.store}/_emdash/admin/content/products`);
      await notePlugins(page);
      await addCategory(content, run.category, made);
      await addProductPage(page, { title: run.product, style: "CAP", category: run.category }, made);
      return `saved "${run.product}" (unpublished) at ${made.pagePath} in the new category ${made.categoryPath}`;
    });

    await step(page, "The owner sets a price and a weight", async () => {
      const { panel, id } = await addPriceAndStock(page, run.sku, made);
      state.id = id;
      await setPrice(panel, "12.00");
      await setWeight(panel, 8);
      return `Add price and stock made "${run.product}" (SKU ${run.sku}) at $12.00, 8 oz; Commerce links the page to product ${id}`;
    });

    await step(content, "The owner gives the product a photo", async () => {
      await uploadPhoto(content, run.photo, run.product);
      let hash = "";
      const { panel, title } = await openPhotoPanel(page);
      // The picker shows each photo just above its Use button, so that picture is the file chosen.
      await choosePhoto(panel, run.photo, { beforeUse: async use => {
        hash = await imageHash(page, await use.locator("xpath=preceding::img[1]").getAttribute("src", quick).catch(() => null));
        if (!hash) throw new Error(`Commerce's image picker shows no picture the test could fetch above "Use ${run.photo}".`);
      } });
      Object.assign(state, { hasPhoto: true, photoHash: hash });
      return `uploaded ${run.photo} to the Media library and chose it in the product page's ${title} panel, which said "Image saved"`;
    }, soft);

    await step(shopper, "Publishing the page puts the product on sale", async () => {
      await openAdmin(page, made.page);
      await publishProductPage(page);
      Object.assign(state, { productPath: made.pagePath, categoryPath: made.categoryPath });
      const listed = await publishedLink(content, run.product);
      if (listed !== new URL(state.productPath, config.store).href) {
        throw new Error(listed === null ? `Published ${state.productPath}, but EmDash's list of product pages doesn't show it as Published with a View published link.`
          : `EmDash's list of product pages links "${run.product}" to ${listed} instead of ${state.productPath}.`);
      }
      // The panel says whether the publish put the product on sale, so a store that doesn't show it says why.
      const problems = await panelSays(page, made.page, "on sale").then(() => [], error => [`after publishing, ${firstLine(error)}`]);
      // A store that keeps every page behind Cloudflare Access gets a one-time PIN sign-in first.
      await openShopperPage(shopper, "/");
      const { problems: storeProblems, seconds } = await storeShows(shopper, state);
      problems.push(...storeProblems);
      if (problems.length) throw new Error(`${problems.join("; ")}${after(seconds)}.`);
      return `the panel says On sale; the Shop card links to ${state.productPath}, which shows "${state.name}" at ${dollars(state.cents)}${withPhoto(state)} and Add to cart; ${state.categoryPath} lists it${after(seconds)}`;
    }, soft);
  } finally {
    // Whatever this run added comes off the store again, even when a step above stopped the journey.
    // Archive here is the tidy Manage products already does. It is not a filmed step.
    if (made.product || made.page || made.category || made.lost.length) await step(shopper, "The test takes its product, page and category off the store", async () => {
      const problems = [];
      if (made.product && made.page) {
        // The panel says what the product is now, whatever this run's notes say.
        const panel = await openProductPanel(page, made.page).catch(error => { problems.push(`opening "${run.product}"'s Dinkus Commerce panel failed, so its product may still be on the store: ${firstLine(error)}`); });
        const shown = panel ? await panelProduct(panel) : null;
        if (shown?.state === "draft" || shown?.state === "on sale") {
          await archive(panel).then(() => { state.archived = true; }, error => problems.push(`archiving "${shown.name}" in its panel failed: ${firstLine(error)}`));
        } else if (shown?.state === "archived") state.archived = true;
        else if (shown?.state === "none") problems.push(`Commerce may have made SKU ${run.sku} without the page keeping it; look for it under Commerce settings' Products without a page`);
        else if (shown) problems.push(`"${run.product}"'s panel shows its product as ${shown.state}`);
      }
      // Each finding names what's left, so the owner can take it off the store by hand.
      for (const [what, url, tab] of [[`product page "${run.product}"`, made.page, page], [`category "${run.category}"`, made.category, content]]) {
        if (url) await trash(tab, url).catch(error => problems.push(`moving the ${what} to the Trash failed: ${firstLine(error)}`));
      }
      for (const what of made.lost) problems.push(`the ${what} may have been saved without the test learning where, so look for it under Content in the store admin`);
      // A step that stopped the journey early can leave the shopper's browser not yet signed in to a store
      // that keeps every page behind Cloudflare Access, so it opens the store first.
      if (await openShopperPage(shopper, "/").then(() => true, error => { problems.push(`the test couldn't open the store as a shopper to check it: ${firstLine(error)}`); return false; })) {
        problems.push(...(await storeHides(shopper, { ...state, productPath: made.pagePath, categoryPath: made.categoryPath })).problems);
        // Every address the run saved stops answering within a minute, published or not.
        for (const path of [made.pagePath, made.categoryPath].filter(Boolean)) {
          problems.push(...(await catchUp(shopper, path, response => response.status() === 200 ? [`${path} still answers HTTP 200`] : [])).problems);
        }
      }
      if (problems.length) throw new Error(`${problems.join("; ")}.`);
      return `${state.archived ? `archived "${state.name}" in its panel` : "Commerce never made the product"}${made.page || made.category ? " and moved its page and category to EmDash's Trash" : ""}; the store shows none of them`;
    }, soft);
    await closeShopper(shopper);
    await content.close();
  }
}));
