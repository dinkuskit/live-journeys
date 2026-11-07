# Manual report diagnostics (proposed)

Source only. This capability is not activated or registered as an installed
runtime. The coordinator must obtain the owner's explicit approval **after the
PR is reviewed**, before the first dispatch/private-proof read. Merging source
alone does not grant that approval. Do not dispatch it as a test of this PR.

The proposed consumer is `.github/workflows/report-diagnostics.yml` in
`dinkuskit/live-journeys`, running `runner/scripts/report-diagnostics.mjs` on
`ubuntu-24.04` with Node `24.22.0`. It accepts only `run_id` (1–15 decimal digits,
positive, no leading zero) and `attempt` (1–4 decimal digits, same restrictions).
It runs only by `workflow_dispatch` on `main` in this repository. No push, PR,
schedule, live journey, store, inbox or browser operation is added.

## Fixed binding and process boundary

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
3. `analyze` receives no credentials and refuses recognized credential environment
   variables. It reads only the fixed temporary report, refusing symlinks,
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

The existing Live journeys workflow, assertions and default `run-summary.mjs`
behavior are unchanged. A successful diagnostics workflow means its projection
completed; it does not mean the selected journey passed.
