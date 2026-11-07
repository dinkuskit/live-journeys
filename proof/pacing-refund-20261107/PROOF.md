# Pacing refund wakeup: a sleeping step wakes when a counted request is taken back

Base `dbf2512864947be2fea87ec58f34866d359cc7d8` (the expected fresh base; worktree clean at start).
Branch `ridge/live-journey-pacing-refund-20261107`; the head is the commit carrying this file. Written
by a worker whose tool policy denies Node, so **no test or script below was run by this writer**; the
coordinator reruns them against the immutable commit. Every figure in "Supplied evidence" is the
coordinator's, from its 2026-11-06 pacing-admission task folder, and describes the disposable
prototype at the base, not this commit.

| Source | SHA-256 |
| --- | --- |
| `runner/support/pace.mjs` at the base (equals the prototype manifest's `original_pace_sha256`, checked here) | `847a3c26…5a5a3c` |
| The prototype's patched copy, never committed (`candidate_pace_sha256`, coordinator's hash) | `9e32d2f1…998a4` |
| `runner/support/pace.mjs` in this commit | `962226ba29c83cbf255bffbc104be7d7d3c11f7ceb9f9968cbfca5234b977196` |
| `runner/unit/pace.test.mjs` / `runner/unit/pace-log.test.mjs` in this commit | `91d1b1f1…29c49` / `f275c1eb…82d01` |

## What changed

`paceStore` decides a wait once, from the requests counted then. `watchStoreRequests` later takes a
request back when the browser answered it from its own copy of an immutable file, but a step already
asleep slept on until its timer fired, while a new identical call could go at once. Now:

- `runner/support/pace.mjs`: the sleep goes through a helper that keeps each sleeping step's `wake` in
  a set; `wake` clears the timer, leaves the set and resolves, whether the timer fired or a refund
  called it. The existing replay branch of `done`, right after it logs `-<at>` and splices the entry,
  wakes every sleeper. Each woken step runs the **same** `forgetOld`/`waitFor` loop: it goes only when
  its room fits, otherwise sleeps again for what the same `Date.now()` arithmetic still owes. No
  constant, margin, filter, cache, log line, retry or deadline changed; waits are not moved into
  request interception; a finished or failed request still counts; another worker's replays still
  reach a worker only through the log it reads when it starts.
- Counters (private `paceSnapshot`, no new field): a woken sleep counts one sleep, its asked-for time
  (`requestedMs`) stays the original timer, its measured time (`ms`, `wallMs`) is the real elapsed
  monotonic time; a step that must sleep again counts that as another sleep. Documented in the
  `pace.mjs` comment and the README's "Private timing" rows; the README's request-limit paragraph
  gains two sentences.

## Tests written (not run by this writer)

Five cases in `pace.test.mjs`, mocked `Date`/`setTimeout` at times a minute past the earlier tests:

| Case | Pins |
| --- | --- |
| Prompt release | 61 on their way, a step asking for `PAGE_ROOM`; a finished, a failed and an off-site request free nothing; one replay frees it without the clock moving; 1 sleep, 60,250 ms asked, under 1 s measured, wall equals measured; a fresh call goes; the asked-for time passing changes no counter |
| Partial refund | one request 50 s old, a hundred 30 s old, room 1: a replay leaves the budget full; the step wakes, sleeps again for the 10 s now owed instead of 30, fires at 10,250 ms; 2 sleeps, 30,250 + 10,250 asked; replaying a request already forgotten changes nothing |
| Concurrent waiters | rooms 1, 2 and 40 over a hundred: refunds release the first, then the second, the third wakes three times and still waits the minute; 7 sleeps, 7 × 60,250 asked, wall ≤ measured sum |
| No refund unchanged | 61 that finish or fail having reached the store: the step waits the full minute, 1 sleep |
| Timer cleanup | spies over the mocked timers: the refund-woken sleep clears the handle it set; a fired sleep clears its own; a refund with nobody asleep sets and clears nothing |

One case in `pace-log.test.mjs`: the woken step reads the log and finds `-<at>` already there, and a
worker started then (a fresh module copy) counts 60, goes for 40 and waits the minute for 41.
All earlier assertions in both files are kept. No source-parsing test, no new framework.

## Supplied evidence (coordinator, prototype at the base; Node 24.22.0, Playwright 1.61.1, Chromium 153.0.8010.36, loopback)

| Fixture | Baseline | Prototype | Preserved |
| --- | ---: | ---: | --- |
| Immutable replay, three interleaved pairs | median 4634.716 ms (4605.721 to 4670.201) | median 9.635 ms (7.947 to 10.171) | same two server requests, real replay, count 61 to 60, `PAGE_ROOM` 40, seeded 55 s-old history of 50 plus warm-up to 60 |
| `no-store` control, one pair | 4678.943 ms | 4631.608 ms | three server requests, no replay or refund, neither released within 75 ms |

Sixteen actual-module model cases (0, 1 and 10 refunds × 1 and 3 waiters, a 62-count insufficient
refund, a refund that ends as `requestfailed`) passed: no timer left live, baseline waiters released at
60,250 ms virtual, prototype waiters at 100 ms where capacity fit. The prototype's `failed` flag was
recorded but not applied; the portable model here applies it. Samples are in
[prototype-browser-summary.json](prototype-browser-summary.json) (temporary paths removed) and the
coordinator's hashes in [prototype-manifest.json](prototype-manifest.json). These are seeded,
controlled-interleaving fixture timings: **not live frequency, not a full-run gain**; the avoidable
wait is whatever remained of the budget minute, and no live run was made or requested.

## Rerun against this commit

```sh
# from live-journeys/, pinned Node 24.22.0, isolated HOME, DINKUS_E2E_ENV_FILE=/dev/null
node --test runner/unit/*.test.mjs
node proof/pacing-refund-20261107/refund-model.mjs --repo . --base dbf2512864947be2fea87ec58f34866d359cc7d8 --candidate <head> --out model-results.json
# once per revision and cache mode; --expect wakes only for the candidate with immutable
node proof/pacing-refund-20261107/refund-browser.mjs --repo . --ref dbf2512864947be2fea87ec58f34866d359cc7d8 --playwright runner/node_modules --chromium "$CHROMIUM" --expect sleeps
node proof/pacing-refund-20261107/refund-browser.mjs --repo . --ref <head> --playwright runner/node_modules --chromium "$CHROMIUM" --expect wakes
node proof/pacing-refund-20261107/refund-browser.mjs --repo . --ref <head> --playwright runner/node_modules --chromium "$CHROMIUM" --cache no-store --expect sleeps
```

Both scripts read the modules from immutable Git objects, never the working tree, write only under a
fresh temporary directory or the named `--out`, and make no request beyond loopback. They are ports
of the coordinator's prototype scripts with their machine paths and version pins turned into
arguments; neither has been executed by this writer, so a syntax slip is possible and would fail
loudly rather than pass.

## Limits and gates

Offline and loopback only: no live store, Access, credential, private report, workflow dispatch, push,
PR, review or merge by this writer. The wake is per worker process; cross-worker refunds are not
delivered live, as before. Merges and further live or private actions need new owner approval.
