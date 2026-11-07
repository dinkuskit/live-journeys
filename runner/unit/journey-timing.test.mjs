import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Script, createContext } from "node:vm";
import { loadJourney, playwrightStubs } from "./fixtures/journey-wrapper.mjs";

// Each test file runs in its own process, so this file's proof folder, run id and pace counters stay
// its own. The store is named so pace logs and the request budget are live, as in a run.
const dir = mkdtempSync(join(tmpdir(), "dinkus-journey-timing-"));
after(() => rmSync(dir, { recursive: true, force: true }));
Object.assign(process.env, {
  DINKUS_E2E_ENV_FILE: join(dir, "no-settings"),
  DINKUS_E2E_PROOF: dir,
  DINKUS_E2E_PROFILE: join(dir, "profile"),
  DINKUS_E2E_STORE: "https://store.example",
  DINKUS_E2E_RUN: "timed",
});
// A hundred store requests sent 59 s before this worker starts, in that minute's log, so the first
// paceStore(1) has to sleep about a second (plus its 250 ms margin) on real timers, and then runs free.
const SENT_AGO = 59_000;
const sentAt = Date.now() - SENT_AGO;
/** What paceStore(1) would schedule right now for requests stamped `at`: their minute's end, plus the margin. */
const scheduledFor = at => at + 60_000 - Date.now() + 250;
writeFileSync(join(dir, `.store-requests-store.example-${Math.floor(sentAt / 60_000)}.log`), Array(100).fill(`${sentAt}\n`).join(""));
const pace = await import("../support/pace.mjs");
const proof = await import("../support/proof.mjs");
const { STORE_REFUSALS_PATTERN, failureKind, firstLine, forProof, isWaitFailureKind } = await import("../support/errors.mjs");
const { config } = await import("../support/env.mjs");

const quiet = t => t.mock.method(console, "log", () => {});
const report = () => JSON.parse(readFileSync(join(dir, "timed", "report.json"), "utf8"));
const markdown = () => readFileSync(join(dir, "timed", "PROOF.md"), "utf8");
const timingOf = name => report().facts[`${name} timing`];

/** The real wrapper, bound to the real proof and pace modules and to stand-ins for Playwright. */
function wrapper(title, retry = 0) {
  const stubs = playwrightStubs({ title, retry });
  const { journey } = loadJourney({
    ...stubs, config, console, firstLine, forProof,
    paceSnapshot: pace.paceSnapshot,
    attemptVerdict: proof.attemptVerdict, journeyVerdict: proof.journeyVerdict, noteJourneyTiming: proof.noteJourneyTiming,
    record: proof.record, shot: async () => "", startJourney: proof.startJourney,
  });
  return { journey, run: body => journey(body)({ page: "the page" }) };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("a journey that waits on the store records its sleeps as measured, its body time, and nothing else", async t => {
  quiet(t);
  const before = pace.paceSnapshot();
  assert.deepEqual(before, { sleeps: 0, ms: 0, wallMs: 0 });
  const { run } = wrapper("Full catalog");
  const scheduled = scheduledFor(sentAt);
  assert.ok(scheduled > 250, `the seeded requests still hold the budget (${scheduled} ms)`);
  await run(async ({ page }) => {
    assert.equal(page, "the page");
    proof.record("Content > Products opens", "PASS");
    await pace.paceStore(1);
    proof.record("The owner adds what the catalog lacks", "PASS");
  });
  const timing = timingOf("Full catalog");
  assert.equal(timing.unit, "ms");
  assert.equal(timing.tries.length, 1);
  const [first] = timing.tries;
  assert.deepEqual(Object.keys(first), ["try", "body", "verdict", "body_ms", "pace_sleeps", "pace_sleep_ms", "pace_sleep_wall_ms"]);
  assert.equal(first.try, 1);
  assert.equal(first.body, "returned");
  assert.equal(first.verdict, "PASS");
  assert.equal(first.pace_sleeps, 1);
  // The sleep is measured as it happened: at least what was scheduled (less the moments between
  // computing it here and in paceStore), and the body took at least that long. Whole milliseconds,
  // with no pretence of finer precision.
  assert.ok(first.pace_sleep_ms >= scheduled - 100, `measured ${first.pace_sleep_ms} ms, scheduled ${scheduled} ms`);
  assert.ok(first.pace_sleep_ms < scheduled + 2_000, `measured ${first.pace_sleep_ms} ms, scheduled ${scheduled} ms`);
  assert.equal(first.pace_sleep_wall_ms, first.pace_sleep_ms);
  assert.ok(first.body_ms >= first.pace_sleep_ms, `${first.body_ms} >= ${first.pace_sleep_ms}`);
  for (const key of ["body_ms", "pace_sleeps", "pace_sleep_ms", "pace_sleep_wall_ms"]) assert.ok(Number.isInteger(first[key]), key);
  // The worker's counters moved by exactly that sleep.
  const after = pace.paceSnapshot();
  assert.equal(after.sleeps, 1);
  assert.equal(Math.round(after.ms), first.pace_sleep_ms);
  // The fact is private: it sits in report.json and PROOF.md's Facts as JSON, named after the journey.
  assert.match(markdown(), /^- Full catalog timing: \{"unit":"ms","tries":\[\{"try":1,"body":"returned","verdict":"PASS",/m);
});

test("a journey that never waits records zero sleeps, not a manufactured sleep time", async t => {
  quiet(t);
  const before = pace.paceSnapshot();
  const { run } = wrapper("Storefront");
  await run(async () => {
    proof.record("A new shopper can open the store", "PASS");
    await pace.paceStore(40);
    await wait(20);
  });
  const [first] = timingOf("Storefront").tries;
  assert.equal(first.pace_sleeps, 0);
  assert.equal(first.pace_sleep_ms, 0);
  assert.equal(first.pace_sleep_wall_ms, 0);
  assert.ok(first.body_ms >= 15 && first.body_ms < 5_000, `${first.body_ms} ms`);
  assert.deepEqual(pace.paceSnapshot(), before);
});

test("overlapping sleeps count each one in the sum but once in the wall time", async t => {
  quiet(t);
  // Fill the budget again with a hundred requests stamped 59 s ago, so two paceStore(1) awaited together
  // schedule the same short sleep from the same instant and overlap entirely. Real timers throughout.
  const originalNow = Date.now;
  const stamp = originalNow() - SENT_AGO;
  Date.now = () => stamp;
  try {
    for (let i = 0; i < 100; i++) pace.countStoreRequest("https://store.example/products/cap");
  } finally {
    Date.now = originalNow;
  }
  const scheduled = scheduledFor(stamp);
  assert.ok(scheduled > 250, `the stamped requests hold the budget (${scheduled} ms)`);
  const before = pace.paceSnapshot();
  const { run } = wrapper("Cart");
  await run(async () => {
    proof.record("Add to cart puts the product in the cart", "PASS");
    await Promise.all([pace.paceStore(1), pace.paceStore(1)]);
  });
  const [first] = timingOf("Cart").tries;
  assert.equal(first.pace_sleeps, 2);
  assert.ok(first.pace_sleep_ms >= 2 * (scheduled - 100), `${first.pace_sleep_ms} ms summed, scheduled ${scheduled} ms each`);
  assert.ok(first.pace_sleep_wall_ms < first.pace_sleep_ms, `${first.pace_sleep_wall_ms} wall < ${first.pace_sleep_ms} sum`);
  assert.ok(first.pace_sleep_wall_ms >= scheduled - 100, `${first.pace_sleep_wall_ms} ms wall, scheduled ${scheduled} ms`);
  assert.ok(first.pace_sleep_wall_ms < scheduled + 2_000, `${first.pace_sleep_wall_ms} ms wall, scheduled ${scheduled} ms`);
  assert.equal(pace.paceSnapshot().sleeps, before.sleeps + 2);
});

test("a journey that throws keeps its error, records the failure, and still writes its timing", async t => {
  quiet(t);
  const { run } = wrapper("Problems");
  const thrown = new Error("page.goto: Timeout 90000ms exceeded.\nCall log:\n  - navigating to https://store.example/cart?token=secret");
  const caught = await run(async () => {
    proof.record("The owner can open Commerce Orders", "PASS");
    await wait(10);
    throw thrown;
  }).then(() => assert.fail("the journey should fail"), error => error);
  // The same error object, as forProof keeps it, with only its first line.
  assert.equal(caught, thrown);
  assert.equal(caught.message, "page.goto: Timeout 90000ms exceeded.");
  const steps = report().steps.filter(s => s.journey === "Problems");
  assert.deepEqual(steps.map(s => [s.step, s.status]), [["The owner can open Commerce Orders", "PASS"], ["The journey finished without an error", "FAIL"]]);
  assert.equal(proof.journeyVerdict("Problems"), "FAIL");
  const [first] = timingOf("Problems").tries;
  assert.equal(first.body, "threw");
  assert.equal(first.verdict, "FAIL");
  assert.ok(first.body_ms >= 5 && first.body_ms < 5_000, `${first.body_ms} ms`);
  assert.equal(first.pace_sleeps, 0);
});

test("a journey whose soft step failed still fails after its timing is written", async t => {
  quiet(t);
  const { run } = wrapper("Manage products");
  await assert.rejects(run(async () => {
    proof.record("A new price shows on the store", "FAIL", "the Shop list still shows $12.00 after 60 s");
  }), /PROOF\.md: FAIL is not PASS/);
  const [first] = timingOf("Manage products").tries;
  assert.equal(first.body, "returned");
  assert.equal(first.verdict, "FAIL");
});

test("a retry keeps the failed try's timing beside its own, and a fresh run of the journey starts over", async t => {
  quiet(t);
  const first = wrapper("Cart", 0);
  await first.run(async () => {
    proof.record("Add to cart puts the product in the cart", "FAIL", "the header's cart shows 0 items");
    await wait(30);
  }).catch(() => {});
  const second = wrapper("Cart", 1);
  await second.run(async () => {
    proof.record("Add to cart puts the product in the cart", "PASS");
    await wait(10);
  });
  assert.equal(proof.journeyVerdict("Cart"), "FLAKY");
  const { tries } = timingOf("Cart");
  assert.deepEqual(tries.map(entry => [entry.try, entry.body, entry.verdict]), [[1, "returned", "FAIL"], [2, "returned", "PASS"]]);
  assert.ok(tries[0].body_ms >= 25, `first try ${tries[0].body_ms} ms`);
  // Per-try entries, so the last try's and the total are both plain to read, and the failed try stays.
  const total = tries.reduce((sum, entry) => sum + entry.body_ms, 0);
  assert.ok(total >= tries.at(-1).body_ms);
  // A retry run again under the same retry number replaces only its own entry.
  await wrapper("Cart", 1).run(async () => { proof.record("Add to cart puts the product in the cart", "PASS"); });
  assert.deepEqual(timingOf("Cart").tries.map(entry => entry.try), [1, 2]);
  // The journey run again, not as a retry, starts its tries over, as its steps do.
  await wrapper("Cart", 0).run(async () => { proof.record("Add to cart puts the product in the cart", "PASS"); });
  assert.deepEqual(timingOf("Cart").tries.map(entry => entry.try), [1]);
  assert.equal(proof.journeyVerdict("Cart"), "PASS");
});

test("nothing is written for a try until its body finishes, so a cut-off try leaves no entry", async t => {
  quiet(t);
  let finish;
  const { run } = wrapper("Buy and ship");
  const running = run(() => new Promise(resolve => { finish = resolve; }));
  await setImmediate();
  proof.record("Place a Stripe TEST order on the store", "PASS");
  assert.equal(timingOf("Buy and ship"), undefined);
  assert.doesNotMatch(markdown(), /Buy and ship timing/);
  finish();
  await running;
  assert.equal(timingOf("Buy and ship").tries.length, 1);
});

test("a timing write that fails changes neither the journey's outcome nor its error", async t => {
  quiet(t);
  const stubs = playwrightStubs({ title: "Ship settings", retry: 0 });
  const { journey } = loadJourney({
    ...stubs, config, console, firstLine, forProof, paceSnapshot: pace.paceSnapshot,
    attemptVerdict: proof.attemptVerdict, journeyVerdict: proof.journeyVerdict,
    noteJourneyTiming: () => { throw new Error("disk full"); },
    record: proof.record, shot: async () => "", startJourney: proof.startJourney,
  });
  await journey(async () => { proof.record("Ship's settings show the Store ID", "PASS"); })({ page: undefined });
  assert.equal(proof.journeyVerdict("Ship settings"), "PASS");
  const thrown = new Error("boom");
  const caught = await journey(async () => { throw thrown; })({ page: undefined }).catch(error => error);
  assert.equal(caught, thrown);
  assert.equal(timingOf("Ship settings"), undefined);
});

test("a later worker keeps every journey's timing and the run's other facts, and the public summary shows none of it", async t => {
  quiet(t);
  proof.note("products listed", 4);
  proof.note("plugins", "dinkus-commerce-beta 0.8.0-beta.1");
  // Another worker, as Playwright starts one after a failed journey: a fresh copy of the proof module
  // loads the report from disk, and its wrapper writes its own journey's timing beside the others'.
  const later = await import("../support/proof.mjs?worker2");
  const stubs = playwrightStubs({ title: "Mark as completed", retry: 0 });
  const { journey } = loadJourney({
    ...stubs, config, console, firstLine, forProof, paceSnapshot: pace.paceSnapshot,
    attemptVerdict: later.attemptVerdict, journeyVerdict: later.journeyVerdict, noteJourneyTiming: later.noteJourneyTiming,
    record: later.record, shot: async () => "", startJourney: later.startJourney,
  });
  await journey(async () => { later.record("The owner can open Commerce Orders", "PASS"); })({ page: undefined });
  const saved = report();
  for (const name of ["Full catalog", "Storefront", "Cart", "Problems", "Manage products", "Buy and ship", "Mark as completed"]) {
    assert.ok(Array.isArray(saved.facts[`${name} timing`]?.tries), `${name} timing kept`);
  }
  assert.equal(saved.facts["products listed"], 4);
  assert.equal(saved.facts.plugins, "dinkus-commerce-beta 0.8.0-beta.1");
  assert.deepEqual(Object.keys(saved), ["run", "mode", "store", "ship", "verdict", "journeys", "facts", "steps"]);
  // The diagnostics reader still takes a report whose facts hold these objects, and projects none of them.
  const { analyze } = await import("../scripts/report-diagnostics.mjs");
  const projected = analyze({ ...saved, run: "github-42337050608-1" }, { run: "42337050608", attempt: "1" });
  assert.equal(projected.length, saved.journeys.length);
  assert.doesNotMatch(JSON.stringify(projected), /timing|body_ms|pace_sleep/);
  // The default public run summary names no timing: it reads only the facts it knows.
  const summary = publicSummary(join(dir, "timed"));
  assert.doesNotMatch(summary, /timing|body_ms|pace_sleep/);
  assert.match(summary, /Plugins tested: dinkus-commerce-beta 0\.8\.0-beta\.1/);
});

/** Runs scripts/run-summary.mjs as it is, in this process (the sandbox spawns none), and returns what it prints. */
function publicSummary(folder) {
  const source = readFileSync(new URL("../scripts/run-summary.mjs", import.meta.url), "utf8")
    .replace(/^#!.*$/m, "").replace(/^import .*$/gm, "");
  const printed = [];
  new Script(source).runInContext(createContext({
    STORE_REFUSALS_PATTERN, failureKind, isWaitFailureKind, readFileSync, join,
    process: { argv: ["node", "run-summary.mjs", folder, "1"], exit() {} },
    console: { log: text => printed.push(text) },
  }));
  return printed.join("\n");
}
