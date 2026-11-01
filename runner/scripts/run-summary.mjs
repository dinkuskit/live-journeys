#!/usr/bin/env node
// Prints the public part of a run's result: each journey and pass or fail, the plugin versions the
// store ran, so a release can check that its own beta passed, which betas the run held back, and why
// "Update the store" stopped, if it did, since that names what the owner has to update by hand. For a
// journey that didn't pass it also lists its steps by the names the journeys give them, each step's pass or fail, and for a failed step
// one fixed kind of failure, so a failure can be traced without the private proof. What a step found,
// its error's words, the screenshots and the console output stay in the private proof. The run fails
// unless Playwright exited 0 and every journey passed: a run cut off part way can leave a report of
// only passed journeys.
//
//   node scripts/run-summary.mjs <proof folder> <Playwright's exit code> [where the private proof went]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STORE_REFUSALS_PATTERN, failureKind, isWaitFailureKind } from "../support/errors.mjs";

const [folder, code = "", proof = "the private proof store"] = process.argv.slice(2);
let report;
try { report = JSON.parse(readFileSync(join(folder, "report.json"), "utf8")); } catch { report = null; }
const journeys = report?.journeys ?? [];
const allSteps = report?.steps ?? [];
const finished = code === "0";
const verdict = journeys.length && finished ? report.verdict : "FAIL";
const facts = report?.facts ?? {};
const storeRefusals = typeof facts["store refusals"] === "string" && STORE_REFUSALS_PATTERN.test(facts["store refusals"]) ? facts["store refusals"] : "";
// "Update the store" readies the store; only the journeys after it test what it runs.
const tested = journeys.some(({ name }) => name !== "Update the store");
// Playwright exits 1 when journeys finish with a recorded failure; an empty or signal exit code, a
// Test run error, or a journey still INCOMPLETE means the run was cut off or failed outside its steps.
const completedFailure = (code === "0" || code === "1")
  && report?.verdict === "FAIL"
  && journeys.length > 0
  && journeys.every(entry => entry.name !== "Test run" && entry.verdict !== "INCOMPLETE");

function failureNote() {
  if (!completedFailure) return "";
  const failedJourneys = journeys.filter(entry => entry.verdict === "FAIL");
  if (!failedJourneys.length) return "";
  const failedSteps = failedJourneys.flatMap(({ name }) => allSteps.filter(entry => entry.journey === name && !entry.retried && entry.status === "FAIL"));
  if (!failedSteps.length || !failedSteps.every(entry => isWaitFailureKind(failureKind(entry.detail)))) return "";
  if (/\bHTTP 429\b/.test(storeRefusals)) {
    return "Failure note: every failed step timed out or lost its connection on a run where the store answered HTTP 429 (rate limit); check the proof before blaming plugin or journey code.";
  }
  const passedAfterTimeout = failedJourneys.every(({ name }) => {
    const journeySteps = allSteps.filter(entry => entry.journey === name && !entry.retried);
    const lastFail = journeySteps.findLastIndex(entry => entry.status === "FAIL");
    return lastFail >= 0 && journeySteps.slice(lastFail + 1).some(entry => entry.status === "PASS");
  });
  if (passedAfterTimeout) {
    return "Failure note: every failed step timed out waiting on the store or network, and later steps in the same journey passed; check the step's screenshot and console.log in the proof before rerunning.";
  }
  return "Failure note: every failed step timed out waiting on the store or network; check console.log and the step's screenshot in the proof before blaming plugin or journey code.";
}

const note = failureNote();
const lines = [
  `## Live journeys: ${verdict}`, "",
  "| Journey | Pass / fail |", "| --- | --- |",
  ...journeys.map(({ name, verdict }) => `| ${name} | ${verdict} |`),
  ...(journeys.length ? [] : ["| Test run | FAIL: no journey recorded a result |"]),
  ...(finished ? [] : [`| Test run | FAIL: the run ${code ? `exited ${code}` : "was cut off"} |`]),
  ...(journeys.some(({ verdict }) => verdict === "FLAKY") ? ["", "FLAKY: failed its first try and passed its one retry inside this run. Only Storefront and Cart get a retry: each opens a clean shopper browser, changes nothing in the store and pays nothing."] : []),
  ...(facts["update stopped"] ? ["", `Update stopped: ${facts["update stopped"]}`] : []),
  ...(facts.held ? ["", `Held on purpose, not updated to the newest beta: ${facts.held}`] : []),
  ...(storeRefusals ? ["", `Store HTTP 429 / 5xx answers during the run: ${storeRefusals}`] : []),
  ...(note ? ["", note] : []),
  "", `${tested ? "Plugins tested" : "Plugins on the store (no journeys ran)"}: ${facts.plugins ?? "not recorded"}`,
  "", `What each step found, screenshots and console output: ${proof}.`,
];
const cell = value => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
for (const { name, verdict: journeyVerdict } of journeys) {
  if (journeyVerdict === "PASS") continue;
  const steps = allSteps.filter(entry => entry.journey === name);
  lines.push("", `### ${cell(name)}: steps`, "", "| Step | Pass / fail | Kind of failure |", "| --- | --- | --- |",
    ...steps.map(({ step, status, detail, retried }) => `| ${cell(step)}${retried ? " (first try)" : ""} | ${status} | ${status === "FAIL" ? failureKind(detail) : ""} |`),
    ...(steps.length ? [] : ["| (no step recorded) | | |"]));
}
console.log(lines.join("\n"));
process.exit(verdict === "PASS" ? 0 : 1);
