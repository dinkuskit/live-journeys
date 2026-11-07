// Portable real-browser proof of the refund wakeup over a seeded request history, on loopback only;
// never a live store. The actual pace and request-filter modules are read from immutable Git objects
// at one commit (never the working tree), so run it once per commit to compare. Usage:
//   node proof/pacing-refund-20261107/refund-browser.mjs --repo . --ref <sha> \
//     --playwright runner/node_modules --chromium "$CHROMIUM" [--cache immutable|no-store] \
//     [--expect wakes|sleeps] [--out file]
// With `immutable`, the browser answers the second load of /asset.js from its own copy and the pacing
// takes that request back; `--expect wakes` asserts the waiting step goes within 75 ms of it, `sleeps`
// that it does not. With `no-store` nothing is taken back and the step sleeps on in either revision.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const repo = option("repo", ".");
const ref = option("ref", "HEAD");
const modules = resolve(option("playwright", "runner/node_modules"));
const chromiumPath = option("chromium");
const cache = option("cache", "immutable");
const expect = option("expect");
assert.ok(["immutable", "no-store"].includes(cache), "--cache is immutable or no-store");
assert.ok([undefined, "wakes", "sleeps"].includes(expect), "--expect is wakes or sleeps");
const git = (...args) => execFileSync("git", ["-C", repo, ...args]);
const sha = git("rev-parse", `${ref}^{commit}`).toString().trim();
const playwrightVersion = JSON.parse(readFileSync(join(modules, "playwright/package.json"), "utf8")).version;

// The import closure of the two modules, from the commit's own objects, under a fresh temporary runner.
const root = mkdtempSync(join(tmpdir(), "pacing-refund-"));
const runner = join(root, "runner");
const proof = join(root, "proof");
mkdirSync(runner);
mkdirSync(proof);
const hashes = {};
const pending = ["support/pace.mjs", "support/request-policy.mjs"];
while (pending.length) {
  const rel = pending.pop();
  if (rel in hashes) continue;
  const bytes = git("show", `${sha}:runner/${rel}`);
  hashes[rel] = createHash("sha256").update(bytes).digest("hex");
  const dest = join(runner, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  for (const match of bytes.toString().matchAll(/(?:from\s*|import\s*\(\s*)["'](\.[^"']+)["']/g)) {
    const dep = relative(runner, resolve(dirname(dest), match[1]));
    if (dep.endsWith(".mjs")) pending.push(dep);
  }
}
writeFileSync(join(root, "source-manifest.json"), `${JSON.stringify({ sha, hashes }, null, 2)}\n`);
symlinkSync(modules, join(runner, "node_modules"), "dir");

// A loopback store: a page, and one script the store marks immutable (or not).
const served = [];
const server = createServer((request, response) => {
  const { pathname } = new URL(request.url, "http://localhost");
  served.push(pathname);
  const asset = pathname === "/asset.js";
  response.setHeader("cache-control", asset && cache === "immutable" ? "public, max-age=31536000, immutable" : "no-store");
  response.setHeader("content-type", asset ? "text/javascript" : "text/html");
  response.end(asset ? "globalThis.fixtureValue = 1;" : "<!doctype html><main>Refund proof</main>");
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
// Fifty requests 55 seconds ago in the store's log, as an earlier worker would leave them.
const seededAt = Date.now() - 55_000;
const logPrefix = `.store-requests-${new URL(origin).host.replace(/[^a-z0-9.-]/gi, "-")}-`;
writeFileSync(join(proof, `${logPrefix}${Math.floor(seededAt / 60_000)}.log`), Array(50).fill(`${seededAt}\n`).join(""));
Object.assign(process.env, {
  HOME: root, DINKUS_E2E_ENV_FILE: "/dev/null", DINKUS_E2E_PROOF: proof, DINKUS_E2E_PROFILE: join(root, "profile"),
  DINKUS_E2E_RUN: "synthetic-refund", DINKUS_E2E_STORE: origin, DINKUS_E2E_HEADLESS: "1", DINKUS_E2E_VIDEO: "0",
});
const recentCount = () => {
  const now = Date.now();
  return readdirSync(proof).filter(name => name.startsWith(logPrefix))
    .flatMap(name => readFileSync(join(proof, name), "utf8").split("\n").filter(Boolean))
    .reduce((sum, line) => Math.abs(Number(line)) > now - 60_000 ? sum + (line.startsWith("-") ? -1 : 1) : sum, 0);
};

let browser;
try {
  const { chromium } = await import(pathToFileURL(join(modules, "playwright/index.mjs")));
  const { PAGE_ROOM, countStoreRequest, paceSnapshot, paceStore, watchStoreRequests } = await import(pathToFileURL(join(runner, "support/pace.mjs")));
  const { filterPage, wasReplayed } = await import(pathToFileURL(join(runner, "support/request-policy.mjs")));
  browser = await chromium.launch({ headless: true, ...(chromiumPath ? { executablePath: chromiumPath } : {}) });
  const context = await browser.newContext({ serviceWorkers: "block" });
  watchStoreRequests(context);
  const page = await filterPage(await context.newPage(), { store: origin });
  // Warm the browser's own copy of the script, then fill the count to sixty.
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => fetch("/asset.js").then(response => response.text()));
  await new Promise(done => setTimeout(done, 100));
  const warmCount = recentCount();
  assert.ok(warmCount <= 60, `warm count ${warmCount}`);
  for (let i = warmCount; i < 60; i++) countStoreRequest(`${origin}/synthetic-history`);
  assert.equal(recentCount(), 60);
  assert.ok(Date.now() - seededAt < 59_000, "the seeded history is still counted");
  // As the browser sends the script's second request, a step asks for a page's room: 61 counted, so it sleeps.
  let armed = true;
  let startAt = null;
  let releaseAt = null;
  let pacer;
  let replayedObserved = false;
  let started;
  const begun = new Promise(done => { started = done; });
  context.on("request", request => {
    if (!armed || request.url() !== `${origin}/asset.js`) return;
    armed = false;
    startAt = performance.now();
    pacer = paceStore(PAGE_ROOM).then(() => { releaseAt = performance.now(); });
    started();
  });
  context.on("requestfinished", request => {
    if (request.url() === `${origin}/asset.js` && wasReplayed(request)) replayedObserved = true;
  });
  const before = paceSnapshot();
  await Promise.all([page.evaluate(() => fetch("/asset.js").then(response => response.text())), begun]);
  await new Promise(done => setTimeout(done, 75));
  const releasedWithin75ms = releaseAt !== null;
  const countAfter = recentCount();
  if (cache === "immutable") {
    assert.equal(countAfter, 60, "the replay is taken back");
    // A fresh identical call goes at once, whatever the sleeping step does.
    await paceStore(PAGE_ROOM);
  } else assert.equal(countAfter, 61, "a no-store load reaches the store and counts");
  await pacer;
  const after = paceSnapshot();
  const pace = Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]]));
  assert.equal(served.filter(path => path === "/asset.js").length, cache === "immutable" ? 1 : 2, "server requests");
  assert.equal(replayedObserved, cache === "immutable", "replay observed");
  if (expect === "wakes") assert.ok(releasedWithin75ms, "the waiting step goes within 75 ms of the replay");
  if (expect === "sleeps") assert.ok(!releasedWithin75ms, "the waiting step sleeps on");
  const result = {
    source: sha, cache, expect: expect ?? null, node: process.version, playwright: playwrightVersion, chromium: browser.version(),
    page_room: PAGE_ROOM, seed: { requests: 50, age_ms_at_creation: 55_000 }, warm_count: warmCount,
    count_before_replay: 60, count_after_replay: countAfter, request_paths: served,
    replayed_observed: replayedObserved, released_within_75ms: releasedWithin75ms, pace_elapsed_ms: releaseAt - startAt, pace,
    source_hashes: hashes,
    limits: [
      "synthetic near-expiry history and controlled call interleaving",
      "real Playwright context, route, filter and immutable cache on loopback",
      "no live frequency or full-journey speedup claim",
    ],
  };
  if (option("out")) writeFileSync(option("out"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
