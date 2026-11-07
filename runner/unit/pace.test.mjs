import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { setImmediate } from "node:timers/promises";

// Each test file runs in its own process, so this file's settings and request counts stay its own.
const dir = mkdtempSync(join(tmpdir(), "dinkus-pace-"));
after(() => rmSync(dir, { recursive: true, force: true }));
Object.assign(process.env, {
  DINKUS_E2E_ENV_FILE: join(dir, "no-settings"),
  DINKUS_E2E_PROOF: dir,
  DINKUS_E2E_PROFILE: join(dir, "profile"),
  DINKUS_E2E_STORE: "https://store.example",
});
const { PAGE_ROOM, STORE_BUDGET, countStoreRequest, countStoreResponse, paceSnapshot, paceStore, storeRefusals, waitFor, watchStoreRequests } = await import("../support/pace.mjs");
const { filterPage } = await import("../support/request-policy.mjs");

const now = 1_000_000;
const sentAt = (count, from) => Array.from({ length: count }, (_, i) => from + i);

test("requests that fit under the budget go at once", () => {
  assert.equal(waitFor([], 1, now), 0);
  assert.equal(waitFor(sentAt(STORE_BUDGET - 40, now - 30_000), 40, now), 0);
  // Requests more than a minute old no longer count.
  assert.equal(waitFor(sentAt(STORE_BUDGET, now - 90_000), STORE_BUDGET, now), 0);
});

test("requests that don't fit wait until enough of the oldest are a minute old", () => {
  const times = sentAt(STORE_BUDGET, now - 30_000);
  // One more waits for the oldest to age out; ten more wait for the tenth oldest.
  assert.equal(waitFor(times, 1, now), times[0] + 60_000 - now);
  assert.equal(waitFor(times, 10, now), times[9] + 60_000 - now);
  // More than the whole budget waits for the minute to empty, rather than forever.
  assert.equal(waitFor(times, STORE_BUDGET * 2, now), times.at(-1) + 60_000 - now);
});

test("requests that reach the store count from when they're sent, and a step waits for room", { timeout: 10_000 }, async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 5_000_000 });
  const context = new EventEmitter();
  const replays = new WeakSet();
  watchStoreRequests(context, { replayed: request => replays.has(request) });
  // A browser is watched once, however often it's handed over.
  watchStoreRequests(context, { replayed: () => false });
  const send = url => {
    const request = { url: () => url };
    context.emit("request", request);
    return request;
  };
  const done = (request, { replay = false, failed = false } = {}) => {
    if (replay) replays.add(request);
    context.emit(failed ? "requestfailed" : "requestfinished", request);
  };
  // A file answered from the browser's own copy never reaches the store; its first load does.
  done(send("https://store.example/_astro/page.js"));
  done(send("https://store.example/_astro/page.js"), { replay: true });
  // A request that fails on the way may still have reached the store.
  done(send("https://store.example/"), { failed: true });
  // A photo still on its way counts already.
  send("https://store.example/_emdash/api/media/file/cap.jpg");
  // Other sites, an address that never leaves the browser, and a local development server's own scripts
  // never count.
  done(send("https://dinkuskit.com/account"));
  done(send("blob:https://store.example/cap-preview"));
  done(send("https://store.example/@vite/client"));
  done(send("https://store.example/src/pages/index.astro"));
  done(send("https://store.example/node_modules/.vite/deps/react.js"));
  countStoreRequest("https://checkout.stripe.com/pay");
  countStoreRequest("blob:https://store.example/cap-preview");
  countStoreRequest("https://store.example/products/cap");
  // Four count: the file's first load, the failed page, the photo on its way and the probe.
  await paceStore(STORE_BUDGET - 4);
  let ready = false;
  const waiting = paceStore(STORE_BUDGET - 3).then(() => { ready = true; });
  t.mock.timers.tick(59_000);
  await Promise.resolve();
  assert.equal(ready, false);
  t.mock.timers.tick(1_500);
  await waiting;
  assert.equal(ready, true);
});

test("a file the browser answers from its own copy counts only until it's answered", { timeout: 10_000 }, async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 9_000_000 });
  const context = new EventEmitter();
  const replays = new WeakSet();
  watchStoreRequests(context, { replayed: request => replays.has(request) });
  const requests = Array.from({ length: STORE_BUDGET }, (_, i) => ({ url: () => `https://store.example/_astro/chunk-${i}.js` }));
  for (const request of requests) context.emit("request", request);
  // Until they're answered, nothing says they won't reach the store, so they fill the budget.
  let ready = false;
  const waiting = paceStore(1).then(() => { ready = true; });
  await Promise.resolve();
  assert.equal(ready, false);
  for (const request of requests) {
    replays.add(request);
    context.emit("requestfinished", request);
  }
  await paceStore(STORE_BUDGET);
  t.mock.timers.tick(60_250);
  await waiting;
});

test("store HTTP 429 and 5xx answers are grouped by fixed route kind and ignore replays and other sites", () => {
  assert.equal(storeRefusals(), "");
  const context = new EventEmitter();
  const replays = new WeakSet();
  watchStoreRequests(context, { replayed: request => replays.has(request) });
  const respond = (url, status, { replayed = false } = {}) => {
    const request = { url: () => url };
    if (replayed) replays.add(request);
    context.emit("response", { url: () => url, status: () => status, request: () => request });
  };
  respond("https://store.example/_image?href=hidden.png&w=640", 503);
  respond("https://store.example/_image?href=other.png&w=640", 503);
  respond("https://store.example/_emdash/api/plugins/r_hidden/admin", 429);
  respond("https://store.example/_emdash/api/plugin-extensions/r_hidden/panel/p", 429);
  respond("https://store.example/_emdash/api/media/file/hidden.png", 502);
  respond("https://store.example/api/guest-cart/snapshot?ids=hidden", 429);
  countStoreResponse("https://store.example/products/hidden-slug", 500);
  // Non-store hosts, 2xx/404s, dev-server scripts and local replays never count as store refusals.
  respond("https://dinkuskit.com/account", 429);
  respond("https://store.example/products/missing", 404);
  respond("https://store.example/_astro/chunk.js", 500, { replayed: true });
  countStoreResponse("https://store.example/@vite/client", 500);
  assert.equal(
    storeRefusals(),
    "2x HTTP 503 (store image), 2x HTTP 429 (plugin route), 1x HTTP 502 (media), 1x HTTP 429 (cart API), 1x HTTP 500 (store page)"
  );
});

test("ETag conditional fallbacks consume pacing budget for both network attempts, while 304 and blocked redirects count once", { timeout: 10_000 }, async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 15_000_000 });
  let routeHandler;
  const context = new EventEmitter();
  Object.assign(context, {
    newCDPSession: async () => ({ on: () => {}, send: async () => {} }),
    cookies: async () => [],
    route: async (_, fn) => { routeHandler = fn; },
    routeWebSocket: async () => {},
  });
  watchStoreRequests(context);
  await filterPage({ context: () => context, on: () => {} }, {
    store: "https://store.example",
    accessOrigins: ["https://store-team.cloudflareaccess.com"],
  });

  const image = "https://store.example/_image?href=cap.png&w=640";
  const cacheable = { "cache-control": "public, max-age=0, must-revalidate", etag: 'W/"cap"' };
  const seedCopy = async () => {
    const req = {
      url: () => image,
      method: () => "GET",
      headerValue: async () => null,
      timing: () => ({ startTime: Date.now(), responseStart: -1 }),
    };
    const listeners = context.listeners("response");
    for (const fn of listeners) {
      await fn({
        url: () => image,
        status: () => 200,
        headers: () => cacheable,
        body: async () => Buffer.from("webp"),
        request: () => req,
      });
    }
  };
  const browserGet = async fetcher => {
    const req = {
      url: () => image,
      method: () => "GET",
      frame: () => null,
      headers: () => ({}),
      isNavigationRequest: () => false,
      headerValue: async () => null,
      timing: () => ({ startTime: Date.now(), responseStart: -1 }),
    };
    context.emit("request", req);
    await routeHandler({
      request: () => req,
      fetch: fetcher,
      fulfill: async () => {},
      fallback: async () => {},
      abort: async () => {},
    });
    context.emit("requestfinished", req);
  };

  await seedCopy();
  // 1 browser request with 304 revalidation -> 1 store request.
  await browserGet(async () => ({ status: () => 304, headers: () => cacheable, dispose: async () => {} }));
  // 1 browser request whose ETag fetch times out and falls back -> 2 store requests (3 total).
  await browserGet(async () => { throw new Error("Timeout 20000ms exceeded"); });
  // 1 browser request whose ETag fetch gets an allowed 302 redirect and falls back -> 2 store requests (5 total).
  await seedCopy();
  await browserGet(async () => ({
    status: () => 302,
    headers: () => ({ location: "https://store-team.cloudflareaccess.com/cdn-cgi/access/login" }),
    dispose: async () => {},
  }));
  // 1 browser request whose ETag fetch gets a blocked redirect and aborts -> 1 store request (6 total).
  await seedCopy();
  await browserGet(async () => ({
    status: () => 302,
    headers: () => ({ location: "https://evil.example/leak" }),
    dispose: async () => {},
  }));
  // 1 browser request whose ETag fetch gets 503 with a reset body and falls back -> 2 store requests (8 total).
  await seedCopy();
  await browserGet(async () => ({
    status: () => 503,
    headers: () => ({}),
    body: async () => { throw new Error("reset"); },
    dispose: async () => {},
  }));

  // Exactly 8 store network attempts were sent across the 5 browser requests above.
  await paceStore(STORE_BUDGET - 8);
  let ready = false;
  const waiting = paceStore(STORE_BUDGET - 7).then(() => { ready = true; });
  t.mock.timers.tick(59_000);
  await Promise.resolve();
  assert.equal(ready, false);
  t.mock.timers.tick(1_500);
  await waiting;
  assert.equal(ready, true);
  assert.match(storeRefusals(), /^3x HTTP 503 \(store image\),/);
});

// The tests below share the module's request count with the ones above, so each starts at a mocked time
// at least a minute after the last one ended, when nothing earlier still counts.

/** A browser the pacing watches, whose requests end as the test says: finished, failed, or answered from its own copy. */
function watchedBrowser() {
  const context = new EventEmitter();
  const replays = new WeakSet();
  watchStoreRequests(context, { replayed: request => replays.has(request) });
  const send = (url = "https://store.example/_astro/chunk.js") => {
    const request = { url: () => url };
    context.emit("request", request);
    return request;
  };
  const done = (request, { replay = false, failed = false } = {}) => {
    if (replay) replays.add(request);
    context.emit(failed ? "requestfailed" : "requestfinished", request);
  };
  return { send, done, sendMany: count => Array.from({ length: count }, () => send()) };
}
/** Lets every promise settle, without moving the mocked clock. */
const settle = () => setImmediate();
const delta = (after, before) => Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]]));

test("a step waiting for room goes as soon as the browser answers a counted request from its own copy", { timeout: 10_000 }, async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 20_000_000 });
  const { send, done, sendMany } = watchedBrowser();
  // Sixty-one on their way: forty more don't fit under the budget, so the step sleeps for the minute.
  const chunks = sendMany(STORE_BUDGET - PAGE_ROOM + 1);
  const before = paceSnapshot();
  let ready = false;
  const waiting = paceStore(PAGE_ROOM).then(() => { ready = true; });
  await settle();
  assert.equal(ready, false);
  // One that reached the store frees nothing when it finishes, nor when it fails; nor does one to another site.
  done(chunks[0]);
  done(chunks[1], { failed: true });
  done(send("https://dinkuskit.com/account"));
  await settle();
  assert.equal(ready, false);
  // One the browser answers from its own copy stops counting, sixty fit forty more, and the step goes
  // without the clock moving, where before it slept on until its timer fired.
  done(chunks[2], { replay: true });
  await settle();
  assert.equal(ready, true);
  await waiting;
  // One sleep, which asked for the minute (plus the margin) and measured next to nothing.
  const slept = delta(paceSnapshot(), before);
  assert.equal(slept.sleeps, 1);
  assert.equal(slept.requestedMs, 60_250);
  assert.ok(slept.ms >= 0 && slept.ms < 1_000, `measured ${slept.ms} ms`);
  assert.equal(slept.wallMs, slept.ms);
  // A new identical call goes at once, as it always did with sixty counted.
  await paceStore(PAGE_ROOM);
  // The time it asked for passing changes nothing: the sleep is over, and it isn't counted again.
  const after = paceSnapshot();
  t.mock.timers.tick(60_250);
  await settle();
  assert.deepEqual(paceSnapshot(), after);
});

test("a request taken back that leaves the budget full wakes the step only to wait on, for what is still owed", { timeout: 10_000 }, async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 30_000_000 });
  const { done, sendMany } = watchedBrowser();
  // One request fifty seconds ago and a hundred thirty seconds ago: one more fits once the oldest of the
  // hundred is a minute old, thirty seconds from now.
  const [oldest] = sendMany(1);
  t.mock.timers.tick(20_000);
  const hundred = sendMany(STORE_BUDGET);
  t.mock.timers.tick(30_000);
  const before = paceSnapshot();
  let ready = false;
  const waiting = paceStore(1).then(() => { ready = true; });
  await settle();
  assert.equal(ready, false);
  // Taking back one of the hundred leaves a hundred counted, still one too many; the step wakes, finds so,
  // and sleeps again, now only until the oldest one is a minute old, ten seconds from now.
  done(hundred[0], { replay: true });
  await settle();
  assert.equal(ready, false);
  t.mock.timers.tick(9_000);
  await settle();
  assert.equal(ready, false);
  t.mock.timers.tick(1_500);
  await waiting;
  assert.equal(ready, true);
  // Two sleeps: the one the refund ended, which asked for thirty seconds, and the one that fired, which
  // asked for the ten still owed from the same clock.
  const slept = delta(paceSnapshot(), before);
  assert.equal(slept.sleeps, 2);
  assert.equal(slept.requestedMs, 30_250 + 10_250);
  // Taking back the one the step waited for, after it has gone, wakes no one and counts nothing.
  const after = paceSnapshot();
  done(oldest, { replay: true });
  await settle();
  assert.deepEqual(paceSnapshot(), after);
});

test("steps waiting together each go when their own room fits, and the rest wait on", { timeout: 10_000 }, async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 40_000_000 });
  const { done, sendMany } = watchedBrowser();
  const hundred = sendMany(STORE_BUDGET);
  const before = paceSnapshot();
  const ready = { one: false, two: false, page: false };
  const waiting = {
    one: paceStore(1).then(() => { ready.one = true; }),
    two: paceStore(2).then(() => { ready.two = true; }),
    page: paceStore(PAGE_ROOM).then(() => { ready.page = true; }),
  };
  await settle();
  assert.deepEqual(ready, { one: false, two: false, page: false });
  // Ninety-nine counted: one more fits, two don't.
  done(hundred[0], { replay: true });
  await settle();
  assert.deepEqual(ready, { one: true, two: false, page: false });
  // Ninety-eight: two fit, forty don't.
  done(hundred[1], { replay: true });
  await settle();
  assert.deepEqual(ready, { one: true, two: true, page: false });
  // Ninety-seven: forty still don't, however often the step is woken.
  done(hundred[2], { replay: true });
  await settle();
  assert.equal(ready.page, false);
  // So it waits on until the rest are a minute old, as before.
  t.mock.timers.tick(59_000);
  await settle();
  assert.equal(ready.page, false);
  t.mock.timers.tick(1_500);
  await Promise.all(Object.values(waiting));
  assert.equal(ready.page, true);
  // One sleep for the first, two for the second, four for the third (three the refunds ended, one that
  // fired), each asking for the minute from the same clock; their overlap is counted once in the wall time.
  const slept = delta(paceSnapshot(), before);
  assert.equal(slept.sleeps, 7);
  assert.equal(slept.requestedMs, 7 * 60_250);
  assert.ok(slept.wallMs <= slept.ms, `wall ${slept.wallMs} ms, sum ${slept.ms} ms`);
});

test("a step nothing takes back waits the full time it asked for, as before", { timeout: 10_000 }, async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 50_000_000 });
  const { done, sendMany } = watchedBrowser();
  const chunks = sendMany(STORE_BUDGET - PAGE_ROOM + 1);
  const before = paceSnapshot();
  let ready = false;
  const waiting = paceStore(PAGE_ROOM).then(() => { ready = true; });
  // Everything on its way finishes or fails having reached the store, so it all counts for the minute.
  for (const [i, chunk] of chunks.entries()) done(chunk, { failed: i % 2 === 1 });
  t.mock.timers.tick(59_000);
  await settle();
  assert.equal(ready, false);
  t.mock.timers.tick(1_500);
  await waiting;
  assert.equal(ready, true);
  const slept = delta(paceSnapshot(), before);
  assert.equal(slept.sleeps, 1);
  assert.equal(slept.requestedMs, 60_250);
});

test("the timer behind a sleep goes when a request taken back wakes it, as when it fires", { timeout: 10_000 }, async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 60_000_000 });
  // Spies over the mocked timers: what paceStore sets, and what it clears.
  const setTimer = t.mock.method(globalThis, "setTimeout");
  const clearTimer = t.mock.method(globalThis, "clearTimeout");
  const { send, done, sendMany } = watchedBrowser();
  const chunks = sendMany(STORE_BUDGET - PAGE_ROOM + 1);
  const woken = paceStore(PAGE_ROOM);
  assert.equal(setTimer.mock.callCount(), 1);
  const [first] = setTimer.mock.calls;
  assert.equal(first.arguments[1], 60_250);
  // Woken by a refund: the timer it set is cleared, and nothing of it remains to fire.
  done(chunks[0], { replay: true });
  await woken;
  assert.equal(clearTimer.mock.callCount(), 1);
  assert.equal(clearTimer.mock.calls[0].arguments[0], first.result);
  // Sixty-one again: a sleep that runs its course clears its timer too, once it has fired.
  sendMany(1);
  const fired = paceStore(PAGE_ROOM);
  assert.equal(setTimer.mock.callCount(), 2);
  const [, second] = setTimer.mock.calls;
  t.mock.timers.tick(60_250);
  await fired;
  assert.equal(clearTimer.mock.callCount(), 2);
  assert.equal(clearTimer.mock.calls[1].arguments[0], second.result);
  // With no one asleep, a request taken back has no timer to clear and sets none.
  done(send(), { replay: true });
  await settle();
  assert.equal(setTimer.mock.callCount(), 2);
  assert.equal(clearTimer.mock.callCount(), 2);
  setTimer.mock.restore();
  clearTimer.mock.restore();
});
