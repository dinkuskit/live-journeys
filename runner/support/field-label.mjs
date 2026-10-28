// How EmDash's editors name a field, with no browser, so the offline checks can test it.

/**
 * The accessible name EmDash's editor gives a field labelled with any of `labels`, as a pattern: the
 * label alone, or the label with "(optional)" after it, which the editor's form kit adds to a field
 * that isn't required.
 */
export function fieldName(labels) {
  const escaped = [labels].flat().map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^(?:${escaped.join("|")})(?: ?\\(optional\\))?$`);
}
