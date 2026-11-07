#!/usr/bin/env node
// One actual-helper browser sample. The artificial history isolates the replay/refund boundary.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  assert.ok(["--repo", "--ref", "--playwright", "--chromium", "--cache", "--out"].includes(process.argv[i]), "unknown option");
  assert.ok(process.argv[i + 1], "option needs a value");
  options[process.argv[i].slice(2)] = process.argv[i + 1];
}
for (const name of ["repo", "ref", "playwright", "chromium", "cache", "out"]) assert.ok(options[name], `--${name} required`);
assert.match(options.ref, /^[a-f0-9]{40}$/);
assert.ok(["immutable", "no-store"].includes(options.cache));
assert.equal(process.version, "v24.22.0");
const repo = resolve(options.repo), modules = resolve(options.playwright), out = resolve(options.out);
assert.equal(JSON.parse(readFileSync(join(modules, "playwright/package.json"))).version, "1.61.1");
mkdirSync(out, { recursive: true });
const runtime = mkdtempSync(join(tmpdir(), "pacing-refund-"));
const runner = join(runtime, "runner"), proof = join(runtime, "proof");
mkdirSync(runner); mkdirSync(proof);
const hashes = {}, pending = ["support/pace.mjs", "support/request-policy.mjs"];
while (pending.length) {
  const name = pending.pop();
  if (name in hashes) continue;
  assert.ok(!name.startsWith("../"), "helper import must stay in runner");
  const bytes = execFileSync("git", ["-C", repo, "show", `${options.ref}:runner/${name}`]);
  hashes[name] = createHash("sha256").update(bytes).digest("hex");
  const destination = join(runner, name);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
  for (const match of bytes.toString().matchAll(/(?:from\s*|import\s*\(\s*)["'](\.[^"']+)["']/g)) {
    const dependency = relative(runner, resolve(dirname(destination), match[1]));
    if (dependency.endsWith(".mjs")) pending.push(dependency);
  }
}
symlinkSync(modules, join(runner, "node_modules"), "dir");
writeFileSync(join(out, "source-manifest.json"), JSON.stringify({ source: options.ref, scope: "runner-relative actual helper import closure", sha256: hashes }, null, 2) + "\n");
const requests = [];
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  requests.push(path);
  response.setHeader("cache-control", path === "/asset.js" && options.cache === "immutable" ? "public, max-age=31536000, immutable" : "no-store");
  response.setHeader("content-type", path === "/asset.js" ? "text/javascript" : "text/html");
  response.end(path === "/asset.js" ? "globalThis.fixtureValue = 1;" : "<!doctype html><main>Refund proof</main>");
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const seededAt = Date.now() - 55_000;
const host = new URL(origin).host.replace(/[^a-z0-9.-]/gi, "-");
writeFileSync(join(proof, `.store-requests-${host}-${Math.floor(seededAt / 60_000)}.log`), `${seededAt}\n`.repeat(50));
Object.assign(process.env, {
  HOME: runtime, DINKUS_E2E_ENV_FILE: "/dev/null", DINKUS_E2E_PROOF: proof,
  DINKUS_E2E_PROFILE: join(runtime, "profile"), DINKUS_E2E_RUN: "synthetic-refund",
  DINKUS_E2E_STORE: origin, DINKUS_E2E_HEADLESS: "1", DINKUS_E2E_VIDEO: "0",
});
let browser;
try {
  const { chromium } = await import(pathToFileURL(join(modules, "playwright/index.mjs")));
  const { watchStoreRequests, paceStore, paceSnapshot, countStoreRequest, PAGE_ROOM } = await import(pathToFileURL(join(runner, "support/pace.mjs")));
  const { filterPage, wasReplayed } = await import(pathToFileURL(join(runner, "support/request-policy.mjs")));
  assert.equal(PAGE_ROOM, 40);
  browser = await chromium.launch({ headless: true, executablePath: resolve(options.chromium) });
  const context = await browser.newContext({ serviceWorkers: "block" });
  watchStoreRequests(context);
  const page = await filterPage(await context.newPage(), { store: origin });
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => fetch("/asset.js").then(response => response.text()));
  await new Promise(done => setTimeout(done, 100)); // allow the actual asynchronous cache remember to complete
  const recentCount = () => readdirSync(proof).filter(name => name.startsWith(".store-requests-")).flatMap(name =>
    readFileSync(join(proof, name), "utf8").trim().split("\n")).reduce((sum, line) => {
      const time = Number(line);
      return Math.abs(time) > Date.now() - 60_000 ? sum + (time < 0 ? -1 : 1) : sum;
    }, 0);
  const warmCount = recentCount();
  assert.ok(warmCount <= 60);
  for (let i = warmCount; i < 60; i++) countStoreRequest(`${origin}/synthetic-history`);
  assert.equal(recentCount(), 60);
  assert.ok(Date.now() - seededAt < 59_000, "warmup exhausted synthetic history; sample is not comparable");
  let armed = true, signalStarted, pendingPacer, releasedAt = null, startedAt = null, replayed = false;
  const started = new Promise(resolveStarted => { signalStarted = resolveStarted; });
  const before = paceSnapshot();
  context.on("request", request => {
    if (!armed || request.url() !== `${origin}/asset.js`) return;
    armed = false;
    startedAt = performance.now();
    pendingPacer = paceStore(PAGE_ROOM).then(() => { releasedAt = performance.now(); });
    signalStarted();
  });
  context.on("requestfinished", request => {
    if (request.url() === `${origin}/asset.js` && wasReplayed(request)) replayed = true;
  });
  await Promise.all([page.evaluate(() => fetch("/asset.js").then(response => response.text())), started]);
  await new Promise(done => setTimeout(done, 75));
  const releasedWithin75ms = releasedAt !== null;
  const countAfter = recentCount();
  if (options.cache === "immutable") {
    assert.equal(countAfter, 60);
    await paceStore(PAGE_ROOM); // a fresh call must prove that the refunded budget already fits
  } else assert.equal(countAfter, 61);
  let watchdog;
  try {
    await Promise.race([pendingPacer, new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("pacer did not finish within 20 seconds")), 20_000); })]);
  } finally { clearTimeout(watchdog); }
  const after = paceSnapshot();
  const counters = Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]]));
  assert.equal(requests.filter(path => path === "/asset.js").length, options.cache === "immutable" ? 1 : 2);
  assert.equal(replayed, options.cache === "immutable");
  const result = {
    source: options.ref, cache: options.cache, node: process.version, playwright: "1.61.1", chromium: browser.version(),
    page_room: PAGE_ROOM, seed: { requests: 50, age_ms_at_creation: 55_000 }, warm_count: warmCount,
    count_before_replay: 60, count_after_replay: countAfter, request_paths: requests,
    replayed_observed: replayed, released_within_75ms: releasedWithin75ms,
    pace_elapsed_ms: releasedAt - startedAt, pace: counters,
    source_manifest: "source-manifest.json",
    limits: ["synthetic near-expiry history and controlled call interleaving", "real Playwright context/filter/cache", "not live frequency or end-to-end speedup"],
  };
  writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
