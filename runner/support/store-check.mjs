import { createHash } from "node:crypto";
import { get } from "./browser.mjs";
import { categoryHides } from "./category-page.mjs";
import { config } from "./env.mjs";
import { firstLine } from "./errors.mjs";
import { PAGE_ROOM, paceStore } from "./pace.mjs";
import { photo, photoProblem, readCard, text } from "./storefront-page.mjs";
import { dollars, money } from "./storefront-text.mjs";

// What a new shopper's browser shows of one product the journey made: the homepage's Shop list, its
// product page and its category page, reloaded until they catch up with a change. Manage products and
// An agent manages a product check the store with these.

// How long the store gets to show a change the owner just made.
const CATCH_UP_MS = 60_000;


/**
 * A fingerprint of the image file at `src`, fetched with `page`'s sign-ins, or "" when it can't be
 * fetched. Commerce's admin and the store address the same Media library file differently, so the
 * test compares the files themselves.
 */
export async function imageHash(page, src) {
  if (!src) return "";
  const response = await get(page, new URL(src, config.store).href).catch(() => null);
  return response?.ok() ? createHash("sha256").update(await response.body()).digest("hex") : "";
}

// The requests each shopper page has started and not yet finished, so a page that never finishes
// loading can name what it still waits on.
const loading = new WeakMap();
function watchLoads(page) {
  if (!loading.has(page)) {
    const open = new Set();
    page.on("request", request => open.add(request));
    for (const event of ["requestfinished", "requestfailed"]) page.on(event, request => open.delete(request));
    loading.set(page, open);
  }
  return loading.get(page);
}

/** What a page that didn't finish loading still waits on: up to three addresses, without their queries. */
function stillLoading(open) {
  const paths = [...new Set([...open].map(request => {
    const url = new URL(request.url());
    return url.origin === config.store ? url.pathname : `${url.origin}${url.pathname}`;
  }))];
  return paths.length ? `; still loading ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ` and ${paths.length - 3} more` : ""}` : "";
}

/**
 * Reloads a store page until `check` finds nothing wrong, giving the store a minute to show a change
 * the owner just made. Returns the last problems found (none once the page caught up) and the wait.
 */
export async function catchUp(shopper, path, check) {
  const started = Date.now();
  for (;;) {
    // Each reload brings the page's photos again, so on a store with many products it waits its turn.
    await paceStore(PAGE_ROOM);
    const open = watchLoads(shopper);
    const response = await shopper.goto(new URL(path, config.store).href).catch(error => error);
    const problems = response instanceof Error ? [`${path} didn't answer (${firstLine(response)}${stillLoading(open)})`]
      : new URL(shopper.url()).origin !== config.store ? [`${path} sent the shopper away from the store`]
        : await check(response);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (!problems.length || Date.now() - started > CATCH_UP_MS) return { problems, seconds };
    await shopper.waitForTimeout(3_000);
  }
}

/** This run's product among a page's product cards: by its Commerce ID, the page it links to, or its name. */
export async function findCard(cards, { id, path, name }) {
  for (const card of await cards.all()) {
    if (id && (await card.getAttribute("data-commerce-product") === id || await card.locator(`img[data-commerce-image="${id}"]`).count())) return card;
    if (path && (await card.getAttribute("href") === path || await card.locator(`a[href="${path}"]`).count())) return card;
    if (!id && name && await text(card.locator("h2, h3, h4")) === name) return card;
  }
  return null;
}

export const shopCards = page => page.locator("[data-commerce-catalog] [data-commerce-product]");

/**
 * Why the homepage's Shop list can't be read, or "" when it lists products or says it has none. A card
 * missing from a Shop list that couldn't have shown it proves nothing.
 */
export async function unreadableShop(shopper) {
  const catalog = shopper.locator("[data-commerce-catalog]");
  if (!await catalog.count()) return "the homepage has no Shop list";
  if (await catalog.locator("[data-commerce-product], [data-commerce-empty]").count()) return "";
  const said = await text(catalog.locator('[role="alert"]'));
  return said ? `the Shop list says "${said}"` : "the Shop list shows neither products nor that it has none";
}
export const categoryCards = page => page.locator("main").locator("[data-commerce-product], [data-merch-item]");

/**
 * What's wrong with the photo a product card or page shows, given what `photo` made of it: it must be
 * the photo the owner chose, the file with fingerprint `hash`.
 */
export async function photoProblems(media, where, image, hash) {
  if (image !== "photo") return [`${where} ${photoProblem[image]}`];
  const src = await media.locator("img[data-commerce-image]").first().getAttribute("src");
  return await imageHash(media.page(), src) === hash ? [] : [`${where} shows another photo (${new URL(src ?? "", config.store).pathname}) than the one the owner chose`];
}

/** What's wrong with how one product card shows this run's product. */
export async function cardProblems(card, where, { name, cents, hasPhoto, photoHash, path }) {
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
export async function productPageProblems(shopper, response, { name, cents, hasPhoto, photoHash, categoryPath }) {
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
 * What goes wrong when a shopper presses this run's product on a list page (its Shop card, or View
 * details on a category page) to open its page.
 */
export async function linkProblems(shopper, where, path, cards, { id, name, productPath }) {
  const response = await shopper.goto(new URL(path, config.store).href).catch(error => error);
  if (response instanceof Error) return [`${where} didn't answer (${firstLine(response)})`];
  const card = await findCard(cards(shopper), { id, path: productPath });
  if (!card) return [`${where} doesn't list it`];
  // A Shop card is the link itself; a category card links from View details.
  const link = await card.getAttribute("href") === productPath ? card : card.locator(`a[href="${productPath}"]`).first();
  if (!await link.count()) return [`${where} lists it without a link to ${productPath}`];
  const opened = await Promise.all([
    shopper.waitForResponse(r => r.request().isNavigationRequest() && new URL(r.url()).pathname === productPath, { timeout: 30_000 }),
    link.click(),
  ]).then(([navigation]) => navigation, () => null);
  if (!opened) return [`pressing it on ${where} didn't open ${productPath}`];
  if (opened.status() !== 200) return [`pressing it on ${where} opened ${productPath}, which answered HTTP ${opened.status()}`];
  await shopper.waitForLoadState("load");
  const heading = await text(shopper.locator("[data-product-page] h1"));
  return heading === name ? [] : [`pressing it on ${where} opened a page headed "${heading || "nothing"}" instead of "${name}"`];
}

/** Where the store shows the product, for a passing step's summary. */
export const places = state => ["the Shop list", ...state.productPath ? [state.productPath, state.categoryPath].filter(Boolean) : []].join(", ");

/**
 * Everything wrong with how the store shows this run's product now (the Shop list, and its page and
 * any category page once published), with the longest the store took to catch up. When `state.shared`
 * says the category holds other products too, its page must list them beside this one; `state.beside`
 * learns how many it does.
 */
export async function storeShows(shopper, state) {
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
    if (categoryPath) checks.push(await catchUp(shopper, categoryPath, async response => {
      if (response.status() !== 200) return [`${categoryPath} answered HTTP ${response.status()}`];
      const where = `the category page ${categoryPath}`;
      const card = await findCard(categoryCards(shopper), { id, path: productPath });
      const problems = await cardProblems(card, where, { name, cents, hasPhoto, photoHash, path: productPath });
      // A category the store's other products are in lists them beside this one, as a shop's does.
      if (state.shared) {
        state.beside = await categoryCards(shopper).count() - (card ? 1 : 0);
        if (!state.beside) problems.push(`${where} lists no other product beside it`);
      }
      return problems;
    }));
  }
  return { problems: checks.flatMap(check => check.problems), seconds: Math.max(...checks.map(check => check.seconds)) };
}

/**
 * Everything that still offers this run's product to shoppers once the owner archived it or took its
 * page down. An archived product's page must say it's no longer available, and its category, still
 * published then, must answer for the missing card to count; so must a category the store's other
 * products are in (`shared`), which the clean-up leaves on the store.
 */
export async function storeHides(shopper, { id, name, productPath, categoryPath, shared = false }, { archived = false } = {}) {
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
      if (offers.length) return [`${productPath} still ${offers.join(" and ")}`];
      // A shopper following an old link to an archived product learns it's gone, from a page that answers 404.
      if (!archived) return [];
      const says = /no longer available/i.test(await text(shopper.locator("main")));
      return response.status() === 404 && says ? [] : [`${productPath} answers HTTP ${response.status()}${says ? " instead of 404" : " without saying the product is no longer available"}`];
    }));
    if (categoryPath) checks.push(await catchUp(shopper, categoryPath, async response => categoryHides({
      path: categoryPath, status: response.status(), archived, shared,
      listed: response.status() === 200 && Boolean(await findCard(categoryCards(shopper), { id, path: productPath })),
    })));
  }
  return { problems: checks.flatMap(check => check.problems), seconds: Math.max(...checks.map(check => check.seconds)) };
}

export const after = seconds => seconds ? ` after ${seconds} s` : "";
/**
 * A passing step's word on the photo: the store showed it, or the step didn't look for it, since none
 * was chosen or an earlier step found the store showing the product wrong.
 */
export const withPhoto = state => state.hasPhoto ? " with its photo"
  : state.photoHash ? " (its photo not looked for, since an earlier store check failed)" : " (no photo to look for, since none was chosen)";
