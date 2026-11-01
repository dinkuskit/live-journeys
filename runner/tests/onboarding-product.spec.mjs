import { newPage, test, expect, shopperPage, closeShopper } from "../support/browser.mjs";
import { config } from "../support/env.mjs";
import { firstLine } from "../support/errors.mjs";
import {
  addCategory, addPriceAndStock, addProductPage, archive, choosePhoto, openPhotoPanel, openProductPanel, panelProduct, publishProductPage, publishedLink,
  setPrice, setWeight, trash, uploadPhoto,
} from "../support/products-admin.mjs";
import { openShopperPage } from "../support/shopper.mjs";
import { notePlugins, openAdmin } from "../support/store-admin.mjs";
import { journey, step } from "../support/steps.mjs";
import { after, catchUp, imageHash, storeHides, storeShows, withPhoto } from "../support/store-check.mjs";
import { quick } from "../support/storefront-page.mjs";
import { dollars } from "../support/storefront-text.mjs";

/** This run's names, unique to the second and not Manage products' "Live test" names, so this run never opens those. */
function runNames() {
  const stamp = new Date().toISOString().replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d).*$/, "$1$2-$3$4$5");
  return {
    product: `Onboarding product ${stamp}`,
    sku: `ONBOARD-${stamp}`,
    category: `Onboarding category ${stamp}`,
    photo: `onboarding-${stamp}.png`,
  };
}

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
