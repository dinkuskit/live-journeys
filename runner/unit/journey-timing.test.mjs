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
const reportFile = join(dir, "timed", "report.json");
const report = () => JSON.parse(readFileSync(reportFile, "utf8"));
const markdown = () => readFileSync(join(dir, "timed", "PROOF.md"), "utf8");
const timingOf = name => report().facts[`${name} timing`];
const FIELDS = ["try", "body", "verdict", "body_ms", "pace_sleeps", "pace_sleep_requested_ms", "pace_sleep_ms", "pace_sleep_wall_ms"];

/** The real wrapper, bound to the real proof and pace modules (or `bound` stand-ins) and to stand-ins for Playwright. */
function wrapper(title, retry = 0, bound = {}) {
  const stubs = playwrightStubs({ title, retry });
  const loaded = loadJourney({
    ...stubs, config, console, firstLine, forProof,
    paceSnapshot: pace.paceSnapshot,
    attemptVerdict: proof.attemptVerdict, journeyVerdict: proof.journeyVerdict, noteJourneyTiming: proof.noteJourneyTiming,
    record: proof.record, shot: async () => "", startJourney: proof.startJourney,
    ...bound,
  });
  return { ...loaded, run: body => loaded.journey(body)({ page: "the page" }) };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Fills the store budget with a hundred requests stamped `SENT_AGO` ago, so the next paceStore(1) sleeps about a second. */
function fillBudget() {
  const originalNow = Date.now;
  const stamp = originalNow() - SENT_AGO;
  Date.now = () => stamp;
  try {
    for (let i = 0; i < 100; i++) pace.countStoreRequest("https://store.example/products/cap");
  } finally {
    Date.now = originalNow;
  }
  const scheduled = scheduledFor(stamp);
  assert.ok(scheduled > 250 && scheduled < 2_000, `the stamped requests hold the budget (${scheduled} ms)`);
  return scheduled;
}

test("a journey that waits on the store records its sleep as asked for and as measured, its body time, and nothing else", async t => {
  quiet(t);
  const before = pace.paceSnapshot();
  assert.deepEqual(before, { sleeps: 0, requestedMs: 0, ms: 0, wallMs: 0 });
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
  assert.deepEqual(Object.keys(first), FIELDS);
  assert.equal(first.try, 1);
  assert.equal(first.body, "returned");
  assert.equal(first.verdict, "PASS");
  assert.equal(first.pace_sleeps, 1);
  // What the sleep asked the timer for: the scheduled wait, less the moments between computing it here
  // and in paceStore, plus the 250 ms margin, from the same Date.now() arithmetic as before.
  assert.ok(first.pace_sleep_requested_ms > scheduled - 100 && first.pace_sleep_requested_ms <= scheduled, `asked ${first.pace_sleep_requested_ms} ms, scheduled ${scheduled} ms`);
  // What it measured: at least what it asked for, give or take the few milliseconds by which the timer's
  // own clock, read at the start of its event-loop turn, trails the monotonic one; never a second more
  // here, where nothing else holds the loop. Whole milliseconds, with no pretence of finer precision.
  assert.ok(first.pace_sleep_ms >= first.pace_sleep_requested_ms - 50, `measured ${first.pace_sleep_ms} ms, asked ${first.pace_sleep_requested_ms} ms`);
  assert.ok(first.pace_sleep_ms < first.pace_sleep_requested_ms + 2_000, `measured ${first.pace_sleep_ms} ms, asked ${first.pace_sleep_requested_ms} ms`);
  assert.equal(first.pace_sleep_wall_ms, first.pace_sleep_ms);
  assert.ok(first.body_ms >= first.pace_sleep_ms, `${first.body_ms} >= ${first.pace_sleep_ms}`);
  for (const key of FIELDS.slice(3)) assert.ok(Number.isInteger(first[key]), key);
  // The worker's counters moved by exactly that sleep.
  const after = pace.paceSnapshot();
  assert.equal(after.sleeps, 1);
  assert.equal(after.requestedMs, first.pace_sleep_requested_ms);
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
  assert.equal(first.pace_sleep_requested_ms, 0);
  assert.equal(first.pace_sleep_ms, 0);
  assert.equal(first.pace_sleep_wall_ms, 0);
  assert.ok(first.body_ms >= 15 && first.body_ms < 5_000, `${first.body_ms} ms`);
  assert.deepEqual(pace.paceSnapshot(), before);
});

test("overlapping sleeps count each one in the sum, which then exceeds the body's own time, but once in the wall time", async t => {
  quiet(t);
  // Two paceStore(1) awaited together schedule the same short sleep from the same instant and overlap
  // entirely. Real timers throughout.
  const scheduled = fillBudget();
  const before = pace.paceSnapshot();
  const { run } = wrapper("Cart");
  await run(async () => {
    proof.record("Add to cart puts the product in the cart", "PASS");
    await Promise.all([pace.paceStore(1), pace.paceStore(1)]);
  });
  const [first] = timingOf("Cart").tries;
  assert.equal(first.pace_sleeps, 2);
  assert.ok(first.pace_sleep_requested_ms > 2 * (scheduled - 100) && first.pace_sleep_requested_ms <= 2 * scheduled, `asked ${first.pace_sleep_requested_ms} ms, scheduled ${scheduled} ms each`);
  assert.ok(first.pace_sleep_ms >= first.pace_sleep_requested_ms - 100, `${first.pace_sleep_ms} ms summed, asked ${first.pace_sleep_requested_ms} ms`);
  // The sum double-counts the overlap, so it is more than the body ran for; the wall time is not.
  assert.ok(first.pace_sleep_ms > first.body_ms, `${first.pace_sleep_ms} ms summed > ${first.body_ms} ms body`);
  assert.ok(first.pace_sleep_wall_ms < first.pace_sleep_ms, `${first.pace_sleep_wall_ms} wall < ${first.pace_sleep_ms} sum`);
  assert.ok(first.pace_sleep_wall_ms <= first.body_ms, `${first.pace_sleep_wall_ms} wall <= ${first.body_ms} body`);
  assert.ok(first.pace_sleep_wall_ms >= scheduled - 100, `${first.pace_sleep_wall_ms} ms wall, scheduled ${scheduled} ms`);
  assert.ok(first.pace_sleep_wall_ms < scheduled + 2_000, `${first.pace_sleep_wall_ms} ms wall, scheduled ${scheduled} ms`);
  assert.equal(pace.paceSnapshot().sleeps, before.sleeps + 2);
});

test("a wall-clock jump during a sleep moves what paceStore decides, as before, but not what is measured", async t => {
  quiet(t);
  const scheduled = fillBudget();
  const before = pace.paceSnapshot();
  const originalNow = Date.now;
  const { run } = wrapper("Payments status");
  try {
    await run(async () => {
      proof.record("Payments shows the processor connected", "PASS");
      const sleeping = pace.paceStore(1);
      await wait(100);
      // The wall clock leaps an hour while the timer runs. The sleep and the body are timed on the
      // monotonic clock, so neither reads an hour.
      Date.now = () => originalNow() + 3_600_000;
      await sleeping;
      // Pacing still decides from Date.now(), as it did: by that clock the logged requests are an hour
      // old, so a full page's worth of room waits for nothing.
      await pace.paceStore(pace.STORE_BUDGET);
    });
  } finally {
    Date.now = originalNow;
  }
  const [first] = timingOf("Payments status").tries;
  assert.equal(first.pace_sleeps, 1);
  assert.ok(first.pace_sleep_requested_ms > scheduled - 100 && first.pace_sleep_requested_ms <= scheduled, `asked ${first.pace_sleep_requested_ms} ms`);
  assert.ok(first.pace_sleep_ms >= first.pace_sleep_requested_ms - 50 && first.pace_sleep_ms < scheduled + 2_000, `measured ${first.pace_sleep_ms} ms`);
  assert.ok(first.body_ms >= first.pace_sleep_wall_ms && first.body_ms < 10_000, `${first.body_ms} ms body`);
  assert.equal(pace.paceSnapshot().sleeps, before.sleeps + 1);
});

test("a sleep still running when the body ends is left out of that try's entry, and counts where it ends", async t => {
  quiet(t);
  // Every journey awaits each sleep it starts, so its sleeps end inside its body. One that didn't (a body
  // that threw while a sleep it started was waiting) is the known limit: the sleep counts, whole, when
  // it ends, so it lands in the next journey of this worker, not split across the two.
  const scheduled = fillBudget();
  const before = pace.paceSnapshot();
  const { run } = wrapper("Buy a label in the store admin");
  const thrown = new Error("the label dialog closed");
  let sleeping;
  const caught = await run(async () => {
    proof.record("Buy a label opens the label dialog", "PASS");
    sleeping = pace.paceStore(1);
    await wait(50);
    throw thrown;
  }).catch(error => error);
  assert.equal(caught, thrown);
  const [first] = timingOf("Buy a label in the store admin").tries;
  assert.equal(first.body, "threw");
  assert.equal(first.pace_sleeps, 0);
  assert.equal(first.pace_sleep_requested_ms, 0);
  assert.equal(first.pace_sleep_ms, 0);
  assert.equal(first.pace_sleep_wall_ms, 0);
  assert.ok(first.body_ms >= 45 && first.body_ms < scheduled, `${first.body_ms} ms body, the sleep still has ${scheduled} ms to run`);
  // The worker's counters have not moved yet: nothing is counted for a sleep until it ends.
  assert.deepEqual(pace.paceSnapshot(), before);
  // The next journey of this worker (here, the retry) is running when the sleep ends, so its entry
  // takes in the whole sleep, beside a body that ran for less than it: the figure the README warns of.
  await wrapper("Buy a label in the store admin", 1).run(async () => {
    proof.record("Buy a label opens the label dialog", "PASS");
    await sleeping;
  });
  const [, retry] = timingOf("Buy a label in the store admin").tries;
  assert.equal(retry.try, 2);
  assert.equal(retry.pace_sleeps, 1);
  assert.ok(retry.pace_sleep_ms >= scheduled - 100, `${retry.pace_sleep_ms} ms counted once it ended, scheduled ${scheduled} ms`);
  assert.equal(retry.pace_sleep_wall_ms, retry.pace_sleep_ms);
  assert.ok(retry.pace_sleep_ms > retry.body_ms, `${retry.pace_sleep_ms} ms of sleep > ${retry.body_ms} ms body, with no overlap`);
  assert.equal(pace.paceSnapshot().sleeps, before.sleeps + 1);
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

test("the body's span leaves out the journey's start and the fact's write, and takes in its own screenshots and cleanup", async t => {
  quiet(t);
  // Holds the thread, as a slow report write would, for the two writes on either side of the body.
  const stall = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const { journey, step } = wrapper("One product with a category", 0, {
    startJourney: (...args) => { stall(200); return proof.startJourney(...args); },
    noteJourneyTiming: (...args) => { stall(200); return proof.noteJourneyTiming(...args); },
    shot: async () => { await wait(30); return ""; },
  });
  const thrown = new Error("the order page lost its details");
  const caught = await journey(async ({ page }) => {
    // A step's screenshot is the body's own work, and so is the cleanup it runs on its way out.
    await step(page, "The order's details open", async () => { await wait(10); });
    try {
      await wait(10);
      throw thrown;
    } finally {
      await wait(20);
    }
  })({ page: "the page" }).catch(error => error);
  assert.equal(caught, thrown);
  const [first] = timingOf("One product with a category").tries;
  assert.equal(first.body, "threw");
  assert.equal(first.verdict, "FAIL");
  assert.ok(first.body_ms >= 60, `${first.body_ms} ms takes in the screenshot and the cleanup`);
  assert.ok(first.body_ms < 250, `${first.body_ms} ms leaves out the 200 ms held on either side`);
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
    // The retry's start kept the failed try's entry; only a run that is not a retry clears them.
    assert.deepEqual(timingOf("Cart").tries.map(entry => [entry.try, entry.verdict]), [[1, "FAIL"]]);
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

test("nothing is written for a try until its body finishes: a rerun clears the earlier entry as it starts, and a cut-off try leaves none", async t => {
  quiet(t);
  const { run } = wrapper("Buy and ship");
  await run(async () => { proof.record("Place a Stripe TEST order on the store", "PASS"); });
  assert.equal(timingOf("Buy and ship").tries.length, 1);
  // Loading the modules again, as listing the journeys does, and reading the counters write nothing.
  const saved = readFileSync(reportFile, "utf8");
  await import("../support/proof.mjs?listed");
  await import("../support/pace.mjs?listed");
  pace.paceSnapshot();
  assert.equal(readFileSync(reportFile, "utf8"), saved);
  // The journey run again under the same run id: its start clears the earlier entry, in the write it
  // already makes, so nothing stands for this try until it finishes, however many steps it records.
  let finish;
  const running = run(() => new Promise(resolve => { finish = resolve; }));
  assert.equal(timingOf("Buy and ship"), undefined);
  await setImmediate();
  proof.record("Place a Stripe TEST order on the store", "PASS");
  assert.equal(timingOf("Buy and ship"), undefined);
  assert.doesNotMatch(markdown(), /Buy and ship timing/);
  finish();
  await running;
  assert.deepEqual(timingOf("Buy and ship").tries.map(entry => entry.try), [1]);
});

test("a timing write that fails changes neither the journey's outcome nor its error", async t => {
  quiet(t);
  const { journey } = wrapper("Ship settings", 0, { noteJourneyTiming: () => { throw new Error("disk full"); } });
  await journey(async () => { proof.record("Ship's settings show the Store ID", "PASS"); })({ page: undefined });
  assert.equal(proof.journeyVerdict("Ship settings"), "PASS");
  const thrown = new Error("boom");
  const caught = await journey(async () => { throw thrown; })({ page: undefined }).catch(error => error);
  assert.equal(caught, thrown);
  assert.equal(timingOf("Ship settings"), undefined);
});

test("a retry in a new worker reads the failed try's entry back from the report and adds its own beside it", async t => {
  quiet(t);
  await wrapper("Free shipping over an amount", 0).run(async () => {
    proof.record("Free shipping shows at the threshold", "FAIL", "the cart still shows a shipping charge");
    await wait(20);
  }).catch(() => {});
  const [failed] = timingOf("Free shipping over an amount").tries;
  assert.equal(failed.verdict, "FAIL");
  // Playwright retries in a new worker: a fresh copy of the proof module loads the report from disk,
  // with the failed try's steps and entry, and its wrapper writes the retry's entry as try 2. A fresh
  // copy of the pace module, as that worker loads one, starts its counters from nothing: this worker's
  // sleeps so far stay with this copy, and the retry's entry is read from the new copy alone.
  const next = await import("../support/proof.mjs?retry-worker");
  const nextPace = await import("../support/pace.mjs?retry-worker");
  assert.ok(pace.paceSnapshot().sleeps >= 4, `this copy has slept ${pace.paceSnapshot().sleeps} times`);
  assert.deepEqual(nextPace.paceSnapshot(), { sleeps: 0, requestedMs: 0, ms: 0, wallMs: 0 });
  const { journey } = wrapper("Free shipping over an amount", 1, {
    attemptVerdict: next.attemptVerdict, journeyVerdict: next.journeyVerdict, noteJourneyTiming: next.noteJourneyTiming,
    record: next.record, startJourney: next.startJourney, paceSnapshot: nextPace.paceSnapshot,
  });
  await journey(async () => { next.record("Free shipping shows at the threshold", "PASS"); })({ page: undefined });
  assert.equal(next.journeyVerdict("Free shipping over an amount"), "FLAKY");
  const { tries } = timingOf("Free shipping over an amount");
  assert.deepEqual(tries[0], failed);
  assert.deepEqual(tries.map(entry => [entry.try, entry.verdict]), [[1, "FAIL"], [2, "PASS"]]);
  assert.equal(tries[1].pace_sleeps, 0);
  assert.deepEqual(nextPace.paceSnapshot(), { sleeps: 0, requestedMs: 0, ms: 0, wallMs: 0 });
});

test("a later worker keeps every journey's timing and the run's other facts, and the public summary shows none of it", async t => {
  quiet(t);
  proof.note("products listed", 4);
  proof.note("plugins", "dinkus-commerce-beta 0.8.0-beta.1");
  // Another worker, as Playwright starts one after a failed journey: a fresh copy of the proof module
  // loads the report from disk, and its wrapper writes its own journey's timing beside the others'.
  const later = await import("../support/proof.mjs?worker2");
  const { journey } = wrapper("Mark as completed", 0, {
    attemptVerdict: later.attemptVerdict, journeyVerdict: later.journeyVerdict, noteJourneyTiming: later.noteJourneyTiming,
    record: later.record, startJourney: later.startJourney,
  });
  await journey(async () => { later.record("The owner can open Commerce Orders", "PASS"); })({ page: undefined });
  const saved = report();
  const names = ["Full catalog", "Storefront", "Cart", "Payments status", "Problems", "Manage products", "One product with a category", "Buy and ship", "Free shipping over an amount", "Mark as completed"];
  for (const name of names) assert.ok(Array.isArray(saved.facts[`${name} timing`]?.tries), `${name} timing kept`);
  assert.equal(saved.facts["Free shipping over an amount timing"].tries.length, 2);
  assert.equal(saved.facts["products listed"], 4);
  assert.equal(saved.facts.plugins, "dinkus-commerce-beta 0.8.0-beta.1");
  assert.deepEqual(Object.keys(saved), ["run", "mode", "store", "ship", "verdict", "journeys", "facts", "steps"]);
  // The diagnostics reader takes the report as the run leaves it and projects each journey's timing in
  // the producer's exact shape, byte for byte: every try apart, and no key at all for the journey whose
  // write failed (Ship settings), rather than a zero.
  const { analyze } = await import("../scripts/report-diagnostics.mjs");
  const projected = analyze({ ...saved, run: "github-42337050608-1" }, { run: "42337050608", attempt: "1" });
  assert.equal(projected.length, saved.journeys.length);
  for (const entry of projected) {
    const fact = saved.facts[`${entry.journey} timing`];
    if (fact) assert.equal(JSON.stringify(entry.timing), JSON.stringify(fact), `${entry.journey} timing projected as written`);
    else assert.ok(!("timing" in entry), `${entry.journey} has no timing to project`);
  }
  assert.ok(saved.journeys.some(entry => entry.name === "Ship settings"));
  assert.ok(!("timing" in projected.find(entry => entry.journey === "Ship settings")));
  assert.equal(projected.find(entry => entry.journey === "Free shipping over an amount").timing.tries.length, 2);
  assert.doesNotMatch(JSON.stringify(projected), /products listed|dinkus-commerce-beta/);
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
