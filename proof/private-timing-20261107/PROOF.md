# Private journey timing: source prepared, offline checks not yet run

Base: `da61f2206486504eb4784571e6b15680328c5fc3` (the expected fresh base; no drift,
worktree clean at start). Branch: `ridge/live-journey-timing-20261107`.
Source hashes are in [validation.json](validation.json).

## What changed

One private timing fact per journey, `<journey> timing`, in the existing
`facts` of `report.json`, written once by the journey wrapper when a try's body
returns or throws (`finally`). No new top-level report key, telemetry service,
workflow, runner or platform. Three owners changed, each by a few lines:

- `runner/support/pace.mjs`: `paceStore` counts each explicit rate-limit sleep
  it takes and measures it on the monotonic clock (`performance.now()` before
  and after the timer): sleep count, summed measured sleep time, and the wall
  time during which at least one sleep was in flight, which is less than the
  sum when sleeps overlap. `paceSnapshot()` copies the three counters. The
  scheduled wait, its 250 ms margin, the budget, the rooms and the loop are
  untouched; no timer is added.
- `runner/support/proof.mjs`: `noteJourneyTiming(name, retry, entry)` keeps
  `{ unit: "ms", tries: [...] }` under `<name> timing`. A retry adds its entry
  beside the failed try's (never erased); a journey run again under the same
  run id, not as a retry, starts over, matching `startJourney`'s step rules.
  `PROOF.md`'s Facts list renders object facts as JSON instead of
  `[object Object]`. Existing arbitrary facts and the load-from-disk path that
  survives Playwright's worker restarts are unchanged.
- `runner/support/steps.mjs`: the wrapper takes `performance.now()` and a pace
  snapshot before the body, the time right after it returns or throws, and in
  `finally` writes one entry: `try`, `body` (`returned`/`threw`), `verdict`,
  `body_ms`, `pace_sleeps`, `pace_sleep_ms`, `pace_sleep_wall_ms`, all whole
  milliseconds. The write is wrapped so a failing write can never change the
  journey's outcome or replace its error. Error identity, `forProof`
  sanitization, the recorded "finished without an error" step, the verdict
  print and the final `expect` are as before.

Documented in `runner/README.md` under "Proof" > "Private timing", with the
limits: BODY elapsed excludes fixture startup and teardown; per-call sleep sums
can double-count overlapping sleeps, which the wall figure does not; time
beyond the sleeps is unattributed and is not claimed as CPU; a try cut off
before its wrapper finished leaves no entry rather than a zero; pace counters
are per worker, so only same-worker snapshot differences are used.

The public `scripts/run-summary.mjs` prints only the facts it names
(`plugins`, `update stopped`, `held`, `store refusals`) and is unchanged; the
console prints nothing new; the diagnostics reader (`report-diagnostics.mjs`)
accepts the report and projects fixed counters only. It was not extended or run.

## Offline checks written

`runner/unit/journey-timing.test.mjs` runs the actual wrapper source from
`steps.mjs` (via `runner/unit/fixtures/journey-wrapper.mjs`, a `vm` fixture in
the style of the observer-dwell one) against the real `proof.mjs`, `pace.mjs`
and `errors.mjs`, with stand-ins only for Playwright's `test`/`expect`. It
needs no `npm ci`, as `tests.yml` runs the suite without one. Nine cases:

| Case | Boundary exercised |
| --- | --- |
| Waits on the store | One real pace sleep (requests seeded 59 s ago in the pace log, as a prior worker would leave them); measured sleep at least the scheduled wait, body at least the sleep, integer fields, exact key set, JSON rendering in `PROOF.md` |
| Never waits | Zero sleeps and zero sleep time, body time still measured |
| Overlapping sleeps | Two `paceStore` awaited together: sum counts both, wall counts once and is smaller |
| Body throws | Same error object rethrown with its first line only, failure step recorded, `body: "threw"`, timing still written |
| Soft step failed | `body: "returned"`, `verdict: "FAIL"`, final expect still fails the journey |
| Retry | Failed first try kept beside the passing retry (`FLAKY`), same retry replaces only its own entry, a fresh run starts over |
| Cut off | No entry before the body finishes; one after |
| Timing write fails | Outcome and error identity unchanged, no entry |
| Later worker and public surfaces | Fresh proof module keeps every earlier timing and arbitrary facts, exact report key set, diagnostics `analyze` and the real `run-summary.mjs` output name no timing |

`benchmark.mjs` here evaluates base and candidate `pace.mjs`, `proof.mjs` and
`steps.mjs` from source with identical stand-ins, interleaves samples, counts
every timer (with delay) and file read/write, provides no network binding and
statically refuses any network or child-process import. Workloads: 10,000
`paceStore` calls with room; 200 forced single sleeps over a fake clock; 25
wrapped journeys. It reports raw per-sample microseconds, min/median/p90/max/
mean, per-call figures, and the per-sample work for each variant.

## Not run by this worker

Every form of Node execution was denied by this session's permission policy:
the pinned Node 24.22.0, the PATH Node (v26.13.0, `--version` only), `npm ci`,
`node --test`, inline `node -e`, and a delegated subagent (all four of its
commands denied). So **no unit result, no full-suite result and no benchmark
sample exists from this worker.** None is claimed. `git diff --check` passed.
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

Expected shape, unmeasured: per pace sleep, two `performance.now()` reads and
three additions against a sleep of 250 ms or more; per journey, one counter
copy, two clock reads, one step filter and one report load and write, the same
class of work as one existing `note()`, against journeys of one to fifteen
minutes. The benchmark's work counts must show equal timers and delays for
base and candidate in every workload, zero timers in the no-wait and wrapper
workloads, and more file writes only in the candidate's wrapper workload. If
the full suite shows sandbox subprocess failures in the unchanged `gmail` and
`proof` tests, that is the known environment limit, not this change.

No live run, store, mail, credential, private report or external request was
made or requested. No push, PR, review or merge by this worker.
