# Reproduce the private timing producer/consumer proof offline

Use the existing checkout, Node24.22.0, Playwright1.61.1 node_modules and Chromium. No package install, network service, credentials or store configuration is required. All created files live under a new system temporary directory; the repository is read only.

Set NODE_24_22_0, CHECKOUT, NODE_MODULES and CHROMIUM to their installed paths, then run:

```sh
env -i PATH=/usr/bin:/bin "$NODE_24_22_0" ./producer-consumer-proof.mjs \
  --repo "$CHECKOUT" \
  --ref c0b03386a18f3bd4a367fc696c9463fce0df1d0a \
  --playwright "$NODE_MODULES" \
  --chromium "$CHROMIUM"
```

`--playwright` names the existing node_modules directory containing `playwright` and `@playwright/test`. `--node` optionally selects the executable for subprocesses; by default they use the executable running this script. `--ref` defaults to HEAD. The proof copies its bounded import closure directly from immutable Git objects at the resolved commit. It does not copy or execute the checkout's dirty edits. Source manifest paths are runner-relative and contain hashes only; result.json contains source identity and synthetic outcomes, not machine input paths.

The printed `artifacts` path identifies the temporary result directory. Retain this script, result.json and source-manifest.json. Optional synthetic evidence lies in pass/ and retry/. Do not copy runner/node_modules: it is only a runtime link to installed dependencies.

The script executes actual Playwright with the production browser, journey, pacing, proof and reporter modules against a127.0.0.1fixture. A seeded request log causes a short real pacing sleep. It validates pass and intentional-failure/new-worker-retry paths, retained attempt metrics, body/sleep bounds, unchanged default public summary and exact numeric projection by the actual analyzer CLI. The analyzer uses an explicitly synthetic selection receipt; no GitHub metadata or R2 operation is performed.

The disposable fixture alone enables retry for its synthetic Manage products test. Production test selection, assertions and retry policy are not changed. A15-second test timeout and60-second whole-invocation timeout bound this local proof.

Verified execution of this packaged script against c0b03386a18f3bd4a367fc696c9463fce0df1d0a completed both invocations and both analyzer calls successfully. Passing body1925ms/sleep1226ms; failed first try1988ms/sleep1226ms; successful retry2016ms/sleep1220ms. All timing values matched the producer, and the retry used a distinct worker. This is functional local-browser evidence, not live performance, authenticated behavior, interruption, disk-failure or private-transport proof.
