import assert from "node:assert/strict";
import test from "node:test";
import { panelSaid, savedRegular, savedWeight } from "../support/panel-answer.mjs";

// Commerce's panel answer to Save, as products.ts draws it from 0.8.0: the status grid, the product form
// under "Pricing & stock", then the cards, the Shipping card holding the weight form.
const answer = (regular, weight = "8") => ({ blocks: [
  { type: "fields", fields: [{ label: "Status", value: "Draft: publish to sell it" }, { label: "SKU", value: "CAP" }, { label: "Name (page title)", value: "Cap" }] },
  { type: "header", text: "Pricing & stock" },
  { type: "form", fields: [{ type: "text_input", action_id: "regular", label: "Regular", initial_value: regular }, { type: "text_input", action_id: "sale", label: "Sale", initial_value: "" }] },
  { type: "accordion", label: "Variants · none", blocks: [{ type: "form", fields: [{ type: "text_input", action_id: "optionLabel", label: "Option name", initial_value: "Size" }] }] },
  { type: "accordion", label: "Shipping", blocks: [{ type: "form", fields: [{ type: "text_input", action_id: "w:x", label: "Weight (oz)", ...(weight === null ? {} : { initial_value: weight }) }] }] },
] });

test("the saved price is the Regular box of Commerce's answer", () => {
  assert.equal(savedRegular(answer("12.00")), "12.00");
});

test("a Save that kept no price reads as no price", () => {
  assert.equal(savedRegular(answer("")), "");
  assert.equal(savedRegular({ blocks: [{ type: "form", fields: [{ action_id: "sale", initial_value: "1.00" }] }] }), "");
  assert.equal(savedRegular(null), "");
});

test("a Save that left Regular empty is an answer, so the lost price is typed again", () => {
  const saved = /^(Product saved|Add a Regular price to sell it)$/;
  assert.equal(panelSaid({ type: "success", message: "Product saved" }, saved), true);
  assert.equal(panelSaid({ type: "info", message: "Add a Regular price to sell it" }, saved), true);
  assert.equal(panelSaid({ type: "success", message: "Weight saved" }, "Weight saved"), true);
  assert.equal(panelSaid({ type: "error", message: "Add a Regular price to sell it" }, saved), false, "a refusal is never an answer");
  assert.equal(panelSaid({ type: "info", message: "Add a Regular price to sell it" }, "Product saved"), false);
  assert.equal(panelSaid(undefined, saved), false);
});

test("the saved weight is the Shipping card's Weight (oz) box of Commerce's answer", () => {
  assert.equal(savedWeight(answer("12.00", "8")), "8");
  assert.equal(savedWeight(answer("12.00", " 12.5 ")), "12.5");
});

test("an answer with no weight, or no Shipping card, reads as no weight", () => {
  assert.equal(savedWeight(answer("12.00", null)), "");
  assert.equal(savedWeight({ blocks: [{ type: "form", fields: [{ action_id: "regular", initial_value: "8" }] }] }), "", "a digital product has no Shipping card");
  assert.equal(savedWeight(null), "");
});

test("the first Save's answer says the Draft was made", () => {
  const made = /^Draft made\. Publish the page to sell it\.$/;
  assert.equal(panelSaid({ type: "success", message: "Draft made. Publish the page to sell it." }, made), true);
  assert.equal(panelSaid({ type: "error", message: "Add a Regular price to sell it" }, made), false);
  assert.equal(panelSaid({ type: "success", message: "Linked." }, made), false, "linking a product to a page is gone");
});
