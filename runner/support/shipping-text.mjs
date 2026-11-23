// What the Ship plugin's Shipping page says, read as text (dinkuskit/ship src/pages.ts and src/admin.ts).

/**
 * The Shipping page's menu labels and folder: from Ship's sidebar folder change (dinkuskit/ship
 * emdash-plugin.jsonc) "Shipments" in a "Dinkus Ship" folder, before it "Shipping" with no folder. From
 * the Store folder change (admin-one-store-folder-128 in dinkuskit/dinkuskit) the folder is "Store",
 * shared with Commerce, Payments and the store's Products. The path stays /shipping, and the page's
 * heading follows the menu label.
 */
export const SHIPPING_LABELS = ["Shipments", "Shipping"];
export const SHIP_FOLDERS = ["Store", "Dinkus Ship"];

/** Where a plugin's Shipping page sits in the store admin. */
const SHIPPING_PATH = /^\/_emdash\/admin\/plugins\/[^/]+\/shipping$/;

/** The Shipping pages among the store admin's menu links (absolute URLs), each once. */
export function shippingPages(hrefs, store) {
  const pages = new Set();
  for (const href of hrefs) {
    let url;
    try { url = new URL(href, store); } catch { continue; }
    if (url.origin === store && SHIPPING_PATH.test(url.pathname) && !url.search && !url.hash) pages.add(url.href);
  }
  return [...pages];
}

/** The price and tracking number in the Shipping page's "Label bought" message for a sandbox label, or null. */
export function boughtMessage(text) {
  const [, price, tracking] = /^Label bought, (\$\d+\.\d\d) sandbox\. Tracking ([A-Z0-9]+)\.$/.exec(String(text).trim()) ?? [];
  return tracking ? { price, tracking } : null;
}

/**
 * The price a quoted USPS service shows for `service`, or null. From Ship 0.4 the service is a radio
 * choice, "USPS Ground Advantage · $5.12" ("· not available for this package" when it has none).
 */
export function servicePrice(options, service) {
  for (const option of options) {
    const price = String(option).trim().startsWith(`${service} · `) && / · (\$\d+\.\d\d)$/.exec(String(option).trim())?.[1];
    if (price) return price;
  }
  return null;
}

/** Ounces in a weight as Ship writes it ("12.5 oz", "2 lb" or "1 lb 4.5 oz"), or NaN. */
export function ounces(text) {
  const [, pounds, rest] = /^(?:(\d+) lb)?\s*(?:(\d+(?:\.\d+)?) oz)?$/.exec(String(text ?? "").trim()) ?? [];
  return pounds === undefined && rest === undefined ? NaN : Number(pounds ?? 0) * 16 + Number(rest ?? 0);
}

/**
 * The package weight the label form should start with: the items' weight ("1 lb 4.5 oz") plus the
 * chosen box's empty weight ("Mailer: 10 × 8 × 2 in, 3 oz empty"), to a tenth of an ounce and within
 * Ship's 0.1 to 1120 oz. Null when either can't be read.
 */
export function expectedWeight(items, box) {
  const total = ounces(items) + ounces(/, ([^,]+) empty$/.exec(String(box ?? "").trim())?.[1]);
  return Number.isFinite(total) ? Math.max(0.1, Math.min(1120, Math.round(total * 10) / 10)) : null;
}

/** A status as Ship 0.4 shows it, without the coloured dot before it ("🟡 Needs label" reads "Needs label"). */
export const statusText = text => String(text ?? "").trim().replace(/^[^\p{L}\p{N}]+/u, "");

// The Labels table's header row on an order's page, as the page's text gives it (cells split by tabs).
const LABELS_HEADER = ["Bought", "Service", "Tracking number", "Status"];

/**
 * TEST order #number's page from Ship 0.4 on, from the page's lines of text (dinkuskit/ship src/pages.ts
 * orderPage): `status`, the line under the order's heading without its item count ("ready to ship · No
 * label yet", "Label bought", "Completed in Commerce"); `shipTo`, its first line; `itemsWeight` from the
 * Package column ("1 lb 4.5 oz"), shown while there is no live label; `label`, the live label's Service,
 * Tracking number and Postage, or null; and `labels`, the Labels table's rows (every label, the live one
 * too), each status without its dot. Null when the page isn't that order's.
 */
export function orderPageText(lines, number) {
  const at = lines.indexOf(`Order #${number} (TEST)`);
  if (at < 0) return null;
  const from = name => { const index = lines.indexOf(name, at); return index < 0 ? null : index; };
  const shipTo = from("Ship to"), pack = from("Package"), live = from("Label");
  const bought = live === null ? undefined : lines.slice(live).find(line => /^Label bought .+ · /.test(line));
  const header = lines.findIndex(line => line.split("\t").map(cell => cell.trim()).join("|") === LABELS_HEADER.join("|"));
  const labels = [];
  for (const line of header < 0 ? [] : lines.slice(header + 1)) {
    const cells = line.split("\t").map(cell => cell.trim());
    if (cells.length !== LABELS_HEADER.length) break;
    labels.push({ ...Object.fromEntries(LABELS_HEADER.map((name, index) => [name, cells[index]])), Status: statusText(cells[3]) });
  }
  return {
    status: (lines[at + 1] ?? "").replace(/^\d+ items?(?: · | )/, ""),
    shipTo: shipTo === null ? null : lines[shipTo + 1] ?? null,
    itemsWeight: pack === null ? null : /^Items weigh (.+)$/.exec(lines.slice(pack + 1, pack + 4).find(line => line.startsWith("Items weigh ")) ?? "")?.[1] ?? null,
    label: live === null ? null : {
      Service: lines[live + 1] ?? null,
      "Tracking number": /^Tracking (.+)$/.exec(lines[live + 2] ?? "")?.[1] ?? null,
      Postage: bought ? bought.split(" · ").slice(1).join(" · ") : null,
    },
    labels,
  };
}

/** Where a sandbox label's fields on an order's page differ from the label Ship sold. */
export function labelProblems(fields, { service, tracking, price }) {
  if (!fields) return ["the order's page shows no label"];
  const wanted = { Service: service, "Tracking number": `${tracking} (test, not trackable)`, Postage: `${price} sandbox price, nothing charged` };
  return Object.entries(wanted).filter(([name, value]) => fields[name] !== value)
    .map(([name, value]) => `its ${name} reads "${fields[name] ?? "nothing"}", not "${value}"`);
}
