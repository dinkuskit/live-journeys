import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";

export const source = readFileSync(new URL("../../tests/problems.spec.mjs", import.meta.url), "utf8");

// Execute the journey's real polling block, without importing the live browser, settings or inbox.
// Delimiters deliberately fail closed if the journey is reorganized.
export function pollingBlock(text) {
  const start = text.indexOf("      const started = Date.now(), deadline = started + config.completeWaitMs;");
  const end = text.indexOf("      // Only now does the test ask for the checkout's status", start);
  if (start < 0 || end < 0) throw new Error("Problems polling block not found");
  return text.slice(start, end);
}

export async function runPoll(block, { snapshots = [[]], timeout = 90_000, failure, readMs = 0 } = {}) {
  let now = 0, reads = 0, navigation = 0, reloads = 0;
  const waits = [];
  const context = createContext({
    config: { completeWaitMs: timeout, ordersAdmin: "fixture-orders" }, newestBefore: 100,
    Date: { now: () => now },
    openAdmin: async () => { navigation++; },
    ordersListed: async () => {},
    testOrders: async () => {
      navigation++; // testOrders always calls openAdmin, then reads every page.
      now += readMs;
      const index = reads++;
      if (failure?.at === index) throw new Error(failure.message);
      return snapshots[Math.min(index, snapshots.length - 1)];
    },
    page: {
      waitForTimeout: async ms => { waits.push(ms); now += ms; },
      reload: async () => { navigation++; reloads++; },
    },
  });
  let added, error;
  try { added = await new Script(`(async () => { ${block}\n return added; })()`).runInContext(context); }
  catch (caught) { error = caught.message; }
  return { added: added && JSON.parse(JSON.stringify(added)), error, reads, navigation, reloads, waits, elapsed: now };
}
