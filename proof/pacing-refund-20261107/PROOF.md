# Pacing refund wakeup: a sleeping step wakes when a counted request is taken back

**Result.** On Node 24.22.0 the full unit suite of **243 tests passes** against committed core
`970c4ad4453358d6bb84e08b18f0d4d8a46b4dda` ([qualification/unit-results.json](qualification/unit-results.json)).
Independent source inspection of that commit found no actionable findings. Independent qualification of
the committed source (12 paired model scenarios, three real browser pairs and a `no-store` control) passed;
see [qualification/README.md](qualification/README.md) and [qualification/manifest.json](qualification/manifest.json).
The owned portable scripts in this directory were also executed against the same head and passed.
Production code and tests are frozen at `970c4ad`; the commit carrying this file changes proof only.

Base `dbf2512864947be2fea87ec58f34866d359cc7d8`, branch `ridge/live-journey-pacing-refund-20261107`.
The implementation was written by a worker whose tool policy denies Node; every execution below is the
coordinator's, on the immutable commit, with pinned Node 24.22.0, Playwright 1.61.1, Chromium 153.0.8010.36,
isolated HOME and loopback only.

| Source | SHA-256 |
| --- | --- |
| `runner/support/pace.mjs` at the base (equals the prototype manifest's `original_pace_sha256`) | `847a3c26c4b1091ed56ce9b14933ec8a0092d64d5f340d44dcfbbd48515a5a3c` |
| `runner/support/pace.mjs` at `970c4ad` and in this commit (byte-identical) | `962226ba29c83cbf255bffbc104be7d7d3c11f7ceb9f9968cbfca5234b977196` |
| `runner/unit/pace.test.mjs` / `runner/unit/pace-log.test.mjs` at `970c4ad` and in this commit | `91d1b1f1…29c49` / `f275c1eb…82d01` |
| The prototype's patched copy, never committed (`candidate_pace_sha256`, history only) | `9e32d2f1…998a4` |

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
  `pace.mjs` comment and the README's "Private timing" rows.

## Unit tests (243 pass, coordinator run)

Five cases in `pace.test.mjs` with mocked `Date`/`setTimeout`: prompt release (61 on their way, a
finished, a failed and an off-site request free nothing, one replay frees the step without the clock
moving, 1 sleep, 60,250 ms asked, under 1 s measured); partial refund (step wakes, sleeps again for the
10 s now owed, 2 sleeps); concurrent waiters (rooms 1, 2 and 40, 7 sleeps, wall ≤ measured sum); no
refund unchanged (full minute, 1 sleep); timer cleanup (every set handle cleared, a refund with nobody
asleep sets and clears nothing). One case in `pace-log.test.mjs`: a worker started after the refund
reads `-<at>` from the log, counts 60, goes for 40 and waits the minute for 41. All earlier assertions
in both files are kept. No source-parsing test, no new framework.

## Independent qualification of the committed source (`qualification/`)

Scripts, exact commands and limits are in [qualification/README.md](qualification/README.md); file
hashes in [qualification/manifest.json](qualification/manifest.json). Both refs are read as Git objects.

| Fixture | Base `dbf2512` | Candidate `970c4ad` | Preserved |
| --- | ---: | ---: | --- |
| Immutable replay, three alternating pairs ([browser-results.json](qualification/browser-results.json)) | median 4635.981 ms (4592.390 to 4642.678) | median 10.211 ms (9.149 to 10.396) | same two server requests, real replay observed, count 61 to 60, `PAGE_ROOM` 40, seeded 55 s-old history of 50 plus warm-up to 60 |
| `no-store` control, one pair | 4620.435 ms | 4575.303 ms | three server requests, no replay or refund, neither released within 75 ms |

Twelve paired model scenarios ([model-results.json](qualification/model-results.json): no refund, one,
many, insufficient and staggered refunds, a refunded failed request, each with 1 and 3 waiters) passed
on the actual `pace.mjs` bodies: base waiters release at 60,250 ms virtual, candidate waiters at the
refund that makes room, an insufficient refund admits nobody, no timer is left live, and the
sum/union sleep counters match the schedule.

## Owned portable scripts (also executed by the coordinator against `970c4ad`)

```sh
# from live-journeys/, pinned Node 24.22.0, isolated HOME, DINKUS_E2E_ENV_FILE=/dev/null
node --test runner/unit/*.test.mjs
node proof/pacing-refund-20261107/refund-model.mjs --repo . --base dbf2512864947be2fea87ec58f34866d359cc7d8 --candidate 970c4ad4453358d6bb84e08b18f0d4d8a46b4dda --out model-results.json
node proof/pacing-refund-20261107/refund-browser.mjs --repo . --ref dbf2512864947be2fea87ec58f34866d359cc7d8 --playwright runner/node_modules --chromium "$CHROMIUM" --expect sleeps
node proof/pacing-refund-20261107/refund-browser.mjs --repo . --ref 970c4ad4453358d6bb84e08b18f0d4d8a46b4dda --playwright runner/node_modules --chromium "$CHROMIUM" --expect wakes
node proof/pacing-refund-20261107/refund-browser.mjs --repo . --ref 970c4ad4453358d6bb84e08b18f0d4d8a46b4dda --playwright runner/node_modules --chromium "$CHROMIUM" --cache no-store --expect sleeps
```

All passed: 16 model scenarios, and base immutable / candidate immutable / candidate `no-store` browser
samples. The scripts read modules from immutable Git objects, write only under a fresh temporary
directory or the named `--out`, and make no request beyond loopback.

## Prototype evidence (history, not this commit)

The 2026-11-06 prototype at the base (uncommitted patched copy `9e32d2f1…998a4`) first reproduced the
defect: immutable median 4634.716 ms to 9.635 ms over three pairs, `no-store` 4678.943 ms to 4631.608 ms,
16 model cases passed. The prototype's `failed` flag was recorded but not applied; the portable model
here applies it. Samples: [prototype-browser-summary.json](prototype-browser-summary.json) (temporary paths
removed); hashes: [prototype-manifest.json](prototype-manifest.json). Superseded by the qualification above.

## Limits and gates

Every timing is from seeded near-expiry history and controlled replay/caller interleaving: **not live
frequency, not a full-run gain**; the avoidable wait is whatever remained of the budget minute, and no
live run was made or requested. Offline and loopback only: no live store, Access, credential, private
report, workflow dispatch, push, PR, review or merge by this writer. The wake is per worker process;
cross-worker refunds are not delivered live, as before. Merges and further live or private actions need
new owner approval.
