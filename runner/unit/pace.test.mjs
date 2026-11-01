import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// Each test file runs in its own process, so this file's settings and request counts stay its own.
const dir = mkdtempSync(join(tmpdir(), "dinkus-pace-"));
after(() => rmSync(dir, { recursive: true, force: true }));
Object.assign(process.env, {
  DINKUS_E2E_ENV_FILE: join(dir, "no-settings"),
  DINKUS_E2E_PROOF: dir,
  DINKUS_E2E_PROFILE: join(dir, "profile"),
  DINKUS_E2E_STORE: "https://store.example",
});
const { STORE_BUDGET, countStoreRequest, countStoreResponse, paceStore, storeRefusals, waitFor, watchStoreRequests } = await import("../support/pace.mjs");
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
