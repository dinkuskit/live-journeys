#!/usr/bin/env node
// Offline comparison of the homepage reuse (runner/support/shopper.mjs and store-check.mjs) between an
// immutable base revision and a candidate. It evaluates each revision's copies of the two modules from
// source over the same stand-ins (the unit fixture's counted fake page and clocked store), runs the
// adopted call sites' patterns through each over every scenario the fixture lists, and counts the
// navigations, pacing reservations, 3 s waits, photo fetches, tries and outcomes. Nothing here opens a
// browser, reads settings or touches a network. Run from the repository root:
//
//   node proof/homepage-reuse-20261107/compare.mjs --base <sha> [--candidate <sha>] [--out results.json]
//
// Without --candidate the working tree's files are the candidate. It fails, rather than reporting a
// figure, when a revision does other than expected: the base must take no look without a load; the
// candidate must take exactly one where the scenario says the opened page stands in, none elsewhere;
// outcomes, waits, pacing and photo fetches must agree, except in the one scenario marked divergent.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { loadHelpers, run, scenarios } from "../../runner/unit/fixtures/homepage-reuse.mjs";

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.flatMap((arg, i) => arg.startsWith("--") ? [[arg.slice(2), argv[i + 1]]] : []));
const base = args.base;
if (!base) { console.error("--base <sha> is required"); process.exit(2); }
const candidate = args.candidate ?? `${execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()} (working tree)`;
const FILES = { shopper: "runner/support/shopper.mjs", storeCheck: "runner/support/store-check.mjs" };

const show = (sha, file) => execFileSync("git", ["show", `${sha}:${file}`], { encoding: "utf8" });
const sources = {
  base: Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, show(base, file)])),
  candidate: Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, args.candidate ? show(args.candidate, file) : readFileSync(file, "utf8")])),
};
// No module under test may reach a network or a child process, in either revision.
for (const [variant, files] of Object.entries(sources)) {
  for (const [key, source] of Object.entries(files)) {
    if (/\bfetch\(|from "node:(?:http|https|net|dns|child_process)"/.test(source)) throw new Error(`${variant} ${FILES[key]} names a network or process API`);
  }
}
const helpers = variant => w => loadHelpers(w, sources[variant]);

/** What a run did, without the world behind it. */
const counted = ({ outcome, sequence, navigations, navigated, paces, waits, gets, tries }) => ({ outcome, sequence, navigations, navigated, paces, waits, gets, tries });
/** Looks the store check took without loading: the open and the loops' tries, less every load made. */
const free = result => result.navigated === 0 ? 0 : 1 + result.tries - result.navigated;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const results = { node: process.version, base, candidate, scenarios: [], summary: {} };
const fail = (scenario, what) => { throw new Error(`${scenario.name}: ${what}`); };
for (const scenario of scenarios) {
  const b = counted(await run(scenario, helpers("base")));
  const c = counted(await run(scenario, helpers("candidate")));
  const row = {
    name: scenario.name, pattern: scenario.pattern, state: scenario.state, expect: scenario.expect, reuse: scenario.reuse, divergent: scenario.divergent ?? null,
    base: b, candidate: c, loads_spared: b.navigated - c.navigated, free_looks: { base: free(b), candidate: free(c) },
  };
  results.scenarios.push(row);
  const outcome = c.outcome.threw ? "throws" : c.outcome.problems.length ? "fail" : "pass";
  if (outcome !== scenario.expect) fail(scenario, `candidate ${outcome}, expected ${scenario.expect}: ${JSON.stringify(c.outcome)}`);
  if (free(b) !== 0) fail(scenario, `the base took ${free(b)} look(s) without a load`);
  if (free(c) !== (scenario.reuse ? 1 : 0)) fail(scenario, `the candidate took ${free(c)} look(s) without a load, expected ${scenario.reuse ? 1 : 0}`);
  if (scenario.divergent) {
    if (c.outcome.problems?.length !== 0) fail(scenario, `the candidate's first look should pass: ${JSON.stringify(c.outcome)}`);
    if (!b.outcome.problems?.length) fail(scenario, "the base should fail to reload");
    continue;
  }
  if (!same(b.outcome.problems ?? b.outcome.threw, c.outcome.problems ?? c.outcome.threw)) fail(scenario, `outcomes differ: ${JSON.stringify(b.outcome)} vs ${JSON.stringify(c.outcome)}`);
  if (Math.abs((b.outcome.seconds ?? 0) - (c.outcome.seconds ?? 0)) > 1) fail(scenario, `waits differ: ${b.outcome.seconds} s vs ${c.outcome.seconds} s`);
  for (const key of ["waits", "paces", "gets", "tries"]) if (b[key] !== c[key]) fail(scenario, `${key}: base ${b[key]}, candidate ${c[key]}`);
  if (b.navigated - c.navigated !== (scenario.reuse ? 1 : 0)) fail(scenario, `loads: base ${b.navigated}, candidate ${c.navigated}`);
  if (!same(b.sequence.filter(path => path !== "/"), c.sequence.filter(path => path !== "/"))) fail(scenario, "the product and category loads differ");
  // Where the opened page stood in, the spared load is the homepage check's first, right after the open.
  if (scenario.reuse && !same(c.sequence, b.sequence.toSpliced(1, 1))) fail(scenario, `the spared load isn't the first look: ${b.sequence} vs ${c.sequence}`);
}

const pad = (value, width) => String(value).padEnd(width);
console.log(`${pad("scenario", 52)} ${pad("expect", 7)} ${pad("base loads", 11)} ${pad("cand. loads", 12)} ${pad("spared", 7)} ${pad("waits", 6)} outcome`);
for (const row of results.scenarios) {
  const outcome = row.candidate.outcome.threw ? `throws: ${row.candidate.outcome.threw}` : row.candidate.outcome.problems.length ? `fail: ${row.candidate.outcome.problems[0]}` : "pass";
  console.log(`${pad(row.name, 52)} ${pad(row.expect, 7)} ${pad(row.base.navigated, 11)} ${pad(row.candidate.navigated, 12)} ${pad(row.loads_spared, 7)} ${pad(row.candidate.waits, 6)} ${outcome}${row.divergent ? " (divergent, by design)" : ""}`);
}
results.summary = {
  scenarios: results.scenarios.length,
  reuse_scenarios: results.scenarios.filter(row => row.reuse).length,
  loads_spared_total: results.scenarios.reduce((sum, row) => sum + row.loads_spared, 0),
  divergent: results.scenarios.filter(row => row.divergent).map(row => row.name),
  rule: "one homepage load spared per adopted call whose opened page stood in; outcomes, waits, pacing and photo fetches otherwise equal",
};
console.log(JSON.stringify(results.summary));
if (args.out) writeFileSync(args.out, JSON.stringify(results, null, 2) + "\n");
