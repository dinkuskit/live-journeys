import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";

export const installSource = readFileSync(new URL("../../tests/01-install-plugins.spec.mjs", import.meta.url), "utf8");
export const connectSource = readFileSync(new URL("../../tests/02-connect-dinkuskit.spec.mjs", import.meta.url), "utf8");

// Execute the actual terminal step, excluding live browser, settings and inbox imports.
// Match the named callback and its closing indentation; fail closed if it moves.
export function runStep(source, name, bindings) {
  const marker = new RegExp(`^( +)await step\\(page, ${JSON.stringify(name)}, async \\(\\) => \\{\\n`, "m");
  const match = marker.exec(source);
  if (!match) throw new Error(`Step not found: ${name}`);
  const start = match.index + match[0].length;
  const end = source.indexOf(`\n${match[1]}});`, start);
  if (end < 0) throw new Error(`Step end not found: ${name}`);
  const follow = source.match(/^const FOLLOW = .*;$/m)?.[0];
  if (!follow) throw new Error("FOLLOW not found");
  const pause = source.match(/^const pause = .*;$/m)?.[0] ?? "";
  return new Script(`(async () => {\n${follow}\n${pause}\n${source.slice(start, end)}\n})()`)
    .runInContext(createContext(bindings));
}
