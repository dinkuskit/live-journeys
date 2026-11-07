import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pollingBlock, runPoll, source } from "../../runner/unit/fixtures/orders-poll.mjs";

const base = "39723f974d5ed7fda703ea11cec0cc20153b235f";
const baselineSource = readFileSync(process.argv[2], "utf8");
assert.equal(createHash("sha256").update(baselineSource).digest("hex"), "1e00f0ac038660948939b99e43fc964a54a135cba9cbb09135af22ba17c68b04", "baseline must match the pinned source");
const blocks = [pollingBlock(baselineSource), pollingBlock(source)];
const fresh = { number: 101, status: "Processing" };
const cases = {
  immediate: { snapshots: [[fresh]] },
  third_poll: { snapshots: [[], [], [fresh]] },
  missing: {},
  deadline: { snapshots: [[], [], [], [fresh]] },
  unordered: { snapshots: [[99, 108, 102, 105, 100, 107, 101, 106, 104, 103].map(number => ({ number, status: number % 2 ? "Processing" : "Completed" }))] },
  scan_failure: { failure: { at: 2, message: "fixture pagination failed" } },
};
const results = {};
const semantic = ({ added, error, reads, waits, elapsed }) => ({ added, error, reads, waits, elapsed });
for (let repeat = 0; repeat < 10; repeat++) {
  for (const [name, options] of Object.entries(cases)) {
    const pair = [];
    // Alternate execution order to avoid systematically warming one side first.
    for (const index of repeat % 2 ? [1, 0] : [0, 1]) pair[index] = await runPoll(blocks[index], options);
    assert.deepEqual(semantic(pair[0]), semantic(pair[1]), name);
    assert.equal(pair[0].navigation - pair[1].navigation, pair[0].reloads, name);
    assert.equal(pair[1].reloads, 0, name);
    results[name] = pair.map(({ navigation, reloads, reads, waits, elapsed, error }) => ({ navigation, reloads, reads, waits, virtual_elapsed_ms: elapsed, error }));
  }
}
console.log(JSON.stringify({ base, samples_per_case: 10, cases: 6, comparison: "interleaved deterministic offline fixtures", source_sha256: createHash("sha256").update(source).digest("hex"), results }, null, 2));
