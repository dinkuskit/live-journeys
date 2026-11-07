# Manual report diagnostics (proposed)

Source only. This capability is not activated or registered as an installed
runtime. The coordinator must obtain the owner's explicit approval **after the
PR is reviewed**, before the first dispatch/private-proof read. That approval
may explicitly cover both the reviewed merge and the first read of run
`42337050608`, attempt `1`; no second confirmation is required within that same
authorization. Approval limited to merging does not authorize a private read,
and the named first-read approval grants no authority for future reads.
The coordinator will request this combined approval after review. Do not
dispatch the permanent workflow as a test of this PR. The temporary
qualification route below requires a separate explicit one-run approval.

The proposed consumer is `.github/workflows/report-diagnostics.yml` in
`dinkuskit/live-journeys`, running `runner/scripts/report-diagnostics.mjs` on
`ubuntu-24.04` with Node `24.22.0`. It accepts only `run_id` (1–15 decimal digits,
positive, no leading zero) and `attempt` (1–4 decimal digits, same restrictions).
It runs only by `workflow_dispatch` on `main` in this repository. No push, PR,
schedule, live journey, store, inbox or browser operation is added.

## Fixed binding and process boundary

Both workflows launch each Node mode with `env -i`, carrying only `PATH` and
`RUNNER_TEMP`, plus `GH_TOKEN` for verify or the four existing R2/AWS binding
values for fetch. Analyze and cleanup receive only those two runtime variables.
Selectors remain quoted positional arguments. Ambient hosted-runner variables,
including credentials with unrecognized names, do not enter these Node
processes. The shell alone uses `GITHUB_STEP_SUMMARY` for the sanitized output.


1. `verify` validates both selectors before network access. With the job's
   `actions: read` token, it requests only
   `https://api.github.com/repos/dinkuskit/live-journeys/actions/runs/<run_id>/attempts/<attempt>`.
   Redirects are refused, with a 30-second timeout and 1 MiB response cap.
   The response must identify the exact numeric run/attempt, this repository,
   `.github/workflows/live-journeys.yml`, and a completed run. Only a local
   non-secret selector receipt is retained. `contents: read` serves checkout;
   checkout does not persist credentials. No token is written to a receipt or log.
2. `fetch` revalidates selectors and requires the matching receipt. The existing
   GitHub secret references `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` and
   `R2_SECRET_ACCESS_KEY` are supplied **only to this step**. Account must equal
   `4e8679e964d3d1808d6226b7150b13c0` (Agent account), and bucket must equal
   `dinkus-e2e-proof`; disagreement stops. The sole AWS operation is
   `/usr/local/bin/aws s3api get-object` for
   `runs/github-<run_id>-<attempt>/report.json`, at the fixed account's R2 HTTPS
   endpoint. A byte range requests at most 1 MiB + one overflow-detection byte.
   AWS receives only the two access credentials and allowlisted runtime state,
   with isolated HOME, empty config/credentials files, metadata lookup disabled,
   fixed endpoint/region, bounded time/output, no session token or ambient proxy.
   Both AWS output streams are captured and discarded on success and failure.
   No bucket listing, write, alternate key, bucket, URL or path input is supported.
3. `analyze` starts from the fresh credential-free environment above and also
   refuses recognized credential environment variables as defense in depth. It reads only the fixed temporary report, refusing symlinks,
   nonregular files, reports over 1 MiB, bad JSON, unknown schema or journey,
   mismatched report run ID, duplicate journeys and malformed step records.
   It constructs output from fixed literals; it never serializes source records.
4. An `always()` cleanup removes the temporary directory. Credentials are never
   saved there. A forcibly terminated runner may miss cleanup; GitHub's ephemeral
   runner disk lifecycle remains the final boundary. No raw report artifact is
   uploaded or published.

These are the **existing upload binding's secret names**, not new credentials,
1Password selectors or an auth-mode change. The existing credential is described
as bucket read/write; this consumer restricts its operation to one read, but does
not claim an IAM read-only credential. No account configuration, permission,
secret, profile or credential lookup is part of this source preparation.
This follows the fixed-consumer isolation rule in x-api's
`docs/operations/cloudflare-account-split.md` and `skills/smoky-1pass/SKILL.md`;
it does not onboard an `op` resolver or borrow operator OAuth.

## Public output contract

One JSON array goes to stdout and the job summary. Journey names come from a
literal allowlist matching the current runner (including `Test run`); an input
name must equal one exactly. Each has integer `step_count`, `failed_step_count`,
and fixed `link_problems` counters. Counts include retained retry records, so
they describe report records, not unique logical steps. No durations are emitted:
`report.json` has no structured duration field, and arbitrary text/timestamps
are not interpreted as timing. `playwright.json` is not fetched.

Only failed `Manage products` records whose step name is exactly
`The product's links open its page` receive link categorization. Anchored patterns
follow `support/store-check.mjs`'s `linkProblems` messages:

| Code | Meaning |
| --- | --- |
| `missing_card_or_link` | Card absent or lacks its product link |
| `navigation_missing` | Following the link produced no matching navigation |
| `non_200` | Following the link returned a non-200 HTTP status |
| `heading_mismatch` | Opened product heading differed from the expected name |
| `unknown` | Unrecognized/ambiguous link failure, including page-load errors |

Only the code/count survives; HTTP status, product/category paths, headings,
error text, step names, facts, URLs, emails, page contents, headers, cookies,
order data and arbitrary names are never emitted. Unknown report schemas or
malformed selectors fail with only `Diagnostics unavailable.` on stderr and
exit 1. Unknown link error text produces only the fixed `unknown` counter.
This is a bounded diagnostic projection, not an assertion that source error
text is trustworthy or a live root-cause finding. GitHub metadata establishes
run ownership, not cryptographic provenance for an R2 object's contents.

The permanent design leaves Live journeys, its assertions and default
`run-summary.mjs` behavior unchanged. The temporary premerge mode below is
removed before final merge. A successful diagnostics workflow means its projection
completed; it does not mean the selected journey passed.

## Temporary premerge qualification (source only)

PR 39's native review requires real owner-context allowed and forbidden cases.
The proposed temporary mode in the **already registered** `live-journeys.yml`
lets GitHub select this task branch before the new main-only diagnostics
workflow exists on the default branch. It does not relax that permanent gate.
No qualification has been dispatched or approved by this source change.

The temporary mode requires all of:

- A manual `workflow_dispatch` with `diagnostics_qualification: true` (boolean,
  default **false**) in `dinkuskit/live-journeys`.
- Exactly `refs/heads/ridge/live-journey-diagnostics-20261107`, actor ID
  `159389674` (`saariuslystoned`), and first attempt only. A rerun is refused.
- `diagnostics_expected_head` equal to `github.sha`; the checked-out commit must
  also equal that full 40-character SHA. Before explicit verifier-token or
  R2-secret injection, the reader must hash to
  `3797025ed95801b337efeeea86cda2e67c8b7b4b2f5ab438515cfa1e2bfcee80`.

With the boolean true, the normal journey job is skipped regardless of whether
qualification's other gates pass. No store updates, browser, inbox, orders or
live journeys run. Qualification uses a separate per-run concurrency group, so
it cannot replace a pending normal store run. With the default false, the
existing normal journey route and store concurrency remain in effect.

The fixed matrix has no caller-selected run, attempt, path, bucket or endpoint:

| Case | Run / attempt | Required outcome |
| --- | --- | --- |
| Allowed | `42337050608` / `1` | Production `verify`, bounded `fetch`, allowlisted `analyze`, `clean` all succeed |
| Forbidden workflow | `42342624009` / `1` | Production `verify` fails; `fetch` and `analyze` skipped; cleanup succeeds |
| Foreign repository | `42342657068` / `1` | Same rejection, through the production same-repository metadata endpoint |
| Forbidden attempt | `42337050608` / `9999` | Same rejection |

These negative targets are coordinator-supplied qualification fixtures; their
live metadata and rejections have not been independently observed here. All
four cases use the unmodified production CLI calls. Even an unexpected
successful negative verification cannot reach `fetch`: only the literal
`allowed` case can fetch. Such an outcome fails qualification. Each negative
case reports only fixed failure text and fixed step outcomes, never API bodies
or logs. `continue-on-error` is limited to verification so expected rejections
can be asserted; it cannot make the final qualification assertion pass.
The fetch step alone receives the existing R2 references. Every production CLI
call uses the same fresh environment allowlist as the permanent workflow; the
analyzer and cleanup receive only `PATH` and `RUNNER_TEMP`. No credentials or account permissions change.

### Permission packet and exact command

The coordinator must present the reviewed source head and request explicit
owner approval for **one** manual qualification dispatch from that exact head:
three fixed metadata-only rejection cases and one bounded private read of
`runs/github-42337050608-1/report.json`, projected to fixed public codes/counts.
The owner may also explicitly grant conditional merge authority, exercisable
only after qualification succeeds, the temporary route is removed, and all
required reviews/CI are clean on the final head. Approval for qualification
alone grants no merge authority; neither grants further private reads.
This document and source preparation grant neither approval.

After approval, the coordinator runs this command from the exact reviewed,
owner-approved checkout, after pushing that same commit. The authenticated
GitHub actor must be `saariuslystoned`. Record the full `qualification_head` in
the approval and dispatch receipt; if the remote branch has moved, the workflow
refuses the mismatch. **Do not execute during source preparation.**

```sh
set -euo pipefail
test "$(git branch --show-current)" = ridge/live-journey-diagnostics-20261107
qualification_head=$(git rev-parse HEAD)
gh workflow run live-journeys.yml --repo dinkuskit/live-journeys \
  --ref ridge/live-journey-diagnostics-20261107 \
  -F diagnostics_qualification=true \
  -f diagnostics_expected_head="$qualification_head" \
  -F update_store=false
```

Observe all four exact matrix jobs and the skipped journey job on that one run;
retain only safe source identity, run/attempt, step outcomes and allowlisted
summary. A failure is a stop condition, not permission to rerun, broaden access,
change credentials, or use another reader. No raw report/log artifact is needed.
After successful authorized qualification, remove the two temporary inputs,
the qualification job, its separate concurrency choice, the journey skip
condition, and `runner/unit/report-qualification.test.mjs`. Restore the original
live workflow exactly. Retain sanitized qualification evidence and obtain
required CI plus comprehensive and native reviews for that final source head
before any owner-authorized merge. Permanent `report-diagnostics.yml` remains
main-only throughout. Static routing/shell checks are regression evidence,
not real-owner or hosted-runner qualification.
