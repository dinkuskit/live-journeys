# Refund wakeup qualification

These scripts compare committed Git objects. They never transform the candidate source and never contact a live store. Run only after the candidate commit exists. `--out` must be new; preserve failed runs rather than overwriting them.

From this directory (or use its absolute script path):

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin \
  "$NODE_24_22_0" compare.mjs \
  --node "$NODE_24_22_0" \
  --repo "$LIVE_JOURNEYS_REPO" \
  --base dbf2512864947be2fea87ec58f34866d359cc7d8 \
  --candidate "$COMMITTED_CANDIDATE_SHA" \
  --playwright "$EXISTING_NODE_MODULES" \
  --chromium "$CHROMIUM" \
  --pairs 3 \
  --out "$NEW_OUTPUT_DIRECTORY"
```

`NODE_24_22_0` names the Node 24.22.0 executable. `EXISTING_NODE_MODULES` names the directory containing Playwright 1.61.1, not its package subdirectory. No installation or credential is needed. Chromium is supplied explicitly. Both refs must be full 40-character hashes available in the repository. The runner starts children with an allowlisted environment; browser samples then use their own temporary HOME, proof and profile directories.

`model.mjs` evaluates each actual `pace.mjs` body with controlled clock/context/filesystem stand-ins. Its 12 paired scenarios cover one/three waiters, no refund, single/multiple refunds, insufficient and staggered refunds, and a refunded failed request. It validates release timing, no false admission, empty timer queues, the sum and union of sleep durations, total scheduled timer durations and sleep counts. Imports are restricted to the known pace-module dependencies; an added dependency fails closed for fixture review.

`browser-sample.mjs` copies the actual helper import closure from one immutable ref into a disposable runtime. The real Playwright filter and cache warm one immutable asset. Synthetic history brings the provisional request count to61 before the replay refunds it to60. Both versions keep PAGE_ROOM40. Three alternating pairs must preserve the same two server requests while the candidate wakes promptly. A no-store pair must keep waiting and make the second network request. The near-expiry history keeps each baseline/control sample bounded; it does not represent observed live traffic.

Each sample writes a relative source hash manifest and result. The orchestrator writes stream files, process receipts, script hashes and a summary. Success output contains no configured machine paths. Failed stderr can contain local stack paths: inspect/redact it before publishing. Temporary browser profiles remain outside the output and must not be copied into PR proof. The canonical capture helper may wrap this single command if a standard outer process receipt is needed.

The model changes its clock and filesystem dependencies; browser samples use actual runtime dependencies. Neither proves live incidence, end-to-end journey speedup, or external rate-limit behavior. Preserve all assertions, STORE_BUDGET100, the existing headroom constants, cache semantics and request counting. A final-head source change requires rechecking the binding; proof-only changes can reuse a byte-identical source core with explicit hashes.
