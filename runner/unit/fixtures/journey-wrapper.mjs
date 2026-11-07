import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";

export const stepsSource = readFileSync(new URL("../../support/steps.mjs", import.meta.url), "utf8");

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
