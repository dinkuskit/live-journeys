# Problems polling: accepted offline candidate

Base: `39723f974d5ed7fda703ea11cec0cc20153b235f`.
Source candidate: `f00d29324a268282a512d302180e8ed74f3f5b1d`.
Branch: `ridge/live-journey-performance-20261106`.
Status: pinned-runtime offline validation passed; live comparison and exact-head
CI/comprehensive OpenClaw/native ClawSweeper reviews pending. Not review-ready.

## Change and preserved behavior

Problems previously reloaded Orders after each unsuccessful 30-second wait;
`testOrders()` then opened Orders again before scanning every page. The candidate
removes only that intervening reload. The initial Orders open and `ordersListed`
readiness check remain, as do the fresh navigation and full scan per observation,
pagination, waits, completion deadline, checkout-status and order-ID assertions.
No changes to parallelism, request caps, security, redaction, retry policy, proof
output, five-minute background checks, or the full `@running` selection.

Stopping after five rows was rejected: no source contract guarantees numeric
newest-first page order. Status filtering, numeric sort and newest-five selection
remain. Reusing an earlier scan for `openOrder()` was also excluded.
`runner/support/orders-admin.mjs` remains unchanged, SHA-256
`fd8a6537971032a93273190bf1266e92dc113c1ec150862a1ce1040ad69cb2d8`.

## Canonical offline acceptance

The coordinator ran Node **24.22.0**, installed locked dependencies (`npm ci`,
three packages, unchanged lockfile), and used `/dev/null` for
`DINKUS_E2E_ENV_FILE` with fresh task-local HOME, proof and profile directories.
This worker inspected the safe logs and verified the copied artifacts' hashes.

| Check | Accepted result |
| --- | --- |
| `node --test unit/*.test.mjs` from `runner/` | 189 passed; zero failures, cancellations, skips or todo |
| Playwright `--list --grep @running` | 14 tests in 14 files; listing only |
| Pinned-Node deterministic comparison | Six cases × ten interleaved pairs = 60 pairs / 120 executions |
| Source binding | Problems source SHA-256 `6406dabc859d55192e70e189b2ee63c06c6904189124e16b3f4becf8dc18dd41` |

Canonical artifacts are [canonical-validation.json](canonical-validation.json),
[canonical-benchmark.json](canonical-benchmark.json) and
[candidate-roster.log](candidate-roster.log). The validation summary records the
unit raw-log hash, isolated environment and dependency evidence without private
absolute paths. The raw unit log remains coordinator-held.

## Measured scope and correctness

`benchmark.mjs` extracts the real polling block from the immutable base and
candidate, verifies the baseline hash and alternates execution order. It asserts
equal returned identities, read counts, scheduled waits and failure behavior.
The JSON retains the final representative counts after all ten pairs per case.

| Workload | Base navigations | Candidate navigations | Scans each |
| --- | ---: | ---: | ---: |
| Immediate arrival | 2 | 2 | 1 |
| Third-poll arrival | 6 | 4 | 3 |
| Missing through fixture deadline | 8 | 5 | 4 |
| Arrival at fixture deadline | 8 | 5 | 4 |
| Unordered rows / statuses / more than five new orders | 2 | 2 | 1 |
| Third-observation scan failure | 6 | 4 | 3 |

Six targeted tests also cover slow scans consuming the deadline. The harness
stubs the unchanged scan boundary; it does not execute browser pagination or
service requests. Counts exclude pagination/subrequests; virtual elapsed time
reflects unchanged waits, not live latency. Third-poll navigation count drops
33.3%; immediate success has no gain. Removed-reload-only failures disappear;
retained scan failures propagate. Real timing may change which observation sees
an arriving order. **No live speedup is established.**

## Resolved attempts and remaining handoff

Earlier Node 26/24.22.1 attempts encountered output-path/subprocess restrictions;
the exact runtime was initially absent from mise, and remote lookup failed.
These gaps are resolved by the coordinator's pinned-runtime acceptance and fresh
fetch of the unchanged base. Existing events, capture receipts and historical
benchmark results remain as chronology, not canonical acceptance. The coordinator
also reports an independent source review with no actionable issues; this does
not substitute for the required review rails.

Next owner: coordinator for non-force push/PR, exact-head CI and both reviews,
and a controlled full-roster live comparison through the existing workflow when
beta is idle. Match baseline inputs/store versions and bind exact head/run ID;
resolve version comparability without downgrading. Compare full results, Problems
and whole-step timing, refusals and authorized private proof. One live pair offers
limited timing evidence. This worker dispatched no live run. No merge authorized.
