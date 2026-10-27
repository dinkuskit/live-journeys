import assert from "node:assert/strict";
import test from "node:test";
import { savedRegular } from "../support/panel-answer.mjs";

// Commerce's panel answer to Save, as products.ts draws it: the product form, then the weight form.
const answer = regular => ({ blocks: [
  { type: "header", text: "Cap" },
  { type: "form", fields: [{ type: "text_input", action_id: "regular", label: "Regular", initial_value: regular }, { type: "text_input", action_id: "sale", label: "Sale", initial_value: "" }] },
  { type: "form", fields: [{ type: "text_input", action_id: "w:x", label: "Weight (oz)", initial_value: "8" }] },
] });

test("the saved price is the Regular box of Commerce's answer", () => {
  assert.equal(savedRegular(answer("12.00")), "12.00");
});

test("a Save that kept no price reads as no price", () => {
  assert.equal(savedRegular(answer("")), "");
  assert.equal(savedRegular({ blocks: [{ type: "form", fields: [{ action_id: "sale", initial_value: "1.00" }] }] }), "");
  assert.equal(savedRegular(null), "");
});
