import assert from "node:assert/strict";
import test from "node:test";
import {
  accountReading, betaPaymentsStatusLinks, COMMERCE_INSTRUCTION, consentReading, CONNECT_INSTRUCTION, connectedPlugins, isSignInLink, storePlugins,
} from "../support/connect-dinkuskit.mjs";

const STORE = "https://beta.sm0ky.dev";
const ACCOUNT = "https://dinkuskit.com";
const account = lines => lines.join("\n");

test("a store the account already lists is left connected", () => {
  const text = account([
    "Signed in as owner@example.com",
    "Smoky",
    "Your stores",
    "Your store is connected",
    "Status: Approved",
    STORE,
    "Set up your store",
    "Your businesses",
  ]);
  assert.deepEqual(accountReading(text, STORE), { next: "connected" });
});

test("another store, a second business, a wait, or a staff sign-in does not start Connect", () => {
  assert.equal(accountReading(account(["Your store is connected", "https://other.example"]), STORE).next, "stop");
  assert.equal(accountReading(account(["Connect your store", CONNECT_INSTRUCTION, "Your businesses"]), STORE).next, "stop");
  assert.match(accountReading(account(["Waiting for approval", "Status: Waiting for approval"]), STORE).reason, /waiting for approval/);
  assert.match(accountReading(account(["Finish creating your account"]), STORE).reason, /does not create one/);
  assert.match(accountReading(account(["You're on the staff of Smoky", "Status: Approved"]), STORE).reason, /staff/);
  assert.equal(accountReading(account(["Connect your store", "Press something else."]), STORE).next, "stop");
});

test("Connect is only the Payments or Commerce instruction on an account with one business and no store", () => {
  assert.deepEqual(accountReading(account([
    "Connect your store",
    "Status: Approved",
    CONNECT_INSTRUCTION,
  ]), STORE), { next: "connect", plugin: "Payments" });
  // dinkuskit#70 starts with Commerce's Connect.
  assert.deepEqual(accountReading(account([
    "Connect your store",
    "Status: Approved",
    COMMERCE_INSTRUCTION,
  ]), STORE), { next: "connect", plugin: "Commerce" });
  assert.equal(accountReading(account(["Connect your store", COMMERCE_INSTRUCTION, "Your businesses"]), STORE).next, "stop");
});

test("Approve stays unpressed unless the page is this store's Payments consent", () => {
  const ready = account([
    "Connect this store?",
    "Service: payments",
    "Payments status and processor setup access; this does not grant checkout access.",
    `Site origin: ${STORE}`,
  ]);
  assert.deepEqual(consentReading(ready, STORE), { ok: true });
  assert.equal(consentReading(ready.replace(STORE, "https://other.example"), STORE).ok, false);
  assert.equal(consentReading(ready.replace("Service: payments", "Service: inventory"), STORE).ok, false);
  assert.match(consentReading(`${ready}\nThis connection is no longer waiting for consent.`, STORE).reason, /no longer waiting/);
});

test("Approve commerce and Approve ship need their own consent paragraphs, and Payments' longer one still counts", () => {
  const consent = (service, says) => account(["Connect this store?", `Service: ${service}`, says, `Site origin: ${STORE}`]);
  const commerce = "Commerce gets its own store key. It uses it for checkout with Payments, for sending paid orders to Ship when Ship is on, and for reading the checkout settings you choose here. Approving also registers this store's web address with your business.";
  const ship = "The Ship plugin gets its own store key, for the Shipping page in your store's admin. It works only while Ship is turned on for this store.";
  const payments = "Payments status and processor setup access; this does not grant checkout access. The Payments plugin also gets its own store key for its status page.";
  assert.deepEqual(consentReading(consent("commerce", commerce), STORE, "commerce"), { ok: true });
  assert.deepEqual(consentReading(consent("ship", ship), STORE, "ship"), { ok: true });
  assert.deepEqual(consentReading(consent("payments", payments), STORE), { ok: true });
  // The service on the page has to be the one this run's plugin asked for.
  assert.match(consentReading(consent("ship", ship), STORE, "commerce").reason, /not asking to connect Commerce/);
  assert.match(consentReading(consent("commerce", payments), STORE, "commerce").reason, /describe Commerce access/);
  assert.match(consentReading(consent("inventory", "Inventory."), STORE, "inventory").reason, /doesn't approve inventory/);
});

test("Your Stores' Connected plugins lines read as connected or not, for this store only", () => {
  const lines = [
    "Commerce plugin: connected 2026-10-22 15:04 UTC, not used yet",
    "Payments plugin: not connected. Press Connect in the Payments plugin in EmDash, after Commerce.",
    "Ship plugin: not connected. Press Connect in the Ship plugin in EmDash, after Commerce.",
  ];
  assert.deepEqual(connectedPlugins(lines), { commerce: true, payments: false, ship: false });
  assert.deepEqual(connectedPlugins(["Commerce plugin: not connected. Press Connect in the Commerce plugin in EmDash.", "Store key: none yet"]), { commerce: false });
  assert.deepEqual(storePlugins([{ origin: "https://other.example", items: lines }, { origin: STORE, items: lines.slice(1) }], `${STORE}/`), {
    plugins: { payments: false, ship: false },
  });
  assert.match(storePlugins([{ origin: "https://other.example", items: lines }], STORE).error, /no Connected plugins list for https:\/\/beta\.sm0ky\.dev/);
  assert.match(storePlugins([{ origin: STORE, items: lines }, { origin: STORE, items: lines }], STORE).error, /2 Connected plugins lists/);
});

test("a DinkusKit sign-in link is told apart from the account page", () => {
  assert.equal(isSignInLink(`${ACCOUNT}/api/auth/magic-link/verify?token=secret`), true);
  assert.equal(isSignInLink(`${ACCOUNT}/account`), false);
});

test("only the beta Payments status page on this store is the Connect page", () => {
  const beta = `${STORE}/_emdash/admin/plugins/r_sffx6l4z6mpqliki/status`;
  const stable = `${STORE}/_emdash/admin/plugins/r_3brsc2on3bu673rn/status`;
  assert.deepEqual(betaPaymentsStatusLinks([
    `${STORE}/_emdash/admin`,
    stable,
    beta,
    "https://other.example/_emdash/admin/plugins/r_sffx6l4z6mpqliki/status",
    `${beta}?view=full`,
    "/_emdash/admin/plugins/r_sffx6l4z6mpqliki/status",
    `${beta}#top`,
    "http://[not a url",
  ], STORE), [beta]);
});
