import assert from "node:assert/strict";
import test from "node:test";
import { pollingBlock, runPoll, source } from "./fixtures/orders-poll.mjs";

const block = pollingBlock(source);
const old = { number: 99, status: "Processing" };
const fresh = { number: 101, status: "Processing" };

test("Problems polls with one fresh full scan per observation and no intervening reload", async () => {
  const result = await runPoll(block, { snapshots: [[old], [old], [fresh, old]] });
  assert.deepEqual(result, { added: [fresh], error: undefined, reads: 3, navigation: 4,
    reloads: 0, waits: [30_000, 30_000], elapsed: 60_000 });
});

test("all newer orders survive arbitrary ordering, statuses, and more than five results", async () => {
  const newer = [106, 101, 108, 103, 102, 105, 107, 104].map((number, i) => ({ number, status: i % 2 ? "Completed" : "Processing" }));
  const result = await runPoll(block, { snapshots: [[old, ...newer, { number: 100, status: "Completed" }]] });
  assert.deepEqual(result.added, newer);
  assert.equal(result.reads, 1);
  assert.deepEqual(result.waits, []);
});

test("a missing new order retains the timeout message and final deadline observation", async () => {
  const result = await runPoll(block);
  assert.equal(result.error, "No new TEST order in Commerce Orders 90s after the shopper paid and closed the tab.");
  assert.equal(result.reads, 4);
  assert.equal(result.navigation, 5);
  assert.deepEqual(result.waits, [30_000, 30_000, 30_000]);
});

test("a new order on the deadline observation is accepted", async () => {
  const result = await runPoll(block, { snapshots: [[], [], [], [fresh]] });
  assert.deepEqual(result.added, [fresh]);
  assert.equal(result.elapsed, 90_000);
});

test("scan failures propagate immediately without retry or a success result", async () => {
  for (const at of [0, 1, 2]) {
    const result = await runPoll(block, { failure: { at, message: "fixture pagination failed" } });
    assert.equal(result.error, "fixture pagination failed");
    assert.equal(result.reads, at + 1);
    assert.equal(result.added, undefined);
    assert.equal(result.waits.length, at);
  }
});

test("slow scans consume the existing deadline budget", async () => {
  const result = await runPoll(block, { readMs: 40_000 });
  assert.equal(result.reads, 2);
  assert.equal(result.elapsed, 110_000);
  assert.equal(result.waits.length, 1);
  assert.match(result.error, /No new TEST order/);
});
