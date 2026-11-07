# Private journey timing: source prepared, offline checks not yet run

Base: `da61f2206486504eb4784571e6b15680328c5fc3` (the expected fresh base; no drift,
worktree clean at start). Branch: `ridge/live-journey-timing-20261107`.
Source hashes are in [validation.json](validation.json). Two turns of source
work: the first commit (`c315f28`) added the fact; the second answers the
read-only design audit below.

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
  `[object Object]`. Existing arbitrary facts and the load-from-disk path that
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
pace counters are per worker, so only same-worker snapshot differences are used.

The public `scripts/run-summary.mjs` prints only the facts it names
(`plugins`, `update stopped`, `held`, `store refusals`) and is unchanged; the
console prints nothing new; the diagnostics reader (`report-diagnostics.mjs`)
accepts the report and projects fixed counters only. It was not extended or run.

## Design audit (turn 2) and where each point lands

| Audit point | Source | Offline check |
| --- | --- | --- |
| A timing write failure never fails a passing body or replaces the thrown error | `steps.mjs` `finally` wraps the write in its own `try` | "a timing write that fails…" |
| `startJourney` at retry 0 under the same run id clears stale timing in its existing write | `proof.mjs` `startJourney` deletes `<name> timing` when `retry` is 0 | "…a rerun clears the earlier entry as it starts…" |
| Retry tries keep distinct identities across a process restart | `noteJourneyTiming` loads the report before adding `try: retry + 1` | "a retry in a new worker…" (fresh proof module) |
| A killed worker leaves a missing metric, never a fabricated 0 or pass | Nothing is written before `finally`; the reporter's unrecorded-failure paths touch no timing | "…a cut-off try leaves none" |
| `--list` writes nothing | Reporter's existing `listOnly` guard; module load and `paceSnapshot()` write nothing | Same test: module reload and snapshot leave `report.json` byte-identical |
| `Date.now()` pacing decisions unchanged, monotonic clock for elapsed | `paceStore`'s wait arithmetic untouched; only `performance.now()` around the timer | "a wall-clock jump during a sleep…" (hour jump mid-sleep) |
| Requested vs completed sleep, summed overlaps may exceed wall elapsed | `pace_sleep_requested_ms` beside measured `pace_sleep_ms`; `pace_sleep_wall_ms` | First test (requested vs measured bounds); overlap test asserts sum > `body_ms` >= wall |
| Body boundary excludes fixtures, `startJourney`, the write; includes body-owned screenshots and cleanup | `from` taken after `startJourney`, `to` before the write | "the body's span…" (200 ms stalls on either side, screenshot and `finally` inside) |
| Passed, soft-failed and thrown bodies; retry plus reload; private-only output | As in turn 1 | Existing tests, kept |

## Offline checks written

`runner/unit/journey-timing.test.mjs` runs the actual wrapper source from
`steps.mjs` (via `runner/unit/fixtures/journey-wrapper.mjs`, a `vm` fixture in
the style of the observer-dwell one) against the real `proof.mjs`, `pace.mjs`
and `errors.mjs`, with stand-ins only for Playwright's `test`/`expect`. It
needs no `npm ci`, as `tests.yml` runs the suite without one. Thirteen cases:

| Case | Boundary exercised |
| --- | --- |
| Waits on the store | One real pace sleep (requests seeded 59 s ago in the pace log, as a prior worker would leave them); requested within the scheduled wait, measured at least requested less 50 ms of timer-clock skew, body at least the sleep, integer fields, exact key set, JSON rendering in `PROOF.md` |
| Never waits | Zero sleeps, zero requested and measured time, body time still measured |
| Overlapping sleeps | Two `paceStore` awaited together: sum counts both and exceeds `body_ms`, wall counts once, is smaller and within `body_ms` |
| Wall-clock jump | `Date.now` jumps an hour while a sleep's timer runs: measured sleep and body stay at the real second; pacing then waits for nothing, as the wall clock says |
| Body throws | Same error object rethrown with its first line only, failure step recorded, `body: "threw"`, timing still written |
| Soft step failed | `body: "returned"`, `verdict: "FAIL"`, final expect still fails the journey |
| Body boundary | `startJourney` and the timing write each hold the thread 200 ms; a step's 30 ms screenshot and a 20 ms `finally` sit inside; `body_ms` lands between |
| Retry | Failed first try kept beside the passing retry (`FLAKY`), kept through the retry's start, same retry replaces only its own entry, a fresh run starts over |
| Cut off and rerun | A finished entry, then module reload and snapshot write nothing; a rerun's start clears the entry; nothing appears while the body is held, however many steps it records; one entry after |
| Timing write fails | Outcome and error identity unchanged, no entry |
| Retry in a new worker | Fresh proof module loads the failed try's entry from disk and adds try 2 beside it, byte-equal try 1 |
| Later worker and public surfaces | Fresh proof module keeps every earlier timing (both Free shipping tries) and arbitrary facts, exact report key set, diagnostics `analyze` and the real `run-summary.mjs` output name no timing |

`benchmark.mjs` here evaluates base and candidate `pace.mjs`, `proof.mjs` and
`steps.mjs` from source with identical stand-ins, interleaves samples, counts
every timer (with delay) and file read/write, provides no network binding and
statically refuses any network or child-process import. Workloads: 10,000
`paceStore` calls with room; 200 forced single sleeps over a fake clock; 25
wrapped journeys. It reports raw per-sample microseconds, min/median/p90/max/
mean, per-call figures, and the per-sample work for each variant. It is
unchanged by turn 2 and reads the candidate from the working tree.

## Not run by this worker

In both turns, every form of Node execution was denied by this session's
permission policy: the pinned Node 24.22.0 (`--version`, `--check`, `--test`,
with and without an isolated `env -i` environment), the PATH Node, `npm ci`,
inline `node -e`, and in turn 1 a delegated subagent. So **no unit result, no
full-suite result and no benchmark sample exists from this worker.** None is
claimed, and the turn-2 test file has not even been syntax-checked by a
parser; it was proof-read only. `git diff --check` passed in both turns.
Primary acceptance (correct private metrics with behavior unchanged, and
negligible measured overhead) rests on the coordinator's independent run:

```sh
# from live-journeys/, with the pinned Node 24.22.0 as NODE, isolated HOME/proof/profile
env -i HOME="$TMP_HOME" PATH="$PATH" DINKUS_E2E_ENV_FILE=/dev/null \
  DINKUS_E2E_PROOF="$TMP_HOME/proof" DINKUS_E2E_PROFILE="$TMP_HOME/profile" \
  "$NODE" --test runner/unit/journey-timing.test.mjs
env -i HOME="$TMP_HOME" PATH="$PATH" DINKUS_E2E_ENV_FILE=/dev/null \
  DINKUS_E2E_PROOF="$TMP_HOME/proof" DINKUS_E2E_PROFILE="$TMP_HOME/profile" \
  "$NODE" --test runner/unit/*.test.mjs
"$NODE" proof/private-timing-20261107/benchmark.mjs \
  --base da61f2206486504eb4784571e6b15680328c5fc3 --samples 30 \
  --out proof/private-timing-20261107/benchmark-results.json
```

The timing test takes about five seconds of real timers (four seeded sleeps of
about 1.25 s each) and holds the thread for 0.4 s in the boundary case. Its
time bounds leave 50 to 180 ms of headroom for a loaded machine; a bound that
trips under heavy load is a test-tolerance matter, not a metric defect, and
the assertion message prints the figure that tripped it.

Expected shape, unmeasured: per pace sleep, two `performance.now()` reads and
four additions against a sleep of 250 ms or more; per journey, one counter
copy, two clock reads, one step filter and one report load and write, the same
class of work as one existing `note()`, against journeys of one to fifteen
minutes; per `startJourney`, one property delete. The benchmark's work counts
must show equal timers and delays for base and candidate in every workload,
zero timers in the no-wait and wrapper workloads, and more file writes only in
the candidate's wrapper workload. If the full suite shows sandbox subprocess
failures in the unchanged `gmail` and `proof` tests, that is the known
environment limit, not this change.

No live run, store, mail, credential, private report or external request was
made or requested. No push, PR, review or merge by this worker.
