import assert from "node:assert/strict";
import test from "node:test";
import { COMMERCE_CONNECT, SHIP_CONNECT, connectPlugin, emptyPasswordInput, nextConnect, pressSent, readConnect, recordPresses } from "../support/plugin-connect.mjs";
import { shipStoreFromHref } from "../support/ship-settings.mjs";

const SITE = "858232f9-bc07-44f6-b3de-259a8055a9dd";
const SHIP = "https://ship.dinkuskit.com";
const text = lines => lines.join("\n");
const commerce = { plugin: "Commerce", service: "commerce" };
const ship = { plugin: "Ship", service: "ship" };
const PENDING = "The business owner opens this link, signs in and presses Approve. Anyone helping can send the owner the same link.";

// Commerce Settings as dinkuskit/commerce src/admin/connect.ts draws its DinkusKit section above Catalog.
const commercePage = section => text(["Commerce settings", "Orders", "Products", "Settings", "DinkusKit", ...section, "Catalog", "Hide out-of-stock products"]);
// The Shipping page as dinkuskit/ship src/pages.ts draws it before Ship is connected.
const shipPage = section => text(["Shipping", ...section]);

test("Commerce's DinkusKit section reads as asking, waiting, or connected to its store", () => {
  const asking = readConnect(commercePage(["Connect Commerce", COMMERCE_CONNECT.invite]), COMMERCE_CONNECT);
  assert.equal(asking.section, true);
  assert.equal(asking.asksToConnect, true);
  assert.equal(asking.failure, "");
  assert.equal(asking.siteId, null);
  const waiting = readConnect(commercePage(["Approve at DinkusKit.com", PENDING, "Not approved yet.", "Approve at DinkusKit.com"]), COMMERCE_CONNECT);
  assert.equal(waiting.pending, true);
  assert.equal(waiting.notApproved, true);
  assert.equal(waiting.asksToConnect, false);
  const connected = readConnect(commercePage([`Connected to DinkusKit.com, store ${SITE}.`]), COMMERCE_CONNECT);
  assert.equal(connected.siteId, SITE);
  assert.equal(connected.notUpdated, null);
  const refused = readConnect(commercePage([`Connected to DinkusKit.com, store ${SITE}.`, "Checkout settings not updated", "Connect Payments, then press Get checkout settings."]), COMMERCE_CONNECT);
  assert.equal(refused.notUpdated, "Connect Payments, then press Get checkout settings.");
  const failed = readConnect(commercePage(["Connect Commerce", "DinkusKit.com could not be reached. Try again in a moment."]), COMMERCE_CONNECT);
  assert.equal(failed.failure, "DinkusKit.com could not be reached. Try again in a moment.");
  assert.equal(readConnect(commercePage(["Connect Commerce", COMMERCE_CONNECT.invite, COMMERCE_CONNECT.adminOnly]), COMMERCE_CONNECT).adminOnly, true);
  // Commerce before its Connect release has no DinkusKit section at all.
  const before = readConnect(text(["Commerce settings", "Catalog", "Hide out-of-stock products"]), COMMERCE_CONNECT);
  assert.equal(before.section, false);
  assert.equal(before.asksToConnect, false);
});

test("Ship's page says when Commerce has to connect first, or when its key stopped working", () => {
  const asking = readConnect(shipPage(["Connect Ship", SHIP_CONNECT.invite]), SHIP_CONNECT);
  assert.equal(asking.asksToConnect, true);
  assert.equal(asking.failure, "");
  const first = readConnect(shipPage(["Connect Ship again", "Connect Commerce first. Press Connect in the Commerce plugin, then come back here and press Connect."]), SHIP_CONNECT);
  assert.equal(first.commerceFirst, true);
  assert.deepEqual(nextConnect(first, ["Connect again"], { ...ship, started: true }).action, "blocked");
  assert.match(nextConnect(first, ["Connect again"], ship).because, /connect Commerce first/);
  const stopped = readConnect(shipPage(["Connect Ship again", "Connect did not finish. Press Connect to start again."]), SHIP_CONNECT);
  assert.equal(stopped.failure, "Connect did not finish. Press Connect to start again.");
  assert.deepEqual(nextConnect(stopped, ["Connect again"], ship), { action: "press", name: "Connect again" });
  const editor = readConnect(shipPage(["Connect Ship", SHIP_CONNECT.invite, SHIP_CONNECT.adminOnly]), SHIP_CONNECT);
  assert.match(nextConnect(editor, [], ship).because, /only an Administrator/);
});

test("Ship's page reads the same under its Shipments heading as under Shipping", () => {
  const shipments = section => text(["Shipments", ...section]);
  const asking = readConnect(shipments(["Connect Ship", SHIP_CONNECT.invite]), SHIP_CONNECT);
  assert.equal(asking.section, true);
  assert.equal(asking.asksToConnect, true);
  assert.equal(asking.failure, "");
  const stopped = readConnect(shipments(["Connect Ship again", "Connect did not finish. Press Connect to start again."]), SHIP_CONNECT);
  assert.equal(stopped.failure, "Connect did not finish. Press Connect to start again.");
  assert.equal(readConnect(shipments(["Approve at DinkusKit.com", PENDING, "Approve at DinkusKit.com"]), SHIP_CONNECT).pending, true);
  // Another heading is not Ship's page.
  assert.equal(readConnect(text(["Shipment settings", "Connect Ship", SHIP_CONNECT.invite]), SHIP_CONNECT).section, false);
});

test("Connect is pressed once, Approve follows only this run's Connect, and Check only follows the approval", () => {
  const asking = readConnect(commercePage(["Connect Commerce", COMMERCE_CONNECT.invite]), COMMERCE_CONNECT);
  assert.deepEqual(nextConnect(asking, ["Connect"], commerce), { action: "press", name: "Connect" });
  assert.match(nextConnect(asking, ["Connect"], { ...commerce, started: true }).because, /still asks to connect after this run's Connect\.$/);
  assert.match(nextConnect(asking, [], commerce).because, /offers no Connect/);
  const waiting = readConnect(commercePage(["Approve at DinkusKit.com", PENDING, "Approve at DinkusKit.com"]), COMMERCE_CONNECT);
  // A Connect waiting from before the run is cancelled, never approved.
  assert.deepEqual(nextConnect(waiting, ["Check", "Cancel"], commerce), { action: "press", name: "Cancel" });
  assert.equal(nextConnect(waiting, ["Check"], commerce).action, "blocked");
  assert.deepEqual(nextConnect(waiting, ["Check", "Cancel"], { ...commerce, started: true }), { action: "approve" });
  assert.deepEqual(nextConnect(waiting, ["Check", "Cancel"], { ...commerce, started: true, approved: true }), { action: "press", name: "Check" });
  const still = readConnect(commercePage(["Approve at DinkusKit.com", PENDING, "Not approved yet.", "Approve at DinkusKit.com"]), COMMERCE_CONNECT);
  assert.match(nextConnect(still, ["Check", "Cancel"], { ...commerce, started: true, approved: true, checks: 4 }).because, /after this run's Approve commerce: "Not approved yet\."/);
  const connected = readConnect(commercePage([`Connected to DinkusKit.com, store ${SITE}.`]), COMMERCE_CONNECT);
  assert.deepEqual(nextConnect(connected, ["Get checkout settings", "Connect again"], commerce), { action: "connected", siteId: SITE });
  assert.match(nextConnect(readConnect(commercePage([]), COMMERCE_CONNECT), [], commerce).because, /no connection to DinkusKit\.com and no Connect/);
});

test("Ship's Open Ship link names the store only when it is this Ship's orders page", () => {
  assert.equal(shipStoreFromHref(`${SHIP}/stores/${SITE}/orders`, SHIP), SITE);
  assert.equal(shipStoreFromHref(`${SHIP}/stores/a%2Fb/orders`, SHIP), "a/b");
  for (const href of [
    `https://ship.example/stores/${SITE}/orders`,
    `${SHIP}/stores/${SITE}/settings`,
    `${SHIP}/stores/${SITE}/orders/o_1?view=full`,
    `${SHIP}/stores/${SITE}/orders?view=full`,
    `${SHIP}/stores/${SITE}/orders#top`,
    "/stores/x/orders",
    null,
  ]) assert.equal(shipStoreFromHref(href, SHIP), null, String(href));
});

test("a run that may not connect presses nothing on a plugin that isn't connected", async () => {
  const asking = readConnect(commercePage(["Connect Commerce", COMMERCE_CONNECT.invite]), COMMERCE_CONNECT);
  const read = async () => ({ reading: asking, buttons: ["Connect"] });
  // The page is never touched: a press would need it.
  await assert.rejects(connectPlugin(null, { texts: COMMERCE_CONNECT, read }), /only the beta store, https:\/\/beta\.sm0ky\.dev, gets a plugin connected/);
  // A Connect left waiting is not cancelled either: Cancel is a press too.
  const waiting = readConnect(commercePage(["Approve at DinkusKit.com", PENDING]), COMMERCE_CONNECT);
  await assert.rejects(connectPlugin(null, { texts: COMMERCE_CONNECT, read: async () => ({ reading: waiting, buttons: ["Check", "Cancel"] }) }), /only the beta store/);
  const connected = readConnect(commercePage([`Connected to DinkusKit.com, store ${SITE}.`]), COMMERCE_CONNECT);
  assert.deepEqual(await connectPlugin(null, { texts: COMMERCE_CONNECT, read: async () => ({ reading: connected, buttons: [] }) }), { siteId: SITE, connected: false });
});

test("a press or settings save counts as sent, and a plugin page's own load does not", () => {
  const settings = { store: "https://beta.sm0ky.dev", account: "https://dinkuskit.com" };
  const sent = (method, url, body) => pressSent({ method, url, body }, settings);
  const admin = "https://beta.sm0ky.dev/_emdash/api/plugins/r_commerce/admin";
  assert.equal(sent("POST", admin, JSON.stringify({ type: "page_load", page: "/settings" })), null);
  assert.equal(sent("POST", admin, JSON.stringify({ type: "panel_load" })), null);
  assert.equal(sent("POST", admin, JSON.stringify({ type: "block_action", action_id: "connect.start" })), "block_action /_emdash/api/plugins/r_commerce/admin");
  assert.equal(sent("POST", admin, JSON.stringify({ type: "form_submit", action_id: "settings", values: {} })), "form_submit /_emdash/api/plugins/r_commerce/admin");
  assert.equal(sent("GET", admin), null);
  assert.equal(sent("PUT", "https://beta.sm0ky.dev/_emdash/api/admin/plugins/r_commerce/settings", "{}"), "PUT /_emdash/api/admin/plugins/r_commerce/settings");
  // Anything but a read at DinkusKit.com is sent, and named without its query, where a connection id would be.
  assert.equal(sent("POST", "https://dinkuskit.com/account/connect?connection_id=abc", "action=approve"), "POST /account/connect at DinkusKit.com");
  assert.equal(sent("GET", "https://dinkuskit.com/account/connect?connection_id=abc"), null);
  // Another site's requests, a store request that isn't JSON, and an address that doesn't parse are not presses.
  assert.equal(sent("POST", "https://api.stripe.com/v1/payment_methods", "card=x"), null);
  assert.equal(sent("POST", "https://beta.sm0ky.dev/_emdash/api/auth/session", "not json"), null);
  assert.equal(sent("POST", "not a url", "{}"), null);
});

test("presses are recorded only while the walk runs, from every page of the browser", async () => {
  const listeners = new Set();
  const context = { on: (event, fn) => listeners.add(fn), off: (event, fn) => listeners.delete(fn) };
  const request = (method, url, body = null) => ({ method: () => method, url: () => url, postData: () => body });
  const emit = r => { for (const fn of listeners) fn(r); };
  const settings = { store: "https://beta.sm0ky.dev", account: "https://dinkuskit.com" };
  const quiet = await recordPresses(context, settings, async () => {
    emit(request("POST", "https://beta.sm0ky.dev/_emdash/api/plugins/r_ship/admin", JSON.stringify({ type: "page_load", page: "/shipping" })));
    return "read only";
  });
  assert.deepEqual(quiet, { outcome: "read only", sent: [] });
  const pressed = await recordPresses(context, settings, async () => {
    emit(request("POST", "https://beta.sm0ky.dev/_emdash/api/plugins/r_ship/admin", JSON.stringify({ type: "block_action", action_id: "connect" })));
  });
  assert.deepEqual(pressed.sent, ["block_action /_emdash/api/plugins/r_ship/admin"]);
  // The recorder lets go of the browser when the walk ends, even when it throws.
  await assert.rejects(recordPresses(context, settings, async () => { throw new Error("stopped"); }), /stopped/);
  assert.equal(listeners.size, 0);
});

test("only an empty password field counts as empty, so a stored connection sent back to the page fails", () => {
  const had = globalThis.HTMLInputElement;
  class HTMLInputElement { constructor(type, value) { this.type = type; this.value = value; } }
  globalThis.HTMLInputElement = HTMLInputElement;
  try {
    assert.equal(emptyPasswordInput(new HTMLInputElement("password", "")), true);
    assert.equal(emptyPasswordInput(new HTMLInputElement("password", "{\"siteId\":\"x\"}")), false);
    assert.equal(emptyPasswordInput(new HTMLInputElement("text", "")), false);
    assert.equal(emptyPasswordInput({ type: "password", value: "" }), false);
  } finally {
    if (had === undefined) delete globalThis.HTMLInputElement; else globalThis.HTMLInputElement = had;
  }
});
