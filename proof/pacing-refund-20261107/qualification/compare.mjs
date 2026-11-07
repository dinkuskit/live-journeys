#!/usr/bin/env node
// Run only after the candidate has been committed. No source transformations are performed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const options = { pairs: "3" };
for (let i = 2; i < process.argv.length; i += 2) {
  assert.ok(["--node", "--repo", "--base", "--candidate", "--playwright", "--chromium", "--out", "--pairs"].includes(process.argv[i]), "unknown option");
  assert.ok(process.argv[i + 1], "option needs a value");
  options[process.argv[i].slice(2)] = process.argv[i + 1];
}
for (const name of ["node", "repo", "base", "candidate", "playwright", "chromium", "out"]) assert.ok(options[name], `--${name} required`);
for (const name of ["base", "candidate"]) assert.match(options[name], /^[a-f0-9]{40}$/);
const pairs = Number(options.pairs);
assert.ok(Number.isInteger(pairs) && pairs >= 1 && pairs <= 5, "--pairs must be 1..5");
const here = dirname(fileURLToPath(import.meta.url)), out = resolve(options.out), node = resolve(options.node);
mkdirSync(out, { recursive: false }); // refuse an existing output, preserving earlier evidence
const receipts = [], rows = [];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function execute(name, script, args) {
  const command = [join(here, script), ...args];
  const began = performance.now();
  const result = spawnSync(node, command, {
    encoding: "utf8", timeout: 90_000, maxBuffer: 10 * 1024 * 1024,
    env: { PATH: `${dirname(node)}:/usr/local/bin:/usr/bin:/bin`, LANG: "C.UTF-8" },
  });
  const elapsed = performance.now() - began;
  writeFileSync(join(out, `${name}.stdout.txt`), result.stdout ?? "");
  writeFileSync(join(out, `${name}.stderr.txt`), result.stderr ?? "");
  receipts.push({ name, script, exit: result.status, signal: result.signal, wall_ms: elapsed,
    stdout_sha256: hash(result.stdout ?? ""), stderr_sha256: hash(result.stderr ?? "") });
  writeFileSync(join(out, "receipts.json"), JSON.stringify(receipts, null, 2) + "\n");
  assert.equal(result.status, 0, `${name} failed; inspect its saved streams`);
}
execute("model", "model.mjs", ["--repo", options.repo, "--base", options.base, "--candidate", options.candidate, "--out", join(out, "model-results.json")]);
function browser(mode, cache, index) {
  const name = `${cache}-${mode}-${index}`, target = join(out, name);
  execute(name, "browser-sample.mjs", ["--repo", options.repo, "--ref", options[mode], "--playwright", options.playwright,
    "--chromium", options.chromium, "--cache", cache, "--out", target]);
  const sample = JSON.parse(readFileSync(join(target, "result.json"), "utf8"));
  assert.equal(sample.source, options[mode]);
  assert.equal(sample.page_room, 40);
  assert.equal(sample.count_before_replay, 60);
  if (cache === "immutable") {
    assert.equal(sample.count_after_replay, 60);
    assert.deepEqual(sample.request_paths, ["/", "/asset.js"]);
    assert.equal(sample.replayed_observed, true);
    if (mode === "base") assert.ok(sample.pace_elapsed_ms > 1000, "seeded baseline did not retain enough wait for comparison");
    else assert.ok(sample.pace_elapsed_ms < 1000, "candidate did not wake promptly for the refund");
  } else {
    assert.equal(sample.count_after_replay, 61);
    assert.deepEqual(sample.request_paths, ["/", "/asset.js", "/asset.js"]);
    assert.equal(sample.replayed_observed, false);
    assert.ok(sample.pace_elapsed_ms > 1000, "a request that reached the store must still wait");
  }
  rows.push({ mode, cache, index, ...sample });
}
for (let pair = 1; pair <= pairs; pair++) {
  for (const mode of pair % 2 ? ["base", "candidate"] : ["candidate", "base"]) browser(mode, "immutable", pair);
}
for (const mode of ["base", "candidate"]) browser(mode, "no-store", 1);
const stats = {};
for (const mode of ["base", "candidate"]) {
  const values = rows.filter(row => row.mode === mode && row.cache === "immutable").map(row => row.pace_elapsed_ms).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  stats[mode] = { n: values.length, median_ms: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
    min_ms: values[0], max_ms: values.at(-1) };
}
const summary = {
  base: options.base, candidate: options.candidate, pairs, stats, rows,
  scripts_sha256: Object.fromEntries(["compare.mjs", "model.mjs", "browser-sample.mjs"].map(name => [name, hash(readFileSync(join(here, name)))])),
  limits: ["synthetic near-expiry request history", "controlled replay/caller interleaving", "not live incidence or end-to-end speedup"],
};
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ base: options.base, candidate: options.candidate, pairs, stats, result: "pass" }));
