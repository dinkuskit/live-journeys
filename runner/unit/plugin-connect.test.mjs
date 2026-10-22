import assert from "node:assert/strict";
import test from "node:test";
import { COMMERCE_CONNECT, SHIP_CONNECT, connectPlugin, nextConnect, readConnect } from "../support/plugin-connect.mjs";
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
  const connected = readConnect(commercePage([`Connected to DinkusKit.com, store ${SITE}.`]), COMMERCE_CONNECT);
  assert.deepEqual(await connectPlugin(null, { texts: COMMERCE_CONNECT, read: async () => ({ reading: connected, buttons: [] }) }), { siteId: SITE, connected: false });
});
