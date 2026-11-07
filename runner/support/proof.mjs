import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./env.mjs";

const reportFile = join(config.runDir, "report.json");
let journeys, steps, facts;
let current = "";

/**
 * Loads the run's report so far. Playwright starts a new worker after a journey fails, so the next
 * journey's worker carries on from it instead of writing an empty report over it.
 */
function load() {
  const earlier = (() => { try { return JSON.parse(readFileSync(reportFile, "utf8")); } catch { return {}; } })();
  journeys = (earlier.journeys ?? []).map(entry => entry.name);
  steps = earlier.steps ?? [];
  facts = earlier.facts ?? {};
}
load();

/** The proof's entry for what goes wrong outside every journey, such as a filter that matches none. */
export const TEST_RUN = "Test run";

/**
 * Starts an invocation in Playwright's main process, before it loads the journeys or starts a worker.
 * A run id used again keeps its journeys, but not the run-level failure an earlier invocation recorded.
 */
export function startRun() {
  load();
  if (!journeys.includes(TEST_RUN)) return;
  journeys = journeys.filter(name => name !== TEST_RUN);
  steps = steps.filter(s => s.journey !== TEST_RUN);
  write();
}

/**
 * Starts a journey; the steps recorded after it belong to it until the next one starts. A journey run
 * again under the same run id replaces its earlier steps. Playwright's retry of a journey that may run
 * twice (`retry` above 0) keeps the failed try's steps, marked `retried`, so the proof shows the journey
 * passed only on its retry.
 */
export function startJourney(name, retry = 0) {
  current = name;
  steps = retry > 0
    ? steps.map(s => s.journey === name ? { ...s, retried: true } : s)
    : steps.filter(s => s.journey !== name);
  // A journey run again, not as a retry, starts its private timing over in this same write, so a try
  // that hasn't finished (or never will) is not shown with an earlier run's entries. A retry keeps them.
  if (!(retry > 0)) delete facts[`${name} timing`];
  if (!journeys.includes(name)) journeys.push(name);
  write();
}

/**
 * Fails a journey in the proof when Playwright failed it but the journey recorded no failure of its
 * own, as when the saved profile wouldn't open before its first step. The reporter runs this once
 * every worker has finished.
 */
export function failUnrecorded(name, step, detail) {
  load();
  if (journeyVerdict(name) === "FAIL") return;
  current = name;
  if (!journeys.includes(name)) journeys.push(name);
  record(step, "FAIL", detail);
}

/**
 * Keeps a failed first try in the proof when Playwright retried a journey but that try recorded no
 * failure of its own, as when its browser wouldn't open or a hook timed out after its steps passed.
 * A retry that passed then shows FLAKY with the try's failure, not a bare PASS or FLAKY; one that
 * failed again still shows why the first try failed. The reporter runs this once every worker has
 * finished, before it records the last try's own unrecorded failure.
 */
export function failedTryUnrecorded(name, detail) {
  load();
  if (steps.some(s => s.journey === name && s.retried && s.status === "FAIL")) return;
  current = name;
  if (!journeys.includes(name)) journeys.push(name);
  const entry = { journey: name, step: "The try finished without an error", status: "FAIL", detail, retried: true, at: new Date().toISOString() };
  const firstRetry = steps.findIndex(s => s.journey === name && !s.retried);
  if (firstRetry < 0) steps.push(entry); else steps.splice(firstRetry, 0, entry);
  write();
}

/** The run's verdict and each journey's, as the report on disk has them. */
export function verdicts() {
  load();
  const results = journeys.map(name => ({ name, verdict: journeyVerdict(name) }));
  return { verdict: verdictOf(results.map(r => r.verdict)), journeys: results };
}

/** Records one step's result; the report is rewritten after every step so a crash still leaves it. */
export function record(step, status, detail = "") {
  steps.push({ journey: current, step, status, detail, at: new Date().toISOString() });
  write();
}

/**
 * Remembers a fact for the report (order number, tracking number, PDF hash...). Every journey in a run
 * shares these keys, so a journey that places its own order names its facts after itself ("Problems
 * order") rather than taking Buy and ship's "order".
 */
export function note(key, value) {
  load();
  facts[key] = value;
  write();
}

/**
 * Keeps one private timing fact per journey, "<name> timing", written once when a try of the journey
 * finishes (see steps.mjs). Each try keeps its own entry, so a failed try is never erased by the retry
 * that followed it: a retry (`retry` above 0) adds its entry beside the earlier tries', read back from
 * the report as the retry's new worker loads it, as startJourney keeps their steps; a journey run again
 * under the same run id starts its tries over (startJourney already cleared them). A try the run cut
 * off before its wrapper finished leaves no entry at all, rather than a zero. The README's "Proof"
 * section describes the shape.
 *
 * This write is extra to the journey's own, so it must never cost the report they built: it goes down
 * whole or not at all (see `replace`), and when it fails this copy reads the files back as they stand,
 * so the entry it could not publish is not held for a later write either.
 */
export function noteJourneyTiming(name, retry, entry) {
  load();
  const key = `${name} timing`;
  const tries = retry > 0 && Array.isArray(facts[key]?.tries) ? facts[key].tries.filter(t => t.try !== retry + 1) : [];
  facts[key] = { unit: "ms", tries: [...tries, { try: retry + 1, ...entry }] };
  try { write(true); } catch (error) { load(); throw error; }
}

/**
 * Saves the page's screenshot for the step about to be recorded. A picture is never worth holding the
 * run for: one that hasn't come within 30 s is skipped, and the step's result stands.
 */
export async function shot(page, name) {
  const file = join(config.runDir, `${String(steps.length + 1).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true, timeout: 30_000 }).catch(() => {});
  return file;
}

/**
 * PASS only when every step passed or was skipped for a stated reason; a journey with no steps yet is
 * INCOMPLETE. A run whose journeys passed, some only on their retry, still passes; the table shows which.
 */
export function verdictOf(results) {
  if (results.some(r => r === "FAIL")) return "FAIL";
  return results.length && results.every(r => r === "PASS" || r === "SKIP" || r === FLAKY) ? "PASS" : "INCOMPLETE";
}

/** A journey that failed its first try and passed its retry. */
export const FLAKY = "FLAKY";

/** The verdict of a journey's latest try, from the steps it has recorded so far. */
export function attemptVerdict(name) {
  return verdictOf(steps.filter(s => s.journey === name && !s.retried).map(s => s.status));
}

/** A journey's verdict: its latest try's, or FLAKY when that passed only after a failed try. */
export function journeyVerdict(name) {
  const verdict = attemptVerdict(name);
  return verdict === "PASS" && steps.some(s => s.journey === name && s.retried) ? FLAKY : verdict;
}

const cell = value => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");

/** Writes the report and PROOF.md; `whole` puts each down whole or not at all (the timing fact's write). */
function write(whole = false) {
  const put = whole ? replace : writeFileSync;
  const results = journeys.map(name => ({ name, verdict: journeyVerdict(name) }));
  const verdict = verdictOf(results.map(r => r.verdict));
  const report = { run: config.runId, mode: config.mode, store: config.store, ship: config.ship, verdict, journeys: results, facts, steps };
  put(join(config.runDir, "report.json"), JSON.stringify(report, null, 2));
  const lines = [
    `# DinkusKit live test: ${verdict}`, "",
    `Run ${config.runId}, mode ${config.mode}, store ${config.store}.`, "",
    "| Journey | Result |", "| --- | --- |",
    ...results.map(r => `| ${cell(r.name)} | ${r.verdict} |`),
    ...results.flatMap(r => [
      "", `## ${r.name}: ${r.verdict}`, "",
      "| Step | Result | Detail |", "| --- | --- | --- |",
      ...steps.filter(s => s.journey === r.name).map(s => `| ${cell(s.step)}${s.retried ? " (first try)" : ""} | ${s.status} | ${cell(s.detail)} |`),
    ]),
    "", "## Facts", "",
    ...Object.entries(facts).map(([key, value]) => `- ${key}: ${Object(value) === value ? JSON.stringify(value) : value}`),
  ];
  put(join(config.runDir, "PROOF.md"), lines.join("\n") + "\n");
}

/**
 * Writes a file whole or not at all: the text goes to `<file>.tmp` beside it, which is then renamed
 * over the file, so a disk that fills or a write that stops midway leaves the file as it was. The
 * temporary file is removed on failure as far as it can be; a worker killed mid-write can leave one.
 */
function replace(file, text) {
  const tmp = `${file}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  } catch (error) {
    try { unlinkSync(tmp); } catch {}
    throw error;
  }
}
