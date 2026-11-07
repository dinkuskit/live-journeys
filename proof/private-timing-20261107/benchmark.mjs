#!/usr/bin/env node
// Offline overhead benchmark for the private journey timing (runner/support/steps.mjs, pace.mjs,
// proof.mjs). It evaluates the base revision's and the candidate's copies of those three modules
// from source, with the same stand-ins for their imports, and runs identical workloads through each,
// interleaved, so the difference is the instrumentation alone. Nothing here opens a browser, reads
// settings or touches a network: the modules get no fetch, http or net binding at all, and every
// timer they schedule is counted, with its delay. Run from the repository root:
//
//   node proof/private-timing-20261107/benchmark.mjs --base <sha> [--candidate <sha>] [--samples 30] [--out results.json]
//
// Without --candidate the working tree's files are the candidate. Reports raw per-sample wall times
// (microseconds) and work counts, then min / median / p90 / max / mean per variant and per call.
// The proof module gets every node:fs function it names (read, write, rename, unlink), each counted;
// a function it named but was not given would throw inside the wrapper's guard and go unseen, so the
// wrapper workload also checks, after every sample, that the candidate published every entry.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script, createContext } from "node:vm";

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.flatMap((arg, i) => arg.startsWith("--") ? [[arg.slice(2), argv[i + 1]]] : []));
const base = args.base;
if (!base) { console.error("--base <sha> is required"); process.exit(2); }
const candidate = args.candidate ?? `${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()} (working tree)`;
const samples = Number(args.samples ?? 30);
const FILES = ["runner/support/pace.mjs", "runner/support/proof.mjs", "runner/support/steps.mjs"];

const show = (sha, file) => execFileSync("git", ["show", `${sha}:${file}`], { encoding: "utf8" });
const sources = {
  base: Object.fromEntries(FILES.map(file => [file, show(base, file)])),
  candidate: Object.fromEntries(FILES.map(file => [file, args.candidate ? show(args.candidate, file) : readFileSync(file, "utf8")])),
};
// No module under test may reach a network or a child process, in either revision.
for (const [variant, files] of Object.entries(sources)) {
  for (const [file, source] of Object.entries(files)) {
    if (/\bfetch\(|from "node:(?:http|https|net|dns|child_process)"/.test(source)) throw new Error(`${variant} ${file} names a network or process API`);
  }
}

const strip = source => source.replace(/^import .*$/gm, "").replace(/^export /gm, "");
/** The local names a module's `import { ... } from` lines bind, which its evaluation must be given. */
const imported = source => [...source.matchAll(/^import \{([^}]*)\} from/gm)]
  .flatMap(([, list]) => list.split(",").map(name => name.trim().split(/\s+as\s+/).at(-1)).filter(Boolean));
/** Evaluates one module over `bindings`, refusing any revision whose imports the bindings do not cover. */
function evaluate(label, source, bindings, names) {
  const missing = imported(source).filter(name => !(name in bindings));
  if (missing.length) throw new Error(`${label} imports ${missing.join(", ")}, which this benchmark does not supply`);
  return new Script(`${strip(source)}\n({ ${names} });`).runInContext(createContext(bindings));
}

const work = mkdtempSync(join(tmpdir(), "dinkus-timing-bench-"));

/** Timers and clock the pace module sees: a fake clock that jumps by each scheduled delay, with every timer counted. */
function fakeTime() {
  const state = { clock: 1_000_000_000, timers: 0, delayMs: 0 };
  const Date = { now: () => state.clock };
  const setTimeout = (fn, delay) => { state.timers += 1; state.delayMs += delay; state.clock += delay; globalThis.setImmediate(fn); };
  return { state, Date, setTimeout };
}

/** One variant's three modules, wired together as the runner wires them, over counted stand-ins and its own proof folder. */
function build(variant, time) {
  const files = sources[variant];
  const config = { runId: variant, runDir: join(work, variant), mode: "full", store: "https://store.example", ship: "https://ship.example" };
  mkdirSync(config.runDir, { recursive: true });
  const counted = { writes: 0, reads: 0, renames: 0, unlinks: 0 };
  const fs = {
    readFileSync: (...a) => { counted.reads += 1; return readFileSync(...a); },
    writeFileSync: (...a) => { counted.writes += 1; return writeFileSync(...a); },
    renameSync: (...a) => { counted.renames += 1; return renameSync(...a); },
    unlinkSync: (...a) => { counted.unlinks += 1; return unlinkSync(...a); },
  };
  const proof = evaluate(`${variant} proof.mjs`, files["runner/support/proof.mjs"], { ...fs, join, config, Date, console },
    "startJourney, record, note, attemptVerdict, journeyVerdict, noteJourneyTiming: typeof noteJourneyTiming === 'function' ? noteJourneyTiming : null");
  const pace = evaluate(`${variant} pace.mjs`, files["runner/support/pace.mjs"], {
    appendFileSync() {}, readdirSync: () => [], readFileSync: () => "", unlinkSync() {}, dirname: () => work, join,
    config, onExtraStoreAttempt() {}, wasReplayed: () => false, URL, Date: time.Date, setTimeout: time.setTimeout, performance,
  }, "paceStore, countStoreRequest, paceSnapshot: typeof paceSnapshot === 'function' ? paceSnapshot : null");
  const current = { title: "Bench", retry: 0 };
  const test = { info: () => ({ title: current.title, retry: current.retry }), step: (_n, fn) => fn(), describe: { configure() {} } };
  const expect = (actual, message) => ({ toBe(expected) { if (actual !== expected) throw new Error(`${message}: ${actual}`); } });
  const steps = evaluate(`${variant} steps.mjs`, files["runner/support/steps.mjs"], {
    test, expect, config, console: { log() {} }, firstLine: e => String(e?.message ?? e), forProof: e => e,
    paceSnapshot: pace.paceSnapshot, attemptVerdict: proof.attemptVerdict, journeyVerdict: proof.journeyVerdict,
    noteJourneyTiming: proof.noteJourneyTiming, record: proof.record, shot: async () => "", startJourney: proof.startJourney,
    performance, setTimeout: time.setTimeout,
  }, "journey");
  return { config, proof, pace, journey: steps.journey, current, counted };
}

const time = { base: fakeTime(), candidate: fakeTime() };
const built = { base: build("base", time.base), candidate: build("candidate", time.candidate) };
const order = i => i % 2 ? ["candidate", "base"] : ["base", "candidate"];
const results = { node: process.version, platform: `${process.platform} ${process.arch}`, base, candidate, samples, workloads: {} };

const stats = list => {
  const sorted = [...list].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { min: sorted[0], median: at(0.5), p90: at(0.9), max: sorted.at(-1), mean: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length) };
};

/**
 * Runs `body(variant)` `samples` times per variant, interleaved, keeping each sample's wall time in
 * microseconds and its work. `check(variant, sampleMs)`, outside the timed span, asserts what the sample
 * left behind: a sample that ran fast because the module under test threw inside a guard and did less
 * must fail here, not pass as an improvement.
 */
async function workload(name, calls, body, counts, check = () => {}) {
  const out = { calls_per_sample: calls, samples_us: { base: [], candidate: [] }, work_per_sample: {} };
  for (let i = 0; i < samples; i++) {
    for (const variant of order(i)) {
      const before = counts(variant);
      const from = performance.now();
      await body(variant);
      const us = (performance.now() - from) * 1000;
      out.samples_us[variant].push(Math.round(us));
      const after = counts(variant);
      const delta = Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]]));
      out.work_per_sample[variant] ??= delta;
      if (JSON.stringify(out.work_per_sample[variant]) !== JSON.stringify(delta)) throw new Error(`${name} ${variant}: work changed between samples`);
      check(variant, us / 1000, delta);
    }
  }
  out.same_timers_and_delays = out.work_per_sample.base.timers === out.work_per_sample.candidate.timers
    && out.work_per_sample.base.delay_ms === out.work_per_sample.candidate.delay_ms;
  out.per_sample_us = { base: stats(out.samples_us.base), candidate: stats(out.samples_us.candidate) };
  out.per_call_us = Object.fromEntries(["base", "candidate"].map(v => [v, Object.fromEntries(Object.entries(out.per_sample_us[v]).map(([k, us]) => [k, +(us / calls).toFixed(3)]))]));
  out.median_delta_per_call_us = +((out.per_sample_us.candidate.median - out.per_sample_us.base.median) / calls).toFixed(3);
  results.workloads[name] = out;
  console.log(`${name}: per call median base ${out.per_call_us.base.median} us, candidate ${out.per_call_us.candidate.median} us, delta ${out.median_delta_per_call_us} us; work per sample ${JSON.stringify(out.work_per_sample)}`);
}

const timerCounts = variant => ({ timers: time[variant].state.timers, delay_ms: time[variant].state.delayMs });
const fileCounts = variant => ({ ...timerCounts(variant), ...built[variant].counted });

// 1. paceStore with room under the budget: the common case, which must schedule nothing.
await workload("pace-no-wait", 10_000, async variant => {
  const { pace } = built[variant];
  for (let i = 0; i < 10_000; i++) await pace.paceStore(1);
}, timerCounts);

// 2. paceStore that has to sleep once: a hundred requests just sent fill the budget, so each call
// schedules one timer for the oldest request's minute to end (plus the 250 ms margin), which the fake
// clock jumps over. Base and candidate must schedule the same timers with the same delays.
await workload("pace-one-sleep", 200, async variant => {
  const { pace } = built[variant];
  for (let i = 0; i < 200; i++) {
    for (let r = 0; r < 100; r++) pace.countStoreRequest("https://store.example/products/cap");
    await pace.paceStore(1);
  }
}, timerCounts);

// 3. The journey wrapper around a body that records one passing step: the base writes the report at
// startJourney and at record (two files each); the candidate also writes its timing fact once at the
// end, each file to a temporary one renamed over it (two more writes and two renames per journey, one
// report read, no unlink). After every sample, `wrapperLeft` reads the proof folder back and checks
// the candidate published one well-formed entry per journey in that sample and the base none: the
// wrapper lets a failed timing write go by design, so a candidate whose write threw (a binding this
// benchmark forgot, say) would otherwise run faster and look like an improvement.
const JOURNEYS = 25;
const ENTRY_KEYS = ["try", "body", "verdict", "body_ms", "pace_sleeps", "pace_sleep_requested_ms", "pace_sleep_ms", "pace_sleep_wall_ms"];
const WRAPPER_WORK = {
  base: { timers: 0, delay_ms: 0, writes: 4 * JOURNEYS, reads: 0, renames: 0, unlinks: 0 },
  candidate: { timers: 0, delay_ms: 0, writes: 6 * JOURNEYS, reads: JOURNEYS, renames: 2 * JOURNEYS, unlinks: 0 },
};
const checked = { base: { samples: 0, timing_facts: 0 }, candidate: { samples: 0, timing_facts: 0, entries: 0 } };
const report = variant => JSON.parse(readFileSync(join(built[variant].config.runDir, "report.json"), "utf8"));

function wrapperLeft(variant, sampleMs, work) {
  const fail = what => { throw new Error(`journey-wrapper ${variant}: ${what}`); };
  for (const [key, expected] of Object.entries(WRAPPER_WORK[variant])) if (work[key] !== expected) fail(`${key} ${work[key]}, expected ${expected} per sample`);
  const left = report(variant);
  if (left.verdict !== "PASS" || left.journeys.length !== JOURNEYS) fail(`verdict ${left.verdict} over ${left.journeys.length} journeys`);
  if (readdirSync(built[variant].config.runDir).some(file => file.endsWith(".tmp"))) fail("a temporary file was left");
  const timingKeys = Object.keys(left.facts).filter(key => key.endsWith(" timing"));
  if (variant === "base") {
    if (timingKeys.length !== 0) fail(`${timingKeys.length} timing facts, expected none`);
  } else {
    if (timingKeys.length !== JOURNEYS) fail(`${timingKeys.length} timing facts, expected ${JOURNEYS}`);
    let bodySum = 0;
    for (let i = 0; i < JOURNEYS; i++) {
      const fact = left.facts[`Bench ${i} timing`];
      if (!fact || fact.unit !== "ms" || !Array.isArray(fact.tries) || fact.tries.length !== 1) fail(`Bench ${i} timing is ${JSON.stringify(fact)}`);
      const [entry] = fact.tries;
      if (JSON.stringify(Object.keys(entry)) !== JSON.stringify(ENTRY_KEYS)) fail(`Bench ${i} entry keys ${Object.keys(entry)}`);
      if (entry.try !== 1 || entry.body !== "returned" || entry.verdict !== "PASS") fail(`Bench ${i} entry ${JSON.stringify(entry)}`);
      for (const key of ENTRY_KEYS.slice(4)) if (entry[key] !== 0) fail(`Bench ${i} ${key} ${entry[key]}, expected 0 (no sleep)`);
      if (!Number.isSafeInteger(entry.body_ms) || entry.body_ms < 0) fail(`Bench ${i} body_ms ${entry.body_ms}`);
      bodySum += entry.body_ms;
      checked.candidate.entries += 1;
    }
    // The bodies' times, measured in this sample, fit inside it (each rounded to the millisecond).
    if (bodySum > Math.ceil(sampleMs) + JOURNEYS) fail(`bodies sum to ${bodySum} ms in a sample of ${sampleMs} ms`);
  }
  checked[variant].samples += 1;
  checked[variant].timing_facts = timingKeys.length;
}

await workload("journey-wrapper", JOURNEYS, async variant => {
  const { journey, current, proof } = built[variant];
  for (let i = 0; i < JOURNEYS; i++) {
    current.title = `Bench ${i}`;
    await journey(async () => { proof.record("A step", "PASS"); })({ page: undefined });
  }
}, fileCounts, wrapperLeft);

if (checked.base.samples !== samples || checked.candidate.samples !== samples || checked.candidate.entries !== samples * JOURNEYS) throw new Error(`journey-wrapper: ${JSON.stringify(checked)} checked over ${samples} samples`);
// What each variant's proof folder holds after workload 3, as checked after every sample: the
// candidate's wrapper wrote one timing fact per journey (zero sleeps, no manufactured time); the base wrote none.
results.wrapper_samples_checked = { ...checked, expected_work_per_sample: WRAPPER_WORK, entry_keys: ENTRY_KEYS };
results.candidate_fact_example = report("candidate").facts["Bench 0 timing"] ?? null;
rmSync(work, { recursive: true, force: true });

if (args.out) writeFileSync(args.out, JSON.stringify(results, null, 2) + "\n");
else console.log(JSON.stringify(results, null, 2));
