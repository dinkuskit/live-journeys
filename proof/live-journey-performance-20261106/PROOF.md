# Problems polling: bounded offline candidate

Source base: `39723f974d5ed7fda703ea11cec0cc20153b235f`.
Candidate source commit: `f00d29324a268282a512d302180e8ed74f3f5b1d`.
Branch: `ridge/live-journey-performance-20261106`.
Classification: offline operation-count improvement demonstrated; live performance and full verification remain partial.

## Change and rationale

Problems formerly reloaded the current Orders page after every unsuccessful
30-second wait, then `testOrders()` opened Orders again before scanning all pages.
The candidate removes only that reload. `testOrders()` still calls `openAdmin()`,
which calls `openStoreAdmin()`, whose first operation is `page.goto(url)`.
The initial navigation and readiness check, every full scan, pagination,
30-second waits, configured completion deadline, and later checkout-status and
order-ID checks remain. No caching, parallelism, request-limit changes, or changes
to test selection, retry policy, security, redaction or proof output.

Rejected: stopping the `numberOf()` scan after five rows. No source contract makes
page order numeric-newest order (the README says orders are listed by order ID).
The full list, status filtering, numeric descending sort and newest-five
selection therefore remain unchanged. Reusing an earlier scan for `openOrder()`
would introduce stale page/order assumptions; that is outside this candidate.
`runner/support/orders-admin.mjs` is byte-for-byte unchanged, SHA-256
`fd8a6537971032a93273190bf1266e92dc113c1ec150862a1ce1040ad69cb2d8`.

## Comparison and correctness

Primary metric: explicit admin navigations in the existing Problems polling
block. Accept only fewer redundant navigations with identical returned order
identities, read counts, failure messages and scheduled waits for each fixture.

`benchmark.mjs` executes the actual polling block extracted from the immutable
base and candidate source. Six cases run ten interleaved pairs each (60 pairs,
120 executions); execution order alternates. Input baseline content is SHA-256
checked. `benchmark-results.json` records the results and candidate source hash.

| Workload | Base navigations | Candidate navigations | Full scans on each side |
| --- | ---: | ---: | ---: |
| Immediate arrival | 2 | 2 | 1 |
| Arrival on third poll | 6 | 4 | 3 |
| Missing through 90-second fixture deadline | 8 | 5 | 4 |
| Arrival at deadline | 8 | 5 | 4 |
| Unordered rows, both statuses, more than five new orders | 2 | 2 | 1 |
| Scan failure on third observation | 6 | 4 | 3 |

The third-poll case removes two of six explicit navigations (33.3%); there is
no gain when the first observation succeeds. Generally it removes N-1 reloads
for N successful polling observations. These counts exclude pagination and
subrequests, which the fixture does not execute. Virtual elapsed times record
the unchanged waits; they are not measurements of live latency.

Six new offline tests pass, covering delayed arrival, arbitrary ordering/all
new orders, missing orders, deadline arrival, propagated scan failure and slow
scans consuming the deadline. The harness executes the real source block in a
VM with an injected clock and scan boundary; it imports no live browser,
settings, credentials or inbox. It stubs the unchanged `testOrders()` boundary,
so this is not browser/pagination or service correctness proof. Transient
failures unique to the removed reload naturally disappear; failures in the
retained scan are still propagated. Real navigation timing can change which
observation sees an asynchronously arriving order, so live proof is required.

## Commands and environment

Run from the mounted repository root. Local runtime: Node 24.22.1 on Linux
7.3.0-3.1-omarchy, aarch64, ARM Cortex-X925. CI specifies Node 24.22.0; the patch
version and platform differ. No dependencies installed, browser launched or
live requests made. No build/cache warming; only source and synthetic rows.
Lockfile SHA-256: `51a538a6154719d5bebb4393b607303a175be28d18518b605e3dfaa47637f397`.

```sh
git show 39723f974d5ed7fda703ea11cec0cc20153b235f:runner/tests/problems.spec.mjs > /tmp/live-journey-performance-baseline.mjs
node proof/live-journey-performance-20261106/benchmark.mjs /tmp/live-journey-performance-baseline.mjs
node runner/unit/orders-poll.test.mjs
DINKUS_E2E_ENV_FILE=/tmp/live-journey-perf-no-settings DINKUS_E2E_PROOF=/tmp/live-journey-perf-proof DINKUS_E2E_PROFILE=/tmp/live-journey-perf-profile node --test runner/unit/*.test.mjs
node --check runner/tests/problems.spec.mjs
git diff --check
```

Each measured command used the performance skill's `scripts/capture.py --out
<new directory> -- <argv>` helper. A harmless exit-7 preflight preserved exit 7
and separated stdout/stderr. `capture-receipts.json` retains metric values and
normalizes only the Node executable path. Raw outputs remain under the
`/tmp/live-journey-perf-*` paths on the worker. Benchmark wall time is harness
execution overhead, not an estimate of journey savings; monetary cost unknown.

- Benchmark: exit 0, wall 0.09051192799961427 s, user 0.08764899999999999 s,
  system 0.049804999999999995 s, max RSS 89804 KiB.
- Targeted six tests: exit 0, wall 0.036344519998237956 s,
  user 0.057581 s, system 0.035901999999999996 s, max RSS 68064 KiB.
- Full offline suite: exit 1, 22/24 files pass. `gmail.test.mjs` and
  `proof.test.mjs` fail at their child-process checks with `spawnSync ... EPERM`
  (some callers catch the error and subsequently assert on empty output).
  Direct diagnostics confirm eight child-process cases fail in Gmail tests
  and one in proof tests. No test was skipped or weakened to produce a pass.
  Wall 0.4588354969964712 s, user 1.302702 s, system 0.60258 s,
  max RSS 79520 KiB. This is incomplete verification, not a clean suite result.
- Syntax and diff whitespace checks pass.

Initial Node 26.13.0 attempt also hit default proof/profile output paths outside
the writable scope. Subsequent runs use task-local temporary settings/output
paths and Node 24.22.1. An initial benchmark using `execFileSync('git', ...)`
hit the same subprocess restriction; the final benchmark instead reads a
baseline file produced by an explicit Git command and validates its hash.
Those attempts are retained in temporary capture outputs, not treated as
comparable successful measurements. No privilege widening attempted.

## Handoff and limits

Local HEAD and local `origin/main` initially matched the expected base.
`git ls-remote origin refs/heads/main` could not resolve github.com, so remote
freshness remains unverified. The source commit was created despite the Git
command reporting read-only `packed-refs.lock` / `rr-cache` errors; its identity
and three-file contents were independently verified with Git afterward.

Coordinator-reported baseline `42335784911` was running at handoff; its outcome,
inputs, store versions and proof have not been independently read by this
worker. Historical run `41310449365` (head `6f505b9`) reportedly had 2380 seconds
in Run journeys and 2416 seconds overall. It is context, not a comparable
measurement of this candidate.

Next, the coordinator should verify remote base/source identity, rerun the
complete offline suite in the supported CI environment, non-force push this
branch and open a PR to main. After the existing baseline finishes and beta is
idle, a candidate run through the existing Live journeys workflow can use the
same full `@running` selection, beta/hold/update_store/video inputs and store
versions as the baseline. Bind its exact head and run ID/attempt. Do not queue
a duplicate or run locally. If the baseline updates the store, resolve version
comparability before interpreting timing; never downgrade it for this test.
Compare whole-step and Problems timing, full journey results, store refusals,
and all required private proof through the authorized coordinator. One pair
can establish live correctness but supports only a limited timing conclusion.
Do not publish raw private proof or claim a full-runtime improvement from these
synthetic operation counts. Retain the 100-request/min guard and five-minute
background-check coverage.

No live workflow was dispatched. CI, comprehensive OpenClaw and native
ClawSweeper evidence for the exact reviewed revision are still required.
This candidate is not review-ready, and no merge is authorized.

## Pinned-runtime acceptance follow-up

The hosted offline workflow pins Node `24.22.0`. Read-only inspection of the
existing mise installations found Node `24.22.1` and `26.13.0`; the `24` and
`24.22` aliases resolve to `24.22.1`. Executing that installed binary with
`--version` returned `v24.22.1`. The exact `24.22.0/bin/node` executable is
absent. No runtime was installed or global setting modified.

No new unit or benchmark run was attempted: the required runtime is missing.
Existing Node 26 results remain noncanonical history; prior Node 24.22.1
results also do not satisfy the exact Node 24.22.0 acceptance check. The
coordinator must provision the pinned Node 24.22.0 runtime before rerunning
`node --test runner/unit/*.test.mjs` and the recorded offline benchmark with
`DINKUS_E2E_ENV_FILE=/dev/null` and task-local writable HOME, proof and profile
paths. Dependency availability under that exact runtime remains unverified.
The candidate source is unchanged, including the initial Orders open and its
`ordersListed` behavior. No live workflow, push, PR or review was initiated.
