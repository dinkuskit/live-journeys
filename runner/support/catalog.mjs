import { versionAtLeast } from "./store-plugins.mjs";

// The standing catalog Full catalog keeps on a test store, so the journeys run against a store with
// as many products as a real shop. Every name starts with "Catalog", so the test's products are easy to
// spot, and stays the same from run to run, so a run finds what earlier runs added.

// Each kind's prices end in their own cents, so no two products in the catalog share a price.
const KINDS = [
  { style: "TEE", one: "Tee", many: "Tees", cents: 1800, ounces: 6 },
  { style: "HOODIE", one: "Hoodie", many: "Hoodies", cents: 4225, ounces: 18 },
  { style: "CAP", one: "Cap", many: "Caps", cents: 2250, ounces: 4 },
  { style: "BEANIE", one: "Beanie", many: "Beanies", cents: 1675, ounces: 3 },
];

export const MAX_PER_CATEGORY = 50;

// The first Commerce whose Dinkus Commerce panel the product helpers drive: from 0.8.0 (commerce#244) a
// page's first Save in the panel makes its product, and the panel is laid out as cards. An older panel
// draws nothing they wait for, so Full catalog writes nothing (no category, photo, page or product) on it.
export const COMMERCE_FOR_CATALOG = "0.8.0-beta.1";

/** Whether Full catalog may add to the store running Commerce `version` (null when it couldn't be read). */
export const catalogCanAdd = version => versionAtLeast(version, COMMERCE_FOR_CATALOG);

/** The catalog's category for products drawn in `style` ("Catalog Caps" for CAP), shared with the journeys that add one product. */
export const catalogCategory = style => `Catalog ${KINDS.find(kind => kind.style === style).many}`;

/**
 * The catalog of a size such as "3x8" (3 categories of 8 products): each category's title and
 * illustration style, and its products, each with a name, SKU, price, weight and photo of its own. A
 * size the catalog can't take throws, naming the sizes it can.
 */
export function catalogPlan(size) {
  const [, categories, perCategory] = String(size).match(/^\s*(\d+)\s*x\s*(\d+)\s*$/i)?.map(Number) ?? [];
  if (!(categories >= 1 && categories <= KINDS.length && perCategory >= 1 && perCategory <= MAX_PER_CATEGORY)) {
    throw new Error(`DINKUS_E2E_CATALOG is "${size}"; it takes categories x products per category, from 1x1 to ${KINDS.length}x${MAX_PER_CATEGORY}, such as 3x8.`);
  }
  return KINDS.slice(0, categories).map(kind => {
    const title = catalogCategory(kind.style);
    return {
      title,
      style: kind.style,
      products: Array.from({ length: perCategory }, (_, i) => {
        // Two digits keep one name from being the start of another ("Catalog Tee 1" and "Catalog Tee 10").
        const number = String(i + 1).padStart(2, "0");
        return {
          name: `Catalog ${kind.one} ${number}`,
          sku: `CATALOG-${kind.style}-${number}`,
          // A price of its own, so a card showing another product's price is caught.
          cents: kind.cents + i * 100,
          ounces: kind.ounces,
          photo: `catalog-${kind.one.toLowerCase()}-${number}.png`,
          category: title,
          style: kind.style,
        };
      }),
    };
  });
}
