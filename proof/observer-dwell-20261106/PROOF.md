# Terminal observer dwell

Source: `61f4c3a970d127a0e6f86c4b4335848fa26b7d8a`, based on the clean supplied mount at `3548b52b4203ae87f938352fb653c041b8abd73d`. Issue #36, new slice after merged #35. File hashes and validation receipts are in [validation.json](validation.json); this follow-up changes proof only.

Only the terminal Plugins-list wait and Commerce-connect wait are conditional. They are omitted when `config.headless && !config.video`. Plugin presence/version checks and exact-site confirmation still precede success. All other waits, login, rate limits, screenshot handling, roster and background checks are unchanged.

The actual step callbacks were extracted and executed with controlled reads, connections and timers. Four mode combinations, pending readiness, unreadable/missing/wrong-version plugins, failed connection, wrong site, already-connected results, and awaited observer timers are covered by 14 new tests.

| Mode | Base scheduled dwell | Candidate scheduled dwell |
| --- | ---: | ---: |
| Headless, no video | 5,500 ms | 0 ms |
| Headless, video | 5,500 ms | 5,500 ms |
| Visible, no video | 5,500 ms | 5,500 ms |
| Visible, video | 5,500 ms | 5,500 ms |

[comparison.json](comparison.json) records one deterministic base/candidate pair per mode, with identical successful return values. This counts scheduled timer work in these two successful callbacks, not wall-clock performance. No browser/network timing or end-to-end speedup is claimed; the Commerce path must be selected for its 3,500 ms reduction to apply.

Validation used the supplied **Node v24.22.0** executable on Linux aarch64, with an empty inherited environment, task-local `/tmp` HOME/proof/profile, and `DINKUS_E2E_ENV_FILE=/dev/null`. No dependencies were installed.

- `node --test --test-isolation=none runner/unit/observer-dwell.test.mjs`: **14 pass, 0 fail, 0 skipped**, exit 0.
- Canonical `node --test runner/unit/*.test.mjs`: **exit 1**, 23 file passes and failures in existing `gmail.test.mjs` and `proof.test.mjs`. It is not a full-suite pass. Isolated diagnostic execution of those files identifies `spawnSync node EPERM` in their existing subprocess checks (9 failures, 14 passes).
- A full run with `--test-isolation=none` is diagnostic only: 180 pass / 23 fail; shared module/environment state introduces additional pacing/proof failures. It cannot substitute for the canonical isolated suite.
- `git diff --check` passed. Source hashes bind the checked files to the source commit. Raw local capture streams are represented by SHA-256 in validation.json.

An initial targeted run under the inherited environment failed at file level; a diagnostic exposed a test synchronization assumption (two microtasks did not reach the deferred read). The test now yields one event-loop turn and checks that readiness was reached. The final clean-environment targeted run passes all 14 cases.

Full canonical validation remains a coordinator gap; no privilege widening was attempted. The source commit exists and the worktree was clean afterward, despite Git reporting blocked shared `packed-refs.lock` and `rr-cache` housekeeping writes. The coordinator owns pushing, the PR and required reviews, and targeted live verification after the current baseline/candidate pair finishes. This worker dispatched no live run and performed no merge.
