# Private journey timing: source prepared, final offline checks owned by the coordinator

Base: `da61f2206486504eb4784571e6b15680328c5fc3` (the expected fresh base; no drift,
worktree clean at start). Branch: `ridge/live-journey-timing-20261107`.
Source hashes are in [validation.json](validation.json). Six turns of source
work: the first commit (`c315f28`) added the fact; the second (`d637573`)
answers the read-only design audit below; the third (`71bb42e`) answers the
independent review of `c315f28` (two proof limits, below), with no further
source change to the metric itself; the fourth (`3a7f913`) extends the manual
diagnostics analyzer to project the fact (below), touching no producer source;
the fifth (`7bd7379`) renames the one fixture title the fourth left outside the
analyzer's allowlist, the single failure in the coordinator's full suite at
`d637573` (below), and records that acceptance as source-specific historical
evidence; the sixth makes the fact's write whole-or-nothing, the required
correctness fix the coordinator raised before final review (below).

## What changed

One private timing fact per journey, `<journey> timing`, in the existing
`facts` of `report.json`, written once by the journey wrapper when a try's body
returns or throws (`finally`). No new top-level report key, telemetry service,
workflow, runner or platform. Three owners changed, each by a few lines:

- `runner/support/pace.mjs`: `paceStore` counts each explicit rate-limit sleep
  it takes, keeps what it asked the timer for (the wait it computed from
  `Date.now()` and the request log, as before, plus the 250 ms margin), and
  measures it on the monotonic clock (`performance.now()` before and after the
  timer): sleep count, summed requested time, summed measured time, and the
  wall time during which at least one sleep was in flight, which is less than
  the sum when sleeps overlap. `paceSnapshot()` copies the four counters. The
  scheduled wait, its margin, the budget, the rooms and the loop are untouched;
  no timer is added, and every pacing decision still reads the wall clock.
- `runner/support/proof.mjs`: `noteJourneyTiming(name, retry, entry)` keeps
  `{ unit: "ms", tries: [...] }` under `<name> timing`. A retry adds its entry
  beside the failed try's (never erased), reading the earlier tries back from
  the report as the retry's new worker loads it. `startJourney(name, 0)` now
  also deletes the journey's earlier timing fact in the write it already makes,
  so a journey run again under the same run id never shows an earlier run's
  entries for a try that hasn't finished; `startJourney(name, 1)` keeps them.
  `PROOF.md`'s Facts list renders object facts as JSON instead of
  `[object Object]`. Since turn 6 the fact's write puts `report.json` and
  `PROOF.md` down whole or not at all (a `.tmp` beside each, renamed over it)
  and, when it fails, reloads the files as they stand, so the report the
  journey's steps built survives and the unpublished entry is not held for a
  later write; see "Required correctness fix (turn 6)". Existing arbitrary
  facts, the steps' own direct writes and the load-from-disk path that
  survives Playwright's worker restarts are unchanged.
- `runner/support/steps.mjs`: the wrapper takes `performance.now()` and a pace
  snapshot after `startJourney` and before the body, the time right after the
  body returns or throws, and in `finally` writes one entry: `try`, `body`
  (`returned`/`threw`), `verdict`, `body_ms`, `pace_sleeps`,
  `pace_sleep_requested_ms`, `pace_sleep_ms`, `pace_sleep_wall_ms`, all whole
  milliseconds. The write is wrapped so a failing write can never change the
  journey's outcome or replace its error. Error identity, `forProof`
  sanitization, the recorded "finished without an error" step, the verdict
  print and the final `expect` are as before.

Documented in `runner/README.md` under "Proof" > "Private timing", with the
limits: BODY elapsed excludes fixture startup and teardown, the journey's start
in the proof and the fact's own write, and includes the body's own screenshots
and cleanup; requested and measured sleep differ by timer overshoot (and a few
milliseconds of timer-clock skew the other way); per-call sleep sums can
double-count overlapping sleeps and then exceed `body_ms`, which the wall
figure does not; time beyond the sleeps is unattributed and is not claimed as
CPU; a try cut off before its wrapper finished (timeout, stopped run, killed
worker) leaves no entry rather than a zero or a pass; `--list` writes nothing;
pace counters are per worker, so only same-worker snapshot differences are
used, and what a worker's counters held before a journey never reaches its
entry; each sleep counts, whole, in the journey whose body is running when it
ends, so the figures are exact for a body that awaits every sleep it starts
(as every journey's does), while a sleep still running when a body ends is left
out of that try and lands in the worker's next journey, or nowhere.

The public `scripts/run-summary.mjs` prints only the facts it names
(`plugins`, `update stopped`, `held`, `store refusals`) and is unchanged; the
console prints nothing new. In turn 4 the manual diagnostics reader
(`runner/scripts/report-diagnostics.mjs`) was extended, in its `analyze` step
only, to project the fact; see below. It was not run, and nothing was dispatched.

## Consumer projection (turn 4)

The coordinator extended the assignment so the private metric is readable
through the consumer the repository already owns, with no new harness.
`analyze` now adds one optional field, `timing`, to a listed journey's
projection, sourced only from `facts["<journey> timing"]` by exact name, and
built from fresh literals in a fixed key order (never a spread of the fact):

| Rule | Where it lands |
| --- | --- |
| Exact keys `unit` and `tries`; `unit` is `ms`; `tries` holds 1 to 8 entries. The runner retries a journey at most once, so the producer writes at most two; 8 is a generous bound | `MAX_TRIES`, `exact()` |
| Each entry has exactly the eight producer keys; `try` is a positive safe integer, unique in the array; `body` is `returned` or `threw`; `verdict` is `PASS`, `FAIL` or `INCOMPLETE` (a try's verdict, never `FLAKY`); the five counts and durations are finite non-negative safe integers (`-0`, fractions, strings, `Infinity`, `NaN` and unsafe integers refused) | `TRY_KEYS`, `BODIES`, `TRY_VERDICTS`, `count()` |
| A malformed recognized fact fails the whole projection with the existing fixed `Diagnostics unavailable.`; no partial output | `timing()` calls `fail()` |
| Every other fact is ignored: near misses of the name, a timing for a journey the report does not list, nested objects | Only `Object.hasOwn(report.facts, "<name> timing")` is read |
| A journey without the fact has no `timing` key, so an older report projects byte for byte as before; nothing is written as zero | Conditional property on the fixed literal |
| Tries are passed through apart, in the report's order; nothing is summed, no speed-up or residual CPU is computed; an overlap sum above `body_ms` passes through as the producer's documented figure | `timing()` maps entries one to one |
| No transport, credential, selector, workflow or default public summary change; no new private read or dispatch | Only `analyze` and its helpers changed; the workflow file and `run-summary.mjs` are untouched, and the existing workflow tests still pin them |

The timing unit test used three synthetic journey titles outside the
analyzer's allowlist. Turn 4 renamed two ("Buy a label", "Order details") to
allowlisted ones ("Buy a label in the store admin", "One product with a
category") and left "Free shipping" in place; the coordinator's full suite at
`d637573` (below) failed exactly that later-worker case, because the existing
analyzer correctly refuses a report naming an unlisted journey. Turn 5 renames
it to the real journey "Free shipping over an amount" (the fixture's step
names are free text and stay). The analyzer was not weakened at any point. The
later-worker case, which hands the run's report to `analyze`, is now a real
producer-to-consumer check: it asserts the projection carries each saved
timing fact byte for byte and no `timing` key for the journey whose write
failed (Ship settings). Its expectation changed on purpose with the consumer
projection: a report without timing facts still projects nothing new, a
report with valid facts projects fixed numeric timing, and the default run
summary still omits it.

Three adversarial cases were added to `runner/unit/report-diagnostics.test.mjs`,
running the actual analyzer and its in-process CLI boundary:

| Case | What it pins |
| --- | --- |
| Report without timing | Output byte-equal to the earlier literal, through `analyze` and the CLI; facts named `Manage products timing ` (trailing space), `manage products timing`, `Manage products Timing`, `<poison> timing`, `Cart timing` (Cart unlisted), `Test run timing`, `timing` and nested private text are all ignored; no `timing`, `body_ms`, `pace_sleep` or canary on stdout, nothing on stderr |
| Valid retry projection | A failed try 1 beside a passed try 2 for a `FLAKY` Storefront, projected in the fixed key order whether the fact's keys came reversed or not; Manage products beside it has no `timing` key; eight tries in the report's own order; `Number.MAX_SAFE_INTEGER` accepted; overlap sum above `body_ms` passed through |
| Malformed recognized timing | 22 fact shapes (null, string, number, boolean, array, missing or extra key, wrong unit including `seconds`, `MS` and an array, non-array or empty tries, 9 and 10001 entries) and 81 entry shapes (duplicate tries, each key missing, extra keys carrying the canary, a nested error and a tokened URL, wrong `body` and `verdict` enums including `FLAKY` and `SKIP`, and for `try` and each count: 0 or negative, fractional, string, `2 ** 53`, null, boolean, array, canary, `Infinity`, `NaN`) each throw the fixed message; a valid fact beside a malformed one for another listed journey fails too; through the CLI, JSON text with an own `__proto__` key, `-0` and `1e400` (Infinity) fail with the fixed stderr line only, while a duplicate JSON key (one key after parsing) still projects; the canary, the URL and `__proto__` never appear on stdout or stderr |

The reference `references/report-diagnostics.md` now states the timing
contract and its limits in its public output section, that offline fixtures
prove only producer-consumer agreement, that attributing a real run's time
needs a future separately authorized full run and read, and that the one
approved read (the qualification recorded there) is consumed. The README's
"Private timing" section and its diagnostics paragraph say the same.

## Design audit (turn 2) and where each point lands

| Audit point | Source | Offline check |
| --- | --- | --- |
| A timing write failure never fails a passing body or replaces the thrown error | `steps.mjs` `finally` wraps the write in its own `try`; since turn 6 the write is also whole-or-nothing, so the report survives it | "a timing write that fails…" (stub that throws before writing); "a timing write that stops midway…" (real `proof.mjs`, half the bytes down) |
| `startJourney` at retry 0 under the same run id clears stale timing in its existing write | `proof.mjs` `startJourney` deletes `<name> timing` when `retry` is 0 | "…a rerun clears the earlier entry as it starts…" |
| Retry tries keep distinct identities across a process restart | `noteJourneyTiming` loads the report before adding `try: retry + 1` | "a retry in a new worker…" (fresh proof module) |
| A killed worker leaves a missing metric, never a fabricated 0 or pass | Nothing is written before `finally`; the reporter's unrecorded-failure paths touch no timing | "…a cut-off try leaves none" |
| `--list` writes nothing | Reporter's existing `listOnly` guard; module load and `paceSnapshot()` write nothing | Same test: module reload and snapshot leave `report.json` byte-identical |
| `Date.now()` pacing decisions unchanged, monotonic clock for elapsed | `paceStore`'s wait arithmetic untouched; only `performance.now()` around the timer | "a wall-clock jump during a sleep…" (hour jump mid-sleep) |
| Requested vs completed sleep, summed overlaps may exceed wall elapsed | `pace_sleep_requested_ms` beside measured `pace_sleep_ms`; `pace_sleep_wall_ms` | First test (requested vs measured bounds); overlap test asserts sum > `body_ms` >= wall |
| Body boundary excludes fixtures, `startJourney`, the write; includes body-owned screenshots and cleanup | `from` taken after `startJourney`, `to` before the write | "the body's span…" (200 ms stalls on either side, screenshot and `finally` inside) |
| Passed, soft-failed and thrown bodies; retry plus reload; private-only output | As in turn 1 | Existing tests, kept |

## Independent review of `c315f28` (turn 3) and where each limit lands

The review found no actionable defect beyond the stale retry-0 timing already
cleared in turn 2, and two proof limits:

| Limit | Where it lands |
| --- | --- |
| The new-worker retry test reloaded the proof module but reused the pace module, so a fresh-worker counter reset was asserted in the README without a test | The README no longer rests on a reset: a journey's entry is a same-worker snapshot difference, so what the counters held before it never reaches the entry. The retry-in-a-new-worker test now also loads a fresh copy of `pace.mjs` (as that worker would), checks this copy has slept at least four times while the fresh copy reads all zeros, binds the retry's wrapper to the fresh copy, and checks the retry's entry reads zero sleeps and the fresh copy stays at zero. A module copy is the offline stand-in for a worker process; a real worker is fresher still, and no claim beyond the copy is made |
| Sleep differences are exact only when the relevant sleeps begin and end inside the body; a sleep across the boundary is misattributed | Documented, not changed: `paceStore` counts a sleep, whole, when it ends, so a journey's difference holds the sleeps that ended during its body. Every journey awaits each sleep it starts, so for the journeys as written every sleep ends inside its body and the figures are exact. The limit is a sleep a body started and did not await before throwing: it is left out of that try and lands in the worker's next journey (whose `pace_sleep_ms` can then exceed its `body_ms` with no overlap) or nowhere, never split. The README and the `pace.mjs` comment say so, and a new test pins it: a body starts a sleep, throws 50 ms in, and its entry reads zero sleeps with the counters unmoved; the retry that then awaits the same sleep reads one sleep, measured at least the scheduled wait less 100 ms, wall equal to measured, and more than its own `body_ms` |

Splitting a sleep across two journeys would need the snapshot to read in-flight
sleeps and count sleeps at their start; it was not added, as no journey has an
un-awaited sleep and the turn's scope was the two limits.

## Required correctness fix (turn 6)

The coordinator found, before final review, that the guard around
`noteJourneyTiming` protected the journey's outcome but not the report: the
fact's write went straight to `report.json` with `writeFileSync`, so a disk that
filled partway through it (ENOSPC or any write that stops midway) left the
previously valid report truncated, the error was swallowed, and the reporter
would later load `{}` and change the run's verdict. This extra, telemetry-only
write could corrupt what the journey's own steps had built.

| Change | Where |
| --- | --- |
| `write(true)`, used only by `noteJourneyTiming`, puts each of `report.json` and `PROOF.md` down whole or not at all: the text goes to `<file>.tmp` beside it, then `renameSync` over the file. The steps' and `startJourney`'s writes keep their direct path, as before | `proof.mjs` `write`, `replace` |
| On failure the temporary file is removed as far as it can be (`unlinkSync`, errors ignored), and the error is rethrown to the wrapper's existing guard. A worker killed mid-write can leave `report.json.tmp` or `PROOF.md.tmp` in the run folder; nothing reads them | `replace` |
| On failure `noteJourneyTiming` reloads the files as they stand before rethrowing, so the entry it could not publish is not held in memory for a later direct write (`startJourney` and `record` write without loading first) | `noteJourneyTiming` |
| No generic storage change: one 11-line helper, one argument on `write`, two `node:fs` imports; `steps.mjs` is byte-identical | `validation.json` |

The offline check is the fourteenth case, "a timing write that stops midway…".
It evaluates the actual `proof.mjs` source (via `loadProof` in the wrapper
fixture) over a file system whose `writeFileSync` puts down half the bytes and
throws `ENOSPC` for any text carrying `Commerce settings timing`, and passes
every other write through, so the journey's own writes succeed and only the
fact's publication fails, in whichever design: a direct write would have hit
the report itself. The case first shows that write leaves a scratch file
unparsable (what the report would have become), then runs the real wrapper
bound to that copy: a passing try, whose `report.json` and `PROOF.md` are
asserted byte-equal to what its last step left, with the run folder's listing
unchanged (no `.tmp` left), no entry, the journey `PASS` by `verdicts()` and
the other fact kept; then a retry in the same copy whose body throws, whose
error comes back identical, whose steps (the retried try's and its own PASS
and "finished without an error" FAIL) and `FAIL` verdict read back from a whole
report, with no entry and no temporary file. The retry's start writes without
loading, so had the failed entry been held in memory that write would have
carried the fact and the same disk would have failed it midway, which the
error-identity assertion would catch. The later-worker case then hands that
report to the real analyzer and asserts no `timing` key for the journey.

`benchmark.mjs` now binds counted `renameSync` and `unlinkSync` to both
variants' proof modules (the base uses neither) and reports renames and
unlinks beside writes and reads. The candidate's wrapper workload is expected
to show two more writes and two renames per journey than before and no unlink;
its per-journey figure will therefore differ from the `+175 µs` the coordinator
measured at `d637573`, and that figure is historical. No sample exists from
this worker.

## Offline checks written

`runner/unit/journey-timing.test.mjs` runs the actual wrapper source from
`steps.mjs` (via `runner/unit/fixtures/journey-wrapper.mjs`, a `vm` fixture in
the style of the observer-dwell one) against the real `proof.mjs`, `pace.mjs`
and `errors.mjs`, with stand-ins only for Playwright's `test`/`expect`. It
needs no `npm ci`, as `tests.yml` runs the suite without one. Fourteen cases
(twelve before turn 3, thirteen before turn 6):

| Case | Boundary exercised |
| --- | --- |
| Waits on the store | One real pace sleep (requests seeded 59 s ago in the pace log, as a prior worker would leave them); requested within the scheduled wait, measured at least requested less 50 ms of timer-clock skew, body at least the sleep, integer fields, exact key set, JSON rendering in `PROOF.md` |
| Never waits | Zero sleeps, zero requested and measured time, body time still measured |
| Overlapping sleeps | Two `paceStore` awaited together: sum counts both and exceeds `body_ms`, wall counts once, is smaller and within `body_ms` |
| Wall-clock jump | `Date.now` jumps an hour while a sleep's timer runs: measured sleep and body stay at the real second; pacing then waits for nothing, as the wall clock says |
| Sleep across the boundary | A body starts a sleep, does not await it and throws 50 ms in: its entry reads zero sleeps and the counters have not moved; the retry that awaits the same sleep reads one whole sleep, wall equal to measured, more than its own `body_ms` |
| Body throws | Same error object rethrown with its first line only, failure step recorded, `body: "threw"`, timing still written |
| Soft step failed | `body: "returned"`, `verdict: "FAIL"`, final expect still fails the journey |
| Body boundary | `startJourney` and the timing write each hold the thread 200 ms; a step's 30 ms screenshot and a 20 ms `finally` sit inside; `body_ms` lands between |
| Retry | Failed first try kept beside the passing retry (`FLAKY`), kept through the retry's start, same retry replaces only its own entry, a fresh run starts over |
| Cut off and rerun | A finished entry, then module reload and snapshot write nothing; a rerun's start clears the entry; nothing appears while the body is held, however many steps it records; one entry after |
| Timing write fails | Outcome and error identity unchanged, no entry |
| Retry in a new worker | Fresh proof and pace module copies: the proof copy loads the failed try's entry from disk and adds try 2 beside it, byte-equal try 1; the pace copy reads all zeros while this copy has slept at least four times, the retry's entry reads zero sleeps from it, and it stays at zero |
| Timing write stops midway | The actual `proof.mjs` over a disk that writes half the bytes then throws ENOSPC for the text carrying the fact: a passing try leaves `report.json` and `PROOF.md` byte-equal to what its last step wrote, no `.tmp`, no entry, `PASS`; a throwing retry in the same copy returns the same error, its steps and `FAIL` verdict read from a whole report, no entry, no `.tmp` |
| Later worker and public surfaces | Fresh proof module keeps every earlier timing (both Free shipping over an amount tries) and arbitrary facts, exact report key set; diagnostics `analyze` projects each saved fact byte for byte and no key for Ship settings or Commerce settings; the real `run-summary.mjs` output names no timing |

`benchmark.mjs` here evaluates base and candidate `pace.mjs`, `proof.mjs` and
`steps.mjs` from source with identical stand-ins, interleaves samples, counts
every timer (with delay) and file read, write, rename and unlink, provides no
network binding and statically refuses any network or child-process import.
Workloads: 10,000 `paceStore` calls with room; 200 forced single sleeps over a
fake clock; 25 wrapped journeys. It reports raw per-sample microseconds,
min/median/p90/max/mean, per-call figures, and the per-sample work for each
variant. It reads the candidate from the working tree; turn 6 added the rename
and unlink bindings and counts.

## Not run by this worker

In turns 1 and 2, every form of Node execution was denied by this session's
permission policy: the pinned Node 24.22.0 (`--version`, `--check`, `--test`,
with and without an isolated `env -i` environment), the PATH Node, `npm ci`,
inline `node -e`, and in turn 1 a delegated subagent. In turns 3 to 6 the
coordinator stated Node is intentionally unavailable on this worker's tool
surface, so nothing was attempted, retried or delegated. So **no unit result,
no full-suite result and no benchmark sample exists from this worker.** None
is claimed, and neither test file has been syntax-checked by a parser in any
turn; both were proof-read only. `git diff --check` passed in every turn.

## Coordinator producer acceptance at `d637573` (historical evidence)

The coordinator ran the producer checks independently on the immutable turn 2
commit `d637573d4f92c607e91fdafd1ceaf9ddae4b7e0e` with the pinned Node 24.22.0
and stable-source hashes captured, and keeps the files in its own task folder:
`producer-unit.log`, `producer-unit.json`, `producer-benchmark-results.json`,
`capture-producer/`, and `real-playwright/PROOF.md` with
`source-manifest.json`. Figures below are as the coordinator reported them;
the raw samples are in those files, not here.

| Check at `d637573` | Result reported by the coordinator |
| --- | --- |
| Full unit suite, pinned Node 24.22.0 | 224 tests, 223 passed, 1 failed: the timing test's later-worker case, whose report named the synthetic journeys "Order details" and "Free shipping", which the analyzer correctly refuses. A fixture defect, not a producer or analyzer defect; fixed by the title renames in turns 4 and 5 |
| Benchmark, 30 interleaved pairs | Passed with equal timer and delay counts per variant in every workload. Per-call deltas, candidate less base: no-wait `paceStore` +0.002 µs; forced single sleep −0.56 µs (within noise, no improvement is claimed); completed wrapper per journey +175 µs, which carries the entry's report load and write |
| Real Playwright producer probe | Passed, with a `FLAKY` journey whose failed try's entry was retained across the retry's new worker; no live I/O |

This evidence is specific to `d637573`. Between it and the current head,
`steps.mjs` is byte-identical and `pace.mjs` differs by a comment only (turn
3; see `validation.json`), but `proof.mjs` changed in turn 6 (the fact's write
is now whole-or-nothing, with two more writes and two renames per published
entry), so the wrapper workload's `+175 µs` figure describes the earlier
write path and not the current one; the analyzer change (turn 4), the
analyzer's adversarial tests, the renamed fixture titles, the midway-write
case and the docs are also later than it and not covered by it. The one
failed case is expected to pass on the current head once "Free shipping over
an amount" is an allowlisted name, and the new case is expected to pass, but
those are expectations, not results: the coordinator reruns every check on the
final source and supplies the final results for a proof-only update. Primary
acceptance (correct private metrics with behavior unchanged, a report that
survives a failed publication, negligible measured overhead, and the consumer
reading the producer's shape) rests on that rerun:

```sh
# from live-journeys/, with the pinned Node 24.22.0 as NODE, isolated HOME/proof/profile
env -i HOME="$TMP_HOME" PATH="$PATH" DINKUS_E2E_ENV_FILE=/dev/null \
  DINKUS_E2E_PROOF="$TMP_HOME/proof" DINKUS_E2E_PROFILE="$TMP_HOME/profile" \
  "$NODE" --test runner/unit/journey-timing.test.mjs runner/unit/report-diagnostics.test.mjs
env -i HOME="$TMP_HOME" PATH="$PATH" DINKUS_E2E_ENV_FILE=/dev/null \
  DINKUS_E2E_PROOF="$TMP_HOME/proof" DINKUS_E2E_PROFILE="$TMP_HOME/profile" \
  "$NODE" --test runner/unit/*.test.mjs
"$NODE" proof/private-timing-20261107/benchmark.mjs \
  --base da61f2206486504eb4784571e6b15680328c5fc3 --samples 30 \
  --out proof/private-timing-20261107/benchmark-results.json
```

The diagnostics test's new cases run about 110 `analyze` calls and 13 CLI
passes against temporary folders, with no timers. The timing test takes about
six seconds of real timers (five seeded sleeps of about 1.25 s each) and holds
the thread for 0.4 s in the boundary case; the midway-write case adds no timer
and a few file writes. Its
time bounds leave 50 to 180 ms of headroom for a loaded machine; a bound that
trips under heavy load is a test-tolerance matter, not a metric defect, and
the assertion message prints the figure that tripped it.

Expected shape, unmeasured: per pace sleep, two `performance.now()` reads and
four additions against a sleep of 250 ms or more; per journey, one counter
copy, two clock reads, one step filter, one report load and one write of each
of the two files to a temporary file plus its rename, the same class of work
as one existing `note()` plus two renames, against journeys of one to fifteen
minutes; per `startJourney`, one property delete. The benchmark's work counts
must show equal timers and delays for base and candidate in every workload,
zero timers in the no-wait and wrapper workloads, more file writes and the
only renames in the candidate's wrapper workload, and zero unlinks in both. If
the full suite shows sandbox subprocess
failures in the unchanged `gmail` and `proof` tests, that is the known
environment limit, not this change.

No live run, store, mail, credential, private report or external request was
made or requested. No push, PR, review or merge by this worker.
