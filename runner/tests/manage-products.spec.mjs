import { newPage, test, expect, shopperPage, closeShopper } from "../support/browser.mjs";
import { config } from "../support/env.mjs";
import { firstLine } from "../support/errors.mjs";
import {
  addCategory, addPriceAndStock, addProductPage, archive, choosePhoto, openPanel, openProductPanel, panelProduct, publishProductPage, publishedLink,
  rename, republishProductPage, restore, setPrice, setWeight, trash, uploadPhoto,
} from "../support/products-admin.mjs";
import { record } from "../support/proof.mjs";
import { openShopperPage } from "../support/shopper.mjs";
import { notePlugins, openAdmin } from "../support/store-admin.mjs";
import { journey, step } from "../support/steps.mjs";
import {
  after, catchUp, categoryCards, imageHash, linkProblems, places, shopCards, storeHides, storeShows, withPhoto,
} from "../support/store-check.mjs";
import { quick, text } from "../support/storefront-page.mjs";
import { dollars } from "../support/storefront-text.mjs";

/** This run's names, unique to the second and plainly the live test's. */
function runNames() {
  const stamp = new Date().toISOString().replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d).*$/, "$1$2-$3$4$5");
  return {
    product: `Live test product ${stamp}`,
    renamed: `Live test product ${stamp} renamed`,
    sku: `LIVE-TEST-${stamp}`,
    category: `Live test category ${stamp}`,
    photo: `live-test-${stamp}.png`,
  };
}

/**
 * Opens the product page editor at `editor` with its panel, and checks the panel shows this run's
 * product in the state `want` ("draft", "on sale" or "archived"). The store's publish check sets the
 * state as the page is published, so a state that isn't there yet gets a few reloads.
 */
async function panelShows(page, editor, want) {
  let shown;
  for (let tries = 0; tries < 4; tries++) {
    if (tries) await page.waitForTimeout(5_000);
    shown = await panelProduct(await openProductPanel(page, editor));
    if (shown.state === want) return;
  }
  throw new Error(`the page's Dinkus Commerce panel shows the product as ${shown.state === "none" ? "not a product yet" : shown.state} instead of ${want}`);
}

/**
 * Why the open panel doesn't show the photo with fingerprint `hash` as the product's image, or "" when
 * it does. Once a product has an image, the panel shows it under Images with Change image beside it.
 */
async function panelPhotoProblem(panel, hash) {
  const images = panel.getByRole("heading", { name: "Images", level: 2 });
  if (!await images.waitFor({ timeout: 30_000 }).then(() => true, () => false)) return "the Dinkus Commerce panel has no Images section";
  // Commerce says so in the image's place when the product has none, or when the Media library has lost it.
  const said = await text(panel.getByText(/^(No image|Image .+ is unavailable\.)$/));
  if (said) return `the Dinkus Commerce panel says "${said}" under Images`;
  if (!await panel.getByRole("button", { name: "Change image", exact: true }).count()) return "the Dinkus Commerce panel has no Change image, which it shows only for a product with an image";
  const img = images.locator("xpath=following::img[1]");
  if (!await img.count()) return "the Dinkus Commerce panel shows no image under Images";
  const loaded = await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth > 0), { timeout: 15_000 }).toBe(true).then(() => true, () => false);
  if (!loaded) return "the image in the Dinkus Commerce panel didn't load";
  return await imageHash(panel.page(), await img.getAttribute("src")) === hash ? "" : "the Dinkus Commerce panel shows another image than the photo the owner chose";
}


// An owner's catalog work on the one product screen: add a product page in a new category, give it
// its Commerce product with a price and a weight in the page's Dinkus Commerce panel, see the Draft
// stay off the store, give it a photo that stays after a reload, publish the page and see the store
// sell it, change its price and name, archive and restore it, with the store following each change.
// It tidies up after itself.
test("Manage products", { tag: "@running" }, journey(async ({ page }) => {
  expect(config.store, `Set DINKUS_E2E_STORE to the store's address (in ${config.settingsFile})`).not.toBe("");
  const run = runNames();
  // The product page's editor, with its panel, stays in the saved profile's page; Media and categories work in a second tab.
  const content = await newPage(page.context());
  const shopper = await shopperPage();
  // What the store should show, and what this run made, so the last step can take it all off the store.
  const state = { id: "", name: run.product, cents: 1200, productPath: "", categoryPath: "", published: false, archived: false, hasPhoto: false, photoHash: "" };
  // `product` is "asked" from the moment the panel may make it, and true once the page is saved with
  // it; the page and category keep their store addresses from just before each is saved and their
  // editor's once it opens. `lost` names an entry saved without the test learning where its editor is.
  const made = { product: false, page: "", category: "", pagePath: "", categoryPath: "", lost: [] };
  // Where the store would show the product, which a Draft's check looks at too.
  const where = () => ({ ...state, productPath: made.pagePath, categoryPath: made.categoryPath });
  const soft = { soft: true };
  try {
    await step(page, "The owner opens Content > Products", async () => {
      await openAdmin(page, `${config.store}/_emdash/admin/content/products`);
      await notePlugins(page);
      if (!await page.getByRole("searchbox", { name: "Search products" }).waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
        throw new Error("Content > Products shows no list of product pages.");
      }
      return "Content > Products opened with its list of product pages";
    });

    // Nothing after this can run without the page, so this step stops the journey too.
    await step(page, "The owner adds a product page in a new category", async () => {
      await addCategory(content, run.category, made);
      await addProductPage(page, { title: run.product, style: "CAP", category: run.category }, made);
      return `saved "${run.product}" (unpublished) at ${made.pagePath} in the new category ${made.categoryPath}`;
    });

    // Nor without its product.
    await step(page, "The owner adds price and stock with a price and a weight", async () => {
      const { panel, id } = await addPriceAndStock(page, run.sku, made);
      state.id = id;
      const shown = await panelProduct(panel);
      const problems = [
        ...shown.state === "draft" ? [] : [`the panel shows the new product as ${shown.state} instead of a Draft`],
        ...shown.sku === run.sku ? [] : [`the panel shows SKU ${shown.sku || "none"} instead of ${run.sku}`],
        ...shown.name === run.product ? [] : [`the panel names the product "${shown.name || "nothing"}" instead of the page's title`],
      ];
      if (problems.length) throw new Error(`${problems.join("; ")}.`);
      await setPrice(panel, "12.00");
      await setWeight(panel, 8);
      return `"${run.product}" (SKU ${run.sku}) is a Draft at $12.00, 8 oz; the page keeps Commerce product ${id}`;
    });

    await step(shopper, "A Draft product stays off the store", async () => {
      // A store that keeps every page behind Cloudflare Access gets a one-time PIN sign-in first.
      await openShopperPage(shopper, "/");
      const { problems, seconds } = await storeHides(shopper, where());
      if (problems.length) throw new Error(`While the page is unpublished, ${problems.join("; ")}${after(seconds)}.`);
      return `the Shop list, ${made.pagePath} and ${made.categoryPath} don't offer it while its page is unpublished`;
    }, soft);

    await step(content, "The owner uploads a photo and makes it the product's image", async () => {
      await uploadPhoto(content, run.photo, run.product);
      const panel = await openPanel(page);
      let hash = "";
      // The picker shows each photo just above its Use button, so that picture is the file chosen.
      await choosePhoto(panel, run.photo, { beforeUse: async use => {
        hash = await imageHash(page, await use.locator("xpath=preceding::img[1]").getAttribute("src", quick).catch(() => null));
        if (!hash) throw new Error(`Commerce's image picker shows no picture the test could fetch above "Use ${run.photo}".`);
      } });
      Object.assign(state, { hasPhoto: true, photoHash: hash });
      return `uploaded ${run.photo} to the Media library and chose it in the product page's Dinkus Commerce panel, which said "Image saved"`;
    }, soft);

    const keptStep = "The photo is still the product's image after a reload";
    if (!state.hasPhoto) record(keptStep, "SKIP", "the photo wasn't chosen, so there's no choice to check");
    else await step(page, keptStep, async () => {
      // Opening the editor afresh draws the panel from what Commerce stored.
      const problem = await panelPhotoProblem(await openProductPanel(page, made.page), state.photoHash);
      if (problem) throw new Error(`After a reload, ${problem}.`);
      return "after a reload, the product page's Dinkus Commerce panel shows the chosen photo under Images, loaded, with Change image beside it";
    }, soft);

    // Publishing is what puts a Draft on sale: the store's publish check tells Commerce.
    const shopRight = await step(shopper, "Publishing the page puts the product on sale", async () => {
      await openAdmin(page, made.page);
      await publishProductPage(page);
      Object.assign(state, { published: true, productPath: made.pagePath, categoryPath: made.categoryPath });
      const listed = await publishedLink(content, run.product);
      if (listed !== new URL(state.productPath, config.store).href) {
        throw new Error(listed === null ? `Published ${state.productPath}, but EmDash's list of product pages doesn't show it as Published with a View published link.`
          : `EmDash's list of product pages links "${run.product}" to ${listed} instead of ${state.productPath}.`);
      }
      const problems = await panelShows(page, made.page, "on sale").then(() => [], error => [`after publishing, ${firstLine(error)}`]);
      const { problems: storeProblems, seconds } = await storeShows(shopper, state);
      problems.push(...storeProblems);
      if (problems.length) throw new Error(`${problems.join("; ")}${after(seconds)}.`);
      return `the panel says On sale; the Shop list, ${state.productPath} and ${state.categoryPath} show "${state.name}" at ${dollars(state.cents)}${withPhoto(state)} and Add to cart${after(seconds)}`;
    }, soft);
    // The changes below look for the photo too, until a step finds the store showing the product wrong,
    // so a photo the store lost fails the step that first misses it, not every change after that too.
    if (!shopRight) state.hasPhoto = false;

    const linkStep = "The product's links open its page";
    if (!state.published) record(linkStep, "SKIP", "the product page wasn't published, so there's no link to follow");
    else await step(shopper, linkStep, async () => {
      const problems = [
        ...await linkProblems(shopper, "the Shop list", "/", shopCards, state),
        ...await linkProblems(shopper, `the category page ${state.categoryPath}`, state.categoryPath, categoryCards, state),
      ];
      if (problems.length) throw new Error(`${problems.join("; ")}.`);
      return `pressing the product's Shop card, and View details on ${state.categoryPath}, opens ${state.productPath}, headed "${state.name}"`;
    }, soft);

    const priceRight = await step(shopper, "A new price shows on the store", async () => {
      await setPrice(await openProductPanel(page, made.page), "13.50");
      state.cents = 1350;
      const { problems, seconds } = await storeShows(shopper, state);
      if (problems.length) throw new Error(`${problems.join("; ")}${after(seconds)}.`);
      return `$13.50${withPhoto(state)} on ${places(state)}${after(seconds)}`;
    }, soft);
    if (!priceRight) state.hasPhoto = false;

    const nameRight = await step(shopper, "A new name shows on the store", async () => {
      await rename(page, made.page, run.renamed);
      state.name = run.renamed;
      const { problems, seconds } = await storeShows(shopper, state);
      if (problems.length) throw new Error(`${problems.join("; ")}${after(seconds)}.`);
      return `"${state.name}"${withPhoto(state)} on ${places(state)}${after(seconds)}`;
    }, soft);
    if (!nameRight) state.hasPhoto = false;

    await step(shopper, "Archiving the product takes it off the store", async () => {
      await archive(await openProductPanel(page, made.page));
      state.archived = true;
      const { problems, seconds } = await storeHides(shopper, state, { archived: state.published });
      if (problems.length) throw new Error(`Archived in the panel, but ${problems.join("; ")}${after(seconds)}.`);
      const shown = state.productPath ? places(state).replace(state.productPath, `${state.productPath} (now "no longer available", HTTP 404)`) : places(state);
      return `gone from ${shown}${after(seconds)}`;
    }, soft);

    // Commerce restores a product as a Draft, so the owner publishes its page again to sell it.
    const restoreStep = "Restoring the product and publishing its page again puts it back on the store";
    if (!state.archived) record(restoreStep, "SKIP", "the product wasn't archived, so there's nothing to restore");
    else await step(shopper, restoreStep, async () => {
      await restore(await openProductPanel(page, made.page));
      state.archived = false;
      await panelShows(page, made.page, "draft").catch(error => { throw new Error(`After Restore, ${firstLine(error)}.`); });
      await republishProductPage(page);
      Object.assign(state, { published: true, productPath: made.pagePath, categoryPath: made.categoryPath });
      const problems = await panelShows(page, made.page, "on sale").then(() => [], error => [`after publishing again, ${firstLine(error)}`]);
      const { problems: storeProblems, seconds } = await storeShows(shopper, state);
      problems.push(...storeProblems);
      if (problems.length) throw new Error(`Restored in the panel and published again, but ${problems.join("; ")}${after(seconds)}.`);
      return `restored as a Draft, published again, and back on ${places(state)} as "${state.name}" at ${dollars(state.cents)}${withPhoto(state)}${after(seconds)}`;
    }, soft);
  } finally {
    // Whatever this run added comes off the store again, even when a step above stopped the journey.
    if (made.product || made.page || made.category || made.lost.length) await step(shopper, "The test takes its product, page and category off the store", async () => {
      const problems = [];
      if (made.product && made.page) {
        // The panel says what the product is now, whatever this run's notes say.
        const panel = await openProductPanel(page, made.page).catch(error => { problems.push(`opening "${run.product}"'s Dinkus Commerce panel failed, so its product may still be on the store: ${firstLine(error)}`); });
        const shown = panel ? await panelProduct(panel) : null;
        if (shown?.state === "draft" || shown?.state === "on sale") {
          await archive(panel).then(() => { state.archived = true; }, error => problems.push(`archiving "${shown.name}" in its panel failed: ${firstLine(error)}`));
        } else if (shown?.state === "archived") state.archived = true;
        else if (shown?.state === "none" && made.product === true) problems.push(`"${run.product}"'s panel shows no product, so the test couldn't archive it; look for SKU ${run.sku} under Commerce settings' Products without a page`);
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
        problems.push(...(await storeHides(shopper, where())).problems);
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
