import assert from "node:assert/strict";
import test from "node:test";
import { COMMERCE_FOR_CATALOG, catalogCanAdd } from "../support/catalog.mjs";

// Full catalog writes categories, photos, pages and products only through Commerce 0.8.0's panel, so an
// older or unreadable Commerce must be refused before the journey writes anything.
test("Full catalog adds only on the Commerce whose panel it drives", () => {
  assert.equal(COMMERCE_FOR_CATALOG, "0.8.0-beta.1");
  for (const version of ["0.8.0-beta.1", "0.8.0-beta.2", "0.8.0", "0.8.1", "0.9.0-beta.1", "1.0.0"]) {
    assert.equal(catalogCanAdd(version), true, version);
  }
});

test("an older or unreadable Commerce gets no writes from Full catalog", () => {
  for (const version of ["0.8.0-beta.0", "0.8.0-alpha.3", "0.7.0", "0.7.0-beta.6", "0.7.0-beta.4", "0.6.0-beta.1", "0.3.0"]) {
    assert.equal(catalogCanAdd(version), false, version);
  }
  for (const version of [null, undefined, "", "unknown", "0.8"]) assert.equal(catalogCanAdd(version), false, String(version));
});
