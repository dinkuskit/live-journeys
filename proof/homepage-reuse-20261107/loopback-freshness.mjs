#!/usr/bin/env node
// Loopback check of the handoff's freshness guard on the real Playwright 1.61.1 and a Chromium. The one
// thing the offline fixture takes on trust is how Playwright delivers `framenavigated` around
// `page.goto`, same-document moves and child frames, which the handoff in runner/support/shopper.mjs
// relies on. This serves three pages on 127.0.0.1 and reaches nothing else; it installs nothing. The
// actual shopper.mjs is evaluated from the named commit (or the working tree) over stand-ins for its
// settings, pacing and proof note, with the real page. Run from the repository root:
//
//   node proof/homepage-reuse-20261107/loopback-freshness.mjs --playwright runner/node_modules [--chromium /path/to/chromium] [--ref <sha>] [--out result.json]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Script, createContext } from "node:vm";

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.flatMap((arg, i) => arg.startsWith("--") ? [[arg.slice(2), argv[i + 1]]] : []));
const modules = resolve(args.playwright ?? "runner/node_modules");
assert.equal(JSON.parse(readFileSync(resolve(modules, "playwright/package.json"), "utf8")).version, "1.61.1");
const { chromium } = createRequire(resolve(modules, "../x"))("playwright");
const ref = args.ref ? execFileSync("git", ["rev-parse", `${args.ref}^{commit}`], { encoding: "utf8" }).trim() : null;
const source = ref ? execFileSync("git", ["show", `${ref}:runner/support/shopper.mjs`], { encoding: "utf8" }) : readFileSync("runner/support/shopper.mjs", "utf8");
assert.doesNotMatch(source, /\bfetch\(|from "node:(?:http|https|net|dns|child_process)"/);

const pages = {
  "/": '<!doctype html><meta charset=utf-8><title>Loopback store</title><main><h1>Store</h1><iframe src="/frame"></iframe></main>',
  "/frame": "<!doctype html><meta charset=utf-8><p>frame</p>",
  "/other": "<!doctype html><meta charset=utf-8><title>Other</title><p>other</p>",
};
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  response.statusCode = path in pages ? 200 : 404;
  response.setHeader("content-type", "text/html");
  response.end(pages[path] ?? "<!doctype html><p>missing</p>");
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const home = `${origin}/`;

const stripped = source.replace(/^import .*$/gm, "").replace(/^export /gm, "");
const { openShopperPage } = new Script(`${stripped}\n({ openShopperPage });`).runInContext(createContext({
  URL, Error, config: { store: origin }, PAGE_ROOM: 40, paceStore: async () => {}, note() {},
  openStorePage: async (page, url) => page.goto(url, { waitUntil: "domcontentloaded" }),
}));

const checks = [];
const check = async (name, body) => {
  try { await body(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: String(error?.message ?? error).split("\n")[0] }); }
};
const mainMoved = page => page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame(), timeout: 10_000 });
const browser = await chromium.launch({ headless: true, executablePath: args.chromium });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await check("a fresh open hands on its own response: the goto's navigation event arrives before goto resolves", async () => {
    const opened = await openShopperPage(page, "/");
    const response = opened.take(page, home);
    assert.ok(response, "take gave nothing");
    assert.equal(response.status(), 200);
    assert.equal(response.url(), home);
    assert.equal(opened.take(page, home), null, "once");
  });
  await check("a hash change the page makes spoils it", async () => {
    const opened = await openShopperPage(page, "/");
    await Promise.all([mainMoved(page), page.evaluate(() => { location.hash = "#top"; })]);
    assert.equal(opened.take(page, home), null);
  });
  await check("a pushState the page makes spoils it", async () => {
    const opened = await openShopperPage(page, "/");
    await Promise.all([mainMoved(page), page.evaluate(() => history.pushState({}, "", "/pushed"))]);
    assert.equal(opened.take(page, home), null);
  });
  await check("a reload spoils it", async () => {
    const opened = await openShopperPage(page, "/");
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(opened.take(page, home), null);
  });
  await check("a child frame navigating leaves it current", async () => {
    const opened = await openShopperPage(page, "/");
    await page.waitForLoadState("load");
    const child = page.frames().find(frame => frame.parentFrame() === page.mainFrame());
    assert.ok(child, "no child frame");
    await Promise.all([page.waitForEvent("framenavigated", { predicate: frame => frame === child, timeout: 10_000 }), child.goto(`${origin}/frame?again`)]);
    const response = opened.take(page, home);
    assert.ok(response, "take gave nothing");
    assert.equal(response.url(), home);
  });
  await check("another page, another address and a closed page are refused", async () => {
    const opened = await openShopperPage(page, "/");
    const other = await context.newPage();
    assert.equal(opened.take(other, home), null, "another page");
    await other.close();
    const again = await openShopperPage(page, "/");
    assert.equal(again.take(page, `${origin}/other`), null, "another address");
    const closing = await context.newPage();
    const last = await openShopperPage(closing, "/");
    await closing.close();
    assert.equal(last.take(closing, home), null, "a closed page");
  });
  await check("a later open spends the earlier handoff", async () => {
    const first = await openShopperPage(page, "/");
    const second = await openShopperPage(page, "/");
    assert.equal(first.take(page, home), null);
    assert.ok(second.take(page, home));
  });
  await check("the status check holds and hands nothing on", async () => {
    await assert.rejects(openShopperPage(page, "/missing"), /answered HTTP 404\./);
  });
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
const result = { source: ref ?? "working tree", node: process.version, playwright: "1.61.1", scope: "loopback-only freshness guard check; no store, settings, credentials or other network", checks };
console.log(JSON.stringify(result, null, 2));
if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 2) + "\n");
if (checks.some(entry => !entry.ok)) process.exit(1);
