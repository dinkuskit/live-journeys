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
const PAGE_PARTS = new Set(["the title", "the style", "the slug", "the first Save", "Add reference", "the category search", "the category choice", "Add selected", "the filed category", "Save"]);
const KINDS = [
  // products-admin.mjs saveEditor: what covered the editor's Save, in its own fixed words.
  [/The editor's Save took no click: (no dialog is open|the dialog (?:Review proposed changes|Add references) is open|another dialog is open)\./, match => `the editor's Save took no click (${match[1]})`],
  // products-admin.mjs `at`: which part of a product page's editor stopped, from its fixed few.
  [/^At (.+?) of the product page: .*?Timeout (\d+)ms exceeded/, match => `timed out after ${Math.round(Number(match[2]) / 1000)} s at ${PAGE_PARTS.has(match[1]) ? match[1] : "a part"} of the product page`],
  [/^At (.+?) of the product page: /, match => `failed at ${PAGE_PARTS.has(match[1]) ? match[1] : "a part"} of the product page`],
  [/Timeout (\d+)ms exceeded/, match => `timed out after ${Math.round(Number(match[1]) / 1000)} s`],
  [/net::(ERR_[A-Z_]+)/, match => `network error ${match[1]}`],
  [/has been closed|browser has disconnected/, () => "the browser closed"],
  [/strict mode violation/, () => "a locator matched more than one element"],
  [/\bHTTP (\d{3})\b/, match => `an answer of HTTP ${match[1]}`],
  [/expect\(/, () => "an expect check failed"],
  // Connect to DinkusKit (plugin-connect.mjs, dinkuskit-approve.mjs): which part of the walk stopped, and
  // for a refusal the plugin's own fixed banner or DinkusKit.com's error code, never the page's other words.
  [/still asks to connect after this run's Connect: "(.*)"$/, match => `Connect: the plugin refused (${CONNECT_REFUSALS.find(([text]) => match[1].startsWith(text))?.[1] ?? "other banner"})`],
  [/still asks to connect after this run's Connect\.$/, () => "Connect: the plugin still asks to connect, with no reason"],
  [/still waits for DinkusKit\.com after this run's Approve/, () => "Connect: still waiting after Approve and Check"],
  [/waits for DinkusKit\.com after this run's Approve \w+, and offers no Check/, () => "Connect: waiting after Approve with no Check"],
  [/waits for an approval this run didn't start/, () => "Connect: an older waiting approval with no Cancel"],
  [/asks to connect, but offers no Connect/, () => "Connect: no Connect button"],
  [/shows no connection to DinkusKit\.com and no Connect/, () => "Connect: no DinkusKit section"],
  [/isn't connected to DinkusKit\.com, and only the beta store/, () => "Connect: not connected, and this step may not connect it"],
  [/says only an Administrator connects it/, () => "Connect: not an Administrator"],
  [/says to connect Commerce first/, () => "Connect: Commerce first"],
  // Payments status (payments-status.mjs nextPress and the Payments status journey): which ask stopped it.
  [/^Payments status still says ".*" after (Approve payments|Connect again|Connect|Continue|Check connection)\.$/, match => `Payments: the page didn't move on after ${match[1]}`],
  [/Payments status asks for the store key/, () => "Payments: asks to paste the store key"],
  [/Payments status says to connect the Commerce plugin first/, () => "Payments: Commerce first"],
  [/Payments status still asks to select Connect again after this run's Approve payments/, () => "Payments: still asks for Connect again after Approve"],
  [/Payments status says to select Connect again, but it has no Connect again button/, () => "Payments: no Connect again button"],
  [/Payments status shows only its last check/, () => "Payments: shows only its last check"],
  [/Payments status offers Sign in again/, () => "Payments: offers Sign in again"],
  [/asks to connect a DinkusKit account, but it has no Connect button/, () => "Payments: no Connect button"],
  [/doesn't show Connected: Stripe test mode\. It offers/, () => "Payments: connected, but not Stripe test mode"],
  [/Payments status page shows no connect control/, () => "Payments: no connect control"],
  [/Payments status still asks for a connection after its connect controls were used/, () => "Payments: still asks to connect after six presses"],
  [/press got no answer within a minute/, () => "Connect: a press got no answer"],
  [/page didn't change after (Connect again|Connect)\.$/, match => `Connect: the page didn't change after ${match[1]}`],
  [/Connect didn't finish\.$/, () => "Connect: too many presses"],
  [/does not open DinkusKit's connect page/, () => "Connect: the approve link is not DinkusKit's"],
  [/DinkusKit did not show Connect this store\?/, () => "Connect: no consent page"],
  [/DinkusKit did not answer Approve \w+ within a minute/, () => "Connect: no answer to Approve"],
  [/DinkusKit\.com did not approve this connection(?: \(([^)]*)\))?; it sent the owner to (another store page|DinkusKit's (\S*?))\.?$/,
    match => `Connect: Approve refused (${CONSENT_REFUSALS.has(match[1]) ? match[1] : match[1] ? "another code" : "no code"}), sent to ${match[3] === undefined ? "another store page" : CONSENT_DESTINATIONS[match[3]] ?? "another DinkusKit.com page"}`],
  [/did not approve this connection/, () => "Connect: Approve refused"],
  [/The plugin's page did not open after Approve/, () => "Connect: the plugin page didn't open after Approve"],
  [/used approval link/, () => "Connect: the used approval link check failed"],
  [/connect page has no Approve \w+ button/, () => "Connect: no Approve button"],
];

// DinkusKit.com's refusal codes on its connect page (dinkuskit/dinkuskit src/account/connect.ts and the
// store-proof checks it calls). Only these are printed; any other code is "another code".
const CONSENT_REFUSALS = new Set([
  "stale_organization", "organization_forbidden", "unsupported_protocol", "expired_token", "not_pending", "integration_unavailable",
  "proof_expires_too_far", "invalid_client", "approval_failed", "connect_commerce_first", "grant_revoked", "ownership_conflict",
  "origin_id_conflict", "invalid_proof_path", "invalid_proof_query", "invalid_proof_url", "private_proof_destination", "proof_empty",
  "proof_fetch_blocked", "proof_malformed", "proof_redirect_rejected", "proof_timeout", "proof_too_large", "proof_unavailable",
]);
// Where DinkusKit.com sent the owner instead, by fixed name.
const CONSENT_DESTINATIONS = { "/account/connect": "the connect page", "/account/sites": "Your Stores", "/account/sign-in": "sign-in" };

// The plugins' own Connect banners (dinkuskit/commerce src/features/checkout/registry-connect.ts and
// src/admin/connect.ts, dinkuskit/ship src/pages.ts), each with the fixed label the run page prints.
const CONNECT_REFUSALS = [
  ["Connect did not finish.", "did not finish"],
  ["DinkusKit.com could not be reached.", "DinkusKit.com could not be reached"],
  ["Connect needs this store on its https web address", "needs https and a Registry install"],
  ["Connect could not finish.", "could not finish"],
  ["The business owner did not approve", "owner did not approve"],
  ["DinkusKit.com no longer knows this store key.", "key no longer known"],
  ["DinkusKit.com named another store for this web address.", "another store for this address"],
];

/** One fixed kind for a failed step's detail, so the public run page can say how a step failed without its words. */
export const failureKind = detail => {
  for (const [pattern, kind] of KINDS) {
    const match = String(detail ?? "").match(pattern);
    if (match) return kind(match);
  }
  return "one of the step's own checks failed";
};
