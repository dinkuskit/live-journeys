import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script, createContext } from "node:vm";
import { firstLine } from "../support/errors.mjs";
import {
  HOME, PAGE_ROOM, STORE, archived, card, emptyPage, homepage, loadHelpers, onSale, product, productPage, run, scenarios, states, storeOf, trashed, world,
} from "./fixtures/homepage-reuse.mjs";

// The homepage a shopper journey just opened with openShopperPage stands in, once, for the first look
// its store check takes at the Shop list, so the four adopted call sites (Manage products' Draft check
// and clean-up, One product with a category's publish check and clean-up; the same two in the @next
// agent journey) load the homepage once instead of twice. These checks run the actual shopper.mjs and
// store-check.mjs over a counted fake page (see the fixture) and the actual call sites' source.

const helpers = w => loadHelpers(w);
const named = name => scenarios.find(scenario => scenario.name === name) ?? assert.fail(`no scenario "${name}"`);

test("openShopperPage keeps its origin and status checks, and hands on only the response it validated", async () => {
  const lands = at => world({ pages: storeOf(() => ({ "/": at })) });
  // The whole message, compared as the error's own `message` (a RegExp would see "Error: ..." instead).
  for (const [at, message] of [
    [{ url: "https://team.cloudflareaccess.com/cdn-cgi/access/login/store.example", dom: emptyPage() }, "/ sent the shopper to a Cloudflare Access sign-in instead of the store; the test gets past Access only with a one-time PIN it reads from the test inbox."],
    [{ url: "https://other.example/", dom: emptyPage() }, "/ sent the shopper to other.example instead of the store."],
    [{ status: 404, dom: emptyPage() }, "/ answered HTTP 404."],
    [{ noResponse: true, dom: emptyPage() }, "/ answered HTTP nothing."],
  ]) {
    const w = lands(at);
    const page = w.page();
    await assert.rejects(helpers(w).openShopperPage(page, "/"), { message });
    // The open paced and navigated as before, and a page that failed the checks hands nothing on.
    assert.deepEqual(w.paces, [PAGE_ROOM, PAGE_ROOM]);
    assert.deepEqual(w.navigations, ["/"]);
    assert.equal(page.listenerCount("framenavigated"), 0);
  }
  const w = lands({ dom: homepage({ cards: [card(product)] }) });
  const page = w.page();
  const h = helpers(w);
  const opened = await h.openShopperPage(page, "/");
  assert.deepEqual(w.paces, [PAGE_ROOM, PAGE_ROOM]);
  assert.deepEqual(w.navigations, ["/"]);
  assert.deepEqual(Object.keys(opened), ["take"]);
  // What it hands on is the very response it validated, once.
  assert.equal(opened.take(page, HOME), w.responses[0]);
  assert.equal(w.responses[0].status(), 200);
  assert.equal(opened.take(page, HOME), null);
  // A caller that ignores the handoff, as Storefront's first step does, sees what it always saw.
  assert.equal(await h.storeOpens(page), 'the homepage "Store" answered HTTP 200');
  assert.deepEqual(w.navigations, ["/", "/"]);
  assert.deepEqual(w.paces, [PAGE_ROOM, PAGE_ROOM, PAGE_ROOM, PAGE_ROOM]);
});

test("the handoff is for the same page at the same address, once, while it still shows the document that answered", async () => {
  const fresh = async (at = () => archived()) => {
    const w = world({ pages: storeOf(at) });
    const h = helpers(w);
    const page = w.page();
    const opened = await h.openShopperPage(page, "/");
    return { w, h, page, opened, response: w.responses[0] };
  };
  {
    const { page, opened, response } = await fresh();
    assert.equal(page.listenerCount("framenavigated"), 1);
    assert.equal(opened.take(page, HOME), response);
    assert.equal(page.listenerCount("framenavigated"), 0, "a taken handoff stops watching the page");
    assert.equal(opened.take(page, HOME), null, "once");
  }
  {
    const { w, page, opened } = await fresh();
    assert.equal(opened.take(w.page(), HOME), null, "another page");
    assert.equal(opened.take(page, HOME), null, "a wrong take spends it too");
  }
  {
    const { page, opened } = await fresh();
    assert.equal(opened.take(page, `${STORE}/cart`), null, "another address");
  }
  {
    const { page, opened } = await fresh();
    page.emit("framenavigated", page.mainFrame());
    assert.equal(page.listenerCount("framenavigated"), 0, "a moved page stops being watched");
    assert.equal(opened.take(page, HOME), null, "the page moved since");
  }
  {
    const { page, opened, response } = await fresh();
    page.emit("framenavigated", { name: "a child frame" });
    assert.equal(opened.take(page, HOME), response, "a child frame moving leaves the document current");
  }
  {
    const { page, opened } = await fresh();
    page.drift(`${HOME}#top`);
    assert.equal(opened.take(page, HOME), null, "the address reads differently");
  }
  {
    const { page, opened } = await fresh(() => ({ "/": { responseUrl: `${STORE}/?welcome`, dom: archived()["/"].dom } }));
    assert.equal(page.url(), HOME);
    assert.equal(opened.take(page, HOME), null, "the response answered another address");
  }
  {
    const { page, opened } = await fresh();
    await page.close();
    assert.equal(opened.take(page, HOME), null, "a closed page");
  }
  {
    const { w, h, page, opened } = await fresh();
    const again = await h.openShopperPage(page, "/");
    assert.equal(opened.take(page, HOME), null, "a later open spends the earlier handoff");
    assert.equal(again.take(page, HOME), w.responses[1]);
    assert.equal(page.listenerCount("framenavigated"), 0);
  }
});

test("an immediate pass spares exactly the homepage's first load; pacing, product, category and photo checks are as before", async () => {
  for (const [pattern, state, at] of [["draft-hides", "hides", () => archived()], ["published-shows", "shows", () => onSale()], ["cleanup-hides", "hides", () => archived()], ["cleanup-hides", "cleanup", () => trashed()]]) {
    const scenario = { pattern, state, at };
    const before = await run(scenario, helpers, { hint: false });
    const after = await run(scenario, helpers);
    assert.deepEqual(before.outcome, { problems: [], seconds: 0 }, pattern);
    assert.deepEqual(after.outcome, before.outcome, pattern);
    // The open's load, then the homepage check's own: the second is the one spared; the rest stand.
    assert.equal(before.sequence[0], "/");
    assert.equal(before.sequence[1], "/");
    assert.deepEqual(after.sequence, before.sequence.toSpliced(1, 1), pattern);
    assert.equal(after.sequence.filter(path => path === "/").length, 1, pattern);
    // The homepage check keeps its pacing reservation (its photos may still be scrolled into view).
    assert.equal(after.paces, before.paces, pattern);
    assert.deepEqual(after.world.paces, Array(after.paces).fill(PAGE_ROOM), pattern);
    assert.equal(before.waits, 0);
    assert.equal(after.waits, 0);
    assert.equal(after.gets, before.gets, `${pattern}: the same photo fetches`);
    if (state === "shows") assert.equal(after.gets, 3, "the Shop card's, the product page's and the category card's photo");
  }
});

test("a homepage that doesn't yet show the change is reloaded fresh after 3 s, and the opened page isn't used again", async () => {
  for (const name of ["draft off the store after 5 s", "published product shown after 5 s"]) {
    const before = await run(named(name), helpers, { hint: false });
    const after = await run(named(name), helpers);
    assert.deepEqual(before.outcome, { problems: [], seconds: 7 }, name);
    assert.deepEqual(after.outcome, before.outcome, name);
    assert.deepEqual(before.sequence, ["/", "/", "/", "/", product.href, product.category], name);
    assert.deepEqual(after.sequence, ["/", "/", "/", product.href, product.category], name);
    assert.deepEqual(after.world.waits, [3_000, 3_000], name);
    assert.deepEqual(before.world.waits, [3_000, 3_000], name);
    assert.equal(after.paces, before.paces, name);
  }
});

test("a homepage that never shows the change, or can't be read, fails as before and within the same deadline", async () => {
  const expected = {
    "product still on sale everywhere": ["the Shop list still lists it", `${product.href} still shows $12.00 and offers Add to cart`, `the category page ${product.category} still lists it`],
    "homepage without a Shop list": ["the homepage has no Shop list"],
    "homepage answers 503 once reloaded": ["the homepage answered HTTP 503"],
    "published product at the wrong price": ['the Shop list shows "$9.00" instead of $12.00', 'the product page shows "$9.00" instead of $12.00', `the category page ${product.category} shows "$9.00" instead of $12.00`],
    "published product with another photo": ["the Shop list shows another photo (/_image/swapped.jpg) than the one the owner chose", "the product page shows another photo (/_image/swapped.jpg) than the one the owner chose", `the category page ${product.category} shows another photo (/_image/swapped.jpg) than the one the owner chose`],
    "clean-up while the page still answers": [`${product.href} still shows $12.00 and offers Add to cart`, `${product.href} still answers HTTP 200`],
  };
  for (const [name, problems] of Object.entries(expected)) {
    const scenario = named(name);
    const before = await run(scenario, helpers, { hint: false });
    const after = await run(scenario, helpers);
    assert.deepEqual(before.outcome.problems, problems, name);
    assert.deepEqual(after.outcome.problems, problems, name);
    // Each loop that failed tried until a minute had passed, in both: as many 3 s waits, one load fewer.
    assert.equal(after.waits, before.waits, name);
    assert.ok(before.waits >= 18, name);
    assert.equal(after.navigated, before.navigated - 1, name);
    assert.equal(after.tries, before.tries, name);
    if (scenario.pattern !== "cleanup-hides") {
      for (const result of [before, after]) assert.ok(result.outcome.seconds >= 60 && result.outcome.seconds <= 62, `${name}: ${result.outcome.seconds} s`);
    }
    assert.equal(after.gets, before.gets, name);
  }
});

test("the one divergence: a store that stops answering right after the homepage opened", async () => {
  // The base reloads the homepage and can't; the candidate's first look is the page it opened, which
  // answered HTTP 200 on the store after the change was made. A true observation, not a failure hidden.
  const scenario = named("store unreachable once the homepage opened");
  assert.ok(scenario.divergent);
  const before = await run(scenario, helpers, { hint: false });
  const after = await run(scenario, helpers);
  assert.deepEqual(before.outcome.problems, ["/ didn't answer (net::ERR_CONNECTION_REFUSED)"]);
  assert.deepEqual(after.outcome, { problems: [], seconds: 0 });
  assert.deepEqual(after.sequence, ["/", product.href, product.category]);
});

test("a handoff for another page, another address, a moved page, one already taken, or no handoff at all is not reused", async () => {
  const state = { ...states.hides };
  const fresh = (at = archived) => { const w = world({ pages: storeOf(() => ({ ...at(), "/cart": { dom: emptyPage() } })) }); return { w, h: helpers(w) }; };
  {
    const { w, h } = fresh();
    const first = w.page();
    const opened = await h.openShopperPage(first, "/");
    const second = w.page();
    assert.deepEqual(await h.storeHides(second, state, { opened }), { problems: [], seconds: 0 });
    assert.deepEqual(w.navigations, ["/", "/", product.href, product.category], "another page loads the homepage itself");
  }
  {
    const { w, h } = fresh();
    const page = w.page();
    const opened = await h.openShopperPage(page, "/cart");
    assert.deepEqual(await h.storeHides(page, state, { opened }), { problems: [], seconds: 0 });
    assert.deepEqual(w.navigations, ["/cart", "/", product.href, product.category], "a handoff for another address");
  }
  {
    const before = await run(named("page moved between the open and the check"), helpers, { hint: false });
    const after = await run(named("page moved between the open and the check"), helpers);
    assert.deepEqual(after.sequence, before.sequence, "a page that moved since loads the homepage again");
    assert.deepEqual(after.sequence, ["/", "/", product.href, product.category]);
    assert.deepEqual(after.outcome, { problems: [], seconds: 0 });
  }
  {
    const { w, h } = fresh();
    const page = w.page();
    const opened = await h.openShopperPage(page, "/");
    await h.storeHides(page, state, { opened });
    await h.storeHides(page, state, { opened });
    assert.deepEqual(w.navigations, ["/", product.href, product.category, "/", product.href, product.category], "a second check loads the homepage itself");
  }
  for (const opened of [undefined, null, true, false, 0, "opened", {}, { take: 1 }, { take: "/" }, [], () => {}]) {
    const { w, h } = fresh();
    const page = w.page();
    await h.openShopperPage(page, "/");
    assert.deepEqual(await h.storeHides(page, state, { opened }), { problems: [], seconds: 0 }, String(opened));
    assert.deepEqual(w.navigations, ["/", "/", product.href, product.category], `no handoff: ${String(opened)}`);
    // The same without the option at all, as every untouched caller passes it.
    assert.deepEqual(await h.storeHides(page, state), { problems: [], seconds: 0 });
    assert.deepEqual(w.navigations.slice(4), ["/", product.href, product.category]);
  }
  {
    // A page closed after the open: with the handoff and without, the same loads, waits and findings.
    const [after, before] = await Promise.all([true, false].map(async hint => {
      const { w, h } = fresh();
      const page = w.page();
      const opened = await h.openShopperPage(page, "/");
      await page.close();
      const { problems, seconds } = await h.storeHides(page, state, hint ? { opened } : {});
      return { problems, seconds, navigations: w.navigations, waits: w.waits.length };
    }));
    assert.deepEqual(after, before, "a closed page is loaded (and fails) exactly as without the handoff");
    assert.equal(after.problems[0], "/ didn't answer (Target page, context or browser has been closed)");
    // The open's load, then every try of the homepage loop to the minute (a closed page refuses each one
    // at once, so a try every 3 s), none of them spared.
    assert.equal(after.navigations[1], "/");
    assert.ok(after.navigations.filter(path => path === "/").length >= 21, "the open and at least twenty tries");
    assert.ok(after.waits >= 60, "three loops, each to the minute");
  }
});

test("a check with no handoff keeps the ordering and the whole of the product, category and photo checks", async () => {
  const w = world({ pages: storeOf(() => onSale()) });
  const h = helpers(w);
  const page = w.page();
  const shows = await h.storeShows(page, { ...states.shows });
  assert.deepEqual(shows, { problems: [], seconds: 0 });
  assert.deepEqual(w.navigations, ["/", product.href, product.category]);
  assert.deepEqual(w.gets, [product.photo, product.photo, product.photo]);
  assert.deepEqual(w.paces, [PAGE_ROOM, PAGE_ROOM, PAGE_ROOM]);
  const hides = await h.storeHides(page, { ...states.hides }, { archived: true });
  assert.deepEqual(hides.problems, ["the Shop list still lists it", `${product.href} still shows $12.00 and offers Add to cart`, `the category page ${product.category} still lists it`]);
  assert.equal(w.waits.length, 54, "three loops, each to the minute");
  // The product page's own say on an archived product: HTTP 404 with a word, as before.
  const later = world({ pages: storeOf(() => ({ ...archived(), [product.href]: { status: 404, dom: productPage({ ...product, price: "" }) } })) });
  const { problems } = await loadHelpers(later).storeHides(later.page(), { ...states.hides }, { archived: true });
  assert.deepEqual(problems, [`${product.href} still offers Add to cart`]);
});

// ---- The call sites, as written ----

const specs = Object.fromEntries(["manage-products", "onboarding-product", "agent-products", "cart", "storefront", "full-catalog"]
  .map(name => [name, readFileSync(new URL(`../tests/${name}.spec.mjs`, import.meta.url), "utf8")]));

/**
 * The adopted sites in a spec: each `const opened = await openShopperPage(shopper, "/")` with what
 * consumes it, the next line for a step's check or the whole `if (opened) { ... }` of a clean-up.
 */
function sites(source) {
  return [...source.matchAll(/^ +const opened = await openShopperPage\(shopper, "\/"\)/gm)].map(match => {
    const rest = source.slice(match.index);
    const cleanup = /^ +const opened = [^\n]*\n +if \(opened\) \{/.exec(rest);
    let code;
    if (cleanup) {
      let depth = 0;
      let end = cleanup[0].length - 1;
      for (; end < rest.length; end++) {
        if (rest[end] === "{") depth += 1;
        else if (rest[end] === "}" && !(depth -= 1)) break;
      }
      code = rest.slice(0, end + 1);
    } else code = rest.split("\n").slice(0, 2).join("\n");
    return { line: source.slice(0, match.index).split("\n").length, cleanup: Boolean(cleanup), code };
  });
}

/** Runs one site's code over stand-ins that record what it hands to whom. */
async function wire(site, { opens = true } = {}) {
  const calls = [];
  const handoff = { take: () => null };
  const bindings = {
    shopper: { name: "shopper" }, problems: [], firstLine,
    state: { id: "p1", productPath: "/products/x", categoryPath: "/categories/x" }, made: { pagePath: "/products/x", categoryPath: "/categories/x" },
    where: () => ({ id: "p1", productPath: "/products/x", categoryPath: "/categories/x" }),
    openShopperPage: async (page, path) => { calls.push(["open", page, path]); if (!opens) throw new Error("/ answered HTTP 503."); return handoff; },
    storeHides: async (page, state, options) => { calls.push(["hides", page, options]); return { problems: ["the Shop list still lists it"], seconds: 2 }; },
    storeShows: async (page, state, options) => { calls.push(["shows", page, options]); return { problems: ["the Shop list doesn't list it"], seconds: 2 }; },
    catchUp: async (page, path, check) => { calls.push(["catchUp", page, path]); return { problems: await check({ status: () => 404 }), seconds: 0 }; },
  };
  await new Script(`(async () => {\n${site.code}\n})()`).runInContext(createContext(bindings));
  return { calls, handoff, problems: bindings.problems, shopper: bindings.shopper };
}

test("the adopted call sites hand the homepage they opened to their first store check, and only they", async () => {
  const adopted = { "manage-products": [["hides", false], ["hides", true]], "onboarding-product": [["shows", false], ["hides", true]], "agent-products": [["hides", false], ["hides", true]] };
  for (const [name, shape] of Object.entries(adopted)) {
    const source = specs[name];
    const found = sites(source);
    assert.equal(found.length, 2, `${name}: two adopted sites`);
    assert.equal((source.match(/openShopperPage\(shopper, "\/"\)/g) ?? []).length, 2, `${name}: every homepage open hands on`);
    assert.doesNotMatch(source, /openShopperPage\(shopper, "\/"\)\.then\(/, `${name}: the old boolean form is gone`);
    for (const [i, site] of found.entries()) {
      const [check, cleanup] = shape[i];
      assert.equal(site.cleanup, cleanup, `${name} line ${site.line}`);
      const { calls, handoff, problems, shopper } = await wire(site);
      assert.deepEqual(calls[0], ["open", shopper, "/"], `${name} line ${site.line}`);
      assert.equal(calls[1][0], check, `${name} line ${site.line}: ${check} comes next`);
      assert.equal(calls[1][1], shopper, `${name} line ${site.line}: on the same page`);
      assert.equal(calls[1][2].opened, handoff, `${name} line ${site.line}: with the handoff`);
      if (cleanup) {
        // The check's problems reach the clean-up's list, and the trashed addresses are still asked.
        assert.deepEqual(problems, ["the Shop list still lists it"], `${name} line ${site.line}`);
        assert.ok(calls.slice(2).every(call => call[0] === "catchUp" && call[1] === shopper), `${name} line ${site.line}`);
        assert.ok(calls.length >= 3, `${name} line ${site.line}: the addresses are asked`);
        const failed = await wire(site, { opens: false });
        assert.deepEqual(failed.calls, [["open", failed.shopper, "/"]], `${name} line ${site.line}: nothing checked when the store won't open`);
        assert.deepEqual(failed.problems, ["the test couldn't open the store as a shopper to check it: / answered HTTP 503."], `${name} line ${site.line}`);
      } else {
        assert.equal(calls.length, 2, `${name} line ${site.line}`);
        await assert.rejects(wire(site, { opens: false }), { message: "/ answered HTTP 503." }, `${name} line ${site.line}: the step fails as before`);
      }
    }
  }
  assert.match(specs["agent-products"], /tag: "@next"/, "the agent journey stays @next");
  for (const name of ["cart", "storefront", "full-catalog"]) {
    assert.doesNotMatch(specs[name], /storeShows|storeHides|opened \}/, `${name} is untouched`);
    assert.match(specs[name], /openShopperPage|open\(/, name);
  }
});
