#!/usr/bin/env node
// Evaluate the immutable pace modules under the same clock and context events.
// Only imports are supplied by this fixture; production function bodies are unchanged.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Script, createContext } from "node:vm";

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  assert.ok(["--repo", "--base", "--candidate", "--out"].includes(process.argv[i]), "unknown option");
  assert.ok(process.argv[i + 1], "option needs a value");
  options[process.argv[i].slice(2)] = process.argv[i + 1];
}
for (const name of ["repo", "base", "candidate", "out"]) assert.ok(options[name], `--${name} required`);
for (const name of ["base", "candidate"]) assert.match(options[name], /^[a-f0-9]{40}$/);
assert.equal(process.version, "v24.22.0");
const source = ref => execFileSync("git", ["-C", resolve(options.repo), "show", `${ref}:runner/support/pace.mjs`], { encoding: "utf8" });
const sources = { base: source(options.base), candidate: source(options.candidate) };
const cases = [
  { name: "no refund", count: 61, refunds: [], finishWithoutRefund: true },
  { name: "one refund", count: 61, refunds: [{ at: 100, count: 1 }] },
  { name: "many refunds", count: 61, refunds: [{ at: 100, count: 10 }] },
  { name: "insufficient refund", count: 62, refunds: [{ at: 100, count: 1 }] },
  { name: "refunded failed request", count: 61, refunds: [{ at: 100, count: 1, failed: true }] },
  { name: "staggered refunds", count: 63, refunds: [{ at: 100, count: 1 }, { at: 200, count: 1 }, { at: 300, count: 1 }] },
];

async function sample(code, scenario, waiters) {
  const origin = 1_000_000;
  let now = origin, nextTimer = 0;
  const timers = new Map(), timerEvents = [], replayed = new WeakSet();
  const sandbox = createContext({
    URL, EventEmitter, config: { store: "https://store.example", runDir: "/synthetic/proof/run" }, dirname, join,
    appendFileSync() {}, readdirSync() { return []; }, readFileSync() { return ""; }, unlinkSync() {},
    onExtraStoreAttempt() {}, wasReplayed: request => replayed.has(request),
    Date: { now: () => now }, performance: { now: () => now },
    setTimeout(fn, delay) {
      const id = ++nextTimer;
      timers.set(id, { fn, at: now + delay });
      timerEvents.push({ kind: "set", id, at: now - origin, delay });
      return id;
    },
    clearTimeout(id) {
      if (timers.delete(id)) timerEvents.push({ kind: "clear", id, at: now - origin });
    },
  });
  const imports = [...code.matchAll(/^import .* from ["']([^"']+)["'];$/gm)].map(match => match[1]);
  for (const name of imports) assert.ok(["node:fs", "node:path", "node:events", "./env.mjs", "./request-policy.mjs"].includes(name), `unsupported fixture import: ${name}`);
  const evaluated = code.replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
  const api = new Script(`${evaluated}\n;({ paceStore, watchStoreRequests, paceSnapshot });`).runInContext(sandbox);
  const context = new EventEmitter();
  api.watchStoreRequests(context);
  const requests = Array.from({ length: scenario.count }, () => ({ url: () => "https://store.example/_astro/chunk.js" }));
  for (const request of requests) context.emit("request", request);
  const released = [];
  const pending = Array.from({ length: waiters }, (_, id) => api.paceStore(40).then(() => released.push({ id, at: now - origin })));
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  await flush();
  assert.equal(released.length, 0);
  if (scenario.finishWithoutRefund) {
    now = origin + 100;
    context.emit("requestfinished", requests[0]);
    context.emit("requestfailed", requests[1]);
    await flush();
    assert.equal(released.length, 0, "normal completion or failure cannot free a counted network request");
  }
  let refunded = 0;
  const afterRefunds = [];
  for (const refund of scenario.refunds) {
    now = origin + refund.at;
    for (let n = 0; n < refund.count; n++) {
      const request = requests[refunded++];
      replayed.add(request);
      context.emit(refund.failed ? "requestfailed" : "requestfinished", request);
    }
    await flush();
    afterRefunds.push({ at: refund.at, count: scenario.count - refunded, released: released.length, activeTimers: timers.size });
    if (released.length === waiters) assert.equal(timers.size, 0, "released waiters must not leave timers behind");
    if (scenario.count - refunded > 60) assert.equal(released.length, 0, "insufficient refund must not admit waiters");
  }
  let iterations = 0;
  while (timers.size) {
    assert.ok(++iterations < 100, "timer loop did not converge");
    now = Math.min(...[...timers.values()].map(timer => timer.at));
    assert.ok(now - origin <= 120_000, "timer exceeds bounded fixture");
    for (const [id, timer] of [...timers]) {
      if (timer.at > now) continue;
      timers.delete(id);
      timerEvents.push({ kind: "fire", id, at: now - origin });
      timer.fn();
    }
    await flush();
    if (released.length === waiters) assert.equal(timers.size, 0, "terminal waiters must clear all timers");
  }
  await Promise.all(pending);
  const counters = JSON.parse(JSON.stringify(api.paceSnapshot()));
  assert.equal(released.length, waiters);
  assert.equal(timers.size, 0);
  for (const [key, value] of Object.entries(counters)) assert.ok(Number.isFinite(value) && value >= 0, key);
  const lastRelease = Math.max(...released.map(item => item.at));
  assert.equal(counters.ms, lastRelease * waiters, "sum of concurrent sleep durations");
  assert.equal(counters.wallMs, lastRelease, "union of concurrent sleep durations");
  assert.equal(counters.requestedMs, timerEvents.filter(item => item.kind === "set").reduce((sum, item) => sum + item.delay, 0));
  assert.equal(counters.sleeps, timerEvents.filter(item => item.kind === "set").length);
  return { released, afterRefunds, counters, timerEvents, activeTimersFinal: timers.size };
}

const rows = [];
for (const scenario of cases) {
  for (const waiters of [1, 3]) {
    const base = await sample(sources.base, scenario, waiters);
    const candidate = await sample(sources.candidate, scenario, waiters);
    const lastRefund = scenario.refunds.at(-1);
    const enough = scenario.count - scenario.refunds.reduce((sum, item) => sum + item.count, 0) <= 60;
    assert.ok(base.released.every(item => item.at === 60_250), `${scenario.name}: baseline behavior drift`);
    const expected = enough ? lastRefund.at : 60_250;
    assert.ok(candidate.released.every(item => item.at === expected), `${scenario.name}: candidate release timing`);
    rows.push({ name: scenario.name, waiters, base, candidate });
  }
}
const output = {
  node: process.version, base: options.base, candidate: options.candidate,
  scope: "actual pace module bodies; virtual clock, event context and filesystem stand-ins",
  source_sha256: Object.fromEntries(Object.entries(sources).map(([key, code]) => [key, createHash("sha256").update(code).digest("hex")])),
  rows,
};
const out = resolve(options.out);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ rows: rows.length, assertions: "passed", base: options.base, candidate: options.candidate }));
