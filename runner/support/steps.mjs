import { test, expect } from "./browser.mjs";
import { config } from "./env.mjs";
import { firstLine, forProof } from "./errors.mjs";
import { paceSnapshot } from "./pace.mjs";
import { attemptVerdict, journeyVerdict, noteJourneyTiming, record, shot, startJourney } from "./proof.mjs";

// Errors that stopped a journey inside a step, which recorded them already.
const recorded = new WeakSet();

/**
 * Runs one step, recording PASS or FAIL with the reason and a screenshot. A `soft` step's
 * failure is recorded and the run goes on; it returns undefined. `soft` can instead be a test of
 * the error, so the step stops the journey only on the errors that test refuses.
 */
export async function step(page, name, body, { soft = false } = {}) {
  return test.step(name, async () => {
    try {
      const detail = await body();
      await shot(page, name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      record(name, "PASS", detail && typeof detail === "object" ? JSON.stringify(detail) : detail ?? "");
      return detail;
    } catch (caught) {
      // What the proof and Playwright's report keep of the failure: its first line, with no address's query.
      const error = forProof(caught);
      await shot(page, `fail-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
      record(name, "FAIL", firstLine(error));
      if (typeof soft === "function" ? soft(error) : soft) return;
      if (Object(error) === error) recorded.add(error);
      throw error;
    }
  });
}

/**
 * Wraps one journey's body as a Playwright test function; PROOF.md groups its steps under the
 * test's title. Tag the test with its stage in the journeys plan: `npm test` runs every
 * `@running` journey. The body gets the saved profile's page, signed in to the store admin and
 * Ship, unless `profile` is false (a shopper journey that opens its own clean browser).
 *
 *   test("Storefront", { tag: "@running" }, journey(async () => { ... }, { profile: false }));
 */
export function journey(body, { profile = true } = {}) {
  const run = async page => {
    const name = test.info().title;
    const retry = test.info().retry;
    startJourney(name, retry);
    // The private timing fact measures the body alone, from here to its return or throw, on the
    // monotonic clock: the fixtures that open and close its browser run outside this function, and
    // startJourney's write above and the fact's own write below fall outside the measured span.
    const from = performance.now();
    const paced = paceSnapshot();
    let to, ended;
    try {
      await body({ page });
      to = performance.now();
      ended = "returned";
    } catch (caught) {
      to = performance.now();
      ended = "threw";
      const error = forProof(caught);
      // An error between steps (a page that wouldn't open) still fails the journey in its proof.
      if (!recorded.has(error)) record("The journey finished without an error", "FAIL", firstLine(error));
      throw error;
    } finally {
      // Written once per try, whether the body returned or threw; a try cut off before this point
      // leaves no entry. Timing can never change a journey's outcome, so a write that fails is let go.
      try { timing(name, retry, ended, to - from, paced); } catch {}
    }
    console.log(`\n${name}: ${journeyVerdict(name)}\n`);
    // A step that failed softly still fails its journey, so "run the test" exits non-zero. Only this
    // try counts here: a retry that passed passes, and the proof still names the failed try.
    expect(attemptVerdict(name), `see ${config.runDir}/PROOF.md`).toBe("PASS");
  };
  // Playwright starts only the fixtures a test names, so a profile-free journey never opens the saved profile.
  return profile ? async ({ page }) => run(page) : async ({}) => run(undefined);
}

/**
 * One try's private timing, in whole milliseconds: how long its body ran, and how many explicit
 * pace sleeps it took meanwhile, what they asked for, what they measured (more when a timer fired
 * late), and their wall time (less than the measured sum when sleeps overlapped). Whatever the body
 * spent beyond the sleeps is unattributed: the store, the network, the browser or the runner itself;
 * nothing here says which.
 */
function timing(name, retry, body, bodyMs, before) {
  const after = paceSnapshot();
  noteJourneyTiming(name, retry, {
    body,
    verdict: attemptVerdict(name),
    body_ms: Math.round(bodyMs),
    pace_sleeps: after.sleeps - before.sleeps,
    pace_sleep_requested_ms: Math.round(after.requestedMs - before.requestedMs),
    pace_sleep_ms: Math.round(after.ms - before.ms),
    pace_sleep_wall_ms: Math.round(after.wallMs - before.wallMs),
  });
}

/**
 * Lets the journeys in this spec file run once more, inside the same run, when they fail. Call it at
 * the top of the file, only for a journey that places no order, pays nothing, buys no label and walks
 * the same path on a second try. A journey that changes the store (installs, Connect, settings, catalog) would
 * find that change already made and skip the checks its first try failed. The proof and the run page
 * show a journey that passed only on its retry as FLAKY.
 */
export const mayRunTwice = () => test.describe.configure({ retries: 1 });
