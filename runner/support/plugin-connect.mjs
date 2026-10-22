import { approveAtDinkusKit, failClosed, showsSecret } from "./dinkuskit-approve.mjs";
import { BETA_STORE } from "./store-updates.mjs";

// Connect to DinkusKit in Commerce and Ship (store-connect-per-plugin-key-080, store-connect-flow-081): an
// Administrator presses Connect on the plugin's page, the business owner approves at DinkusKit.com, and
// DinkusKit.com hands the plugin its own store key. Commerce connects first; Ship's Connect is refused until
// it has. Both draw the same Block Kit: a "Connect <plugin>" banner with Connect (Connect again once a key
// stopped working), then "Approve at DinkusKit.com" with that link, Check and Cancel while the owner's
// approval waits, and the plugin's connected page after. Texts are dinkuskit/commerce src/admin/connect.ts
// and dinkuskit/ship src/pages.ts.

export const APPROVE_LINK = "Approve at DinkusKit.com";
const NOT_APPROVED = "Not approved yet.";
const COMMERCE_FIRST = "Connect Commerce first.";
// How many times Check is pressed after this run's approval before the run stops waiting.
const CHECKS = 4;
const CHECK_PAUSE = 5_000;

// Commerce's DinkusKit section on its Settings page. Only the lines from its heading on are read.
export const COMMERCE_CONNECT = {
  plugin: "Commerce",
  service: "commerce",
  section: "DinkusKit",
  asks: ["Connect Commerce"],
  invite: "Connect this store to DinkusKit.com first, then Payments and Ship. The business owner approves at DinkusKit.com.",
  connected: /^Connected to DinkusKit\.com, store (\S+)\.$/,
  adminOnly: "An Administrator connects Commerce on this page.",
};

// Ship's Shipping page. Connected, it shows Ship's orders (or why it couldn't read them) with an Open Ship
// link to this store's orders at Ship, which names the store it is connected to.
export const SHIP_CONNECT = {
  plugin: "Ship",
  service: "ship",
  section: "Shipping",
  asks: ["Connect Ship", "Connect Ship again"],
  invite: "Connect this plugin to DinkusKit.com so it can buy labels through Ship. Commerce connects first; the business owner approves at DinkusKit.com.",
  connected: null,
  adminOnly: "Ask an Administrator of this site to press Connect on this page.",
};

const linesOf = text => String(text ?? "").split("\n").map(line => line.trim()).filter(Boolean);

/**
 * What a plugin's Connect shows, from its page's text: the store it is connected to (`siteId`, for a page
 * that names it), an approval waiting at DinkusKit.com, or a Connect it asks for, with the reason it gives
 * when that isn't the first one. `notUpdated` is Commerce's reason it couldn't get its checkout settings.
 */
export function readConnect(text, plugin) {
  const lines = linesOf(text);
  const from = lines.indexOf(plugin.section);
  const shown = from === -1 ? [] : lines.slice(from + 1);
  const after = title => shown[shown.indexOf(title) + 1] ?? "";
  const asks = plugin.asks.find(title => shown.includes(title));
  const said = asks ? after(asks) : "";
  const connected = plugin.connected ? shown.map(line => line.match(plugin.connected)).find(Boolean) : null;
  return {
    section: from !== -1,
    siteId: connected?.[1] ?? null,
    pending: shown.includes(APPROVE_LINK),
    notApproved: shown.includes(NOT_APPROVED),
    asksToConnect: Boolean(asks),
    failure: asks && said !== plugin.invite && said !== plugin.adminOnly ? said : "",
    commerceFirst: shown.some(line => line.startsWith(COMMERCE_FIRST)),
    adminOnly: shown.includes(plugin.adminOnly),
    notUpdated: shown.includes("Checkout settings not updated") ? after("Checkout settings not updated") : null,
  };
}

/**
 * The next press on a plugin's Connect, or "connected". Connect (or Connect again) is pressed only when the
 * page asks for it, and only once a run. The Approve link is followed only for a Connect this run started,
 * and Check only after this run's approval. A Connect that was already waiting when the run came is
 * cancelled first, so the run approves only what it started; Cancel keeps any key the plugin already has.
 */
export function nextConnect(reading, buttons, { plugin, service, started = false, approved = false, checks = 0 }) {
  const blocked = because => ({ action: "blocked", because });
  const press = name => ({ action: "press", name });
  if (reading.siteId) return { action: "connected", siteId: reading.siteId };
  if (reading.adminOnly) return blocked(`${plugin} says only an Administrator connects it, and the store admin sign-in isn't one.`);
  if (reading.commerceFirst) return blocked(`${plugin} says to connect Commerce first: Commerce's own Connect hasn't finished for this store.`);
  if (reading.pending) {
    if (!started) return buttons.includes("Cancel") ? press("Cancel") : blocked(`${plugin} waits for an approval this run didn't start, and offers no Cancel.`);
    if (!approved) return { action: "approve" };
    if (checks >= CHECKS) return blocked(`${plugin} still waits for DinkusKit.com after this run's Approve ${service}${reading.notApproved ? `: "${NOT_APPROVED}"` : "."}`);
    return buttons.includes("Check") ? press("Check") : blocked(`${plugin} waits for DinkusKit.com after this run's Approve ${service}, and offers no Check.`);
  }
  if (reading.asksToConnect) {
    if (started) return blocked(`${plugin} still asks to connect after this run's Connect${reading.failure ? `: "${reading.failure}"` : "."}`);
    const name = ["Connect", "Connect again"].find(label => buttons.includes(label));
    return name ? press(name) : blocked(`${plugin} asks to connect, but offers no Connect.`);
  }
  return blocked(`${plugin}'s page shows no connection to DinkusKit.com and no Connect.`);
}

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * What a request the browser sent would change, or null: a press on a plugin page (Block Kit's block_action
 * or form_submit), a save of a plugin's settings form, or anything but a read sent to DinkusKit.com. A
 * plugin page's own load (page_load) changes nothing the run chose. Only the method and path are named.
 */
export function pressSent({ method, url, body }, { store, account }) {
  if (READS.has(String(method).toUpperCase())) return null;
  let target;
  try { target = new URL(url); } catch { return null; }
  if (target.origin === new URL(account).origin) return `${method} ${target.pathname} at DinkusKit.com`;
  if (target.origin !== new URL(store).origin) return null;
  let path = target.pathname;
  try { path = decodeURIComponent(path); } catch {}
  if (/^\/_emdash\/api\/admin\/plugins\/[^/]+\/settings$/.test(path)) return `${method} ${path}`;
  let type = null;
  try { type = JSON.parse(body ?? "")?.type ?? null; } catch {}
  return type === "block_action" || type === "form_submit" ? `${type} ${path}` : null;
}

/**
 * Runs `run` and lists each press or change the browser sent meanwhile, from any page of the run's browser
 * (pressSent says which count). Returns { outcome: what run returned, sent }.
 */
export async function recordPresses(context, settings, run) {
  const sent = [];
  const onRequest = request => {
    const press = pressSent({ method: request.method(), url: request.url(), body: request.postData() }, settings);
    if (press) sent.push(press);
  };
  context.on("request", onRequest);
  try {
    return { outcome: await run(), sent };
  } finally {
    context.off("request", onRequest);
  }
}

/** The visible buttons in the page's main area. */
export async function mainButtons(page) {
  return (await page.locator("main").getByRole("button").allInnerTexts()).map(label => label.trim()).filter(Boolean);
}

/** The page's main text, or a blank page and a failure if it shows anything secret. */
export async function mainText(page, plugin) {
  const text = await page.locator("main").innerText();
  if (showsSecret(text)) await failClosed(page, `${plugin}'s page showed a store key or session secret. It was not kept.`);
  return text;
}

/** Presses the one button named `name` in the page's main area and waits for the page to answer. */
export async function pressButton(page, name, plugin) {
  const main = page.locator("main");
  const button = main.getByRole("button", { name, exact: true });
  const count = await button.count();
  if (count !== 1) throw new Error(`${plugin}'s page has ${count} buttons named ${name}, not one.`);
  const before = await main.innerText();
  await button.click();
  await page.waitForFunction(previous => {
    const shown = document.querySelector("main");
    return shown && shown.innerText !== previous;
  }, before, { timeout: 60_000 }).catch(() => {});
}

/**
 * Walks a plugin's Connect until its page says it is connected, and returns { siteId, connected }:
 * `connected` is true when this run connected it. `open` opens the plugin's page, `read` reads it as
 * { reading, buttons }, `landing` is the page's path DinkusKit.com sends the owner back to, and `ready`
 * finds the page's heading. `started` says the run already pressed Connect again before handing over.
 * Without `mayConnect` a plugin that isn't connected fails before anything is pressed.
 */
export async function connectPlugin(page, { texts, open, read, landing, ready, started = false, mayConnect = false }) {
  const { plugin, service } = texts;
  let approved = false;
  let checks = 0;
  for (let turn = 0; turn < 10; turn++) {
    const { reading, buttons } = await read(page);
    const decision = nextConnect(reading, buttons, { plugin, service, started, approved, checks });
    if (decision.action === "connected") return { siteId: decision.siteId, connected: started };
    if (decision.action === "blocked") throw new Error(decision.because);
    // Connect, Cancel and Approve change which DinkusKit.com store the plugin answers to, or stop a Connect.
    if (!mayConnect) throw new Error(`${plugin} isn't connected to DinkusKit.com, and only the beta store, ${BETA_STORE.store}, gets a plugin connected by a run.`);
    if (decision.action === "approve") {
      const href = await page.locator("main").getByRole("link", { name: APPROVE_LINK, exact: true }).first().getAttribute("href");
      await approveAtDinkusKit(page, { link: APPROVE_LINK, href, service, landing, ready });
      approved = true;
      // The plugin's page checks a waiting Connect when it loads, once DinkusKit.com's poll interval has passed.
      await open(page);
      continue;
    }
    if (decision.name === "Check") {
      checks++;
      await page.waitForTimeout(CHECK_PAUSE);
    }
    if (decision.name === "Connect" || decision.name === "Connect again") started = true;
    await pressButton(page, decision.name, plugin);
  }
  throw new Error(`${plugin}'s Connect didn't finish.`);
}
