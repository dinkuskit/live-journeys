# Manual report diagnostics

The owner explicitly approved one qualification and conditional merge. The
coordinator executed that qualification once, successfully, on the exact source
and selection recorded below. That authorization has been consumed for the
private read; it grants no further private reads. Conditional merge remains
subject to clean CI, comprehensive OpenClaw and native ClawSweeper reviews of
the final source after temporary-route removal. No repeated confirmation is
required for actions already within that approval. The permanent workflow has
not been dispatched; no installed runtime is registered.

The permanent consumer is `.github/workflows/report-diagnostics.yml` in
`dinkuskit/live-journeys`, running `runner/scripts/report-diagnostics.mjs` on
`ubuntu-24.04` with Node `24.22.0`. It accepts only `run_id` (1–15 decimal digits,
positive, no leading zero) and `attempt` (1–4 decimal digits, same restrictions).
It runs only by `workflow_dispatch` on `main` in this repository. No push, PR,
schedule, live journey, store, inbox or browser operation is added.

## Fixed binding and process boundary

The workflow launches each Node mode with `env -i`, carrying only `PATH` and
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
`run-summary.mjs` behavior unchanged. The temporary premerge mode has been removed. A successful diagnostics workflow means its projection
completed; it does not mean the selected journey passed.

## Completed owner qualification

The coordinator ran [qualification 42381597122, attempt 1](https://github.com/dinkuskit/live-journeys/actions/runs/42381597122)
on approved head `cb741d85c8d1c7d44c1b2b4b7ba82f3df4fe1a0e`, as actor ID
`159389674`, using the temporary branch/head/actor-gated route. Its reader SHA-256
was `3797025ed95801b337efeeea86cda2e67c8b7b4b2f5ab438515cfa1e2bfcee80`,
identical to the retained permanent reader. All four case jobs and outcome
assertions passed; live journeys were skipped.

| Case | Run / attempt | Observed outcome |
| --- | --- | --- |
| Allowed | `42337050608` / `1` | Verify, bounded fetch, analyze and cleanup succeeded |
| Forbidden workflow | `42342624009` / `1` | Verify rejected; fetch/analyze skipped; cleanup succeeded |
| Foreign repository | `42342657068` / `1` | Verify rejected; fetch/analyze skipped; cleanup succeeded |
| Forbidden attempt | `42337050608` / `9999` | Verify rejected; fetch/analyze skipped; cleanup succeeded |

GitHub's step conclusion displays success for the negative verification steps
because they use `continue-on-error`. The final fixed assertion passed only
when the actual `steps.verify.outcome` was failure and fetch/analyze were
skipped. All four cleanup steps passed. This proves the observed route's
allowed read and rejection behavior, not IAM denial for arbitrary objects.

The sanitized projection has 14 journeys and 103 step records. `Manage products`
has 13 records, one failed record, and `navigation_missing: 1`; its other four
link counters are zero. Every other journey has zero failed records. These
counts include retained retry records and identify a failure category, not its
root cause. No raw error, product name, private URL or report was retained here.
See [the portable proof](../proof/proof-diagnostics-20261107/PROOF.md) for the
sanitized receipt, job metadata, projection and offline checks.

The temporary inputs, qualification job, concurrency branch, journey skip
condition and qualification-only tests are removed. `live-journeys.yml` is
restored byte-for-byte to base `9d0302c4264412d5c782a44d976ab56c681f0532`.
The permanent workflow retains its main-only gate and fresh environment
allowlists. Qualification exercised the same reader and launch boundaries,
not the permanent workflow on main; final-head CI and external review remain
required. No further dispatch, private read or merge is part of this cleanup.
