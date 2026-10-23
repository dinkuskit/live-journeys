#!/usr/bin/env node
// Prints the public part of a run's result: each journey and pass or fail, the plugin versions the
// store ran, so a release can check that its own beta passed, and why "Update the store" stopped, if it
// did, since that names what the owner has to update by hand. For a journey that didn't pass it also
// lists its steps by the names the journeys give them, each step's pass or fail, and for a failed step
// one fixed kind of failure, so a failure can be traced without the private proof. What a step found,
// its error's words, the screenshots and the console output stay in the private proof. The run fails
// unless Playwright exited 0 and every journey passed: a run cut off part way can leave a report of
// only passed journeys.
//
//   node scripts/run-summary.mjs <proof folder> <Playwright's exit code> [where the private proof went]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { failureKind } from "../support/errors.mjs";

const [folder, code = "", proof = "the private proof store"] = process.argv.slice(2);
let report;
try { report = JSON.parse(readFileSync(join(folder, "report.json"), "utf8")); } catch { report = null; }
const journeys = report?.journeys ?? [];
const finished = code === "0";
const verdict = journeys.length && finished ? report.verdict : "FAIL";
const facts = report?.facts ?? {};
// "Update the store" readies the store; only the journeys after it test what it runs.
const tested = journeys.some(({ name }) => name !== "Update the store");
const lines = [
  `## Live journeys: ${verdict}`, "",
  "| Journey | Pass / fail |", "| --- | --- |",
  ...journeys.map(({ name, verdict }) => `| ${name} | ${verdict} |`),
  ...(journeys.length ? [] : ["| Test run | FAIL: no journey recorded a result |"]),
  ...(finished ? [] : [`| Test run | FAIL: the run ${code ? `exited ${code}` : "was cut off"} |`]),
  ...(journeys.some(({ verdict }) => verdict === "FLAKY") ? ["", "FLAKY: failed its first try and passed its one retry inside this run. Only journeys that place no order and pay nothing get a retry."] : []),
  ...(facts["update stopped"] ? ["", `Update stopped: ${facts["update stopped"]}`] : []),
  "", `${tested ? "Plugins tested" : "Plugins on the store (no journeys ran)"}: ${facts.plugins ?? "not recorded"}`,
  "", `What each step found, screenshots and console output: ${proof}.`,
];
const cell = value => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
for (const { name, verdict: journeyVerdict } of journeys) {
  if (journeyVerdict === "PASS") continue;
  const steps = (report?.steps ?? []).filter(entry => entry.journey === name);
  lines.push("", `### ${cell(name)}: steps`, "", "| Step | Pass / fail | Kind of failure |", "| --- | --- | --- |",
    ...steps.map(({ step, status, detail, retried }) => `| ${cell(step)}${retried ? " (first try)" : ""} | ${status} | ${status === "FAIL" ? failureKind(detail) : ""} |`),
    ...(steps.length ? [] : ["| (no step recorded) | | |"]));
}
console.log(lines.join("\n"));
process.exit(verdict === "PASS" ? 0 : 1);
