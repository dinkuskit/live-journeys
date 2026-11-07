# Diagnostics source status

- Base: `9d0302c4264412d5c782a44d976ab56c681f0532`.
- Qualification preparation parent: `9a6260a8950cdc58dd16c8bc502de5a600bf5d7c`.
- Temporary premerge mode prepared on the assigned branch only; actor/head/reader pin and manual boolean gates; normal journeys skipped in that mode.
- Permanent main-only diagnostics workflow and reader are unchanged.
- Current targeted offline checks: 11 passed, 0 failed/skipped; YAML parse, 21 shell outcome cases and 3 head-pin cases passed.
- Current full suite: two unchanged subprocess test files fail with sandbox EPERM. Prior coordinator 211-pass is historical evidence only.
- Real-owner allowed/forbidden qualification: needs-evidence; not dispatched.
- Next: coordinator reviews source and obtains explicit one-run approval before any private read. Remove temporary route after authorized proof and renew CI/comprehensive/native reviews on final head before owner-authorized merge.
- No private I/O, credentials, dispatch, push or merge during preparation.
