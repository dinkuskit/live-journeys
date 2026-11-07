import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import { categoryHides } from "../../support/category-page.mjs";
import { firstLine } from "../../support/errors.mjs";
import { dollars, money } from "../../support/storefront-text.mjs";

// The actual shopper.mjs and store-check.mjs, evaluated over stand-ins for the browser, the settings,
// the pacing and the proof, so the offline checks run openShopperPage, catchUp, storeShows and
// storeHides as the journeys do, against a shopper page the fixture drives and counts: every
// navigation, pacing reservation, 3 s wait and photo fetch, over a store whose pages are a function
// of a clock the waits move. In the style of the journey-wrapper fixture; the comparison under
// proof/homepage-reuse-20261107 loads another revision's sources the same way.

export const shopperSource = readFileSync(new URL("../../support/shopper.mjs", import.meta.url), "utf8");
export const storeCheckSource = readFileSync(new URL("../../support/store-check.mjs", import.meta.url), "utf8");
export const STORE = "https://store.example";
export const PAGE_ROOM = 40;
export const HOME = `${STORE}/`;

const strip = source => source.replace(/^import .*$/gm, "").replace(/^export /gm, "");
/** The local names a module's `import { ... } from` lines bind, which its evaluation must be given. */
const imported = source => [...source.matchAll(/^import \{([^}]*)\} from/gm)]
  .flatMap(([, list]) => list.split(",").map(name => name.trim().split(/\s+as\s+/).at(-1)).filter(Boolean));

/** Evaluates one module over `bindings`, refusing a revision whose imports the bindings don't cover. */
function evaluate(label, source, bindings, names) {
  const missing = imported(source).filter(name => !(name in bindings));
  if (missing.length) throw new Error(`${label} imports ${missing.join(", ")}, which this fixture does not supply`);
  // This realm's Error, so an error the fake page throws is one to the module's `instanceof`.
  return new Script(`${strip(source)}\n({ ${names} });`).runInContext(createContext({ URL, Error, Buffer, ...bindings }));
}

// ---- A page's elements, and the selectors store-check.mjs reads them with ----

/** One element: a tag, its attributes, its children and its own text. */
export const el = (tag, attrs = {}, children = [], text = "") => ({ tag, attrs, children, text });
const innerText = e => [e.text, ...e.children.map(innerText)].filter(Boolean).join(" ");
const walk = (e, path = []) => e.children.flatMap(child => [{ el: child, path }, ...walk(child, [...path, child])]);

/** One compound of a selector: `tag.class[attr][attr="value"][attr^="value"]`, any part optional. */
function compound(token) {
  const m = /^([a-z0-9]+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i.exec(token);
  if (!token || !m) throw new Error(`the fixture can't match "${token}"`);
  return {
    tag: m[1]?.toLowerCase(),
    classes: m[2].split(".").filter(Boolean),
    attrs: [...m[3].matchAll(/\[([\w-]+)(?:(\^?)="([^"]*)")?\]/g)].map(([, name, op, value]) => ({ name, op, value })),
  };
}
const matches = (e, c) => (!c.tag || e.tag === c.tag)
  && c.classes.every(name => String(e.attrs.class ?? "").split(/\s+/).includes(name))
  && c.attrs.every(({ name, op, value }) => name in e.attrs && (value === undefined || (op ? String(e.attrs[name]).startsWith(value) : String(e.attrs[name]) === value)));
/** Whether a chain of descendant compounds matches `e` under its ancestors `path` (nearest last). */
function matchesChain(e, path, chain) {
  if (!matches(e, chain.at(-1))) return false;
  let i = chain.length - 2;
  for (let p = path.length - 1; p >= 0 && i >= 0; p--) if (matches(path[p], chain[i])) i--;
  return i < 0;
}
/** The elements under `roots` that `selector` (a comma list of descendant chains) matches, in document order. */
export function select(roots, selector) {
  const chains = selector.split(",").map(part => part.trim().split(/\s+/).map(compound));
  return roots.flatMap(root => walk(root).filter(({ el: e, path }) => chains.some(chain => matchesChain(e, path, chain))).map(({ el: e }) => e));
}

/** A locator over the page's current document, resolved when read, as Playwright's are. */
class FakeLocator {
  constructor(page, resolve) { this._page = page; this._resolve = resolve; }
  page() { return this._page; }
  locator(selector) { return new FakeLocator(this._page, () => this._resolve().flatMap(e => select([e], selector))); }
  filter() { return this; }
  first() { return new FakeLocator(this._page, () => this._resolve().slice(0, 1)); }
  async count() { return this._resolve().length; }
  async all() { return this._resolve().map(e => new FakeLocator(this._page, () => [e])); }
  async getAttribute(name) { const [e] = this._resolve(); if (!e) throw new Error("locator matched nothing"); return e.attrs[name] ?? null; }
  async innerText() { const [e] = this._resolve(); if (!e) throw new Error("locator matched nothing"); return innerText(e); }
  async waitFor() { if (!this._resolve().length) throw new Error("locator matched nothing"); }
  async isEnabled() { const [e] = this._resolve(); return Boolean(e) && !("disabled" in e.attrs); }
  async scrollIntoViewIfNeeded() {}
}

const response = (url, status, body = "") => ({
  url: () => url,
  status: () => status,
  ok: () => status >= 200 && status < 300,
  body: async () => Buffer.from(body),
  request: () => ({ isNavigationRequest: () => true }),
});

/**
 * A shopper's page as the helpers drive it. `goto` takes the store's page for that address at the
 * world's clock, moves the clock by one load, announces the navigation to the main frame before it
 * answers (as Playwright delivers the event before `goto` resolves), and answers with the response.
 */
export class FakePage extends EventEmitter {
  constructor(world) {
    super();
    this.world = world;
    this._url = "about:blank";
    this._dom = null;
    this._closed = false;
    this._main = { name: "main frame" };
  }
  url() { return this._url; }
  isClosed() { return this._closed; }
  mainFrame() { return this._main; }
  async close() { this._closed = true; }
  context() { return { cookies: async () => [] }; }
  async title() { return this._dom?.attrs.title ?? ""; }
  /** What the page's address reads after a move the fixture doesn't announce (no real browser does this). */
  drift(url) { this._url = url; }
  async goto(href) {
    const { world } = this;
    const { pathname } = new URL(href);
    world.navigations.push(pathname);
    if (this._closed) throw new Error("Target page, context or browser has been closed");
    world.clock += world.loadMs;
    const page = world.pages(pathname, world.clock);
    if (page.error) throw new Error(page.error);
    this._url = page.url ?? href;
    this._dom = page.dom ?? null;
    this.emit("framenavigated", this._main);
    if (page.noResponse) return null;
    const answer = response(page.responseUrl ?? this._url, page.status ?? 200);
    world.responses.push(answer);
    return answer;
  }
  locator(selector) { return new FakeLocator(this, () => this._dom ? select([this._dom], selector) : []); }
  async waitForTimeout(ms) { this.world.waits.push(ms); this.world.clock += ms; }
}

/**
 * One scenario's world: a clock, a store whose pages are a function of the clock (`pages(path, now)`
 * gives `{ status, dom, url, responseUrl, error, noResponse }`), and the counts of what the helpers did.
 */
export function world({ pages, loadMs = 400 } = {}) {
  const w = { store: STORE, clock: 1_700_000_000_000, loadMs, pages, navigations: [], responses: [], paces: [], waits: [], gets: [] };
  w.page = () => new FakePage(w);
  return w;
}

// What storefront-page.mjs reads from a page, without the browser's waits: the same locators.
const text = async locator => (await locator.filter({ visible: true }).first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
const photo = async media => await media.locator("img[data-commerce-image]").count() ? "photo" : await media.locator("img").count() ? "illustration" : "none";
const photoProblem = { none: 'has no photo ("No image")', illustration: "shows a stand-in drawing instead of its photo" };
const readCard = async (card, { withPhoto = true } = {}) => {
  const links = card.locator('a[href^="/products/"]');
  return {
    name: await text(card.locator("h2, h3, h4")),
    price: await text(card.locator(".price, [data-product-price]")),
    image: withPhoto ? await photo(card) : undefined,
    href: await card.getAttribute("href") ?? (await links.count() ? await links.first().getAttribute("href") : null),
  };
};

/** The fingerprint `imageHash` makes of a photo the fixture's `get` serves: its path is its bytes. */
export const photoHash = src => createHash("sha256").update(Buffer.from(new URL(src, STORE).pathname)).digest("hex");

/**
 * Both modules, wired to `w` as the runner wires them: the pacing counts rooms, `openStorePage` paces
 * and navigates as the real one does (its Access sign-in left out, so a page that lands on Access stays
 * there, as when nobody can sign in), and `get` serves each photo as its own path. Another revision's
 * sources may be given.
 */
export function loadHelpers(w, sources = {}) {
  const config = { store: w.store };
  const paceStore = async room => { w.paces.push(room); };
  const openStorePage = async (page, url) => { await paceStore(PAGE_ROOM); return page.goto(url, { waitUntil: "domcontentloaded" }); };
  const shopper = evaluate("shopper.mjs", sources.shopper ?? shopperSource,
    { config, PAGE_ROOM, paceStore, note() {}, openStorePage }, "openShopperPage, storeOpens, elsewhere, STORE_OPENS");
  const get = async (page, url) => { w.gets.push(new URL(url).pathname); return { ok: () => true, body: async () => Buffer.from(new URL(url).pathname) }; };
  const storeCheck = evaluate("store-check.mjs", sources.storeCheck ?? storeCheckSource, {
    createHash, get, categoryHides, config, firstLine, PAGE_ROOM, paceStore, photo, photoProblem, readCard, text, dollars, money,
    Date: { now: () => w.clock },
  }, "catchUp, storeShows, storeHides, findCard, shopCards, categoryCards, unreadableShop, imageHash, after, places");
  return { ...shopper, ...storeCheck };
}

// ---- The store's pages, as the storefront draws them ----

export const other = { id: "p0", name: "Catalog Cap 01", price: "$20.00", href: "/products/catalog-cap-01", photo: "/_image/p0.jpg" };
export const product = { id: "p1", name: "Live test product", price: "$12.00", cents: 1200, href: "/products/live-test", category: "/categories/catalog-caps", photo: "/_image/p1.jpg" };

/** A Shop card: the link to the product's page, holding its name, price and photo. */
export const card = p => el("a", { "data-commerce-product": p.id, href: p.href }, [
  el("h3", {}, [], p.name), el("span", { class: "price" }, [], p.price), el("img", { "data-commerce-image": p.id, src: p.photo }),
]);
export const homepage = ({ cards = [], shopList = true, title = "Store" } = {}) => el("html", { title }, [el("main", {}, [
  ...shopList ? [el("section", { "data-commerce-catalog": "" }, cards.length ? cards : [el("p", { "data-commerce-empty": "" }, [], "No products yet")])] : [],
])]);
export const productPage = p => el("html", {}, [el("main", {}, [
  el("nav", { class: "browse-breadcrumb" }, [el("a", { href: p.category }, [], "Caps")]),
  el("article", { "data-product-page": "" }, [
    el("h1", {}, [], p.name),
    el("span", { "data-product-price": "" }, [], p.price),
    el("div", { class: "product-detail__visual" }, [el("img", { "data-commerce-image": p.id, src: p.photo })]),
    el("button", { "data-add-to-cart": "", "data-guest-cart-ready": "1" }, [], "Add to cart"),
  ]),
])]);
export const gonePage = () => el("html", {}, [el("main", {}, [el("p", {}, [], "This product is no longer available.")])]);
export const emptyPage = () => el("html", {}, [el("main", {}, [])]);
export const categoryPage = items => el("html", {}, [el("main", {}, items.map(p => el("div", { "data-commerce-product": p.id }, [
  el("h3", {}, [], p.name), el("span", { class: "price" }, [], p.price), el("a", { href: p.href }, [], "View details"), el("img", { "data-commerce-image": p.id, src: p.photo }),
])))]);

/** The store with the product on sale everywhere, with any `changes` to the card and page (a wrong price, another photo). */
export const onSale = (changes = {}) => {
  const p = { ...product, ...changes };
  return { "/": { dom: homepage({ cards: [card(other), card(p)] }) }, [p.href]: { dom: productPage(p) }, [p.category]: { dom: categoryPage([other, p]) } };
};
/** The store once the product is archived: off the Shop list and its category, its page gone with a word. */
export const archived = () => ({
  "/": { dom: homepage({ cards: [card(other)] }) }, [product.href]: { status: 404, dom: gonePage() }, [product.category]: { dom: categoryPage([other]) },
});
/** The store once the clean-up trashed the product's page and its own category: both addresses gone. */
export const trashed = () => ({ "/": { dom: homepage({ cards: [card(other)] }) }, [product.href]: { status: 404, dom: emptyPage() }, [product.category]: { status: 404, dom: emptyPage() } });

/** A store whose pages are `at(now)`'s, with every other address answering 404; `now` is relative to the world's first instant. */
export const storeOf = at => {
  let origin;
  return (path, now) => { origin ??= now; return at(now - origin)[path] ?? { status: 404, dom: emptyPage() }; };
};

// ---- The journeys' states and their adopted call sites ----

export const states = {
  /** What Manage products checks while the page is a Draft, and at the clean-up (the shared "Catalog Caps" stays). */
  hides: { id: product.id, name: product.name, productPath: product.href, categoryPath: product.category, shared: true },
  /** What One product with a category checks once the page is published, photo and all. */
  shows: { id: product.id, name: product.name, cents: product.cents, hasPhoto: true, photoHash: photoHash(product.photo), productPath: product.href, categoryPath: product.category, shared: true },
  /** What the clean-up of One product with a category checks, its own category trashed with the page. */
  cleanup: { id: product.id, name: product.name, productPath: product.href, categoryPath: product.category },
};

/** `{ opened }` when a revision's openShopperPage hands a page on and the pattern is to take it, else nothing. */
const handoff = (opened, hint) => hint && typeof opened?.take === "function" ? { opened } : {};

/**
 * The adopted call sites as the journeys write them (a Draft kept off the store, a published product
 * shown, the clean-up), over a revision's helpers: open the homepage as a shopper, then check the store,
 * handing the opened page on where the revision returns one and `hint` says to. `between` runs after
 * the homepage opens and before the check, for what may move the page meanwhile. Each returns the
 * check's `{ problems, seconds }`, or throws as the step would.
 */
export const patterns = {
  "draft-hides": async (helpers, shopper, state, { hint = true, between } = {}) => {
    const opened = await helpers.openShopperPage(shopper, "/");
    await between?.(shopper);
    return helpers.storeHides(shopper, state, { ...handoff(opened, hint) });
  },
  "published-shows": async (helpers, shopper, state, { hint = true, between } = {}) => {
    const opened = await helpers.openShopperPage(shopper, "/");
    await between?.(shopper);
    return helpers.storeShows(shopper, state, { ...handoff(opened, hint) });
  },
  "cleanup-hides": async (helpers, shopper, state, { hint = true, between } = {}) => {
    const problems = [];
    // A revision whose openShopperPage returns nothing still opened the store.
    const opened = await helpers.openShopperPage(shopper, "/").then(result => result ?? true, error => { problems.push(`the test couldn't open the store as a shopper to check it: ${firstLine(error)}`); return false; });
    await between?.(shopper);
    if (opened) {
      problems.push(...(await helpers.storeHides(shopper, state, { ...handoff(opened, hint) })).problems);
      for (const path of [state.productPath, state.shared ? "" : state.categoryPath].filter(Boolean)) {
        problems.push(...(await helpers.catchUp(shopper, path, response => response.status() === 200 ? [`${path} still answers HTTP 200`] : [])).problems);
      }
    }
    return { problems, seconds: 0 };
  },
};
/** How many catchUp loops each pattern runs over its state, for counting its tries from its 3 s waits. */
export const catchUps = (pattern, state) => 1 + (state.productPath ? 1 : 0) + (state.productPath && state.categoryPath ? 1 : 0)
  + (pattern === "cleanup-hides" ? [state.productPath, state.shared ? "" : state.categoryPath].filter(Boolean).length : 0);

/**
 * The scenarios the comparison runs, each a store over time and what the adopted call must make of it.
 * `expect`: `pass` (no problems), `fail` (problems at the deadline), `throws` (the open fails);
 * `reuse`: whether the opened homepage stands in for the first check. `divergent` names the one case
 * where the two revisions must differ, and why.
 */
export const scenarios = [
  { name: "draft kept off the store", pattern: "draft-hides", state: "hides", at: () => archived(), expect: "pass", reuse: true },
  { name: "draft off the store after 5 s", pattern: "draft-hides", state: "hides", at: t => t < 5_000 ? onSale() : archived(), expect: "pass", reuse: true },
  { name: "product still on sale everywhere", pattern: "draft-hides", state: "hides", at: () => onSale(), expect: "fail", reuse: true },
  { name: "homepage without a Shop list", pattern: "draft-hides", state: "hides", at: () => ({ ...archived(), "/": { dom: homepage({ shopList: false }) } }), expect: "fail", reuse: true },
  { name: "homepage answers 503 once reloaded", pattern: "draft-hides", state: "hides", at: t => t < 500 ? onSale() : { ...archived(), "/": { status: 503, dom: emptyPage() } }, expect: "fail", reuse: true },
  { name: "published product shown", pattern: "published-shows", state: "shows", at: () => onSale(), expect: "pass", reuse: true },
  { name: "published product shown after 5 s", pattern: "published-shows", state: "shows", at: t => t < 5_000 ? archived() : onSale(), expect: "pass", reuse: true },
  { name: "published product at the wrong price", pattern: "published-shows", state: "shows", at: () => onSale({ price: "$9.00" }), expect: "fail", reuse: true },
  { name: "published product with another photo", pattern: "published-shows", state: "shows", at: () => onSale({ photo: "/_image/swapped.jpg" }), expect: "fail", reuse: true },
  { name: "clean-up with the shared category kept", pattern: "cleanup-hides", state: "hides", at: () => archived(), expect: "pass", reuse: true },
  { name: "clean-up with the page and category trashed", pattern: "cleanup-hides", state: "cleanup", at: () => trashed(), expect: "pass", reuse: true },
  { name: "clean-up while the page still answers", pattern: "cleanup-hides", state: "cleanup", at: () => ({ ...trashed(), [product.href]: { dom: productPage(product) } }), expect: "fail", reuse: true },
  { name: "Access sign-in at the open", pattern: "draft-hides", state: "hides", at: () => ({ "/": { url: "https://team.cloudflareaccess.com/cdn-cgi/access/login/store.example", dom: emptyPage() } }), expect: "throws", reuse: false },
  { name: "Access sign-in at the clean-up's open", pattern: "cleanup-hides", state: "hides", at: () => ({ "/": { url: "https://team.cloudflareaccess.com/cdn-cgi/access/login/store.example", dom: emptyPage() } }), expect: "fail", reuse: false },
  { name: "homepage answers 503 at the open", pattern: "draft-hides", state: "hides", at: () => ({ ...archived(), "/": { status: 503, dom: emptyPage() } }), expect: "throws", reuse: false },
  { name: "page moved between the open and the check", pattern: "draft-hides", state: "hides", at: () => archived(), expect: "pass", reuse: false, between: async page => { page.emit("framenavigated", page.mainFrame()); } },
  { name: "a child frame moved between the open and the check", pattern: "draft-hides", state: "hides", at: () => archived(), expect: "pass", reuse: true, between: async page => { page.emit("framenavigated", { name: "child frame" }); } },
  { name: "store unreachable once the homepage opened", pattern: "draft-hides", state: "hides", at: t => t < 500 ? archived() : { "/": { error: "net::ERR_CONNECTION_REFUSED" }, [product.href]: archived()[product.href], [product.category]: archived()[product.category] }, expect: "pass", reuse: true,
    divergent: "the base reloads the homepage and can't; the candidate's first look is the page it opened, a true observation made after the change" },
];

/** Runs one scenario's pattern in a fresh world over `helpers(world)`, and counts what happened. */
export async function run(scenario, helpers, { hint = true } = {}) {
  const w = world({ pages: storeOf(scenario.at) });
  const h = helpers(w);
  const page = w.page();
  const outcome = await patterns[scenario.pattern](h, page, { ...states[scenario.state] }, { hint, between: scenario.between })
    .then(result => ({ problems: result.problems, seconds: result.seconds }), error => ({ threw: firstLine(error) }));
  const count = list => Object.fromEntries([...new Set(list)].sort().map(item => [item, list.filter(x => x === item).length]));
  return {
    outcome,
    world: w,
    sequence: w.navigations.slice(),
    navigations: count(w.navigations),
    navigated: w.navigations.length,
    paces: w.paces.length,
    waits: w.waits.length,
    gets: w.gets.length,
    // Each catchUp loop tries once more than it waited; the open is one more load.
    tries: outcome.threw || (outcome.problems?.[0] ?? "").startsWith("the test couldn't open") ? 0 : w.waits.length + catchUps(scenario.pattern, states[scenario.state]),
  };
}
