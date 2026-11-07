# Homepage reuse: the opened homepage stands in for its first store check

Base `e3fff0090468de0237e10a5d4e9443c0ac761e68`; branch `ridge/live-journey-homepage-20261107`.
**Production source is frozen at `587fc2e3eec5f2f36d7fd11f86bda057a0e197f4`** (the core
candidate). `c8e74ca` repaired the new unit test and fixture, `71f578b` was proof-only, and the
next commit drops one unit test (below); `git diff --stat 587fc2e HEAD -- runner/support
runner/tests runner/README.md README.md` is empty. **No result below was produced by this
writer**, whose tool surface runs no Node; every figure is the coordinator's, copied from its task
folder and recorded with hashes in [validation.json](validation.json).

## What changed, and why it is safe

Four active call sites (Manage products' Draft check and clean-up; One product with a category's
publish check and clean-up) open the homepage with `openShopperPage`, then call
`storeHides`/`storeShows`, whose first `catchUp("/")` loaded the same homepage again. The `@next`
agent journey has the same two sites; both adopted, `@next` kept.

- `shopper.mjs`: `openShopperPage` keeps its pacing, Access handling (through `openStorePage`),
  final-origin and HTTP 200 checks, and returns a one-shot handoff of the response it validated.
  Any main-frame `framenavigated` since (reload, link, hash change, pushState) spends it.
  `take(page, href)` gives the response once, only to the same open page at the same address
  whose response answered that href; otherwise null. No cache: one object per open.
- `store-check.mjs`: `catchUp` takes an optional handoff. The loop is unchanged (`PAGE_ROOM`
  reservation first, `watchLoads`, check, 3 s wait, 60 s deadline); only the first load is
  replaced when `take` accepts, then the handoff is dropped, so a failed first check reloads as
  before. Product, category and photo checks and their order are untouched.
- Call sites: `const opened = await openShopperPage(shopper, "/")`, then the check with
  `{ opened }`. Same messages, same soft-step contract. README: one sentence.

Untouched callers pass no handoff and behave as before, bar one self-removing listener per open.
No assertion, budget, timeout, retry, workflow, public summary or test selection changed.

## Coordinator evidence (Node 24.22.0, Playwright 1.61.1, Chromium 153.0.8010.36, loopback only)

| Check | Source | Result | Copy here |
| --- | --- | --- | --- |
| Full offline unit suite | `587fc2e` helpers + the test and fixture committed in `c8e74ca` (hashes equal) | 238 tests, 238 passed, 0 failed, exit 0, 5,771 ms | `unit-results.json` |
| Offline compare, 18 scenarios | base `e3fff00` vs `587fc2e`, repaired fixture | all pass; 14 reuse scenarios; 32 loads spared in all; 1 divergent by design | `comparison-results.json` |
| Real-browser freshness guard | `587fc2e` `shopper.mjs` on real Playwright | 8 of 8: fresh take; hash change, pushState, reload spoil it; child frame leaves it current; other page/address/closed page refused; later open spends it; status check hands nothing on | `freshness-results.json` |
| Paired actual-helper samples | immutable Git objects of both revisions, five interleaved pairs per variant | table below; every sample no problems, 0 pacing sleeps, product and category loads unchanged | `paired-loopback/` |
| Same-URL reload fallback | `587fc2e`, reload between open and check | 3 homepage documents (open, reload, fresh fallback), no problems, 0 pacing sleeps | `paired-loopback/reload-result.json` |

The preliminary run on the uncommitted draft (238 tests, 231 passed, 7 failed, all in the new test
file and fixture) is history: `c8e74ca` repaired those four fixture faults and the suite above is
the rerun. That 238-test result is the suite **as of `c8e74ca`**. On the native review's optional
recommendation for PR #41 (head `71f578b`), the ninth test, which parsed the specs' source and ran
each adopted site over stand-ins, was then removed with its `specs`/`sites`/`wire` helpers: it
asserted exact source spelling and mock calls. The eight behaviour tests, fixture, compare and
helpers are unchanged. The retained suite has not been run since; the current head's CI is its
evidence, and no count is stated until it exists. The `c8e74ca` copies above stay as history.

| Fixture, five pairs | Revision | Homepage documents | All documents | Requests incl. preflight | Image requests |
| --- | --- | ---: | ---: | ---: | ---: |
| Empty readable catalog | base / candidate | 2 / 1 | 4 / 3 | 5 / 4 | 0 / 0 |
| Three unrelated image cards | base / candidate | 2 / 1 | 4 / 3 | 11 / 7 | 6 / 3 |

Every response was `Cache-Control: no-store`. The supported claim is one fewer homepage document
navigation per adopted call. Image savings depend on that fixture's cache policy. Elapsed medians
(about 5.2 to 5.3 s, in the raw copies) are descriptive only: the unchanged absent-price wait
dominates and **no live speedup is claimed**.

```sh
# from live-journeys/, pinned Node 24.22.0, isolated HOME, DINKUS_E2E_ENV_FILE=/dev/null
node --test runner/unit/*.test.mjs
node proof/homepage-reuse-20261107/compare.mjs --base e3fff0090468de0237e10a5d4e9443c0ac761e68 --candidate 587fc2e3eec5f2f36d7fd11f86bda057a0e197f4 --out comparison-results.json
node proof/homepage-reuse-20261107/loopback-freshness.mjs --playwright runner/node_modules --chromium "$CHROMIUM" --ref 587fc2e3eec5f2f36d7fd11f86bda057a0e197f4 --out freshness-results.json
# from proof/homepage-reuse-20261107/paired-loopback/, once per --variant empty|cards
env -i PATH=/usr/bin:/bin "$NODE_24_22_0" paired.mjs --repo ../../.. --base e3fff0090468de0237e10a5d4e9443c0ac761e68 --candidate 587fc2e3eec5f2f36d7fd11f86bda057a0e197f4 --playwright ../../../runner/node_modules --chromium "$CHROMIUM" --variant empty
env -i PATH=/usr/bin:/bin "$NODE_24_22_0" same-url-reload.mjs --repo ../../.. --ref 587fc2e3eec5f2f36d7fd11f86bda057a0e197f4 --playwright ../../../runner/node_modules --chromium "$CHROMIUM"
```

## Limits

- Offline fixture and loopback only: hide path with actual helpers; `storeShows`' photo identity,
  Access sign-in, live pacing pressure and live store behaviour are not exercised. The fixture's
  `readCard`/`photo` stand-ins read the same locators without the browser waits.
- One compare scenario diverges by design: a store that stops answering right after the open.
  The base reloads and fails; the candidate's first look is the page it opened, which answered
  HTTP 200 after the change. A true observation, not a hidden failure; no other outcome differs.
- `seconds` in a step summary can read one lower, since one load is gone.
- No automated check covers the call sites' wiring. That the six sites in `manage-products`,
  `onboarding-product` and `agent-products` pass `{ opened }` to their first check, and that the
  other specs are untouched, rests on direct reading of `git diff e3fff00 587fc2e -- runner/tests`.
- Work counts, not time: the live hotspots (Manage products 640.670 s, One product 327.565 s in
  run 42389391917) are the target; nothing here measures them.

## Files, sanitization, gates

Scripts `compare.mjs` and `loopback-freshness.mjs` are this writer's; `paired-loopback/*.mjs`, its
README, `freshness-results.json` and `reload-result.json` are the coordinator's, copied byte for
byte (hashes equal the reported raw hashes). `empty-results.json`, `cards-results.json` and
`summary.json` differ from raw only where a local temporary path was replaced by a note.
`comparison-results.json` and `unit-results.json` are whole copies without a raw hash. The raw
unit log, capture receipts (they name workstation paths), browser profiles and cookies are not
copied. No file here names a machine path. Copies were checked by hash where a raw hash exists,
else by line count and bracket balance; this writer could not hash files outside its workspace.

No live run, credential, private report, workflow dispatch, push, PR, review or merge by this
writer. Merges and further live or private actions need new owner approval.
