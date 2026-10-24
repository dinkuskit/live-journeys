import { get, newPage, test, expect, shopperPage, closeShopper } from "../support/browser.mjs";
import { catalogPlan } from "../support/catalog.mjs";
import { config } from "../support/env.mjs";
import { firstLine, withoutQueries } from "../support/errors.mjs";
import {
  addCategory, addPriceAndStock, addProductPage, choosePhoto, finishProductPage, openPanel, openProductPanel, panelProduct, publish, publishProductPage,
  publishedLink, republishProductPage, restore, setPrice, setWeight, uploadPhotos,
} from "../support/products-admin.mjs";
import { PHOTO_ROOM, STORE_BUDGET, paceStore } from "../support/pace.mjs";
import { note } from "../support/proof.mjs";
import { openShopperPage } from "../support/shopper.mjs";
import { notePlugins, openAdmin } from "../support/store-admin.mjs";
import { pluginVersion, versionAtLeast } from "../support/store-plugins.mjs";
import { journey, step } from "../support/steps.mjs";
import { photo, photoProblem, quick, readCard, text } from "../support/storefront-page.mjs";
import { dollars, money } from "../support/storefront-text.mjs";

// An error's first line without its full stop, since findings are joined into one sentence.
const reason = error => firstLine(error).replace(/\.$/, "");
// The first Commerce whose products are kept in each product page's Dinkus Commerce panel; before it,
// Commerce had a Products page of its own, which this journey no longer drives.
const COMMERCE_WITH_PANEL = "0.6.0-beta.1";
const tooOld = (commerce, lacks) => new Error(`The catalog lacks ${lacks}, but this store runs Commerce ${commerce ?? "of a version the test couldn't read"}, which has no Dinkus Commerce panel on its product pages. It needs Commerce ${COMMERCE_WITH_PANEL} or later; nothing was added.`);
// Commerce's image picker lists twelve photos a page, so uploading that many at a time keeps each new photo on its first page.
const UPLOAD_BATCH = 12;
// The most store requests the owner's work sends, measured on a local store: the Media library shows
// its photos while a batch uploads, so a batch waits for the store's whole allowance; one product's
// page editor, panel and image picker photos send about 40.
const UPLOADS_ROOM = STORE_BUDGET;
const PRODUCT_ROOM = 50;

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
// Passing summaries name the first few products; a failure names every finding.
const short = (items, count = 5) => items.length > count ? [...items.slice(0, count), `${items.length - count} more`] : items;

/**
 * Every page in Content > Products, read as the owner's admin reads it from EmDash, a hundred at a
 * time: by title, each page's editor address, whether it's published and the Commerce product it
 * names. Trashed pages aren't listed.
 */
async function productPages(page) {
  const pages = new Map();
  let cursor = "";
  for (let reads = 0; reads < 50; reads++) {
    const url = new URL(`${config.store}/_emdash/api/content/products`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await get(page, url.href, { headers: { "X-EmDash-Request": "1" } });
    if (!response.ok()) throw new Error(`EmDash refused to list Content > Products (HTTP ${response.status()}).`);
    const { items = [], nextCursor = "" } = (await response.json())?.data ?? {};
    for (const item of items) {
      const title = typeof item?.data?.title === "string" ? item.data.title : "";
      const entry = { editor: `${config.store}/_emdash/admin/content/products/${item.id}`, published: Boolean(item.liveRevisionId),
        commerceId: typeof item?.data?.commerce_item_id === "string" ? item.data.commerce_item_id.trim() : "" };
      pages.set(title, [...pages.get(title) ?? [], entry]);
    }
    if (!nextCursor || !items.length) return pages;
    cursor = nextCursor;
  }
  throw new Error("Content > Products kept offering more pages after 5,000 product pages.");
}
const total = pages => [...pages.values()].reduce((sum, entries) => sum + entries.length, 0);

/**
 * The cards of a list page that name one of the catalog's products, read as a shopper sees them: name,
 * price, photo, the page each links to, and its photo's address. Several cards can name one product.
 */
async function catalogCards(cards, names) {
  const found = new Map();
  for (const card of await cards.all()) {
    const shown = await readCard(card, { withPhoto: false });
    if (!names.has(shown.name)) continue;
    // Only the catalog's cards get their photos read, sparing the wait on other products' photos.
    await paceStore(PHOTO_ROOM);
    shown.image = await photo(card);
    shown.src = shown.image === "photo" ? await card.locator("img[data-commerce-image]").first().getAttribute("src", quick).catch(() => null) : null;
    found.set(shown.name, [...found.get(shown.name) ?? [], shown]);
  }
  return found;
}

/**
 * The homepage's Shop list: how many products it lists, and its cards for the catalog's products. A list
 * with no products counts as read only when it says the store lists none yet, and only with `mayBeEmpty`.
 */
async function readShop(shopper, names, { mayBeEmpty = false } = {}) {
  await openShopperPage(shopper, "/");
  const catalog = shopper.locator("[data-commerce-catalog]");
  if (!await catalog.count()) throw new Error("The homepage has no Shop list.");
  const cards = catalog.locator("[data-commerce-product]");
  const count = await cards.count();
  if (!count) {
    const said = await text(catalog.locator('[role="alert"]'));
    if (said) throw new Error(`The Shop list says "${said}".`);
    const empty = await text(catalog.locator("[data-commerce-empty]"));
    if (!empty) throw new Error("The Shop list shows neither products nor that it has none.");
    if (!mayBeEmpty) throw new Error(`The Shop list says "${empty}".`);
  }
  return { count, found: await catalogCards(cards, names) };
}

/** A category page's cards for the catalog's products. */
async function readCategory(shopper, path, names) {
  await openShopperPage(shopper, path);
  return catalogCards(shopper.locator("main").locator("[data-commerce-product], [data-merch-item]"), names);
}

/**
 * Where a link takes a shopper: a store page by its path and query, any other site by its whole address.
 * A #part only scrolls the page, so it's left out.
 */
function destination(href) {
  const url = new URL(href, config.store);
  url.hash = "";
  return url.origin === config.store ? `${url.pathname}${url.search}` : url.href;
}

/**
 * What's wrong with how a list page shows `products`: one it doesn't list or lists twice, one at
 * another price, without a photo of its own or a link to its page, or two showing the same photo.
 * `pages` holds the page each product's Shop card links to, which its other cards must link to too.
 */
function listProblems(found, products, where, pages = new Map()) {
  const problems = [];
  const bySrc = new Map();
  for (const product of products) {
    const cards = found.get(product.name) ?? [];
    if (!cards.length) {
      problems.push(`${where} doesn't list "${product.name}"`);
      continue;
    }
    if (cards.length > 1) problems.push(`${where} lists "${product.name}" ${cards.length} times`);
    const [card] = cards;
    if (money(card.price) !== product.cents) problems.push(`${where} shows "${product.name}" at ${card.price ? `"${card.price}"` : "no price"} instead of ${dollars(product.cents)}`);
    if (card.image !== "photo") problems.push(`"${product.name}" on ${where} ${photoProblem[card.image]}`);
    if (!card.href) problems.push(`"${product.name}" on ${where} links to no product page`);
    else if (pages.has(product.name) && destination(card.href) !== pages.get(product.name)) problems.push(`"${product.name}" on ${where} links to ${destination(card.href)} instead of ${pages.get(product.name)}`);
    if (card.src) bySrc.set(card.src, [...bySrc.get(card.src) ?? [], product.name]);
  }
  // Every product has a photo of its own, so two products showing one photo means one shows the wrong photo.
  for (const shared of bySrc.values()) if (shared.length > 1) problems.push(`${where} shows one photo for ${shared.map(name => `"${name}"`).join(" and ")}`);
  return problems;
}

/** What's wrong with how the open product page shows `product`: its name, its price and a working Add to cart button. */
async function productPageProblems(shopper, product) {
  const shown = shopper.locator("[data-product-page]");
  if (!await shown.count()) return ["shows no product"];
  const problems = [];
  const heading = await text(shown.locator("h1"));
  if (heading !== product.name) problems.push(`is headed "${heading || "nothing"}" instead of "${product.name}"`);
  const price = await text(shown.locator("[data-product-price]"));
  if (money(price) !== product.cents) problems.push(`shows ${price ? `"${price}"` : "no price"} instead of ${dollars(product.cents)}`);
  // Ready means wired to the cart and pressable; the journey never presses it.
  const add = shown.locator('[data-add-to-cart][data-guest-cart-ready="1"]').first();
  if (!await add.waitFor({ timeout: 15_000 }).then(() => true, () => false)) problems.push("has no working Add to cart button");
  else if (!await add.isEnabled()) problems.push("has an Add to cart button shoppers can't press");
  return problems;
}

/**
 * Gives one catalog product what the store lacks for it, as an owner would, all on its product page:
 * a page in its category when it has none, its Commerce product made in the page's Dinkus Commerce
 * panel (or the one with its SKU that has no page yet, or the one the page already names), restored
 * when archived, its price and weight saved where they differ, its photo chosen when the panel shows
 * none (uploaded first unless its batch did), and the page published, again when its product is a
 * Draft. Records in `did` what it did, which stays nothing when the store had it all, and keeps what
 * was done when a later part fails.
 */
async function completeProduct(page, content, product, { entry, uploaded }, did) {
  // A published page whose style or category the test just saved has changes to publish.
  let changed = false;
  if (entry) {
    await openAdmin(page, entry.editor);
    changed = await finishProductPage(page, product);
    if (changed) did.push("page completed");
  } else {
    await addProductPage(page, { title: product.name, style: product.style, category: product.category }, { lost: [] });
    did.push("page");
  }
  let panel = await openPanel(page);
  let shown = await panelProduct(panel);
  if (shown.state === "none") {
    const made = {};
    ({ panel } = await addPriceAndStock(page, product.sku, made, { link: true }));
    did.push(made.product ? "added" : "linked");
    shown = await panelProduct(panel);
  }
  if (shown.state === "archived") {
    await restore(panel);
    did.push("restored");
    shown = await panelProduct(panel);
  }
  if (shown.sku !== product.sku) throw new Error(`its page's panel shows SKU ${shown.sku || "none"} instead of ${product.sku}`);
  // The panel shows the price and weight Commerce stored, so only one that differs is saved, and reported.
  const price = (product.cents / 100).toFixed(2);
  if (await panel.getByRole("textbox", { name: "Regular", exact: true }).inputValue() !== price) {
    await setPrice(panel, price);
    did.push("price");
  }
  if (await panel.getByRole("textbox", { name: "Weight (oz)", exact: true }).inputValue() !== String(product.ounces)) {
    await setWeight(panel, product.ounces);
    did.push("weight");
  }
  // Commerce says so in the image's place when the product has none, or when the Media library has
  // lost it. A photo the panel already shows stays, since choosing it again can't change what the store shows.
  if (await panel.getByText(/^(No image|Image .+ is unavailable\.)$/).count()) {
    if (!uploaded) await uploadPhotos(content, [{ fileName: product.photo, label: product.name }]);
    await choosePhoto(panel, product.photo);
    did.push("photo");
  }
  // Publishing the page is what puts its product on sale; a Draft behind a published page needs it again.
  if (!entry?.published) {
    await publishProductPage(page);
    did.push("published");
  } else if (shown.state === "draft" || changed) {
    await republishProductPage(page);
    did.push("published again");
  }
}

// A store with as many products as a real shop: the catalog's categories, each holding several products
// with their own price, weight, photo and page. The test adds what the store lacks and leaves it there for
// later runs, then checks that the Shop list, every category page and every product page show the whole
// catalog, and that the owner can still save a product with all of it in place.
test("Full catalog", { tag: "@running" }, journey(async ({ page }) => {
  expect(config.store, `Set DINKUS_E2E_STORE to the store's address (in ${config.settingsFile})`).not.toBe("");
  const plan = catalogPlan(config.catalog);
  const products = plan.flatMap(category => category.products);
  const names = new Set(products.map(product => product.name));
  note("catalog", `${plural(plan.length, "category", "categories")} of ${plural(plan[0].products.length, "product")} (${products.length} in all)`);
  // Checking takes a few seconds a product at the shopper's pace, so a big catalog gets that time on top of the usual limit.
  test.info().setTimeout(test.info().timeout + products.length * 10_000);
  // Media and categories work in a second tab, so the product page editor keeps the first.
  const content = await newPage(page.context());
  const shopper = await shopperPage();
  // Content > Products as the first step read it, where each category's View published link goes, and the Shop list's catalog cards.
  let pages = new Map();
  // The store's Commerce, and whether it has the product page panel the test adds products with.
  let commerce = null;
  let canAdd = false;
  const categoryPaths = new Map();
  let shopFound = new Map();
  const soft = { soft: true };
  try {
    // Nothing after this can run without Content > Products, so this step stops the journey.
    await step(page, "Content > Products opens and lists every product page", async () => {
      // A run just before this one may have left little of the store's allowance.
      await paceStore(PRODUCT_ROOM);
      await openAdmin(page, `${config.store}/_emdash/admin/content/products`);
      if (!await page.getByRole("searchbox", { name: "Search products" }).waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
        throw new Error("Content > Products shows no list of product pages.");
      }
      pages = await productPages(page);
      // Commerce Orders' address carries Commerce's id: /_emdash/admin/plugins/<id>/orders.
      commerce = pluginVersion(await notePlugins(page), new URL(config.ordersAdmin).pathname.match(/\/plugins\/([^/]+)/)?.[1]);
      canAdd = versionAtLeast(commerce, COMMERCE_WITH_PANEL);
      note("product pages", total(pages));
      const have = products.filter(product => pages.has(product.name)).length;
      return `${plural(total(pages), "product page")}; ${have} of the catalog's ${products.length} among them`;
    });

    // Product pages need their category, so a category the store can't publish stops the journey too.
    await step(content, "The catalog's categories are published", async () => {
      const added = [];
      for (const { title } of plan) {
        let view = await publishedLink(content, title, "categories");
        if (!view) {
          if (!canAdd) throw tooOld(commerce, `the category "${title}"`);
          // A category an earlier run saved but never published is published, not added again.
          const edit = content.getByRole("link", { name: `Edit ${title}`, exact: true });
          const saved = await edit.count();
          if (saved > 1) throw new Error(`EmDash lists ${saved} categories titled "${title}" and none of them is published, so the test can't tell which to publish; remove the extra one.`);
          if (saved) {
            await openAdmin(content, new URL(await edit.getAttribute("href"), config.store).href);
            await publish(content, "categories");
          } else await addCategory(content, title, { lost: [] });
          added.push(title);
          view = await publishedLink(content, title, "categories");
          if (!view) throw new Error(`After publishing "${title}", EmDash's list of categories doesn't show it as Published with a View published link.`);
        }
        categoryPaths.set(title, destination(view));
      }
      return plan.map(({ title }) => `${title} at ${categoryPaths.get(title)}${added.includes(title) ? " (added)" : ""}`).join(", ");
    });

    await step(page, "The owner adds what the catalog lacks", async () => {
      // A product is whole once the Shop list shows it at its price with its photo and a link to its
      // page, and its category page lists it. Only what the store shows decides what to add, so a list
      // that won't open stops the step before anything is added.
      let shop;
      const shelves = new Map();
      try {
        shop = await readShop(shopper, names, { mayBeEmpty: true });
        for (const [title, path] of categoryPaths) shelves.set(title, await readCategory(shopper, path, names));
      } catch (error) {
        throw new Error(`Nothing was added, because the test couldn't read what the store shows: ${reason(error)}.`);
      }
      const shelved = product => shelves.get(product.category).has(product.name);
      const lacking = products.filter(product => {
        const card = shop.found.get(product.name)?.[0];
        return !pages.has(product.name) || !card || money(card.price) !== product.cents || card.image !== "photo" || !card.href || !shelved(product);
      });
      if (!lacking.length) return `nothing: the store already shows all ${products.length} catalog products`;
      if (!canAdd) throw tooOld(commerce, plural(lacking.length, "product"));
      // Content > Products can hold two pages by one title; the test can't tell which is the catalog's and leaves both alone.
      const twins = lacking.filter(product => pages.get(product.name)?.length > 1);
      const problems = twins.map(product => `"${product.name}": Content > Products has ${pages.get(product.name).length} pages by that title, so the test can't tell which to complete; remove the extra one`);
      const todo = lacking.filter(product => !twins.includes(product));
      // Adding takes about a minute a product, so a big catalog's first run gets that time on top of the usual limit.
      test.info().setTimeout(test.info().timeout + todo.length * 2 * 60_000);
      const added = [];
      const completed = [];
      for (let start = 0; start < todo.length; start += UPLOAD_BATCH) {
        const batch = todo.slice(start, start + UPLOAD_BATCH);
        // Products without a page get their photos uploaded together; one with a page gets one only if its panel shows none.
        const photos = batch.filter(product => !pages.has(product.name));
        // A photo that doesn't go up is recorded, and its product uploads it again on its own.
        const missed = new Set();
        if (photos.length) {
          await uploadPhotos(content, photos.map(product => ({ fileName: product.photo, label: product.name })), UPLOADS_ROOM).catch(error => {
            // An upload that failed before the library listed its files may have taken none of them.
            for (const name of error.missed ?? photos.map(product => product.photo)) missed.add(name);
            problems.push(`uploading the photos of ${short(photos.map(product => product.name)).join(", ")} failed (${reason(error)}); each photo that didn't go up is uploaded again with its product`);
          });
        }
        for (const product of batch) {
          await paceStore(PRODUCT_ROOM);
          // One product's trouble is recorded, with what was done for it first, and the rest still get added.
          const entry = pages.get(product.name)?.[0];
          const did = [];
          const failed = await completeProduct(page, content, product, { entry, uploaded: !entry && !missed.has(product.photo) }, did).then(() => null, error => error);
          if (failed) problems.push(`"${product.name}"${did.length ? ` (${did.join(", ")})` : ""}: ${reason(failed)}`);
          else if (did.includes("page")) added.push(product.name);
          else completed.push(`${product.name} (${did.join(", ") || "nothing to change in its panel, so the next steps report what the store shows wrong"})`);
        }
      }
      const done = [
        ...added.length ? [`added ${added.length} (${short(added).join(", ")}), each with a page in its category, its price, weight and photo, published`] : [],
        ...completed.length ? [`completed ${short(completed).join(", ")}`] : [],
      ];
      if (problems.length) throw new Error(`${[...done, ...problems].join("; ")}.`);
      return done.join("; ");
    }, soft);

    await step(shopper, "The Shop list shows every catalog product with its own price and photo", async () => {
      const { count, found } = await readShop(shopper, names);
      shopFound = found;
      note("products in the Shop list", count);
      const problems = listProblems(found, products, "the Shop list");
      if (problems.length) throw new Error(`${problems.join("; ")}.`);
      return `all ${products.length} catalog products, each at its own price with its own photo and a link to its page, among the ${count} the Shop list shows`;
    }, soft);

    await step(shopper, "Each category page lists its products with their own price and photo", async () => {
      const problems = [];
      const shown = [];
      // Each product's card links to the page its Shop card does, which the next step opens.
      const linked = new Map([...shopFound].filter(([, [card]]) => card.href).map(([name, [card]]) => [name, destination(card.href)]));
      for (const category of plan) {
        const path = categoryPaths.get(category.title);
        const found = await readCategory(shopper, path, names).catch(error => { problems.push(reason(error)); });
        if (!found) continue;
        problems.push(...listProblems(found, category.products, path, linked));
        // The other categories' products don't belong here.
        const strays = [...found.keys()].filter(name => !category.products.some(product => product.name === name));
        if (strays.length) problems.push(`${path} also lists ${strays.map(name => `"${name}"`).join(", ")}`);
        shown.push(`${path} lists its ${category.products.length}`);
      }
      if (problems.length) throw new Error(`${problems.join("; ")}.`);
      return shown.join(", ");
    }, soft);

    await step(shopper, "Every catalog product's page opens with its name, price and Add to cart", async () => {
      // The Shop list's links are the pages to open, so without them there's one reason, not one per product.
      if (!shopFound.size) throw new Error("The Shop list couldn't be read or showed none of the catalog's products (see its step), so there was no product page to open.");
      const problems = [];
      for (const product of products) {
        const href = shopFound.get(product.name)?.[0]?.href;
        if (!href) {
          problems.push(`the Shop list links "${product.name}" to no page`);
          continue;
        }
        // A link to another site is followed there, where the request filter or the store check stops it.
        const target = destination(href);
        const failed = await openShopperPage(shopper, target).then(() => "", error => {
          // The reason loses the address's query, as every first line in the proof does.
          const line = reason(error);
          return line.startsWith(withoutQueries(target)) ? line : `${target} didn't open (${line})`;
        });
        if (failed) problems.push(failed);
        else problems.push(...(await productPageProblems(shopper, product)).map(problem => `${target} ${problem}`));
      }
      if (problems.length) throw new Error(`${problems.join("; ")}.`);
      return `all ${products.length} pages show the product's name and price and a working Add to cart button`;
    }, soft);

    const [first] = products;
    await step(page, "The owner saves a product's weight with the whole catalog in place", async () => {
      // A weight save once failed on a store with more than a handful of products, since each product
      // screen read the whole catalog; this is that save, in the product page's panel, with every page
      // of Content > Products read first.
      if (!canAdd) throw new Error(`This store runs Commerce ${commerce ?? "of a version the test couldn't read"}, which has no Dinkus Commerce panel on its product pages; it needs ${COMMERCE_WITH_PANEL} or later.`);
      await paceStore(PRODUCT_ROOM);
      const now = await productPages(page);
      const missing = products.filter(product => !now.has(product.name)).map(product => `"${product.name}"`);
      if (missing.length) throw new Error(`Content > Products has no page for ${short(missing).join(", ")}.`);
      // A page the test can't tell from another by its title is never written to.
      const twins = now.get(first.name).length;
      if (twins > 1) throw new Error(`Content > Products has ${twins} pages titled "${first.name}", so the test can't tell which is the catalog's; remove the extra one.`);
      const [entry] = now.get(first.name);
      let panel = await openProductPanel(page, entry.editor);
      // A page saved before Commerce kept its own note of pages opens on "Not a product yet"; Add price
      // and stock then opens the product the page names, and makes none.
      if ((await panelProduct(panel)).state === "none") {
        if (!entry.commerceId) throw new Error(`"${first.name}"'s page names no Commerce product.`);
        ({ panel } = await addPriceAndStock(page, first.sku, {}, { link: true }));
      }
      const shown = await panelProduct(panel);
      if (shown.sku !== first.sku) throw new Error(`"${first.name}"'s panel shows SKU ${shown.sku || "none"} instead of ${first.sku}, so the test saved nothing.`);
      await setWeight(panel, first.ounces);
      return `Content > Products lists ${plural(total(now), "product page")}; "${first.name}" saved at ${first.ounces} oz in its panel`;
    }, soft);
  } finally {
    await closeShopper(shopper);
    await content.close();
  }
}));
