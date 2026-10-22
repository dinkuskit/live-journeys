import assert from "node:assert/strict";
import test from "node:test";
import { authorizeHref, nextPress, readStatusText, readsWithStoreKey, redact, showsSecret } from "../support/payments-status.mjs";

const store = "https://store.example";
const account = "https://dinkuskit.com";
const connectLine = "Connect payments: Not complete. Connect your DinkusKit account to check payment setup. No Payments service endpoint is configured.";
const connectedLine = "Connect payments: Connected: Stripe test mode. Test card payments work at checkout. Real customer payments need a live Stripe connection, which isn't set up yet.";
// Payments 0.3.0 (dinkuskit/payments#76) before the owner pastes a store key, and Payments 0.2 after its sign-in lapsed.
const storeKeyLine = "Connect payments: Not checked. Paste the store key from the Set up Commerce box on DinkusKit.com into this plugin's settings (Store key), the same key Commerce uses. This page trades it for a short pass each time it checks your payment status. Then select Check connection.";
const lastCheckForKey = "Last checked Oct 21, 2026 at 10:15 PM UTC. Paste the store key in this plugin's settings so this page can check it now. Checkout isn't affected.";
const lastCheckForSignIn = "Last checked Oct 21, 2026 at 10:15 PM UTC. This page's DinkusKit sign-in lasts 5 minutes, so select Sign in again to check it now. Checkout doesn't use this sign-in.";

test("the known connect line asks for Connect and a verified test connection does not", () => {
  const asking = readStatusText(`Payment setup\nNot ready to sell\n${connectLine}\nPlace a test order: Not complete. Connect payments first, then place a test order.`);
  assert.equal(asking.header, true);
  assert.equal(asking.asksToConnect, true);
  assert.equal(asking.connectedTest, false);
  const connected = readStatusText(`Payment setup\nConnected: Stripe test mode\n${connectedLine}`);
  assert.equal(connected.asksToConnect, false);
  assert.equal(connected.connectedTest, true);
  const disconnected = readStatusText("Connect payments: Not complete. Your payment connection is unavailable, so it could not be checked. Connect your DinkusKit account to continue.");
  assert.equal(disconnected.asksToConnect, true);
  assert.deepEqual(nextPress(disconnected, { buttons: ["Connect"], links: [] }), { action: "press", name: "Connect" });
  assert.equal(readStatusText("Connect payments: Not complete. Select Sign in again to continue.").asksToConnect, false);
});

test("Connect is the press when the page asks, and a verified test connection is left alone", () => {
  assert.deepEqual(nextPress(readStatusText(connectLine), { buttons: ["Connect"], links: [] }), { action: "press", name: "Connect" });
  assert.deepEqual(
    nextPress(readStatusText(`Connected: Stripe test mode\n${connectedLine}`), { buttons: ["Check connection", "Reconnect", "Check provider identity"], links: [] }),
    { action: "leave", because: "Connected: Stripe test mode. Reconnect and Stripe setup were left alone." },
  );
});

test("a lapsed sign-in that still shows Stripe test mode does not press Sign in again", () => {
  assert.equal(nextPress(
    readStatusText(`Connected: Stripe test mode\n${connectedLine}`),
    { buttons: ["Sign in again"], links: [] },
  ).action, "leave");
});

test("a page that asks for the store key fails and presses nothing, whatever the plugin version", () => {
  for (const text of [
    `Payment setup\nPayment status not checked\nThis page couldn't read your payment status. The first step says why. Checkout isn't affected.\n${storeKeyLine}`,
    `Payment setup\nConnected: Stripe test mode\n${lastCheckForKey}\n${connectedLine}`,
    "Payment setup\nPayment status not checked\nConnect payments: Not checked. DinkusKit.com does not know this store key. Paste the current one from the Set up Commerce box into this plugin's settings, or make a new key there.",
  ]) {
    const reading = readStatusText(text);
    assert.equal(reading.asksForStoreKey, true, text);
    for (const storeKeyRead of [false, true]) {
      const decision = nextPress(reading, { buttons: ["Check connection"], links: [] }, { storeKeyRead });
      assert.equal(decision.action, "blocked", text);
      assert.match(decision.because, /never types it/);
    }
  }
});

test("from Payments 0.3.0 the page checks when it opens: Connected passes, Sign in again or only a last check fails", () => {
  assert.equal(readsWithStoreKey("0.3.0-beta.1"), true);
  assert.equal(readsWithStoreKey("0.3.0"), true);
  assert.equal(readsWithStoreKey("0.2.11-beta.1"), false);
  assert.equal(readsWithStoreKey(null), false);
  const live = readStatusText(`Payment setup\nConnected: Stripe test mode\n${connectedLine}`);
  assert.equal(live.lastCheck, false);
  assert.deepEqual(
    nextPress(live, { buttons: ["Check connection", "Reconnect", "Check provider identity"], links: [] }, { storeKeyRead: true }),
    { action: "leave", because: "Connected: Stripe test mode. Reconnect and Stripe setup were left alone." },
  );
  assert.match(nextPress(live, { buttons: ["Sign in again"], links: [] }, { storeKeyRead: true }).because, /offers Sign in again/);
  const lapsed = readStatusText(`Payment setup\nConnected: Stripe test mode\n${lastCheckForSignIn}\n${connectedLine}`);
  assert.equal(lapsed.lastCheck, true);
  assert.equal(lapsed.asksForStoreKey, false);
  // Payments 0.2 shows a lapsed sign-in this way, and it still passes there.
  assert.equal(nextPress(lapsed, { buttons: ["Sign in again"], links: [] }).action, "leave");
  assert.match(nextPress(lapsed, { buttons: ["Sign in again"], links: [] }, { storeKeyRead: true }).because, /only its last check/);
});

test("pending approval opens DinkusKit before Continue, and Continue is next once payments are approved", () => {
  const pending = readStatusText("Connect payments: Not complete. Select Authorize Payments at DinkusKit and select Approve there. DinkusKit brings you back here, and this page checks your approval on its own.");
  const controls = { buttons: ["Continue"], links: ["Authorize Payments at DinkusKit"] };
  assert.equal(nextPress(pending, controls).action, "authorize");
  assert.deepEqual(nextPress(pending, controls, { approved: true }), { action: "press", name: "Continue" });
  assert.notEqual(nextPress(pending, { buttons: ["Continue"], links: [] }).action, "press");
});

test("Stripe setup and every other control stay unpressed", () => {
  const checked = readStatusText("Connect payments: Not complete. DinkusKit Payments status was checked. No processor account is connected. Select Set up Stripe to connect your processor account.");
  assert.equal(nextPress(checked, { buttons: ["Set up or resume Stripe", "Check connection", "Reconnect"], links: ["Continue setup at Stripe"] }).action, "leave");
  assert.equal(nextPress(checked, { buttons: ["Set up or resume Stripe", "Check connection", "Reconnect"], links: ["Continue setup at Stripe"] }, { approved: true }).action, "leave");
  const saved = readStatusText("Connect payments: Not complete. Your DinkusKit authorization was saved. Use Check connection to read the payment account status. No processor setup was attempted.");
  assert.equal(nextPress(saved, { buttons: ["Check connection", "Reconnect"], links: [] }).action, "blocked");
  assert.deepEqual(nextPress(saved, { buttons: ["Check connection", "Reconnect"], links: [] }, { approved: true }), { action: "press", name: "Check connection" });
  assert.match(nextPress(saved, { buttons: ["Check connection", "Reconnect"], links: [] }).because, /Check connection, which this journey leaves to the owner/);
  assert.equal(
    nextPress(readStatusText("Payment status not checked\nConnect payments: Not checked. Select Sign in again to refresh it."), { buttons: ["Sign in again"], links: [] }).action,
    "blocked",
  );
  for (const name of ["Reconnect", "Deny", "Set up or resume Stripe", "Check provider identity", "Confirm recovery preparation", "Check connection", "Sign in again", "Continue"]) {
    const decision = nextPress(
      { connectedTest: false, asksToConnect: false },
      { buttons: [name], links: [] },
    );
    assert.notEqual(decision.name, name);
    assert.notEqual(decision.action, "press");
  }
});

test("an authorize address is DinkusKit's connect page with one connection id and nothing else", () => {
  assert.equal(authorizeHref("https://dinkuskit.com/account/connect?connection_id=6b0d4e18-7c3a-4f1e-9a2b-0c5d6e7f8091", account), true);
  for (const href of [
    "https://dinkuskit.com/account/connect?connection_id=6b0d4e18-7c3a-4f1e-9a2b-0c5d6e7f8091&token=eyJabc.def.ghi",
    "https://dinkuskit.com/account/connect",
    "https://evil.example/account/connect?connection_id=abc",
    "http://dinkuskit.com/account/connect?connection_id=abc",
    "https://dinkuskit.com/account/connect?connection_id=abc#key",
    "https://user:pass@dinkuskit.com/account/connect?connection_id=abc",
    "https://dinkuskit.com/account/sites?connection_id=abc",
  ]) assert.equal(authorizeHref(href, account), false, href);
});

test("a store key or session token is recognized and removed from proof text", () => {
  const leaked = "status sk_test_51Abc whsec_abc connection_id=6b0d4e18-7c3a-4f1e-9a2b-0c5d6e7f8091";
  assert.equal(showsSecret(leaked), true);
  assert.equal(showsSecret("Connected: Stripe test mode"), false);
  assert.equal(redact(leaked).includes("sk_test_"), false);
  assert.equal(redact(leaked).includes("connection_id=6b0d4e18"), false);
  assert.match(redact(leaked), /\[secret\]/);
});
