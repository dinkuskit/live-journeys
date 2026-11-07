import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { namedInstalls, planInstalls } from "../support/registry-install.mjs";
import { connectSource, installSource, runStep } from "./fixtures/observer-dwell.mjs";

const modes = [
  { headless: true, video: false, dwell: false },
  { headless: true, video: true, dwell: true },
  { headless: false, video: false, dwell: true },
  { headless: false, video: true, dwell: true },
];
const wanted = namedInstalls("dinkus-ship-beta 0.1.0-beta.1");
const installed = version => ({ data: { items: [{ source: "registry", registrySlug: "dinkus-ship-beta", version }] } });
const connected = { siteId: "fixture-site", connected: true };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture(mode, { read = async () => installed("0.1.0-beta.1"), connect = async () => connected, wait } = {}) {
  const events = [], waits = [];
  const bindings = {
    config: { ...mode, siteId: "fixture-site" }, wanted,
    plan: planInstalls({ data: { items: [] } }, wanted), planInstalls,
    paceStore: async () => { events.push("pace"); },
    notePlugins: async () => { events.push("read"); return read(); },
    connectPlugin: async () => { events.push("connect"); return connect(); },
    COMMERCE_CONNECT: {}, commerce: { url: "fixture-url", page: "fixture-page" },
    openCommercePage: async () => {}, readCommercePage: async () => {},
    note: (...args) => { events.push(args); },
    page: { waitForTimeout: async ms => { events.push("wait"); waits.push(ms); await wait?.(); } },
  };
  return { events, waits,
    install: () => runStep(installSource, "Plugins lists each named beta", bindings),
    connect: () => runStep(connectSource, "Commerce is connected to this store", bindings),
  };
}

for (const mode of modes) {
  const label = `headless=${mode.headless}, video=${mode.video}`;
  test(`terminal dwell matrix: ${label}`, async () => {
    const f = fixture(mode);
    assert.equal(await f.install(), "dinkus-ship-beta 0.1.0-beta.1");
    assert.equal(await f.connect(), "The owner approved commerce on DinkusKit.com, and Commerce is connected to store fixture-site.");
    assert.deepEqual(f.waits, mode.dwell ? [2_000, 3_500] : []);
    // Deterministic scheduled time, not elapsed browser or end-to-end time.
    assert.equal(f.waits.reduce((sum, ms) => sum + ms, 0), mode.dwell ? 5_500 : 0);
    assert.deepEqual(f.events, ["pace", "read", ...(mode.dwell ? ["wait"] : []),
      "connect", ...(mode.dwell ? ["wait"] : []), ["commerce connect", "connected this run"]]);
  });

  test(`readiness finishes before terminal dwell or success: ${label}`, async () => {
    for (const step of ["install", "connect"]) {
      const gate = deferred();
      const f = fixture(mode, { read: () => gate.promise, connect: () => gate.promise });
      let settled = false;
      const running = f[step]().finally(() => { settled = true; });
      // Let the step reach its unresolved read; no timer or completion may precede it.
      await setImmediate();
      assert.ok(f.events.includes(step === "install" ? "read" : "connect"));
      assert.deepEqual(f.waits, []);
      assert.equal(settled, false);
      gate.resolve(step === "install" ? installed("0.1.0-beta.1") : connected);
      await running;
      assert.deepEqual(f.waits, mode.dwell ? [step === "install" ? 2_000 : 3_500] : []);
    }
  });

  test(`failed verification never dwells or reports connection success: ${label}`, async () => {
    for (const [read, message] of [
      [async () => null, /couldn't be read after the install/],
      [async () => ({ data: { items: [] } }), /still doesn't list/],
      [async () => installed("0.1.0-beta.2"), /not 0.1.0-beta.1/],
      [async () => { throw new Error("read failed"); }, /read failed/],
    ]) {
      const f = fixture(mode, { read });
      await assert.rejects(f.install(), message);
      assert.deepEqual(f.waits, []);
    }
    for (const [connect, message] of [
      [async () => ({ siteId: "wrong-site", connected: true }), /not this store's fixture-site/],
      [async () => { throw new Error("connect failed"); }, /connect failed/],
    ]) {
      const f = fixture(mode, { connect });
      await assert.rejects(f.connect(), message);
      assert.deepEqual(f.events, ["connect"]);
      assert.deepEqual(f.waits, []);
    }
  });
}

test("an existing connection keeps its result and observer dwell", async () => {
  for (const mode of modes) {
    const f = fixture(mode, { connect: async () => ({ ...connected, connected: false }) });
    assert.equal(await f.connect(), "Commerce was already connected to store fixture-site. Connect again was left alone.");
    assert.deepEqual(f.waits, mode.dwell ? [3_500] : []);
    assert.deepEqual(f.events.at(-1), ["commerce connect", "already connected"]);
  }
});

test("observer dwell is awaited before returning or recording success", async () => {
  for (const step of ["install", "connect"]) {
    const gate = deferred();
    const f = fixture({ headless: false, video: false }, { wait: () => gate.promise });
    let settled = false;
    const running = f[step]().finally(() => { settled = true; });
    await setImmediate();
    assert.equal(f.waits.length, 1);
    assert.equal(settled, false);
    assert.equal(f.events.some(event => Array.isArray(event)), false);
    gate.resolve();
    await running;
  }
});
