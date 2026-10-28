import { agentCall, deleteAgentKey, makeAgentKey, refusal } from "../support/agent-api.mjs";
import { test, expect } from "../support/browser.mjs";
import { placeTestOrder } from "../support/checkout.mjs";
import { config } from "../support/env.mjs";
import { note, record } from "../support/proof.mjs";
import { completionProblems, numberOf, openOrder, orderShown, ordersListed, testOrders } from "../support/orders-admin.mjs";
import { confirmed, notePlugins, openAdmin } from "../support/store-admin.mjs";
import { journey, step } from "../support/steps.mjs";

// What an order's page in Commerce Orders shows for a carrier or tracking number nobody gave.
const NOT_RECORDED = "Not recorded";

/** Places a Stripe TEST order, or takes the order DINKUS_E2E_ORDERS_TO_COMPLETE names for this part of the journey. */
async function orderToComplete(page, name, given, who) {
  if (given) {
    record(name, "SKIP", `completing order #${given} from DINKUS_E2E_ORDERS_TO_COMPLETE instead of placing one`);
    return { number: given };
  }
  let placed;
  await step(page, name, async () => {
    placed = await placeTestOrder(page);
    if (placed.state !== "paid") throw new Error(`Commerce reports this checkout as "${placed.state}", not paid.`);
    if (!placed.orderId) throw new Error("Commerce's checkout status named no order.");
    note(`${who}'s order`, placed.orderId);
    return `Commerce recorded the payment for ${placed.orderId}`;
  });
  return { orderId: placed.orderId };
}

/** Commerce's orders API, beside Commerce Orders: where agents and the CLI read and complete orders. */
function ordersApi() {
  const api = config.ordersAdmin.replace("/_emdash/admin/plugins/", "/_emdash/api/plugins/");
  if (api === config.ordersAdmin) throw new Error("DINKUS_E2E_ORDERS_ADMIN isn't a plugin page in the store admin, so the test can't tell where Commerce's orders API is.");
  // The agent's key belongs to the store, so it is never sent anywhere else.
  if (new URL(api).origin !== config.store) throw new Error("DINKUS_E2E_ORDERS_ADMIN is on another site than DINKUS_E2E_STORE, so the test won't send the store's key there.");
  return api;
}

/** What Commerce's orders API answers the agent; a refusal fails with its reason. */
async function agentAsk(page, agent, input) {
  const { response, answer } = await agentCall(page, agent, input);
  if (!response.ok || answer?.success !== true) throw new Error(`Commerce's orders API refused the agent's "${input.action}" (${refusal(response, answer)}).`);
  return answer.data;
}

/** The agent's view of an order, giving Orders a minute to keep its copy of a new one; null when it never does. */
async function agentOrder(page, agent, orderId) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const { order } = await agentAsk(page, agent, { action: "show", orderId });
    if (order || Date.now() > deadline) return order ?? null;
    await page.waitForTimeout(5_000);
  }
}

// Completing an order without a label: the owner marks a paid TEST order completed in Commerce
// Orders, typing a carrier and tracking number, and an agent completes another through Commerce's
// orders API, sending neither. Both end Completed.
test("Mark as completed", { tag: "@running" }, journey(async ({ page }) => {
  expect(config.store, `Set DINKUS_E2E_STORE to the store's address (in ${config.settingsFile})`).not.toBe("");
  const stamp = new Date().toISOString().replace(/^\d{4}-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d).*$/, "$1$2-$3$4$5");
  // Unique to the second and plainly the live test's, so one run's tracking number never passes for another's.
  const typed = { carrier: "USPS", tracking: `LIVE-TEST-${stamp}` };
  // A typo in the orders to complete stops the run before it places or completes any order. Entries
  // are compared as the order numbers they pick, so "1003,01003" counts as the same order twice.
  const given = config.ordersToComplete.map(number => /^#?\d+$/.test(number) ? Number(number.replace(/^#/, "")) : NaN);
  expect(given.length <= 2 && given.every(number => Number.isSafeInteger(number) && number > 0) && new Set(given).size === given.length,
    `DINKUS_E2E_ORDERS_TO_COMPLETE reads "${config.ordersToComplete.join(",")}"; set it to one or two different order numbers like 1003,1004, or leave it empty to place new orders (in ${config.settingsFile})`).toBe(true);
  const [ownerGiven, agentGiven] = given;
  const soft = { soft: true };

  // Without Commerce Orders nothing can be marked completed, so this step stops the journey.
  await step(page, "The owner can open Commerce Orders", async () => {
    await openAdmin(page, config.ordersAdmin);
    await ordersListed(page);
    await notePlugins(page);
    return "Commerce Orders opened in the store admin";
  });

  // An order that wasn't placed can't be completed, so a failed order stops the journey.
  const ownerOrder = await orderToComplete(page, "A shopper places a Stripe TEST order for the owner to complete", ownerGiven, "owner");

  let ownerNumber;
  await step(page, "The owner marks the order completed with a carrier and tracking number", async () => {
    const number = ownerOrder.number ?? await numberOf(page, ownerOrder.orderId, "Processing");
    const before = await openOrder(page, number);
    // The test only ever completes TEST orders.
    if (!before.test) throw new Error(`Order #${number} isn't a TEST order, so the test leaves it alone.`);
    if (before.status !== "Processing") throw new Error(`Order #${number} shows ${before.status ?? "no status"}, not Processing, so it can't be marked completed.`);
    ownerNumber = number;
    note("owner's order number", `#${number}`);
    await page.getByRole("button", { name: "Complete order", exact: true }).click();
    await page.getByRole("textbox", { name: "Carrier (optional)", exact: true }).fill(typed.carrier);
    await page.getByRole("textbox", { name: "Tracking number (optional)", exact: true }).fill(typed.tracking);
    await page.getByRole("button", { name: "Complete order", exact: true }).click();
    await confirmed(page, "Order completed");
    const problems = completionProblems(await orderShown(page), typed);
    if (problems.length) throw new Error(`Commerce said "Order completed", but ${problems.join(" and ")}.`);
    return `#${number} Completed with carrier ${typed.carrier} and tracking number ${typed.tracking}`;
  }, soft);

  if (!ownerNumber) record("Commerce Orders keeps the owner's order Completed", "SKIP", "the owner's order wasn't marked completed");
  else await step(page, "Commerce Orders keeps the owner's order Completed", async () => {
    const listed = (await testOrders(page)).find(order => order.number === ownerNumber);
    if (listed?.status !== "Completed") throw new Error(`Commerce Orders lists #${ownerNumber} as ${listed?.status ?? "missing"}, not Completed.`);
    const problems = completionProblems(await openOrder(page, ownerNumber), typed);
    if (problems.length) throw new Error(`Opened again, #${ownerNumber} ${problems.join(" and ")}.`);
    return `listed Completed, and its page still shows carrier ${typed.carrier} and tracking number ${typed.tracking}`;
  }, soft);

  // The agent works with an admin key the test makes from the owner's sign-in and deletes at the end.
  let agent;
  try {
    // Without a key the agent can do nothing, so this step stops the journey.
    await step(page, "The test makes a one-hour key for the agent", async () => {
      const api = ordersApi();
      agent = { ...await makeAgentKey(page, `Live test agent ${stamp}`), api };
      note("agent's key", `"${agent.name}", stops working at ${agent.expiresAt}`);
      return `EmDash made the admin key "${agent.name}", which stops working at ${agent.expiresAt.slice(11, 16)} UTC`;
    });

    const agentPlaced = await orderToComplete(page, "A shopper places a second Stripe TEST order for the agent to complete", agentGiven, "agent");

    let agentDone;
    await step(page, "An agent marks the order completed through Commerce's orders API, sending no carrier or tracking number", async () => {
      const orderId = agentPlaced.orderId ?? (await openOrder(page, agentPlaced.number)).orderId;
      if (!orderId) throw new Error(`Order #${agentPlaced.number}'s page in Commerce Orders shows no order ID for the agent to use.`);
      agent.orderId = orderId;
      const before = await agentOrder(page, agent, orderId);
      if (!before) throw new Error(`Commerce's orders API still doesn't know order ${orderId} a minute later.`);
      const label = before.number ? `#${before.number}` : orderId;
      // The test only ever completes TEST orders.
      if (before.test !== true) throw new Error(`Order ${label} isn't a TEST order, so the test leaves it alone.`);
      if (before.status !== "processing") throw new Error(`Commerce's orders API says order ${label} is ${before.status ?? "in no status"}, not processing, so it can't be marked completed.`);
      const { result, order } = await agentAsk(page, agent, { action: "complete", orderId, version: before.version });
      if (result !== "saved") throw new Error(`Commerce answered "${result}", not "saved", to completing ${label} at version ${before.version}.`);
      const problems = [];
      if (order?.status !== "completed") problems.push(`the order is ${order?.status ?? "missing"}, not completed`);
      if (order?.version !== before.version + 1) problems.push(`its version is ${order?.version ?? "missing"}, not ${before.version + 1}`);
      if (!order?.completed?.at) problems.push("it has no completion time");
      if (order?.completed?.carrier || order?.completed?.tracking) problems.push("it has a carrier or tracking number the agent never sent");
      if (problems.length) throw new Error(`Commerce saved the agent's change, but ${problems.join(" and ")}.`);
      agentDone = { orderId, number: order.number };
      return `${label} completed at version ${order.version}, with no carrier or tracking number`;
    }, soft);

    if (!agentDone) record("Commerce Orders shows the agent's order Completed", "SKIP", "the agent's order wasn't marked completed");
    else await step(page, "Commerce Orders shows the agent's order Completed", async () => {
      // Orders numbers an order when its page next opens, so one the agent completed first may have no number yet.
      const number = agentDone.number ?? await numberOf(page, agentDone.orderId, "Completed");
      note("agent's order number", `#${number}`);
      const listed = (await testOrders(page)).find(order => order.number === number);
      if (listed?.status !== "Completed") throw new Error(`Commerce Orders lists #${number} as ${listed?.status ?? "missing"}, not Completed.`);
      const problems = completionProblems(await openOrder(page, number), { carrier: NOT_RECORDED, tracking: NOT_RECORDED });
      if (problems.length) throw new Error(`Opened, #${number} ${problems.join(" and ")}.`);
      return `#${number} is listed Completed, and its page shows carrier and tracking number "${NOT_RECORDED}"`;
    }, soft);
  } finally {
    if (agent) await step(page, "The test deletes the agent's key", () => deleteAgentKey(page, agent, () => agentCall(page, agent, { action: "show", orderId: agent.orderId ?? "order:none" })), soft);
  }
}));
