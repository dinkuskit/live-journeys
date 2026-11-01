import assert from "node:assert/strict";
import test from "node:test";
import { filterPage, onExtraStoreAttempt, wasReplayed } from "../support/request-policy.mjs";

const settings = { store: "https://e2e.sm0ky.dev", accessOrigins: ["https://smokyproduct.cloudflareaccess.com"] };

async function contextRoute() {
  let handler;
  let listener;
  const extra = [];
  const context = {
    newCDPSession: async () => ({ on: () => {}, send: async () => {} }),
    cookies: async () => [],
    route: async (_, fn) => { handler = fn; },
    routeWebSocket: async () => {},
    on: (event, fn) => { if (event === "response") listener = fn; },
  };
  onExtraStoreAttempt(context, (url, status) => extra.push([url, status]));
  await filterPage({ context: () => context, on: () => {} }, settings);
  let lastRequest;
  const answer = async (url, method = "GET", requestHeaders = {}, { fetch: fetcher, navigation = false } = {}) => {
    const outcome = {};
    lastRequest = {
      url: () => url,
      method: () => method,
      frame: () => null,
      headers: () => requestHeaders,
      isNavigationRequest: () => navigation,
      headerValue: async name => requestHeaders[name] ?? null,
      timing: () => ({ startTime: Date.now(), responseStart: -1 }),
    };
    await handler({
      request: () => lastRequest,
      fetch: fetcher,
      fulfill: async value => { outcome.fulfilled = value; },
      fallback: async value => { outcome.fallback = value ?? true; },
      abort: async reason => { outcome.aborted = reason; },
    });
    return outcome;
  };
  const loaded = (url, headers, { status = 200, body = Buffer.from("synthetic"), requestHeaders = {}, request, responseStart = -1 } = {}) => {
    const sent = Date.now();
    return listener({
      url: () => url,
      status: () => status,
      headers: () => headers,
      body: async () => body,
      request: () => request ?? {
        method: () => "GET",
        headerValue: async name => requestHeaders[name] ?? null,
        timing: () => ({ startTime: sent, responseStart }),
      },
    });
  };
  return { answer, loaded, extra, lastRequest: () => lastRequest };
}

test("store photos with an ETag ask with If-None-Match, answer 304 from the kept bytes, and still count as store requests", async () => {
  const { answer, loaded, extra, lastRequest } = await contextRoute();
  const image = settings.store + "/_image?href=cap.png&w=640";
  const headers = { "cache-control": "public, max-age=0, must-revalidate", etag: 'W/"v1"', "content-type": "image/webp", "set-cookie": ["session", "ignored"].join("=") };
  await loaded(image, headers, { body: Buffer.from("webp-v1") });
  const seen = [];
  const hit304 = await answer(image, "GET", { accept: "image/webp", Cookie: ["CF_Authorization", "synthetic"].join("=") }, {
    fetch: async options => {
      seen.push(options);
      return { status: () => 304, headers: () => ({ etag: 'W/"v1"', "cache-control": "public, max-age=0, must-revalidate" }), dispose: async () => {} };
    },
  });
  assert.equal(hit304.fulfilled.status, 200);
  assert.equal(hit304.fulfilled.body.toString(), "webp-v1");
  assert.deepEqual(hit304.fulfilled.headers, { "cache-control": "public, max-age=0, must-revalidate", etag: 'W/"v1"', "content-type": "image/webp" });
  // Cookie header is omitted so context.request uses its live jar; 304 still reached the store, so wasReplayed is false.
  assert.deepEqual(seen[0].headers, { accept: "image/webp", "if-none-match": 'W/"v1"' });
  assert.equal(seen[0].maxRedirects, 0);
  assert.equal(wasReplayed(lastRequest()), false);
  // Fulfilling 304 emits a synthetic 200 response on the context; it must not clear the stored ETag copy.
  await loaded(image, hit304.fulfilled.headers, { body: hit304.fulfilled.body, request: lastRequest() });
  // When the store answers 200 with a new ETag, the new bytes replace the copy in one hop.
  const hit200 = await answer(image, "GET", {}, {
    fetch: async () => ({
      status: () => 200,
      headers: () => ({ "cache-control": "public, max-age=0, must-revalidate", etag: 'W/"v2"', "content-type": "image/webp" }),
      body: async () => Buffer.from("webp-v2"),
      dispose: async () => {},
    }),
  });
  assert.equal(hit200.fulfilled.body.toString(), "webp-v2");
  const afterUpdate = await answer(image, "GET", {}, {
    fetch: async options => {
      assert.equal(options.headers["if-none-match"], 'W/"v2"');
      return { status: () => 304, headers: () => ({}), dispose: async () => {} };
    },
  });
  assert.equal(afterUpdate.fulfilled.body.toString(), "webp-v2");
  assert.deepEqual(extra, []);
});

test("ETag copies respect navigations, no-store, private, Authorization, no-cache, Vary and redirect policy", async () => {
  const { answer, loaded } = await contextRoute();
  const image = settings.store + "/_image?href=tee.png&w=640";
  await loaded(image, { "cache-control": "public, max-age=0, must-revalidate", etag: 'W/"tee"', vary: "Accept" }, { requestHeaders: { accept: "image/webp" } });
  // Navigations, mismatched Vary and explicit conditional/range headers bypass the ETag copy without dropping it.
  assert.deepEqual(await answer(image, "GET", { accept: "image/webp" }, { navigation: true, fetch: async () => { throw new Error("unexpected"); } }), { fallback: true });
  assert.deepEqual(await answer(image, "GET", { accept: "image/png" }, { fetch: async () => { throw new Error("unexpected"); } }), { fallback: true });
  assert.deepEqual(await answer(image, "GET", { accept: "image/webp", range: "bytes=0-10" }, { fetch: async () => { throw new Error("unexpected"); } }), { fallback: true });
  // Allowed Access redirect falls back to the browser; an off-list redirect is blocked.
  const toAccess = await answer(image, "GET", { accept: "image/webp" }, {
    fetch: async () => ({ status: () => 302, headers: () => ({ location: settings.accessOrigins[0] + "/cdn-cgi/access/login" }), dispose: async () => {} }),
  });
  assert.deepEqual(toAccess, { fallback: true });
  await loaded(image, { "cache-control": "public, max-age=0, must-revalidate", etag: 'W/"tee"' });
  const offSite = await answer(image, "GET", {}, {
    fetch: async () => ({ status: () => 302, headers: () => ({ location: "https://e2e-v2.sm0ky.dev/leak" }), dispose: async () => {} }),
  });
  assert.deepEqual(offSite, { aborted: "blockedbyclient" });
  // no-store, private and Authorization-bearing answers are never kept, and a page sending no-cache drops an existing copy.
  const privateImg = settings.store + "/_image?href=private.png";
  for (const [respHeaders, reqHeaders] of [
    [{ "cache-control": "no-store", etag: 'W/"one"' }, {}],
    [{ "cache-control": "private, max-age=0, must-revalidate", etag: 'W/"two"' }, {}],
    [{ "cache-control": "public, max-age=0, must-revalidate", etag: 'W/"three"' }, { authorization: "synthetic" }],
  ]) {
    await loaded(privateImg, respHeaders, { requestHeaders: reqHeaders });
    assert.deepEqual(await answer(privateImg, "GET", reqHeaders, { fetch: async () => { throw new Error("unexpected"); } }), { fallback: true });
  }
  await loaded(image, { "cache-control": "public, max-age=0, must-revalidate", etag: 'W/"tee"' });
  assert.deepEqual(await answer(image, "GET", { "cache-control": "no-cache" }, { fetch: async () => { throw new Error("unexpected"); } }), { fallback: true });
});

test("ETag fetch timeouts, allowed redirects and unreadable bodies report one extra store attempt, while blocked redirects do not", async () => {
  const { answer, loaded, extra } = await contextRoute();
  const image = settings.store + "/_image?href=mug.png&w=640";
  const cacheable = { "cache-control": "public, max-age=0, must-revalidate", etag: 'W/"mug"' };

  await loaded(image, cacheable);
  assert.deepEqual(await answer(image, "GET", {}, { fetch: async () => { throw new Error("Timeout 20000ms exceeded"); } }), { fallback: true });
  assert.deepEqual(extra, [[image, undefined]]);

  extra.length = 0;
  await loaded(image, cacheable);
  assert.deepEqual(await answer(image, "GET", {}, {
    fetch: async () => ({ status: () => 302, headers: () => ({ location: settings.accessOrigins[0] + "/cdn-cgi/access/login" }), dispose: async () => {} }),
  }), { fallback: true });
  assert.deepEqual(extra, [[image, 302]]);

  extra.length = 0;
  await loaded(image, cacheable);
  assert.deepEqual(await answer(image, "GET", {}, {
    fetch: async () => ({ status: () => 302, headers: () => ({ location: "https://e2e-v2.sm0ky.dev/other" }), dispose: async () => {} }),
  }), { aborted: "blockedbyclient" });
  assert.deepEqual(extra, []);

  extra.length = 0;
  await loaded(image, cacheable);
  assert.deepEqual(await answer(image, "GET", {}, {
    fetch: async () => ({ status: () => 503, headers: () => ({}), body: async () => { throw new Error("socket reset"); }, dispose: async () => {} }),
  }), { fallback: true });
  assert.deepEqual(extra, [[image, 503]]);
});
