// Reading the Dinkus Commerce panel's answers, with no browser, so the offline checks can test it.
/** The Regular price in the product form of Commerce's panel answer `data` ("" when blank or missing). */
export function savedRegular(data) {
  const field = (data?.blocks ?? []).filter(block => block?.type === "form").flatMap(block => block.fields ?? [])
    .find(field => field?.action_id === "regular");
  return typeof field?.initial_value === "string" ? field.initial_value.trim() : "";
}

/**
 * Whether Commerce's `toast` answers a press with `message` (a string, or a pattern): a success, or an
 * info notice such as "Add a Regular price to sell it" after a Save that left Regular empty. An error never does.
 */
export function panelSaid(toast, message) {
  if (toast?.type !== "success" && toast?.type !== "info") return false;
  return typeof message === "string" ? toast.message === message : message.test(String(toast.message ?? ""));
}
