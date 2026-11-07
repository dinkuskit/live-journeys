# Homepage reuse: the opened homepage stands in for its first store check

Base: `e3fff0090468de0237e10a5d4e9443c0ac761e68` (verified; worktree clean at start).
Branch: `ridge/live-journey-homepage-20261107`. **Verification not run by this
writer**: this tool profile permits no Node execution. The coordinator's proof lane
runs the commands below; raw results belong beside this file.

Preliminary (coordinator, Node 24, the uncommitted draft before `587fc2e`): 238
unit tests, 231 pass, 7 fail, all seven in the new test file and fixture, none in
the helpers: vm-realm arrays failed `deepStrictEqual` against this realm's
literals; one `assert.rejects` RegExp was written for the message, not the error's
string form; the divergent scenario's store went down at 500 ms, after the
fixture's second load at 400 ms; the closed-page case counted 19 tries where a
page that refuses at once fits 22 in the minute. The commit after `587fc2e`
repairs those four in the fixture and test only (results JSON-rounded, `{ message }`
matchers, boundary at `LOAD_MS`, closed page compared with its no-handoff twin).

## What changed, and why it is safe

Four active call sites (Manage products' Draft check and clean-up; One product
with a category's publish check and clean-up) open the homepage with
`openShopperPage`, then call `storeHides`/`storeShows`, whose first `catchUp("/")`
loaded the same homepage again. The `@next` agent journey has the same two sites
(two, not one); both adopted, the reuse being mechanically identical; `@next` kept.

- `shopper.mjs`: `openShopperPage` keeps its pacing, Access handling (through
  `openStorePage`), final-origin and HTTP 200 checks, and returns a one-shot
  handoff of the response it validated. Any main-frame `framenavigated` since (a
  reload, a link, a hash change, pushState) spends it. `take(page, href)` gives
  the response once, only to the same page object at the same address while the
  page is open, its address still reads that href and the response answered it;
  otherwise null. No cache: one object per open, consumed on first use.
- `store-check.mjs`: `catchUp` takes an optional handoff. The loop is unchanged
  (`PAGE_ROOM` reservation first, `watchLoads`, check, 3 s wait, 60 s deadline);
  only the first load is replaced when `take` accepts, and the handoff is dropped
  after that attempt, so a failed first check reloads as before. `storeShows`/
  `storeHides` pass `opened` to the homepage check only; product, category and
  photo checks and their order are untouched. Invalid input means no reuse.
- Call sites: `const opened = await openShopperPage(shopper, "/")`, then the
  check with `{ opened }`; clean-ups use `.catch(... return null)` and `if (opened)`
  in place of the earlier boolean `.then`. Same messages, same soft-step contract.
- README: one sentence under the Manage products paragraph.

Untouched callers pass no handoff and behave as before, bar one self-removing `framenavigated` listener per open.

## Offline evidence written (to be run by the coordinator)

`runner/unit/homepage-reuse.test.mjs` with `runner/unit/fixtures/homepage-reuse.mjs`
evaluate the actual `shopper.mjs` and `store-check.mjs` (vm, imports replaced by
stand-ins, as the journey-wrapper fixture does) over a fake page that counts every
navigation, pacing reservation, 3 s wait and photo fetch, with a store whose pages
are a function of a clock the waits move. Eight tests: origin/status/Access checks
kept and nothing handed on when they fail; the handoff matrix (same page, same
address, once, moved main frame, child frame, drifted address, response for
another address, closed page, later open); an immediate pass sparing exactly the
homepage's first load for all four adopted shapes with pacing, product, category
and photo fetches equal; a change shown after 5 s reloaded fresh after 3 s waits;
six permanent failures with identical problems, waits, tries and deadline; foreign
page, wrong path, moved page, double take, eleven invalid inputs and a closed page
all loading fresh; and the six call sites executed from the spec source.

`compare.mjs` loads base and candidate copies of both modules from Git objects
and runs 18 scenarios through each, failing unless: the base never looks without
loading; the candidate looks once without loading exactly where the scenario says
the opened page stands in; outcomes, waits, pacing, photo fetches and the
product/category load sequence agree; the spared load is the one right after
the open. `loopback-freshness.mjs` checks the one assumption the fake cannot: on
real Playwright 1.61.1 and Chromium over 127.0.0.1, the goto's own
`framenavigated` arrives before `goto` resolves (so a fresh handoff is accepted),
and a hash change, pushState, reload, other page, other address, closed page and
later open are refused while a child frame's navigation is not.

```sh
# from live-journeys/, pinned Node 24.22.0, isolated HOME, DINKUS_E2E_ENV_FILE=/dev/null
node --test runner/unit/homepage-reuse.test.mjs
node --test runner/unit/*.test.mjs
node proof/homepage-reuse-20261107/compare.mjs --base e3fff0090468de0237e10a5d4e9443c0ac761e68 --out proof/homepage-reuse-20261107/comparison.json
node proof/homepage-reuse-20261107/loopback-freshness.mjs --playwright runner/node_modules --chromium "$CHROMIUM" --out proof/homepage-reuse-20261107/loopback.json
```

## Expected work counts (fixture, not live time), limits, one known divergence

Per adopted call: one homepage navigation fewer (the fixture's 4 → 3 loads for a
Draft check); pacing reservations, waits, tries and photo fetches equal, whether
the first look passes or fails. This targets homepage loads inside Manage products
(640.670 s) and One product (327.565 s); no time saving is claimed from the fixture.

- The fixture's `framenavigated` ordering is an assumption until the loopback
  script runs; if it fails, the handoff is refused everywhere (safe, no gain).
- One scenario diverges by design and is asserted as such: a store that stops
  answering right after the homepage opened. The base reloads and fails; the
  candidate's first look is the page it opened, which answered HTTP 200 after the
  change. A true observation, not a hidden failure; no other outcome differs.
- `seconds` in step summaries can read one second lower, since one load is gone.
- Not covered offline: Access sign-in itself, live store behaviour, and the real
  `readCard`/`photo` waits (the stand-ins read the same locators without waiting).

No live run, credential, private report, workflow dispatch, merge, push or PR by
this writer.
