# Report diagnostics: qualified source cleanup

Base: `9d0302c4264412d5c782a44d976ab56c681f0532`.
Qualified source and cleanup parent: `cb741d85c8d1c7d44c1b2b4b7ba82f3df4fe1a0e`.

The owner explicitly approved one qualification and conditional merge. The
coordinator executed [run 42381597122, attempt 1](https://github.com/dinkuskit/live-journeys/actions/runs/42381597122)
once on that exact head. It completed successfully: four qualification jobs
passed, all four cleanups passed, and live journeys were skipped. The worker
read only the coordinator-provided sanitized evidence linked below. No raw
report, raw log, credentials or further private proof was read in this cleanup.

## Observed qualification

The exact production reader SHA-256, checked before credential injection, was
`3797025ed95801b337efeeea86cda2e67c8b7b4b2f5ab438515cfa1e2bfcee80`.
It is unchanged in this cleanup, as is the permanent diagnostics workflow.

| Case | Selected run / attempt | Result |
| --- | --- | --- |
| Allowed | `42337050608` / `1` | Verify, fixed bounded fetch, analyze and cleanup passed |
| Forbidden workflow | `42342624009` / `1` | Verify failed; fetch/analyze skipped; cleanup passed |
| Foreign repository | `42342657068` / `1` | Verify failed; fetch/analyze skipped; cleanup passed |
| Forbidden attempt | `42337050608` / `9999` | Verify failed; fetch/analyze skipped; cleanup passed |

The negative verification steps show a successful GitHub conclusion because
of `continue-on-error`. Their final fixed assertions passed only for a failure
outcome plus skipped fetch/analyze, corroborated by the coordinator receipt.
This is observed application rejection, not proof of IAM denial for other keys.

The allowlisted projection contains 14 journeys and 103 step records. Only
`Manage products` has a failed record: 1 of 13 records, categorized as
`navigation_missing: 1`. Its other four link counters are zero; all other
journeys have zero failed records. Counts include retained retry records.
The category does not establish the underlying product, network or timing cause.

Sanitized evidence (SHA-256 hashes in [validation.json](validation.json)):

- [Qualification receipt](qualification-receipt.json)
- [Job/step metadata](qualification-run.json)
- [Allowlisted projection](qualification-safe-projection.json)

## Final source and offline checks

- Restored `.github/workflows/live-journeys.yml` byte-for-byte to the base.
  Temporary inputs/job, special concurrency and journey skip condition are gone.
- Removed `runner/unit/report-qualification.test.mjs`; retained its permanent
  fresh-environment regression in `report-diagnostics.test.mjs`.
- Permanent main-only workflow, fixed reader, journey assertions and default
  public summary remain unchanged. No installed runtime was registered.
- Node **v24.22.0**, empty environment, temporary HOME/proof/profile and env file
  `/dev/null`: **9 targeted tests passed, 0 failed or skipped**. Tests retain
  malformed/oversized input, unknown schema/journey, malicious selectors,
  synthetic secrets/PII/URL redaction, fixed AWS invocation and output suppression,
  main-only/manual policy and exact environment allowlist coverage.
- The full unit suite was attempted; the same unchanged `gmail.test.mjs` and
  `proof.test.mjs` subprocess files failed in this sandbox. No final-head full
  pass is claimed. Historical coordinator evidence of 211 passing tests belongs
  to the earlier source; prior evidence is explicitly archived in validation.
- Source/evidence identities, byte equality, sanitized counts, job outcomes and
  private-path audit (13 retained task files, zero matches) are verified in
  `validation.json`. Static workflow tests
  are regression checks, not substitutes for runtime qualification.

The previous private-path finding was repaired in `9a6260a8950cdc58dd16c8bc502de5a600bf5d7c`;
Git history is retained. The native request for real owner-context qualification
now has the observed evidence above, subject to final external adjudication.
The prior unperformed/pending statements describe historical preparation only.

## Scope and remaining work

The one-read authorization was consumed by the successful qualification. It
provides no future private-read authority. Conditional merge remains authorized
only after the final cleaned source passes required CI, comprehensive OpenClaw
and native ClawSweeper review. The coordinator owns those checks, push and merge.
The worker has not dispatched, pushed or merged anything in this cleanup.

Qualification used the same reader and fresh launch boundaries as the permanent
consumer; the permanent main-only workflow itself has not been dispatched.
The bounded read demonstrated hosted AWS availability and the fixed R2 binding
for this one selection, not future availability, arbitrary access or provenance
of all stored objects. The existing credential remains read/write at the account
boundary; the consumer performs only the fixed read. See the
[consumer contract](../../references/report-diagnostics.md) for privacy limits.
