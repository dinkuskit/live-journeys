# Observer dwell handoff

- Source commit: `61f4c3a970d127a0e6f86c4b4335848fa26b7d8a`; base: `3548b52b4203ae87f938352fb653c041b8abd73d`.
- Branch: `ridge/live-journey-observer-20261106`. This record is a proof-only follow-up to the source commit.
- Only the two authorized terminal waits changed. Visible or video retains 2,000 + 3,500 ms.
- Node v24.22.0: 14 targeted checks passed. Canonical full command exited 1: 23 file passes, two failures; subprocess EPERM remains unresolved in this sandbox.
- Deterministic comparison: 5,500 ms removed only for headless without video when both steps succeed. No live or end-to-end speedup claim.
- Coordinator owns full canonical verification, push, PR, CI and both reviews, then targeted live verification after the existing pair finishes. No live dispatch, merge or child writer by this worker.
