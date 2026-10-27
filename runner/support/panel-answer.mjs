// Reading the Dinkus Commerce panel's answers, with no browser, so the offline checks can test it.
/** The Regular price in the product form of Commerce's panel answer `data` ("" when blank or missing). */
export function savedRegular(data) {
  const field = (data?.blocks ?? []).filter(block => block?.type === "form").flatMap(block => block.fields ?? [])
    .find(field => field?.action_id === "regular");
  return typeof field?.initial_value === "string" ? field.initial_value.trim() : "";
}
