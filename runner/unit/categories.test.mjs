import assert from "node:assert/strict";
import test from "node:test";
import { findListed } from "../support/agent-api.mjs";
import { categoryHides } from "../support/store-check.mjs";

test("a category the store's other products are in must keep answering once the run's product is gone", () => {
  const path = "/categories/catalog-caps";
  assert.deepEqual(categoryHides({ path, status: 200, listed: false, shared: true }), []);
  assert.deepEqual(categoryHides({ path, status: 200, listed: true, shared: true }), [`the category page ${path} still lists it`]);
  for (const status of [404, 500]) {
    assert.deepEqual(categoryHides({ path, status, listed: false, shared: true }), [`the category page ${path} answered HTTP ${status}`], String(status));
  }
});

test("a category the run made may stop answering once the clean-up trashed it, but not while its product is only archived", () => {
  const path = "/categories/run-1";
  assert.deepEqual(categoryHides({ path, status: 404, listed: false }), []);
  assert.deepEqual(categoryHides({ path, status: 404, listed: false, archived: true }), [`the category page ${path} answered HTTP 404`]);
  assert.deepEqual(categoryHides({ path, status: 200, listed: true }), [`the category page ${path} still lists it`]);
});

test("the agent finds a category on any page of EmDash's list, following each page's cursor", async () => {
  const pages = { "": { items: [{ id: "a" }], nextCursor: "c1" }, c1: { items: [{ id: "b" }], nextCursor: "c2" }, c2: { items: [{ id: "tees" }] } };
  const asked = [];
  const read = async cursor => { asked.push(cursor); return pages[cursor]; };
  assert.deepEqual(await findListed(read, item => item.id === "tees"), { id: "tees" });
  assert.deepEqual(asked, ["", "c1", "c2"]);
  // It stops at the first page that holds one.
  asked.length = 0;
  assert.deepEqual(await findListed(read, item => item.id === "a"), { id: "a" });
  assert.deepEqual(asked, [""]);
  // None on any page, or an empty page that still offers a cursor, is null.
  assert.equal(await findListed(read, item => item.id === "hoodies"), null);
  assert.equal(await findListed(async () => ({ items: [], nextCursor: "again" }), () => true), null);
});

test("a list that never stops offering pages fails rather than reading forever", async () => {
  let reads = 0;
  await assert.rejects(findListed(async () => ({ items: [{ id: ++reads }], nextCursor: `c${reads}` }), () => false, 5), /after 5 reads/);
  assert.equal(reads, 5);
});
