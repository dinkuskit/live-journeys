# Source-only report diagnostics

Prepared in the assigned `dinkuskit/live-journeys` mount on
`ridge/live-journey-diagnostics-20261107`. Clean starting HEAD matched the exact
required base `9d0302c4264412d5c782a44d976ab56c681f0532`; no base drift, child writer,
extra worktree or other repository change. The source is in the commit carrying
this record; [validation.json](validation.json) binds each changed source file
by SHA-256. The final handoff supplies its resolved commit ID.

The manual-only, main-only workflow verifies exact run ownership via GitHub
metadata, then fetches only the fixed selected R2 `report.json`, bounded to
1 MiB plus an overflow byte. Existing secret references are scoped to the fetch
step. AWS receives a newly constructed allowlisted environment. The separate
analyzer emits only literal journey names, fixed link-failure codes and bounded
integer record counts. Unknown schema/journey/identity fails closed. Private
AWS output is discarded even on error. The [consumer contract](../../references/report-diagnostics.md)
records binding, boundaries and the approval gate.

No live workflow or journey/assertion/support source, default public summary,
credentials, account configuration or auth mode changed. No AWS/GitHub request,
store call, actual private-proof read, installed runtime registration, push, PR,
review submission, merge or dispatch was performed.

## Offline checks

All Node checks used the supplied **v24.22.0** Linux ARM64 executable, `env -i`,
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
- Canonical `node --test runner/unit/*.test.mjs`: **exit 1**, 24 file passes and
  two file failures (`gmail.test.mjs`, `proof.test.mjs`). This is **not a full
  suite pass**. Separate diagnostic execution of those unchanged files produced
  14 test passes and 9 failures, with `spawnSync node EPERM` in the existing
  subprocess checks, matching the previously recorded workspace limitation.
  No existing test was weakened or edited. Coordinator/CI must run the full
  canonical suite in a qualified environment before acceptance.
- `git diff --check`: passed. Manual source review checked fixed targets,
  selector validation before transport, stream/file caps, scoped credentials,
  discarded AWS output, literal output projection and unchanged live sources.

Logs remain local under `/tmp/diagnostics-validation-20261107`; their hashes are
in `validation.json`. No raw fixture report is committed. Existing reported
baseline/candidate/rerun outcomes are task context, not evidence independently
read by this worker. The exact private Manage products failure remains unknown.
The parser is derived from the current `linkProblems` source, not that report.

## Remaining gates

Coordinator owns the resolved-head handoff, qualified full-suite run, push/PR,
CI and repository-required reviews. Owner approval after the reviewed PR is
required before any workflow dispatch/private-proof access. The R2/GitHub
binding, AWS binary availability on the hosted runner, actual metadata schema
and actual selected report have **not** been tested live. A binding mismatch
fails closed; it is not permission to change credentials or account settings.
