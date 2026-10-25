import { newPage, expect } from "./browser.mjs";
import { config } from "./env.mjs";
import { firstLine } from "./errors.mjs";
import { MEDIA_ROOM, PICKER_PAGE_ROOM, paceStore } from "./pace.mjs";
import { openAdmin } from "./store-admin.mjs";
import { quick, text } from "./storefront-page.mjs";

// What an owner does with products in the store admin: EmDash's product pages (Content > Products) with
// their Dinkus Commerce panel, the Media library, and categories. Manage products, Full catalog and One
// product with a category share these.

/** Answers the question the admin asks before an action with one of its buttons. */
export async function answer(page, question, choice) {
  // Commerce's question carries no name of its own, so it's found by what it asks.
  const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog")).filter({ hasText: question }).first();
  if (!await dialog.waitFor({ timeout: 15_000 }).then(() => true, () => false)) throw new Error(`The admin never asked "${question}"`);
  await dialog.getByRole("button", { name: choice, exact: true }).click();
}

// The Dinkus Commerce panel on a Content > Products page is the one product screen: it makes the page's
// Commerce product and holds its price, weight, photos, name and archive. Its state line reads "Draft:
// publish to sell it", "On sale" or "Archived: off the shop", then the SKU; a page with no product yet
// says "Not a product yet".
const PANEL_READY = /^Not a product yet|\u00b7 SKU /;
const PANEL_STATES = { "Draft": "draft", "On sale": "on sale", "Archived": "archived" };

/**
 * Opens the Dinkus Commerce panel on the product page editor showing in `page` and returns it once
 * it has drawn. A page whose editor offers no panel, or a panel that won't draw, fails.
 */
export async function openPanel(page) {
  const trigger = page.getByLabel("Settings", { exact: true }).getByRole("button", { name: "Dinkus Commerce", exact: true });
  // On a phone-sized window the editor's settings open from its Settings button.
  const settings = page.getByRole("main").getByRole("button", { name: "Settings", exact: true });
  if (!await trigger.or(settings).first().waitFor({ timeout: 60_000 }).then(() => true, () => false)) {
    throw new Error("The product page's editor shows no Dinkus Commerce panel.");
  }
  if (!await trigger.isVisible()) await settings.click();
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  const panel = trigger.locator("xpath=..");
  if (!await panel.getByText(PANEL_READY).first().waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
    const said = await text(panel.locator('[role="alert"]'));
    throw new Error(said ? `The Dinkus Commerce panel says "${said}".` : "The Dinkus Commerce panel didn't draw within 30 seconds.");
  }
  return panel;
}

/** Opens the product page editor at `editor` with its Dinkus Commerce panel open. */
export async function openProductPanel(page, editor) {
  await openAdmin(page, editor);
  return openPanel(page);
}

/**
 * What the open panel says of the page's product: "none" before it has one, else "draft", "on sale"
 * or "archived" with its SKU and name.
 */
export async function panelProduct(panel) {
  const said = await text(panel.getByText(PANEL_READY));
  if (/^Not a product yet/.test(said)) return { state: "none" };
  const [, state = "", sku = ""] = said.match(/^(Draft|On sale|Archived)\b.*\u00b7 SKU (.+)$/) ?? [];
  return { state: PANEL_STATES[state] ?? `unknown ("${said}")`, sku, name: await text(panel.getByRole("heading", { level: 2 })) };
}

/**
 * Does `act` (a press in the open panel) and waits for Commerce's answer, which must be a success
 * toast saying `message` (a string, or a pattern); anything else fails with what Commerce said. The
 * panel draws the answer as it arrives, so what's read after this comes from the new drawing.
 */
async function panelSays(panel, act, message) {
  const page = panel.page();
  // The panel draws itself again whenever the page is saved; those loads aren't the press's answer.
  const answered = page.waitForResponse(r => r.request().method() === "POST" && /\/plugin-extensions\/[^/]+\/panel\//.test(new URL(r.url()).pathname)
    && r.request().postDataJSON()?.type !== "panel_load", { timeout: 30_000 });
  answered.catch(() => {});
  await act();
  const response = await answered.catch(() => null);
  if (!response) throw new Error(`Commerce never answered, so it never said "${message.source ?? message}".`);
  const body = await response.json().catch(() => null);
  const toast = body?.data?.toast;
  if (toast?.type === "success" && (typeof message === "string" ? toast.message === message : message.test(toast.message))) {
    await page.getByText(toast.message, { exact: true }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    return body.data;
  }
  const banner = body?.data?.blocks?.find(block => block?.type === "banner")?.title;
  const reason = toast?.message ?? banner ?? body?.error?.message ?? `HTTP ${response.status()}`;
  throw new Error(`Commerce refused it: "${reason}"`);
}

// What may cover the editor's Save, as the public run page may name it: dialogs EmDash or the panel open.
const DIALOGS = ["Review proposed changes", "Add references"];

/**
 * What stands in the way of `button`, in fixed words: an open dialog it names, else what the page shows
 * at the button's middle (the button itself, a frame such as the panel's, a toast, or another element).
 */
async function inTheWay(page, button) {
  const count = await page.getByRole("dialog").count().catch(() => 0);
  if (count) {
    for (const name of DIALOGS) if (await page.getByRole("dialog", { name }).count().catch(() => 0)) return `the dialog ${name} is open`;
    return "another dialog is open";
  }
  const found = await button.evaluate(el => {
    const box = el.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) return "off the screen";
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (!top) return "under nothing";
    if (top === el || el.contains(top)) return el.disabled || el.getAttribute("aria-disabled") === "true" ? "the button, disabled" : "the button itself";
    if (top.closest("iframe")) return "a frame";
    if (top.closest("[data-sonner-toast], [role=status], [role=alert], [aria-live]")) return "a toast";
    if (top.closest("aside, [role=complementary]")) return "a sidebar";
    return "another element";
  }, null, { timeout: 5_000 }).catch(() => "unreadable");
  return `no dialog is open, and at Save the page shows ${found}`;
}

/**
 * Saves the editor's changes and waits for EmDash to say Saved. EmDash also saves a change by itself a
 * moment after it's made, and its button then reads Saving... and Saved, so a press that loses that race
 * is fine. The editor's button carries its label as its accessible name, which the panel's own Save
 * doesn't, and only a shown one counts. When it never says Saved, the failure says what covers it.
 */
export async function saveEditor(page) {
  const save = page.locator('button[aria-label="Save"]:visible').first();
  const saving = page.locator('button[aria-label="Saving..."]:visible');
  if (await save.count() && !await save.isEnabled() && !await saving.count()) return;
  if (await save.count() && await save.isEnabled()) await save.click({ timeout: 5_000 }).catch(() => {});
  if (!await page.locator('button[aria-label="Saved"]:visible').first().waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
    if (await save.count() && await save.isEnabled()) throw new Error(`The editor's Save took no click: ${await inTheWay(page, save)}.`);
    throw new Error("EmDash didn't save the product page within 30 seconds.");
  }
}

/**
 * Gives the saved product page open in `page` its Commerce product, as an owner does, and saves the
 * page with it. With `link`, a product with this SKU that has no page yet is chosen ("Or its SKU", then
 * Sell it here); otherwise, or when Commerce has none by that SKU, Add price and stock makes a Draft
 * with that SKU. A page that already names a product gets that one. Commerce's change to the page's
 * Commerce product field is applied when EmDash asks. `made.product` is "asked" from the moment a
 * product may be made and true once the page is saved with it, so a caller can archive a product
 * Commerce made even when the page never kept it. Returns the panel and the product's ID.
 */
export async function addPriceAndStock(page, sku, made = {}, { link = false } = {}) {
  let panel = await openPanel(page);
  if ((await panelProduct(panel)).state !== "none") throw new Error("The product page already has a Commerce product.");
  let said = null;
  const bySku = panel.getByRole("textbox", { name: "Or its SKU", exact: true });
  if (link && await bySku.count()) {
    await bySku.fill(sku);
    said = await panelSays(panel, () => panel.getByRole("button", { name: "Sell it here", exact: true }).click(), "Linked. Save to keep it.").catch(() => null);
    // A refused link draws the panel again with nothing linked, so Add price and stock follows.
    if (!said) panel = await openPanel(page);
  }
  if (!said) {
    await panel.getByRole("textbox", { name: "SKU (optional)", exact: true }).fill(sku);
    made.product = "asked";
    said = await panelSays(panel, () => panel.getByRole("button", { name: "Add price and stock", exact: true }).click(),
      /^(Draft made\. Save, then Publish to sell it\.|Linked\. Save to keep it\.)$/);
  }
  // EmDash asks before Commerce's change reaches the editor; a page that already named the product needs none.
  if (said.patch) {
    const review = page.getByRole("dialog", { name: "Review proposed changes" });
    if (!await review.waitFor({ timeout: 15_000 }).then(() => true, () => false)) throw new Error("EmDash never asked to apply Commerce's change to the page.");
    await review.getByRole("button", { name: "Apply changes", exact: true }).click();
    await review.waitFor({ state: "hidden", timeout: 15_000 });
  }
  await saveEditor(page);
  const id = (await page.getByRole("textbox", { name: /^Commerce product/ }).inputValue().catch(() => "")).trim();
  if (!id) throw new Error("The product page's Commerce product field is still empty after Save.");
  if (made.product) made.product = true;
  return { panel: await openPanel(page), id };
}

/** Saves the regular price in the open panel. */
export async function setPrice(panel, regular) {
  await panel.getByRole("textbox", { name: "Regular", exact: true }).fill(regular);
  await panelSays(panel, () => panel.getByRole("button", { name: "Save", exact: true }).click(), "Product saved");
}

/** Saves the weight in ounces in the open panel, and checks Commerce kept it. */
export async function setWeight(panel, ounces) {
  const weight = panel.getByRole("textbox", { name: "Weight (oz)", exact: true });
  await weight.fill(String(ounces));
  await panelSays(panel, () => panel.getByRole("button", { name: "Save weight", exact: true }).click(), "Weight saved");
  // Commerce draws the product again from what it stored, so the field now shows the saved weight.
  await expect(weight, "Commerce didn't keep the weight").toHaveValue(String(ounces), { timeout: 15_000 });
}

/** Renames the product in the open panel. */
export async function rename(panel, name) {
  await panel.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await panelSays(panel, () => panel.getByRole("button", { name: "Rename", exact: true }).click(), "Product renamed");
}

/** Archives the product in the open panel, answering the question Commerce asks first. */
export async function archive(panel) {
  const button = panel.getByRole("button", { name: "Archive product", exact: true });
  if (!await button.count()) throw new Error("The Dinkus Commerce panel has no Archive product.");
  const name = await text(panel.getByRole("heading", { level: 2 }));
  await panelSays(panel, async () => {
    await button.click();
    await answer(panel.page(), `Archive ${name}?`, "Archive");
  }, "Product archived");
}

/** Restores the archived product in the open panel; Commerce brings it back as a Draft. */
export async function restore(panel) {
  await panelSays(panel, () => panel.getByRole("button", { name: "Restore", exact: true }).click(), "Restored as a Draft");
}

/** Uploads a plain square photo to the Media library, as an owner does before choosing it for a product. */
export async function uploadPhoto(page, fileName, label) {
  await uploadPhotos(page, [{ fileName, label }]);
}

/**
 * Uploads several plain square photos to the Media library in one go, each with its own label drawn on
 * it. The browser draws them, so the test carries no image files. A label makes its photo its own: the
 * Media library keeps one copy of identical files, under the first one's name. It first waits until
 * `room` more store requests fit, which for a single photo is MEDIA_ROOM.
 */
export async function uploadPhotos(page, photos, room = MEDIA_ROOM) {
  const painter = await newPage(page.context());
  const files = [];
  for (const { fileName, label } of photos) {
    await painter.setContent(`<div style="width:480px;height:480px;display:grid;place-items:center;background:linear-gradient(135deg,#2a6,#246);color:#fff;font:600 28px sans-serif">${label}</div>`);
    files.push({ name: fileName, mimeType: "image/png", buffer: await painter.locator("div").screenshot() });
  }
  await painter.close();
  await paceStore(room);
  await openAdmin(page, `${config.store}/_emdash/admin/media`);
  await page.getByRole("button", { name: "Upload Files" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Upload to Library" });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), dialog.getByRole("button", { name: "Browse files", exact: true }).click()]);
  await chooser.setFiles(files);
  // The dialog lists the files it takes, uploads a few at a time, and offers Done once none is queued or
  // uploading. A row then reads Complete, once the library has the photo for good (a photo it already had
  // included), or "Upload failed"; one still going when the time is up didn't go up either. Every file is
  // read, so the error names each one missed.
  if (await dialog.getByRole("listitem").first().waitFor({ timeout: 15_000 }).then(() => true, () => false)) {
    await dialog.getByRole("button", { name: "Done", exact: true }).waitFor({ timeout: 60_000 + files.length * 5_000 }).catch(() => {});
  }
  const missed = [];
  for (const { name } of files) {
    const shown = await text(dialog.getByRole("listitem").filter({ hasText: name }));
    if (!/\bComplete\b/.test(shown)) missed.push({ name, shown: shown || `${name}: no upload listed` });
  }
  if (missed.length) {
    const error = new Error(files.length === 1 ? `The Media library didn't take the photo: "${missed[0].shown}".`
      : `The Media library didn't take ${missed.length} of the ${files.length} photos: ${missed.map(({ shown }) => `"${shown}"`).join(", ")}.`);
    // The files that didn't go up, so a caller can upload just those again.
    error.missed = missed.map(({ name }) => name);
    throw error;
  }
  await dialog.getByRole("button", { name: "Done" }).click();
}

/**
 * Chooses the Media library photo `fileName` as the product's image in the open panel. Commerce's
 * picker lists the library twelve photos at a time, newest first, so it turns the picker's pages until
 * it finds the photo. Returns the photo's Use button just before it's pressed, so a caller can read the
 * picture above it.
 */
export async function choosePhoto(panel, fileName, { beforeUse = async () => {} } = {}) {
  await panel.getByRole("button", { name: /^(Choose|Change) image$/ }).click();
  const use = panel.getByRole("button", { name: `Use ${fileName}`, exact: true });
  const shown = () => panel.getByRole("button", { name: /^Use / }).evaluateAll(buttons => buttons.map(button => button.textContent));
  for (;;) {
    if (!await panel.getByRole("button", { name: /^Use / }).first().waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
      throw new Error("Commerce's image picker shows no photos to use.");
    }
    if (await use.count()) break;
    const next = panel.getByRole("button", { name: "Next", exact: true });
    if (!await next.count()) throw new Error(`Commerce's image picker doesn't offer ${fileName}.`);
    const before = await shown();
    await paceStore(PICKER_PAGE_ROOM);
    await next.click();
    await expect.poll(shown, { timeout: 30_000 }).not.toEqual(before);
  }
  await beforeUse(use);
  await panelSays(panel, () => use.click(), "Image saved");
}

/** An EmDash editor's field by its label; an editor without it fails with that plain reason. */
export async function field(page, label, editor) {
  const box = page.getByRole("textbox", { name: label, exact: true });
  if (!await box.waitFor({ timeout: 30_000 }).then(() => true, () => false)) throw new Error(`${editor} has no "${label}" field.`);
  return box;
}

/** The slug EmDash makes from the title, once it has made one. */
export async function slugOf(page) {
  const slug = page.getByRole("textbox", { name: "Slug", exact: true });
  await expect.poll(() => slug.inputValue(), quick).not.toBe("");
  return slug.inputValue();
}

/**
 * Saves a new EmDash entry and returns its editor's address. When the editor doesn't move there, the
 * address comes from EmDash's answer to the save; null when neither says, though the entry may exist.
 */
export async function saveNew(page, collection) {
  const saved = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === `/_emdash/api/content/${collection}`, { timeout: 30_000 });
  saved.catch(() => {});
  await page.getByRole("button", { name: "Save", exact: true }).click();
  if (await page.waitForURL(url => !url.pathname.endsWith("/new"), { timeout: 30_000 }).then(() => true, () => false)) return page.url();
  const id = await saved.then(response => response.json()).then(body => body?.data?.item?.id, () => null);
  return typeof id === "string" && id ? `${config.store}/_emdash/admin/content/${collection}/${id}` : null;
}

/** Publishes the open EmDash entry; a refusal fails with the reason the admin gives. */
export async function publish(page, collection) {
  const published = page.waitForResponse(r => r.request().method() === "POST" && new RegExp(`/_emdash/api/content/${collection}/[^/]+/publish`).test(r.url()), { timeout: 30_000 });
  // When the click or the question fails first, this wait's own failure mustn't go unhandled; awaiting it below still fails the step.
  published.catch(() => {});
  // An entry published before, with changes saved since, offers Publish changes instead.
  const button = page.getByRole("button", { name: /^Publish (now|changes)$/ }).first();
  const label = await button.getAttribute("aria-label") ?? (await button.innerText()).trim();
  await button.click();
  await answer(page, `${label}?`, label);
  const response = await published;
  if (response.ok()) return;
  const body = await response.json().catch(() => null);
  throw new Error(body?.error?.message ?? `HTTP ${response.status()}`);
}

/**
 * Adds a category and publishes it. `made` learns its store address before the save and its editor
 * once saved (or that the save left it somewhere unknown), so a caller can take it off the store again.
 */
export async function addCategory(content, title, made) {
  await openAdmin(content, `${config.store}/_emdash/admin/content/categories/new`);
  await (await field(content, "Category title", "The new category editor")).fill(title);
  made.categoryPath = `/categories/${await slugOf(content)}`;
  made.category = await saveNew(content, "categories") ?? "";
  if (!made.category) {
    made.lost.push(`category "${title}"`);
    throw new Error(`Saving the category "${title}" never opened its editor, and EmDash's answer didn't say where it is.`);
  }
  await publish(content, "categories").catch(error => { throw new Error(`Publishing the category failed: ${firstLine(error)}`); });
}

/**
 * Adds a product page titled `title`, drawn in `style`, puts it in the category `category` and saves
 * it, unpublished: a page gets its Commerce product in its panel once saved, and goes on sale when
 * published. `made` learns its address and editor as `addCategory` tells them.
 */
export async function addProductPage(content, { title, style, category }, made) {
  await openAdmin(content, `${config.store}/_emdash/admin/content/products/new`);
  const editor = "The new product page editor";
  await at("the title", async () => (await field(content, "Product title", editor)).fill(title));
  await at("the style", async () => (await field(content, STYLE, editor)).fill(style));
  made.pagePath = `/products/${await at("the slug", () => slugOf(content))}`;
  made.page = await at("the first Save", () => saveNew(content, "products")) ?? "";
  if (!made.page) {
    made.lost.push(`product page "${title}"`);
    throw new Error(`Saving the product page "${title}" never opened its editor, and EmDash's answer didn't say where it is.`);
  }
  await fileInCategory(content, category);
}

/**
 * Runs `act`, and when it fails says which part of the page's editor stopped (`part`, one of a fixed
 * few, which the public run page may print as the failure's kind says).
 */
async function at(part, act) {
  try {
    return await act();
  } catch (error) {
    throw new Error(`At ${part} of the product page: ${firstLine(error)}`);
  }
}

const STYLE = "Illustration style (TEE, HOODIE, CAP, or BEANIE)";

/**
 * Finishes the product page open in `content`: it gets the style `style` when it has none and goes in
 * the category `category` unless it's there, and is saved. True when that changed the page, so a
 * published page needs its changes published.
 */
export async function finishProductPage(content, { style, category }) {
  const box = await field(content, STYLE, "The product page editor");
  const styled = !(await box.inputValue()).trim();
  if (styled) await box.fill(style);
  return await fileInCategory(content, category, { mayBeFiled: true }) || styled;
}

/** Puts the open product page in `category` unless it already is, and saves it. True when it added the category. */
async function fileInCategory(content, category, { mayBeFiled = false } = {}) {
  const filed = content.getByRole("button", { name: `Remove ${category}` });
  const adding = !mayBeFiled || !await filed.waitFor({ timeout: 5_000 }).then(() => true, () => false);
  if (adding) {
    await at("Add reference", () => content.getByRole("button", { name: "Add reference" }).click());
    const picker = content.getByRole("dialog", { name: "Add references" });
    await at("the category search", () => picker.getByPlaceholder("Search content...").fill(category));
    await at("the category choice", () => picker.locator("label").filter({ hasText: category }).first().click({ timeout: 15_000 }));
    await at("Add selected", () => picker.getByRole("button", { name: "Add selected" }).click());
    await at("the filed category", () => filed.waitFor({ timeout: 15_000 }));
  }
  await at("Save", () => saveEditor(content));
  return adding;
}

/** Publishes the product page open in `content`, which is what puts its product on sale. */
export async function publishProductPage(content) {
  await saveEditor(content);
  await publish(content, "products").catch(error => { throw new Error(`Publishing the product page failed: ${firstLine(error)}`); });
}

/**
 * Publishes the product page open in `content` again, as an owner does to put a restored product back
 * on sale: a published page with nothing new to publish offers only Unpublish, so it's unpublished first.
 */
export async function republishProductPage(content) {
  const unpublish = content.getByRole("button", { name: /^Unpublish / });
  if (await unpublish.count()) {
    await unpublish.first().click();
    if (!await content.getByRole("button", { name: /^Publish (now|changes)$/ }).first().waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
      throw new Error("Unpublishing the product page didn't bring back its Publish button.");
    }
  }
  await publishProductPage(content);
}

/**
 * EmDash's `collection` entry titled `title`, as its list shows it once searched for: its editor's
 * address, and where its "View published" link goes when the list shows it as Published (else null).
 * When the list shows more than one entry by that title, it's a published one if there is one. Null when
 * the list has no entry by that title; a list that doesn't answer fails instead, so a slow list never gets
 * the entry added twice.
 */
async function listedEntry(page, title, collection) {
  await openAdmin(page, `${config.store}/_emdash/admin/content/${collection}`);
  // The list asks EmDash for the entries that match the search, then draws them.
  const searched = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === `/_emdash/api/content/${collection}` && [...url.searchParams.values()].includes(title);
  }, { timeout: 30_000 });
  searched.catch(() => {});
  await page.getByRole("searchbox", { name: `Search ${collection}` }).fill(title);
  const edit = page.getByRole("link", { name: `Edit ${title}`, exact: true });
  const view = page.getByRole("link", { name: `View published ${title}`, exact: true });
  // EmDash's answer to the search settles the list, and so does the list saying it has no results. An
  // entry's row alone doesn't: until the answer comes, the list shows its latest entries, which may hold
  // one of two entries by this title.
  const none = page.getByText(`No results for "${title}"`, { exact: true });
  const answer = await Promise.race([
    searched.then(response => response.ok() ? "answered" : `HTTP ${response.status()}`, () => "silent"),
    none.waitFor({ timeout: 30_000 }).then(() => "none", () => "silent"),
  ]);
  if (answer.startsWith("HTTP")) throw new Error(`EmDash refused to search its ${collection} for "${title}" (${answer}).`);
  // Until it has drawn the answer, the list marks itself busy and keeps showing the entries it had before;
  // it draws the answer and drops the mark in one go.
  if (!await page.locator('table[aria-busy="true"]').waitFor({ state: "detached", timeout: 30_000 }).then(() => true, () => false)) {
    throw new Error(`EmDash's list of ${collection} didn't finish showing its answer to the search for "${title}" within 30 seconds.`);
  }
  // A list that answered neither way may never have searched, so then only an entry it shows counts.
  if (answer === "silent" && !await edit.count()) throw new Error(`EmDash's list of ${collection} didn't answer the search for "${title}" within 30 seconds.`);
  if (!await edit.count()) return null;
  // An entry's Edit and View published links are read from its own row (from the page, should the list stop
  // drawing rows). The list draws View published with the rest of the row, and only for a published entry,
  // including one with changes saved since it was published (its status then says so too).
  const rows = page.getByRole("row").filter({ has: edit });
  const published = rows.filter({ has: view }).first();
  const scope = await published.count() ? published : await rows.count() ? rows.first() : page;
  const link = scope.getByRole("link", { name: `View published ${title}`, exact: true }).first();
  const href = await link.count() ? await link.getAttribute("href") : null;
  const editor = await scope.getByRole("link", { name: `Edit ${title}`, exact: true }).first().getAttribute("href");
  return { editor: new URL(editor, config.store).href, view: href === null ? null : new URL(href, config.store).href };
}

/**
 * The full address the "View published" link in EmDash's list of `collection` entries (product pages
 * unless named) goes to for this title, once the list shows the entry as Published; null when it doesn't.
 */
export async function publishedLink(page, title, collection = "products") {
  return (await listedEntry(page, title, collection))?.view ?? null;
}

/**
 * EmDash's product page titled `title`: its editor's address and whether it's published; null when
 * EmDash's list of product pages has none.
 */
export async function productPageEntry(page, title) {
  const entry = await listedEntry(page, title, "products");
  return entry && { editor: entry.editor, published: entry.view !== null };
}

/** Moves an EmDash entry to the Trash, so the store stops showing it. */
export async function trash(page, url) {
  await openAdmin(page, url);
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await answer(page, "Move to Trash?", "Move to Trash");
  await page.waitForURL(next => !next.href.startsWith(url.split("?")[0]), { timeout: 30_000 });
}
