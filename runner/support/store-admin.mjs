import { get } from "./browser.mjs";
import { config } from "./env.mjs";
import { firstLine } from "./errors.mjs";
import { note } from "./proof.mjs";
import { openStoreAdmin } from "./signin.mjs";
import { describePlugins } from "./store-plugins.mjs";
import { text } from "./storefront-page.mjs";

const SIGN_IN_ONCE = "Run once with DINKUS_E2E_ADMIN_SIGNIN=wait and sign in by hand.";

/** Opens a page of the store admin, signing in to its Access app with a one-time PIN when it asks. */
export async function openAdmin(page, url) {
  if (!await openStoreAdmin(page, url, { waitForPerson: config.adminSignIn === "wait" })) {
    throw new Error("The store admin needs a sign-in the test can't make: its Access app offers no one-time PIN and the saved profile has no sign-in. Turn on One-time PIN in the Access app; the request filter blocks other sign-in providers such as Google.");
  }
  // A store whose admin isn't signed in through Access asks for EmDash's own sign-in (passkey or email link).
  if (!new URL(page.url()).pathname.startsWith("/_emdash/admin/login")) return;
  if (config.adminSignIn !== "wait" || config.headless) throw new Error(`The store admin asks for an EmDash sign-in (passkey or email link) that the saved profile doesn't have. ${SIGN_IN_ONCE}`);
  console.log(`\n>>> Sign in to the store admin in this test's browser window (once per profile).\n`);
  await page.waitForURL(next => !next.pathname.startsWith("/_emdash/admin/login"), { timeout: 10 * 60 * 1000 });
  await page.goto(url);
}

/**
 * The open admin menu's links named any of `names`, once the menu lists plugins' pages. A plugin page
 * that names a `group` sits in a sidebar folder of that name (EmDash's sidebar-groups), drawn closed
 * unless one of its pages is open or the owner left it open, and a closed folder hides its links. So
 * each of `folders` the menu shows closed is opened first. Opening one is remembered by the browser,
 * as it is for an owner, and changes nothing on the store.
 */
export async function menuLinks(page, names, folders = []) {
  const links = names.map(name => page.getByRole("link", { name, exact: true })).reduce((all, one) => all.or(one));
  const closed = folders.map(name => page.getByRole("button", { name, exact: true, expanded: false }));
  // The menu lists plugins' pages once the admin has read its plugins.
  await [links, ...closed].reduce((all, one) => all.or(one)).first().waitFor({ timeout: 30_000 }).catch(() => {});
  for (const [index, folder] of closed.entries()) {
    if (await folder.count() !== 1) continue;
    await folder.click();
    await page.getByRole("button", { name: folders[index], exact: true, expanded: true }).waitFor({ timeout: 5_000 }).catch(() => {});
  }
  return links;
}

/**
 * Notes which plugin versions the store runs, so the proof says what it covers, and returns EmDash's
 * plugin list, or null when it couldn't be read.
 */
export async function notePlugins(page) {
  const response = await get(page, `${config.store}/_emdash/api/admin/plugins`, { headers: { "X-EmDash-Request": "1" } }).catch(error => error);
  if (response instanceof Error) note("plugins", `couldn't read the plugin list (${firstLine(response)})`);
  else if (!response.ok()) note("plugins", `couldn't read the plugin list (HTTP ${response.status()})`);
  else {
    const body = await response.json();
    note("plugins", describePlugins(body));
    return body;
  }
  return null;
}

/** Waits for Commerce to confirm an action ("Product saved"); a refusal fails with the reason Commerce shows. */
export async function confirmed(page, message) {
  const done = page.getByText(message, { exact: true }).first();
  const refused = page.locator('main [role="alert"]').first();
  await done.or(refused).waitFor({ timeout: 30_000 }).catch(() => {});
  if (await done.isVisible()) return;
  const reason = await text(refused);
  throw new Error(reason ? `Commerce refused it: "${reason}"` : `Commerce never said "${message}".`);
}
