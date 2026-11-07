import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";

export const stepsSource = readFileSync(new URL("../../support/steps.mjs", import.meta.url), "utf8");
export const proofSource = readFileSync(new URL("../../support/proof.mjs", import.meta.url), "utf8");

/**
 * Evaluates the actual proof module from proof.mjs with its imports replaced by `bindings` (the file
 * system it writes with, `join` and `config`), so a check can hand it a disk that fails midway through
 * a write. A fresh copy each time, which loads the report from disk as a new worker's copy does.
 */
export function loadProof(bindings, source = proofSource) {
  const stripped = source.replace(/^import .*$/gm, "").replace(/^export /gm, "");
  if (!/^function noteJourneyTiming\(/m.test(stripped)) throw new Error("noteJourneyTiming not found");
  const names = "startJourney, record, note, noteJourneyTiming, verdicts, attemptVerdict, journeyVerdict";
  return new Script(`${stripped}\n({ ${names} });`).runInContext(createContext(bindings));
}

/**
 * Evaluates the actual journey wrapper from steps.mjs (or another revision's source) with its imports
 * replaced by `bindings`, so the offline checks run it without Playwright. `test`, `expect`, `config`
 * and the proof, pace and error helpers all come from the bindings; everything else in the module is
 * the real source. Fails closed when the module's shape moves.
 */
export function loadJourney(bindings, source = stepsSource) {
  const stripped = source.replace(/^import .*$/gm, "").replace(/^export /gm, "");
  if (!/^function journey\(/m.test(stripped)) throw new Error("journey not found");
  const context = createContext({ performance, ...bindings });
  return new Script(`${stripped}\n({ journey, step });`).runInContext(context);
}

/** Playwright's `test` and `expect`, as far as the wrapper uses them, with the current title and retry. */
export function playwrightStubs(current = { title: "Journey", retry: 0 }) {
  const test = {
    info: () => ({ title: current.title, retry: current.retry }),
    step: (_name, fn) => fn(),
    describe: { configure() {} },
  };
  const expect = (actual, message) => ({
    toBe(expected) { if (actual !== expected) throw new Error(`${message ?? "expect"}: ${actual} is not ${expected}`); },
  });
  return { test, expect, current };
}
