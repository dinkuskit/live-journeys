# Observer dwell handoff

- Source commit: `61f4c3a970d127a0e6f86c4b4335848fa26b7d8a`; base: `3548b52b4203ae87f938352fb653c041b8abd73d`.
- Branch: `ridge/live-journey-observer-20261106`. This record is a proof-only follow-up to the source commit.
- Only the two authorized terminal waits changed. Visible or video retains 2,000 + 3,500 ms.
- Accepted coordinator Node v24.22.0 canonical isolated suite: 203/203 passed, zero failures/skips. Raw log inspected and hashed. Earlier worker subprocess EPERM is historical; the full-suite validation gap is resolved.
- Exact npm ci and Playwright listing: 14 tests in 14 files; coordinator reports three packages installed, lockfile unchanged. Independent source review at `fce5c130c17b7c3c2f688f9e13dd55e64217f80f` found no actionable findings.
- Deterministic comparison: 5,500 ms removed only for headless without video when both steps succeed. No live or end-to-end speedup claim.
- Coordinator owns push, PR, CI and both external required reviews, then targeted live verification after the existing pair finishes. Standing owner authorization permits coordinator merge only with clean CI and both external required reviews. No live dispatch, merge or child writer by this worker.
