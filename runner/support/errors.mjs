/**
 * Text with each address's query and fragment cut off, where sign-in links, connect addresses and
 * Ship's sign-in code carry their secret, whether the address is whole (with any scheme) or starts at
 * the site's root (as a link's markup gives it), and with the token cut from a Ship print link, which
 * carries it in the path. What follows a query up to the next space or quote goes with it.
 */
export const withoutQueries = text => String(text)
  .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'<>?#]+|(?<![\w/.-])\/[^\s"'<>?#]*)[?#][^\s"'<>]*/g, "$1")
  .replace(/(\/print\/)[^\s"'<>?#]+/g, "$1");

/**
 * What the proof keeps of a failure, or of anything else thrown: its first line with words on it, without
 * the terminal colours Playwright's assertions use or any address's query.
 */
export const firstLine = error => withoutQueries(String(error?.message ?? error).replace(/\u001b\[[0-9;]*m/g, "").split("\n").find(line => line.trim()) ?? "");

/**
 * The error as the proof may keep it: its first line and nothing else. Playwright puts what went wrong
 * on that line, and below it lists what it saw: for a request the test sends itself, every header sent
 * and received, the store's Cloudflare Access and DinkusKit.com sign-in cookies among them; for a page
 * load or a wait, the addresses the page went to; each element a locator matched, links included; what
 * an assertion expected and received. A failed assertion also carries a snapshot of the page, with its
 * links and what its fields hold, and an error can carry its cause. A failure's proof (console.log,
 * Playwright's report, error-context.md, report.json) prints the error, so all of that goes, and the
 * first line loses each address's query. Returns the same error, or, when it can't be changed, a copy
 * of the same kind.
 */
export function forProof(error) {
  if (Object(error) !== error || typeof error.message !== "string") return error;
  const kept = firstLine(error);
  if (kept === error.message && !("matcherResult" in error) && !("cause" in error)) return error;
  // As Playwright rewrites its own errors: the stack keeps its frames and takes the new message, so the
  // old one doesn't stay behind in it.
  const frames = String(error.stack ?? "").split("\n").filter(line => line.startsWith("    at "));
  const stack = [`${error.name}: ${kept}`, ...frames].join("\n");
  try {
    error.message = kept;
    error.stack = stack;
    delete error.matcherResult;
    delete error.cause;
    return error;
  } catch {
    // A message set after the error was made is one of its own properties, so it's set again here.
    const { matcherResult, cause, ...own } = error;
    return Object.assign(Object.setPrototypeOf(new Error(kept), Object.getPrototypeOf(error)), own, { name: error.name, message: kept, stack });
  }
}

// A failed step's kind, from what the proof keeps of its error. The public run page prints only these
// fixed words and numbers, since the error's own words can carry what the page said.
const KINDS = [
  [/Timeout (\d+)ms exceeded/, match => `timed out after ${Math.round(Number(match[1]) / 1000)} s`],
  [/net::(ERR_[A-Z_]+)/, match => `network error ${match[1]}`],
  [/has been closed|browser has disconnected/, () => "the browser closed"],
  [/strict mode violation/, () => "a locator matched more than one element"],
  [/\bHTTP (\d{3})\b/, match => `an answer of HTTP ${match[1]}`],
  [/expect\(/, () => "an expect check failed"],
];

/** One fixed kind for a failed step's detail, so the public run page can say how a step failed without its words. */
export const failureKind = detail => {
  for (const [pattern, kind] of KINDS) {
    const match = String(detail ?? "").match(pattern);
    if (match) return kind(match);
  }
  return "one of the step's own checks failed";
};
