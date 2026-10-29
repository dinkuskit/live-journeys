import { config } from "./env.mjs";
import { note } from "./proof.mjs";

// An agent working on the store with an EmDash API key and nothing else: the key the test makes from
// the owner's sign-in, the agent's calls with it, and the key's deletion at the end. Mark as completed
// and An agent manages a product use these.

export const hostOf = location => { try { return new URL(location ?? "", config.store).hostname; } catch { return "an unreadable address"; } };
const redirected = response => response.status >= 300 && response.status < 400;

/**
 * A call from the test itself rather than from its browser, so neither the agent's key nor the
 * answer that carries it ever passes through the browser. A failure names only what went wrong.
 */
export async function send(url, init, what) {
  return fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(30_000) })
    .catch(error => { throw new Error(`The test couldn't reach ${what} (${error.cause?.code ?? error.name}).`); });
}

/** A refused call's HTTP status and the reason EmDash or Commerce gave, or where it was sent instead. */
export function refusal(response, answer) {
  if (redirected(response)) return `HTTP ${response.status} to ${hostOf(response.headers.get("location"))}`;
  const reason = answer?.error?.message;
  return `HTTP ${response.status}${typeof reason === "string" ? `, "${reason.slice(0, 200)}"` : ""}`;
}

/** The cookies the owner's browser sends to one store address: its EmDash sign-in, and its Access sign-in when Access fronts it. */
async function ownerCookies(page, url) {
  return (await page.context().cookies(url)).map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
}

/** Commerce's private catalog API (catalog-api-20261027), beside its orders API on the store's Orders page. */
export function commerceCatalogApi() {
  const orders = config.ordersAdmin.replace("/_emdash/admin/plugins/", "/_emdash/api/plugins/");
  if (orders === config.ordersAdmin || !orders.endsWith("/orders")) {
    throw new Error("DINKUS_E2E_ORDERS_ADMIN isn't Commerce's Orders page in the store admin, so the test can't tell where Commerce's catalog API is.");
  }
  return orders.replace(/\/orders$/, "/catalog");
}

/**
 * The Commerce product a product page sells, asked of Commerce's catalog API as the signed-in owner:
 * Commerce holds the page's link (catalog-page-link-in-commerce-20261029). "" when it links none.
 */
export async function pageProductId(page, entryId) {
  const url = commerceCatalogApi();
  const response = await send(url, { method: "POST", body: JSON.stringify({ op: "get", entryId }),
    headers: { cookie: await ownerCookies(page, url), "content-type": "application/json", "X-EmDash-Request": "1" } }, "Commerce's catalog API");
  const answer = await response.json().catch(() => null);
  if (!response.ok || answer?.success !== true) throw new Error(`Commerce's catalog API wouldn't say which product the page sells (${refusal(response, answer)}).`);
  const id = answer.data?.product?.catalogItemId;
  return typeof id === "string" ? id : "";
}

/** How a key the test couldn't delete ends, for the finding. */
export const keyLeft = ({ name, expiresAt }) => `It stops working at ${expiresAt.slice(11, 16)} UTC on its own; to end it sooner, revoke "${name}" under Settings, API Tokens in the store admin.`;

/** Deletes a key by its ID as the signed-in owner; a refusal fails with its reason. */
async function revokeKey(page, id) {
  const url = `${config.store}/_emdash/api/admin/api-tokens/${encodeURIComponent(id)}`;
  const response = await send(url, { method: "DELETE", headers: { cookie: await ownerCookies(page, url), "X-EmDash-Request": "1" } }, "EmDash's API tokens");
  const answer = await response.json().catch(() => null);
  if (!response.ok || answer?.data?.revoked !== true) throw new Error(`EmDash didn't delete the agent's key (${refusal(response, answer)}).`);
}

/**
 * Asks EmDash, as the signed-in owner, for an admin key that stops working after an hour; EmDash
 * lets a key call a plugin's private routes only with the admin scope. Only the key's name and when
 * it stops working ever reach the proof.
 */
export async function makeAgentKey(page, name) {
  const url = `${config.store}/_emdash/api/admin/api-tokens`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const response = await send(url, { method: "POST", body: JSON.stringify({ name, scopes: ["admin"], expiresAt }),
    headers: { cookie: await ownerCookies(page, url), "content-type": "application/json", "X-EmDash-Request": "1" } }, "EmDash's API tokens")
    .catch(error => { throw new Error(`${error.message} EmDash may have made the key anyway. ${keyLeft({ name, expiresAt })}`); });
  const answer = await response.json().catch(() => null);
  const made = answer?.data;
  const id = made?.info?.id;
  if (response.status === 201 && typeof made?.token === "string" && id) return { name, expiresAt, id, key: made.token };
  if (response.status !== 201) throw new Error(`EmDash didn't make the agent's key (${refusal(response, answer)}).`);
  // A key the test can't use is deleted at once rather than left working for its hour.
  const left = id
    ? await revokeKey(page, id).then(() => "The test deleted it again.", error => `${error.message} ${keyLeft({ name, expiresAt })}`)
    : keyLeft({ name, expiresAt });
  throw new Error(`EmDash said it made the agent's key but sent none the test could use. ${left}`);
}

/**
 * The first entry `match` picks from an EmDash content list read a page at a time, following each
 * page's cursor as EmDash's own admin does: `read(cursor)` answers one page's `{ items, nextCursor }`,
 * the first with no cursor. Null when no page holds one; a list still offering pages after `most` reads
 * fails instead.
 */
export async function findListed(read, match, most = 50) {
  let cursor = "";
  for (let reads = 0; reads < most; reads++) {
    const { items = [], nextCursor = "" } = await read(cursor) ?? {};
    const found = items.find(match);
    if (found) return found;
    if (!nextCursor || !items.length) return null;
    cursor = nextCursor;
  }
  throw new Error(`EmDash's list kept offering more pages after ${most} reads.`);
}

/**
 * One call to the store as an agent makes it, with the key and nothing of the owner's sign-in: a POST of
 * `input` to `agent.api` unless `url` and `method` say otherwise. When Cloudflare Access fronts the
 * store's API too, the call also carries the test's Access sign-in, as an agent's Access service token
 * would; EmDash still goes by the key alone.
 */
export async function agentCall(page, agent, input, { url = agent.api, method = "POST", what = "Commerce's orders API" } = {}) {
  // The agent's key belongs to the store, so it is never sent anywhere else.
  if (new URL(url).origin !== config.store) throw new Error(`The test won't send the agent's key to ${hostOf(url)}, which isn't the store.`);
  const headers = { authorization: `Bearer ${agent.key}`, ...(input !== undefined && { "content-type": "application/json" }), ...(agent.access && { cookie: agent.access }) };
  const response = await send(url, { method, headers, ...(input !== undefined && { body: JSON.stringify(input) }) }, what);
  if (!agent.access && redirected(response) && hostOf(response.headers.get("location")).endsWith(".cloudflareaccess.com")) {
    const access = (await page.context().cookies(url)).find(cookie => cookie.name === "CF_Authorization");
    if (!access) throw new Error("Cloudflare Access sends the agent's calls to its sign-in page, and the test has no Access sign-in to carry for the store's API.");
    agent.access = `${access.name}=${access.value}`;
    note("agent's Access sign-in", "Cloudflare Access fronts the store's API, so the agent's calls carry the test's Access sign-in beside the key");
    return agentCall(page, agent, input, { url, method, what });
  }
  return { response, answer: await response.json().catch(() => null) };
}

/**
 * Deletes the agent's key as the signed-in owner, then checks that a call with it is refused: `probe`
 * makes one call with the key, as agentCall does.
 */
export async function deleteAgentKey(page, agent, probe) {
  await revokeKey(page, agent.id).catch(error => { throw new Error(`${error.message} ${keyLeft(agent)}`); });
  const after = await probe()
    .catch(error => { throw new Error(`EmDash deleted the agent's key, but the test couldn't try the key again: ${error.message}`); });
  if (after.response.status !== 401 || after.answer?.error?.code !== "INVALID_TOKEN") {
    throw new Error(`EmDash deleted the agent's key, but a call with it got ${refusal(after.response, after.answer)} instead of HTTP 401 for an unknown key. ${keyLeft(agent)}`);
  }
  return `EmDash deleted "${agent.name}", and a call with it now gets HTTP 401`;
}
