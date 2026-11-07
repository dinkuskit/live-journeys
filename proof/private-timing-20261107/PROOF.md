# Private journey timing: source frozen at `c0b0338`, coordinator checks passed, proof-only closeout

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
evidence; the sixth (`c0b0338`) makes the fact's write whole-or-nothing, the
required correctness fix the coordinator raised before final review (below);
the seventh (`d28057b`) makes the benchmark fail, rather than look fast, when
the candidate's wrapper did not publish every entry (below).

**Production code and tests are frozen at
`c0b03386a18f3bd4a367fc696c9463fce0df1d0a`.** `d28057b` differs from it only
under `proof/private-timing-20261107/` (`git diff --stat c0b0338 d28057b --
runner references` is empty, checked in turn 8), so every result below that
names `c0b0338` holds for the runner source on the current head; the one file
that changed in `d28057b` and matters to a result is `benchmark.mjs`, and the
final benchmark ran that version (its SHA-256 is in
[benchmark-manifest.json](benchmark-manifest.json) and equals the script's
hash at `d28057b`, `d0a5f86d…9d53f`). Turn 8 is proof-only: no source, test
or benchmark change, no experiment. The coordinator's final results are in
"Final coordinator acceptance at `c0b0338` (turn 8)".

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
unlinks beside writes and reads. The candidate's wrapper workload was expected
to show two more writes and two renames per journey than before and no unlink,
and the final benchmark shows exactly that (150 writes, 25 reads, 50 renames,
0 unlinks per 25 journeys against the base's 100 writes); its per-journey
median moved from the `+175 µs` the coordinator measured at `d637573` to
`+181.6 µs` at `c0b0338` (below). No sample exists from this worker.

## Benchmark consistency (turn 7)

The coordinator asked, after the atomic fix, that the benchmark could not
mistake a candidate whose timing write failed for a fast one: the wrapper lets
a failed write go by design (`steps.mjs` `finally`), so if `proof.mjs` named a
`node:fs` function the benchmark had not supplied, the `ReferenceError` would
be swallowed, the entry never published, and the sample would run with less
work. Two guards were added to `benchmark.mjs`; no runner source changed.

| Guard | What it does |
| --- | --- |
| Import coverage | Before evaluating any of the three modules, in either revision, the benchmark collects the local names of its `import { ... } from` lines and refuses to run if the bindings do not cover every one, naming the module and the missing names. On this head `proof.mjs` imports `readFileSync`, `writeFileSync`, `renameSync` and `unlinkSync` from `node:fs` (no `mkdtemp`, `rmSync` or other), all four bound and counted; `pace.mjs` and `steps.mjs` name nothing beyond the bindings, in either revision |
| Per-sample publication check | After every wrapper sample, outside the timed span, the benchmark reads each variant's `report.json` back and asserts: the work per sample equals a fixed expectation (base: 100 writes, 0 reads, 0 renames, 0 unlinks; candidate: 150 writes, 25 reads, 50 renames, 0 unlinks; 0 timers and 0 ms of delay for both), the report's verdict is `PASS` over 25 journeys, no `.tmp` file is left in the run folder, the base holds no `<name> timing` fact, and the candidate holds exactly 25, `Bench 0` to `Bench 24`, each `{ unit: "ms", tries: [one entry] }` with the eight producer keys in order, `try` 1, `body` `returned`, `verdict` `PASS`, the four `pace_*` figures 0 and `body_ms` a non-negative safe integer; and the 25 `body_ms` sum to no more than the sample's own wall time (plus one millisecond of rounding per entry). A candidate entry is present only if that sample's write succeeded, since the journey's start clears it in the same write. After the workload it also asserts every sample of both variants was checked and 25 × samples entries examined, and records the counts under `wrapper_samples_checked` in the results |

The fixed expectations are those of this head's sources, stated in "Required
correctness fix (turn 6)": the base writes two files at `startJourney` and two
at `record`; the candidate adds one report read, two temporary-file writes and
two renames per published entry. A revision that does more or less work, or
publishes fewer entries, fails the benchmark instead of reporting a figure.
The existing checks (equal timers and delays per variant in every workload,
work constant across samples, no network or child-process import) stand.

The coordinator's combined suite at `3a7f913` (the fourth commit, before the
title rename in `7bd7379`) was reported as 228 tests, 227 passed, with the sole
failure the later-worker case's synthetic "Free shipping" title, which the
analyzer correctly refuses; `7bd7379` renamed it to "Free shipping over an
amount", the real journey (the analyzer's allowlist, `NAMES` in
`report-diagnostics.mjs`, carries it), and every other title the timing test
uses (Full catalog, Storefront, Cart, Payments status, Buy a label in the store
admin, Problems, Manage products, One product with a category, Buy and ship,
Ship settings, Commerce settings, Mark as completed) is on that list. That
result is evidence specific to `3a7f913`; the coordinator's rerun on the frozen
source `c0b0338` passed every test (below).

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
and unlink bindings and counts; turn 7 added the import-coverage refusal and
the per-sample publication check (see "Benchmark consistency (turn 7)").

## Execution on this worker, by turn

In turns 1 and 2, every form of Node execution was denied by this session's
permission policy: the pinned Node 24.22.0 (`--version`, `--check`, `--test`,
with and without an isolated `env -i` environment), the PATH Node, `npm ci`,
inline `node -e`, and in turn 1 a delegated subagent. In turns 3 to 8 the
coordinator stated Node is intentionally unavailable on this worker's tool
surface, so nothing was attempted, retried or delegated. So **no unit result,
no full-suite result and no benchmark sample was produced by this worker in
any turn**; every result in this proof was produced by the coordinator on its
own tool surface and is recorded here from its files. Neither test file nor
`benchmark.mjs` was syntax-checked by this worker; the coordinator's runs of
them (the suite at `c0b0338`, the benchmark at `d0a5f86d…9d53f`) are the
evidence that they parse and pass. `git diff --check` passed in every turn.

Three coordinator checkpoints preceded the final one, each specific to its
commit: a draft full suite before turn 3 (221 passed) with a 30-pair benchmark;
the producer acceptance at `d637573` (next section); and the combined suite at
`3a7f913` (228 tests, 227 passed, the one "Free shipping" title). Each earlier
claim of "no result exists" in this proof described the state at that turn and
is superseded by the final section.

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

This evidence is specific to `d637573`. Between it and the frozen source,
`steps.mjs` is byte-identical and `pace.mjs` differs by a comment only (turn
3; see `validation.json`), but `proof.mjs` changed in turn 6 (the fact's write
is now whole-or-nothing, with two more writes and two renames per published
entry), so the wrapper workload's `+175 µs` figure describes the earlier
write path; the analyzer change (turn 4), the analyzer's adversarial tests,
the renamed fixture titles, the midway-write case and the docs are also later
than it. The coordinator's rerun on `c0b0338` (next section) covers all of
them and is the acceptance evidence; this section is history.

## Final coordinator acceptance at `c0b0338` (turn 8)

The coordinator ran the three commands below independently on the frozen
source `c0b03386a18f3bd4a367fc696c9463fce0df1d0a` with the pinned Node
24.22.0 (linux arm64) in an isolated environment (own `HOME`, proof and
profile folders, `DINKUS_E2E_ENV_FILE=/dev/null`), capturing the source
hashes before and after (stable), and supplied the result files for this
proof-only update. The commands, as this proof has listed them since turn 1:

```sh
# from live-journeys/, with the pinned Node 24.22.0 as NODE, isolated HOME/proof/profile
env -i HOME="$TMP_HOME" PATH="$PATH" DINKUS_E2E_ENV_FILE=/dev/null \
  DINKUS_E2E_PROOF="$TMP_HOME/proof" DINKUS_E2E_PROFILE="$TMP_HOME/profile" \
  "$NODE" --test runner/unit/journey-timing.test.mjs runner/unit/report-diagnostics.test.mjs
env -i HOME="$TMP_HOME" PATH="$PATH" DINKUS_E2E_ENV_FILE=/dev/null \
  DINKUS_E2E_PROOF="$TMP_HOME/proof" DINKUS_E2E_PROFILE="$TMP_HOME/profile" \
  "$NODE" --test runner/unit/*.test.mjs
"$NODE" proof/private-timing-20261107/benchmark.mjs \
  --base da61f2206486504eb4784571e6b15680328c5fc3 \
  --candidate c0b03386a18f3bd4a367fc696c9463fce0df1d0a --samples 30 \
  --out proof/private-timing-20261107/benchmark-results.json
```

### Full offline unit suite

| Figure | Value |
| --- | --- |
| Source | `c0b0338`, source hashes stable across the run ([unit-results.json](unit-results.json), which also lists every hashed file; its hashes for `pace.mjs`, `proof.mjs`, `steps.mjs`, the analyzer, the timing and diagnostics tests and the wrapper fixture equal `validation.json`'s and `git show c0b0338:<file>`, checked in turn 8) |
| Tests | 229 |
| Passed | 229 |
| Failed, cancelled, skipped, todo | 0, 0, 0, 0 |
| Suite wall time | 5,746 ms |
| Exit code | 0 |

The 229 include the fourteen timing cases (among them "a timing write that
stops midway…", "a retry in a new worker…", "a later worker keeps every
journey's timing…", now naming only allowlisted journeys) and the three
adversarial analyzer cases; all passed. No sandbox subprocess failure appeared
in the unchanged `gmail` and `proof` tests on the coordinator's host. The
suite's full output stays in the coordinator's task folder (237 lines, the
Node test reporter's per-test lines and totals); only its totals and hash
record are copied here, since the raw log is not needed and the record holds
no machine path.

### Overhead benchmark, 30 interleaved pairs

Script: `benchmark.mjs` at SHA-256
`d0a5f86dcb5877dd813866f44bff9995bc6a6d7c0ed68d34d67bb11f66f9d53f`, unchanged
across the run ([benchmark-manifest.json](benchmark-manifest.json)); base
`da61f22`, candidate `c0b0338` read from immutable Git objects; exit 0. The
raw results, with every per-sample microsecond figure, are copied as-is in
[benchmark-results.json](benchmark-results.json) (the file names no machine
path); a sanitized summary of the capture receipt (exit, wall and CPU seconds,
peak RSS; the receipt's `argv` left out because it names the coordinator's
workstation paths) is in [benchmark-capture.json](benchmark-capture.json).

| Workload | Calls per sample | Base median per call | Candidate median per call | Median delta | Per-call min to max across the 30 samples (base / candidate) |
| --- | --- | --- | --- | --- | --- |
| `paceStore` with room, no wait | 10,000 | 0.356 µs | 0.356 µs | +0.001 µs | 0.345 to 1.097 µs / 0.346 to 0.932 µs |
| Forced single sleep (fake clock) | 200 | 125.34 µs | 125.855 µs | +0.515 µs | 123.77 to 178.175 µs / 124.175 to 138.23 µs |
| Completed wrapped journey | 25 | 124.16 µs | 305.76 µs | +181.6 µs | 114 to 139.2 µs / 236.68 to 329.76 µs |

The first two deltas are within the sample-to-sample spread of either variant
(the no-wait p90 is 0.87 µs for the base and 0.84 µs for the candidate; the
forced-sleep min-to-max spread is 54 µs for the base and 14 µs for the
candidate); no improvement and no
measurable cost is claimed for them. The wrapper delta is real and is the
fact's publication: one report read and, for each of the two files, a write
to the temporary file and a rename, against a journey body that in a real run
is one to fifteen minutes. It is a small-fixture figure (the fixture's journey
body is empty, so the whole 306 µs is wrapper and file work on the
coordinator's disk), not live speed; it says the publication costs well under
a millisecond per journey on that machine and nothing about a run's time.

Work per sample, identical in every sample of both variants:

| Workload | Timers / delay | Base file work | Candidate file work |
| --- | --- | --- | --- |
| No wait | 0 / 0 ms in both | | |
| Forced single sleep | 200 / 12,050,000 ms in both | | |
| Wrapped journeys (25) | 0 / 0 ms in both | 100 writes, 0 reads, 0 renames, 0 unlinks | 150 writes, 25 reads, 50 renames, 0 unlinks |

So no timer, delay, network call (none bound; the static import check passed
for all three modules in both revisions) or unlink was added, and the only
new file work is the candidate's two temporary-file writes, two renames and
one read per published entry. The turn 7 publication check passed in every
sample: 30 base samples with no timing fact, 30 candidate samples each with
exactly 25 well-formed single-try entries, 750 entries in all
(`wrapper_samples_checked` in the results), each `{ unit: "ms", tries: [one
entry] }` with the eight producer keys in order.

### Portable local-browser producer and consumer proof

The coordinator also wrote and ran a portable 76-line script,
[portable/producer-consumer-proof.mjs](portable/producer-consumer-proof.mjs),
that drives actual Playwright 1.61.1 and a Chromium against a loopback
(`127.0.0.1`) fixture page with the production `browser.mjs`, `steps.mjs`,
`pace.mjs`, `proof.mjs`, the verdict reporter, `run-summary.mjs` and the
diagnostics analyzer, every one read from immutable Git objects at the named
commit (never the working tree) and hashed into
[portable/source-manifest.json](portable/source-manifest.json). Its thirteen
hashes equal `git show c0b0338:runner/<file>` for every file (checked in turn
8). Instructions and limits are in [portable/README.md](portable/README.md);
the exact command, from this folder, with the pinned Node, the existing
`runner/node_modules` and a Chromium binary:

```sh
env -i PATH=/usr/bin:/bin "$NODE_24_22_0" ./portable/producer-consumer-proof.mjs \
  --repo ../.. \
  --ref c0b03386a18f3bd4a367fc696c9463fce0df1d0a \
  --playwright ../../runner/node_modules \
  --chromium "$CHROMIUM"
```

It installs nothing, writes only under a fresh system temporary directory,
makes no request beyond the loopback fixture, and hands the analyzer an
explicitly synthetic selection receipt, so no GitHub, R2 or private read
happens. The existing manual diagnostic transport (`verify`, `fetch`) is never
called. The coordinator's run against `c0b0338`, copied as-is in
[portable/result.json](portable/result.json):

| Invocation | Run / journey verdict | Try | Body | `body_ms` | `pace_sleeps` | requested / measured / wall ms | Worker |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pass | PASS / PASS | 1 | returned, PASS | 1,925 | 1 | 1,224 / 1,226 / 1,226 | 0 |
| retry | PASS / FLAKY | 1 | threw, FAIL | 1,988 | 1 | 1,224 / 1,226 / 1,226 | 0 |
| retry | PASS / FLAKY | 2 | returned, PASS | 2,016 | 1 | 1,218 / 1,220 / 1,220 | 1 |

Both Playwright invocations and both analyzer calls exited 0 with empty
analyzer stderr. The seeded request log (100 requests 59 s old) caused one
real pacing sleep per try, and each body covers its sleep. The failed first
try's entry was retained beside the retry's, and Playwright ran the retry in a
different worker (index 1), so the entry crossed a real worker restart. The
analyzer's projection equalled the producer's fact (`assert.deepEqual`), and
neither the default public summary nor Playwright's stdout carried
`body_ms`, `pace_sleep` or the fact's name.

Limits: this is functional local-browser evidence of producer and consumer
agreement on a synthetic journey, not live-store performance, authenticated
behavior, interruption, disk failure, video or private-transport proof; the
disposable fixture alone enables one retry for its synthetic test, and the
production roster, selection, assertions and retry policy are unchanged. In an
earlier, non-portable run at `c0b0338` the coordinator's audit also noted that
the fact's write replaces each of `report.json` and `PROOF.md` atomically but
not as one transaction across both, so a report that succeeds and a Markdown
that fails can leave a valid report newer than its `PROOF.md`; the README's
"Private timing" section states the per-file behavior, and nothing reads the
Markdown back. No screenshot, browser profile or raw log is copied into this
proof.

### Files added in turn 8 and what each is

| File | What it is | SHA-256 of the copy here |
| --- | --- | --- |
| `benchmark-results.json` | The final benchmark's output, as written by `benchmark.mjs --out` | `15951da0…8150` |
| `benchmark-manifest.json` | Candidate, script hash, script unchanged, exit code | `f686b8eb…106f` |
| `benchmark-capture.json` | Sanitized summary of the capture receipt | `da20daa4…90d2` |
| `unit-results.json` | The suite's head, exit, hash record and totals | `4510abe0…173a` |
| `portable/producer-consumer-proof.mjs` | The portable local-browser script | `506f1b9e…1b76` |
| `portable/README.md` | Its instructions and limits | `0e8386be…d575` |
| `portable/result.json` | Its run against `c0b0338` | `28b73ecd…f826` |
| `portable/source-manifest.json` | The import closure it hashed at `c0b0338` | `8846b20c…2515` |

This worker's tool surface can read but not copy or hash files outside its
workspace, so each copy was transcribed from the coordinator's file as read
and the hashes above are of the copies in this folder (full values in
`validation.json`); the raw capture receipt's own SHA-256 is therefore not
recorded, and the coordinator can add it. The copies were checked after
writing: every JSON parses, no file names a machine path, and the hash values
they carry equal the frozen commit's files as stated above.

### What the final results establish, and what they do not

Primary acceptance holds on the coordinator's evidence: the private metrics
are produced in the documented shape and read back by the existing consumer
(229 of 229 offline tests, the local-browser proof with a real retry across
workers), existing behavior is unchanged (equal timers, delays and outcomes;
the public summary and console show nothing new), a failed publication leaves
the report whole (the midway-write case), and the publication's cost is a few
hundred microseconds of file work per journey in a small fixture with no
added timer, wait, network call or unlink. Not established, and not claimed:
any live observed performance, any attribution of a real run's time (that
needs a future, separately authorized full run and read; the one approved
diagnostics read is consumed), and anything the portable proof's limits above
exclude. Nothing is deployed.

No live run, store, mail, credential, private report or external request was
made or requested. No push, PR, review or merge by this worker.
