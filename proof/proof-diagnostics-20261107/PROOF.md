# Source-only report diagnostics

Prepared against base `9d0302c4264412d5c782a44d976ab56c681f0532`.
Implementation commit: `6b350ed0080838eb9ff80c81b996cf1f9e13a24d`;
accepted validation update: `6e095a6bf1a9e6d183750826635356adeb4dc4e5`.
[validation.json](validation.json) records source and validation-log SHA-256 hashes.

The manual-only, main-only workflow verifies exact run ownership via GitHub
metadata, then fetches only the fixed selected R2 `report.json`, bounded to
1 MiB plus an overflow byte. Existing secret references are scoped to the fetch
step. AWS receives a newly constructed allowlisted environment. The separate
analyzer emits only literal journey names, fixed link-failure codes and bounded
integer record counts. Unknown schema/journey/identity fails closed. Private
AWS output is discarded even on error. The [consumer contract](../../references/report-diagnostics.md)
records binding, boundaries and the approval gate.

The original privacy repair left live behavior unchanged. The subsequent
temporary qualification preparation below adds a gated mode to the live
workflow; journey assertions, default public summary, credentials, account
configuration and auth mode remain unchanged. No private-proof access or
activation was performed.

## Offline checks

Original worker Node checks used the supplied **v24.22.0** Linux ARM64 executable, `env -i`,
isolated temporary HOME/proof/profile and
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
  The safe log's totals were inspected and its SHA-256 is recorded under
  the portable label `full-unit.log` in `validation.json`.
- Historical local canonical attempt: exit 1, 24 file passes and two file
  failures (`gmail.test.mjs`, `proof.test.mjs`). Separate diagnosis yielded
  14 test passes and 9 failures with `spawnSync node EPERM`. These sandbox
  subprocess failures are retained as history, superseded for acceptance by
  the coordinator's full-suite pass. No existing test was weakened or edited.
- `git diff --check`: passed. Manual source review checked fixed targets,
  selector validation before transport, stream/file caps, scoped credentials,
  discarded AWS output, literal output projection and unchanged live sources.

Validation logs are identified by portable labels and hashes in
`validation.json`. No raw fixture report is committed. Existing reported
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

## PR 39 repair and remaining evidence

Native review of `6e095a6bf1a9e6d183750826635356adeb4dc4e5`
([published finding](https://github.com/dinkuskit/live-journeys/pull/39#issuecomment-6702824000))
identified private workstation paths in this proof and `validation.json`.
Disposition: `required_fix`; current files now use portable labels and hashes.
Prior Git history is retained. Internal handoff details were reduced.
The repair audit found zero private absolute path matches across all 10 task
files. Node v24.22.0 targeted offline tests passed again: **8 passed, 0 failed,
0 skipped**. The full suite was not rerun for this bounded repair; its earlier
211-pass evidence applies to the prior head. Current source hashes and the
repair test log hash are recorded in `validation.json`.

The workflow text test retains manual/main-only, read-permission and step-local
secret policy checks without depending on step display wording. These are
static regression checks, not proof of the production process boundary.

Production-owner allowed and forbidden cases remain **needs-evidence**
(`human_gate`): no production qualification was performed. The main-only gate
is unchanged. Offline tests and earlier clean comprehensive review do not
satisfy that native requirement. The changed head needs renewed CI and external
reviews before merge; the coordinator owns those steps.

Explicit owner approval may cover the reviewed merge and the first read of run
`42337050608`, attempt `1`, without a second confirmation within that same
scope. It grants no broad future-read authority. Any production qualification
requires its own explicit authorized scope; this repair grants none.
The hosted runner's AWS path/availability, R2 binding/readability and actual
selected report remain untested. A binding mismatch fails closed; it is not
permission to change credentials or account settings.


## Temporary premerge qualification preparation

Prepared on privacy-repair parent `9a6260a8950cdc58dd16c8bc502de5a600bf5d7c`.
The already registered `live-journeys.yml` now has a temporary false-by-default
qualification mode, bound to the exact task branch, actor ID `159389674`, first
attempt, and caller-supplied approved full head matching `github.sha` and the
checkout. Before credentials, the unmodified production reader's SHA-256 is
checked. The permanent main-only workflow and reader script are unchanged.

The normal live journey job is skipped whenever qualification is requested,
even when other qualification gates fail. A fixed matrix uses the same
production verify/fetch/analyze/clean commands for one allowed report and three
negative metadata cases. Fetch requires successful verification AND the fixed
allowed case. Negative cases require verification failure, fetch/analyze skipped
and cleanup success. Existing R2 secret references occur only on the fetch step;
no new credentials, fake AWS or production access were used in preparation.

Offline checks on Node v24.22.0: **11 targeted tests passed, 0 failed/skipped**.
The workflow parses as YAML; actual shell bodies passed **21 outcome cases**
and **3 head-pin cases**, with only fixed output. Routing tests exercise the
owned workflow expressions and ensure no normal journey runs in qualification
mode. These are static/local checks, not GitHub runtime or real-owner proof.
Full canonical suite was attempted and failed in the same two unchanged
subprocess test files (`gmail.test.mjs`, `proof.test.mjs`) with sandbox `EPERM`.
Earlier coordinator 211-pass evidence remains historical, not this head's pass.
Portable log labels and hashes are recorded in `validation.json`.

The [permission packet and command](../../references/report-diagnostics.md#permission-packet-and-exact-command)
require explicit approval of one run and one bounded read of run `42337050608`,
attempt `1`. Optional conditional merge authority must be explicit. No dispatch,
private read, credential access, push or merge occurred. Production qualification
remains **needs-evidence**. The temporary route and its tests must be removed
before final-head CI and both required reviews; the permanent main-only gate
must remain intact. Coordinator owns review, approval, dispatch and closeout.

## Fresh Node environment boundary

Prepared on qualification source parent `67c7df3c826bbc5fa3464eec21aaf04960acced7`.
Both permanent and temporary workflows now launch all four production reader
modes through `env -i`. Only `PATH` and `RUNNER_TEMP` are common; verify adds
`GH_TOKEN`, fetch adds the four existing R2/AWS binding values, and analyze/
cleanup add nothing. The unchanged AWS child allowlist remains narrower.
The reader, normal journey job, branch/actor/expected-head/script-pin gates and
fixed cases are unchanged. The permission command resolves the checkout's
current HEAD, so it remains bound to the newly reviewed and approved commit.

Node v24.22.0: **12 targeted tests passed**, none failed or skipped.
**Eight actual Node launch probes** used the workflow command prefixes with an
offline environment/argument probe in place of the reader. They proved exact
environment keys and arguments with synthetic ambient credentials, including
an unrecognized credential name, hosted runtime token and `NODE_OPTIONS`;
none crossed the allowlist. These probes made no GitHub/AWS calls and do not
claim hosted-runner or real-owner qualification. Full suite still fails in
the two unchanged subprocess files with sandbox `EPERM`; prior accepted
full-suite evidence remains historical. Hashes and portable log labels are in
`validation.json`. All 12 changed task files have zero private-path matches.

No private I/O, credential access, activation, dispatch, push or merge.
Renewed CI and both external reviews are required. Real-owner qualification
remains **needs-evidence**, subject to explicit approval for the exact head.
