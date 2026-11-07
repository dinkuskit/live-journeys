// Portable model of the refund wakeup. It evaluates the actual pace module, read from immutable Git
// objects at two commits, over a synthetic clock, synthetic timers and a synthetic browser, with no file
// system side effects and no network. Never a live store. Usage, from the repository root:
//   node proof/pacing-refund-20261107/refund-model.mjs --repo . --base <sha> --candidate <sha> [--out file]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Script, createContext } from "node:vm";

const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const repo = option("repo", ".");
const refs = { base: option("base", "dbf2512864947be2fea87ec58f34866d359cc7d8"), candidate: option("candidate", "HEAD") };
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
const commit = ref => git("rev-parse", `${ref}^{commit}`).trim();
const source = ref => git("show", `${commit(ref)}:runner/support/pace.mjs`);
const sha256 = text => createHash("sha256").update(text).digest("hex");
const flush = () => new Promise(resolve => setImmediate(resolve));

/** One scenario: `count` store requests on their way, `waiters` steps asking for forty more, then `refunds` replays. */
async function run(src, { refunds, waiters, count, failed }) {
  let now = 1_000_000;
  let nextTimer = 0;
  const timers = new Map();
  const replayed = new WeakSet();
  const events = [];
  const context = createContext({
    URL, dirname, join,
    config: { store: "https://store.example", runDir: "/synthetic/proof/run" },
    appendFileSync() {}, readdirSync() { return []; }, readFileSync() { return ""; }, unlinkSync() {},
    onExtraStoreAttempt() {}, wasReplayed: request => replayed.has(request),
    Date: { now: () => now }, performance: { now: () => now },
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => { timers.delete(id); },
  });
  const stripped = src.replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
  const api = new Script(`${stripped}\n;({ paceStore, watchStoreRequests, paceSnapshot });`).runInContext(context);
  const browser = new EventEmitter();
  api.watchStoreRequests(browser);
  const requests = Array.from({ length: count }, () => ({ url: () => "https://store.example/_astro/file.js" }));
  for (const request of requests) browser.emit("request", request);
  const released = Array(waiters).fill(false);
  const waiting = released.map((_, i) => api.paceStore(40).then(() => { released[i] = true; events.push({ waiter: i, at: now }); }));
  await flush();
  assert.ok(released.every(value => !value), "no step goes while the budget is full");
  now += 100;
  // Replays end as finished or, for the `failed` case, as failed; both take the request back. Without
  // refunds, two requests end normally, having reached the store.
  for (let i = 0; i < refunds; i++) { replayed.add(requests[i]); browser.emit(failed ? "requestfailed" : "requestfinished", requests[i]); }
  if (!refunds) { browser.emit("requestfinished", requests[0]); browser.emit("requestfailed", requests[1]); }
  await flush();
  const afterRefund = { released: [...released], timers: timers.size };
  // A fresh identical call shows whether the budget is free now.
  let freshReleased = false;
  if (count - refunds <= 60) await api.paceStore(40).then(() => { freshReleased = true; });
  while (timers.size) {
    now = Math.min(...[...timers.values()].map(timer => timer.at));
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    await flush();
  }
  await Promise.all(waiting);
  return { refunds, waiters, count, failed, after_refund: afterRefund, fresh_released: freshReleased, events, counters: api.paceSnapshot(), live_timers: timers.size };
}

const scenarios = [];
for (const refunds of [0, 1, 10]) for (const waiters of [1, 3]) scenarios.push({ refunds, waiters, count: 61, failed: false });
scenarios.push({ refunds: 1, waiters: 3, count: 62, failed: false }, { refunds: 1, waiters: 3, count: 61, failed: true });

const results = [];
for (const mode of ["base", "candidate"]) {
  const src = source(refs[mode]);
  for (const scenario of scenarios) results.push({ mode, ...await run(src, scenario) });
}
for (const result of results) {
  const freed = result.refunds > 0 && result.count - result.refunds <= 60;
  const name = `${result.mode} ${JSON.stringify({ refunds: result.refunds, waiters: result.waiters, count: result.count, failed: result.failed })}`;
  assert.equal(result.live_timers, 0, `${name}: every timer is gone`);
  assert.equal(result.fresh_released, freed, `${name}: a fresh call goes exactly when the budget is free`);
  if (result.mode === "candidate" && freed) {
    assert.ok(result.after_refund.released.every(Boolean), `${name}: every waiting step goes on the refund`);
    assert.equal(result.after_refund.timers, 0, `${name}: no timer outlives the refund`);
    assert.ok(result.events.every(event => event.at === 1_000_100), `${name}: released at the refund, not the timer`);
  } else {
    assert.ok(result.after_refund.released.every(value => !value), `${name}: no step goes before the budget is free`);
    assert.equal(result.after_refund.timers, result.waiters, `${name}: every waiting step still has one timer`);
    assert.ok(result.events.every(event => event.at === 1_060_250), `${name}: released by the timer, as before`);
  }
  // Each step counts one sleep per timer it set; a refund that leaves the budget full means a second one.
  const sleeps = result.mode === "candidate" && result.refunds && !freed ? 2 * result.waiters : result.waiters;
  assert.equal(result.counters.sleeps, sleeps, `${name}: sleeps`);
}
const out = {
  base: commit(refs.base), candidate: commit(refs.candidate),
  base_pace_sha256: sha256(source(refs.base)), candidate_pace_sha256: sha256(source(refs.candidate)),
  node: process.version, scenarios: results.length,
  scope: "actual pace module from immutable Git objects, synthetic clock, timers and browser, no file system side effects, no network",
  results,
};
if (option("out")) writeFileSync(option("out"), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ ...out, results: undefined }, null, 2));
console.log(`${results.length} scenarios passed`);
