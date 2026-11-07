# Source-only report diagnostics

Prepared in the assigned `dinkuskit/live-journeys` mount on
`ridge/live-journey-diagnostics-20261107`. Clean starting HEAD matched the exact
required base `9d0302c4264412d5c782a44d976ab56c681f0532`; no base drift, child writer,
extra worktree or other repository change. The implementation source is commit
`6b350ed0080838eb9ff80c81b996cf1f9e13a24d`; this acceptance update changes only
documentation and proof. [validation.json](validation.json) binds each changed
source file by SHA-256. The final handoff supplies its resolved commit ID.

The manual-only, main-only workflow verifies exact run ownership via GitHub
metadata, then fetches only the fixed selected R2 `report.json`, bounded to
1 MiB plus an overflow byte. Existing secret references are scoped to the fetch
step. AWS receives a newly constructed allowlisted environment. The separate
analyzer emits only literal journey names, fixed link-failure codes and bounded
integer record counts. Unknown schema/journey/identity fails closed. Private
AWS output is discarded even on error. The [consumer contract](../../references/report-diagnostics.md)
records binding, boundaries and the approval gate.

No live workflow or journey/assertion/support source, default public summary,
credentials, account configuration or auth mode changed. This worker made no
AWS/GitHub request, store call, actual private-proof read,
installed runtime registration, push, PR, review submission, merge or dispatch.
The coordinator separately made only the public metadata check described below.

## Offline checks

Original worker Node checks used the supplied **v24.22.0** Linux ARM64 executable, `env -i`,
task-local `/tmp/diagnostics-validation-20261107` HOME/proof/profile and
`DINKUS_E2E_ENV_FILE=/dev/null`. No dependency install was needed. Test transport
uses fabricated metadata and an injected AWS stub, never real credentials.

- `node --test --test-isolation=none runner/unit/report-diagnostics.test.mjs`:
  **8 passed, 0 failed, 0 skipped**. Covers fixed categories, combined failures,
  secrets/PII/URLs in unused fields and error headings, spoofed journey names,
  malformed/oversized input, unknown schemas, report identity mismatch,
  malicious selectors, symlink rejection, credential-free analyzer, and exact
  transport/environment constraints. Success and failure transport output is
  never forwarded. The CLI's exported entry point is captured in-process because
  this sandbox blocks Node child spawning.
- Separate shell-launched CLI probes checked **exact stdout/stderr and exit
  codes** for a synthetic private-bearing report and a path-injection selector:
  passed. No synthetic canary/URL/email/order data appeared in output.
- Accepted coordinator rerun: canonical `node --test runner/unit/*.test.mjs`
  with Node **v24.22.0**: **211 passed, 0 failed, 0 skipped, 0 cancelled**.
  This worker inspected the supplied safe log's totals and hashed it:
  `/home/bobby-xps/Work/repos/saari-co/x-api/runs/live-journey-performance-runs/20261106/diagnostics/full-unit.log`.
  Its SHA-256 is recorded in `validation.json`.
- Historical local canonical attempt: exit 1, 24 file passes and two file
  failures (`gmail.test.mjs`, `proof.test.mjs`). Separate diagnosis yielded
  14 test passes and 9 failures with `spawnSync node EPERM`. These sandbox
  subprocess failures are retained as history, superseded for acceptance by
  the coordinator's full-suite pass. No existing test was weakened or edited.
- `git diff --check`: passed. Manual source review checked fixed targets,
  selector validation before transport, stream/file caps, scoped credentials,
  discarded AWS output, literal output projection and unchanged live sources.

Logs remain local under `/tmp/diagnostics-validation-20261107`; their hashes are
in `validation.json`. No raw fixture report is committed. Existing reported
baseline/candidate/rerun outcomes are task context, not evidence independently
read by this worker. The exact private Manage products failure remains unknown.
The parser is derived from the current `linkProblems` source, not that report.

## Coordinator acceptance evidence

The coordinator reports an independent source/privacy review with no actionable
defect. This is not a substitute for the pending external repository reviews.
The coordinator's public GitHub API check of run `42337050608`, attempt `1`,
confirmed `id=42337050608`, `run_attempt=1`, `status=completed`,
`path=.github/workflows/live-journeys.yml`, and repository
`dinkuskit/live-journeys`. This verifies the expected API shape without reading
private R2 proof; the check was reported by the coordinator, not rerun here.

## Remaining gates

Coordinator owns push/PR, CI and repository-required external reviews. After
review, the coordinator will request explicit owner approval covering both the
reviewed merge and the first read of run `42337050608`, attempt `1`. That single
authorization can cover both actions without a second confirmation; it grants
no broad future-read authority. No approval or activation is claimed here.
The hosted runner's AWS path/availability, R2 binding/readability and actual
selected report remain untested. A binding mismatch fails closed; it is not
permission to change credentials or account settings.
