import { forProof } from "./errors.mjs";

/** The selected store and the services its canonical journeys use, never sibling stores. */
const PRIVATE_HEADERS = /^(authorization|proxy-authorization|cookie|cf-access-client-id|cf-access-client-secret|x-api-key|x-emdash-key|x-commerce-guest-capability)$/i;
const loopback = hostname => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);

function siteOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash
      || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback(url.hostname)))) {
    throw new Error("The request filter needs a site origin, without a path or credentials.");
  }
  return url.origin;
}

export function requestPolicy({ store, accessOrigins = [], ship = "https://ship.dinkuskit.com", account = "https://dinkuskit.com" }) {
  const selected = siteOrigin(store);
  // The Ship and DinkusKit.com the run is set to use (DINKUS_E2E_SHIP, DINKUS_E2E_ACCOUNT), exactly.
  const services = new Set([siteOrigin(ship), siteOrigin(account)]);
  const access = new Set(accessOrigins.map(value => {
    const origin = siteOrigin(value);
    if (!new URL(origin).hostname.endsWith(".cloudflareaccess.com")) {
      throw new Error("Access origins must name the store's exact Cloudflare Access host.");
    }
    return origin;
  }));
  const allowed = value => {
    let url;
    try { url = new URL(value); } catch { return false; }
    if (url.username || url.password) return false;
    if (url.origin === selected || services.has(url.origin)) return true;
    if (url.protocol !== "https:" || url.port) return false;
    return url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com")
      || url.hostname === "stripecdn.com" || url.hostname.endsWith(".stripecdn.com")
      || access.has(url.origin);
  };
  return {
    allows: allowed,
    isStore: value => { try { return new URL(value).origin === selected; } catch { return false; } },
    // Browser cookies remain scoped by their jar when no explicit header is supplied.
    publicHeaders: headers => Object.fromEntries(Object.entries(headers).filter(([key]) => !PRIVATE_HEADERS.test(key))),
  };
}

const installed = new WeakMap();
const guarded = new WeakMap();
// Store requests answered from a browser's own immutable copy, which never reach the store.
const replayed = new WeakSet();
// Store requests guardContext fulfilled itself (immutable replay or ETag revalidation), so its own
// response listener leaves the stored copy alone.
const fulfilled = new WeakSet();
const MAX_COPIES = 256;

/** Whether the run answered this browser request from its own copy of an immutable store file. */
export const wasReplayed = request => replayed.has(request);

/** Chromium pauses every hop, including redirects; install before navigating. */
export function filterPage(page, settings) {
  if (!installed.has(page)) installed.set(page, install(page, requestPolicy(settings), settings));
  return installed.get(page);
}

async function install(page, policy, settings) {
  await guardContext(page.context(), policy, settings);
  await intercept(await page.context().newCDPSession(page), page.context(), policy);
  return page;
}

/**
 * The page's interceptor sees its own requests and redirects, but not a cross-site frame's (Chromium
 * gives those their own renderer) or a popup's first one, sent before the popup's interceptor exists.
 * The context route sees every request's first hop from any of them: it refuses an off-list
 * destination, removes store headers, and holds a popup's request until its interceptor is ready.
 */
function guardContext(context, policy, settings) {
  if (!guarded.has(context)) guarded.set(context, (async () => {
    const copies = storeCopies(context, policy);
    await context.route("**/*", async route => {
      const request = route.request();
      if (!policy.allows(request.url())) return route.abort("blockedbyclient");
      let frame = null;
      try { frame = request.frame(); } catch {} // A worker's request belongs to its page's interceptor.
      try {
        if (frame) await filterPage(frame.page(), settings);
      } catch {
        // No interceptor could attach (the page is closing, say), so nothing would check a redirect.
        return route.abort("blockedbyclient").catch(() => {});
      }
      if (policy.isStore(request.url())) return copies.handle(route);
      // This first request left before its interceptor attached, so strip store headers here too.
      const headers = request.headers();
      const kept = policy.publicHeaders(Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "cookie")));
      const cookie = Object.entries(headers).find(([name]) => name.toLowerCase() === "cookie");
      if (Object.keys(kept).length + (cookie ? 1 : 0) === Object.keys(headers).length) return route.fallback();
      return route.fallback({ headers: cookie ? { ...kept, [cookie[0]]: cookie[1] } : kept });
    });
    // Chromium's Fetch interception never pauses a WebSocket handshake.
    await context.routeWebSocket(url => !policy.allows(url.href.replace(/^ws/, "http")), ws => ws.close());
  })());
  return guarded.get(context);
}

const keptHeaders = headers => Object.fromEntries(Object.entries(headers).filter(([name]) =>
  !["content-encoding", "content-length", "transfer-encoding", "set-cookie"].includes(name.toLowerCase())));

/**
 * Playwright turns Chromium's HTTP cache off while any route is set, so the run would fetch every
 * store script and re-encode every /_image photo on every page view, far more often than a shopper's
 * browser. A store file sent as immutable (its hashed /_astro/ build files) is answered from this
 * context's own copy while it stays fresh, without touching the store. A store file sent with an ETag
 * (EmDash's /_image and media files send max-age=0, must-revalidate with a weak ETag) asks the store
 * with If-None-Match on repeat loads, answering from the kept bytes when the store replies 304 so
 * unchanged photos skip R2 download and WebP encoding while still counting as a store request. Copies
 * stay with their context, so a new shopper's browser starts empty, as a new shopper's does.
 */
function storeCopies(context, policy) {
  const copies = new Map();
  const newest = new Map();
  async function remember(turn, url, request, headers, readBody, received, timing) {
    const sent = cacheDirectives(headers["cache-control"]);
    if (sent.has("no-store")) return;
    if (cacheDirectives(await request.headerValue("cache-control")).has("no-store")) return;
    // A file that varies answers only requests sending the same values for the headers it names. The
    // kept body is already decoded, so Accept-Encoding never matters, and Playwright sets its length.
    const vary = (headers.vary ?? "").toLowerCase().split(",").map(name => name.trim()).filter(name => name && name !== "accept-encoding");
    if (vary.includes("*")) return;
    const lifetime = Number(sent.get("max-age"));
    const age = ageOnArrival(headers, received, timing);
    const immutable = sent.has("immutable") && !sent.has("no-cache") && lifetime > age;
    const etag = !immutable && !sent.has("private") && await request.headerValue("authorization") === null ? (headers.etag ?? "") : "";
    if (!immutable && !etag) return;
    const chosenBy = await Promise.all(vary.map(async name => [name, await request.headerValue(name)]));
    const body = await readBody();
    if (newest.get(url) !== turn) return;
    if (!copies.has(url) && copies.size >= MAX_COPIES) copies.delete(copies.keys().next().value);
    const answer = { status: 200, headers: keptHeaders(headers), body };
    copies.set(url, immutable ? { kind: "immutable", received, age, lifetime, chosenBy, answer } : { kind: "etag", etag, chosenBy, answer });
  }
  context.on("response", async response => {
    try {
      const url = response.url();
      const received = Date.now();
      // A fulfilled replay never touches its copy, so it can't stretch an immutable copy's lifetime.
      if (fulfilled.has(response.request()) || !policy.isStore(url) || response.request().method() !== "GET") return;
      // Any store answer from the network takes the old copy's place, whether or not it is kept, and only
      // the newest one can become the copy, however long an older one's body takes to arrive.
      const turn = {};
      copies.delete(url);
      newest.set(url, turn);
      if (response.status() !== 200) return;
      await remember(turn, url, response.request(), response.headers(), () => response.body(), received, response.request().timing());
    } catch {} // The page closed before the body arrived, say; the next load fetches the file again.
  });
  return {
    async handle(route) {
      const request = route.request();
      if (request.method() !== "GET") return route.fallback();
      const url = request.url();
      const copy = copies.get(url);
      if (!copy) return route.fallback();
      if (copy.kind === "immutable") {
        const age = copy.age + (Date.now() - copy.received) / 1000;
        if (!(copy.lifetime > age) || await asksAgain(request, age, copy.lifetime - age)) {
          copies.delete(url);
          return route.fallback();
        }
        for (const [name, value] of copy.chosenBy) if (await request.headerValue(name) !== value) return route.fallback();
        replayed.add(request);
        fulfilled.add(request);
        return route.fulfill(copy.answer);
      }
      if (typeof route.fetch !== "function" || request.isNavigationRequest?.()) return route.fallback();
      if (await bypassesConditional(request)) {
        copies.delete(url);
        return route.fallback();
      }
      for (const name of ["if-none-match", "if-modified-since", "range"]) {
        if (await request.headerValue(name) !== null) return route.fallback();
      }
      for (const [name, value] of copy.chosenBy) if (await request.headerValue(name) !== value) return route.fallback();
      // Let context.request attach the browser's live cookie jar rather than forwarding any Cookie header.
      const sentHeaders = Object.fromEntries(Object.entries(request.headers()).filter(([name]) => name.toLowerCase() !== "cookie"));
      let check;
      try {
        check = await route.fetch({ headers: { ...sentHeaders, "if-none-match": copy.etag }, maxRedirects: 0, timeout: 20_000 });
      } catch {
        return route.fallback().catch(() => {});
      }
      const status = check.status();
      const checkHeaders = check.headers();
      if (status === 304) {
        if (cacheDirectives(checkHeaders["cache-control"]).has("no-store")) copies.delete(url);
        else if (checkHeaders.etag) copy.etag = checkHeaders.etag;
        await check.dispose();
        fulfilled.add(request);
        return route.fulfill(copy.answer).catch(() => {});
      }
      if ([301, 302, 303, 307, 308].includes(status) && checkHeaders.location) {
        copies.delete(url);
        let allowed = false;
        try { allowed = policy.allows(new URL(checkHeaders.location, url).href); } catch {}
        await check.dispose();
        return (allowed ? route.fallback() : route.abort("blockedbyclient")).catch(() => {});
      }
      const turn = {};
      copies.delete(url);
      newest.set(url, turn);
      let body;
      try {
        body = await check.body();
      } catch {
        await check.dispose().catch(() => {});
        return route.fallback().catch(() => {});
      }
      await check.dispose();
      if (status === 200) await remember(turn, url, request, checkHeaders, async () => body, Date.now(), null);
      fulfilled.add(request);
      return route.fulfill({ status, headers: keptHeaders(checkHeaders), body }).catch(() => {});
    },
  };
}

/**
 * How old a store answer already was when it arrived, as RFC 9111 4.2.3 counts it: its Age plus the
 * time it took to arrive, or how long before its arrival its Date says it was sent, whichever is more.
 */
function ageOnArrival(headers, received, timing) {
  const travel = Math.max(0, timing?.responseStart ?? 0) / 1000;
  return Math.max(0, (Number(headers.age) || 0) + travel, (received - Date.parse(headers.date)) / 1000 || 0);
}

function cacheDirectives(value) {
  return new Map((value ?? "").toLowerCase().split(",").map(part => {
    const [name, directive = ""] = part.split("=");
    return [name.trim(), directive.trim().replace(/^"(.*)"$/, "$1")];
  }));
}

/**
 * Whether the page itself asked for more than this copy, so old and with so many fresh seconds left,
 * can give. Cache-Control no-cache, no-store or max-age=0, or Pragma no-cache, ask the store again; any
 * other max-age wants a copy no older than it says, and min-fresh one that stays fresh at least that
 * long. Chromium adds no-cache to every request while Playwright has the cache off, but only after the
 * route sees it, so ordinary requests never look like this here.
 */
async function asksAgain(request, age, left) {
  const asked = cacheDirectives(await request.headerValue("cache-control"));
  // A value that isn't a number of seconds rules the copy out too.
  const allows = (name, test) => !asked.has(name) || test(Number(asked.get(name)));
  return asked.has("no-cache") || asked.has("no-store")
    || !allows("max-age", most => most > 0 && age <= most) || !allows("min-fresh", least => left >= least)
    || cacheDirectives(await request.headerValue("pragma")).has("no-cache");
}

/** Whether the page itself asked not to store or revalidate an ETag copy (no-cache or no-store). */
async function bypassesConditional(request) {
  const asked = cacheDirectives(await request.headerValue("cache-control"));
  return asked.has("no-cache") || asked.has("no-store")
    || cacheDirectives(await request.headerValue("pragma")).has("no-cache");
}

async function intercept(session, context, policy) {
  const handle = async ({ requestId, request }) => {
    if (!policy.allows(request.url)) {
      await session.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      return;
    }
    const headers = policy.isStore(request.url) ? request.headers : policy.publicHeaders(request.headers);
    if (!policy.isStore(request.url)) {
      // Rebuild only the destination's browser cookies, never a store Cookie override.
      const received = Object.entries(request.headers).find(([name]) => name.toLowerCase() === "cookie")?.[1] ?? "";
      // Keep the browser's order: a server reading the first of two same-named cookies must get the same one.
      const jar = new Set((await context.cookies(request.url)).map(({ name, value }) => `${name}=${value}`));
      const cookies = received.split(";").map(value => value.trim()).filter(value => jar.has(value));
      if (cookies.length) headers.Cookie = cookies.join("; ");
    }
    await session.send("Fetch.continueRequest", {
      requestId, headers: Object.entries(headers).map(([name, value]) => ({ name, value: String(value) })),
    });
  };
  session.on("Fetch.requestPaused", event => handle(event).catch(() =>
    session.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" }).catch(() => {})));
  await session.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
}

/** Direct photo/link/PDF probes use the same sites and check redirects before following. */
export async function filteredGet(client, address, settings, options = {}) {
  const policy = requestPolicy(settings);
  let url = address;
  for (let hop = 0; hop < 6; hop++) {
    if (!policy.allows(url)) throw new Error("A direct request left the selected sites.");
    const headers = policy.isStore(url) ? options.headers : policy.publicHeaders(options.headers ?? {});
    let response;
    try {
      response = await client.get(url, { ...options, headers, maxRedirects: 0 });
    } catch (error) {
      // The request carries the browser's cookies, and Playwright's call log for a failure lists them.
      throw forProof(error);
    }
    const location = response.headers().location;
    if (![301, 302, 303, 307, 308].includes(response.status()) || !location) return response;
    const next = new URL(location, url).href;
    await response.dispose();
    if (!policy.isStore(next)) options = { ...options, headers: policy.publicHeaders(options.headers ?? {}) };
    url = next;
  }
  throw new Error("Too many redirects in a direct site request.");
}
