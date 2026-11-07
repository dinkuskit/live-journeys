Prepared comparison only; candidate must be committed and coordinator-authorized before execution.

Identical immutable-revision sample code calls:

    const opened = await openShopperPage(shopper, '/');
    await storeHides(shopper, state, { opened });

The base returns undefined and ignores the option. No candidate implementation is embedded here. The driver runs five pairs, alternating execution order. It asserts two versus one homepage document loads, unchanged product/category document checks and zero pacing sleeps on this unpressured fixture. Actual request counts, per-sample manifests, outputs and elapsed times remain in artifacts. Timings are descriptive because the unchanged absent-price check may take five seconds.

`--variant empty` (default) serves an explicitly empty readable catalog. `--variant cards` serves three unrelated cards with actual small SVG images and records their requests. It does not assume a fixed image-request saving.

When approved:

    "$NODE_24_22_0" paired.mjs --repo "$CHECKOUT" --base "$BASE_SHA" --candidate "$CANDIDATE_SHA" --playwright "$NODE_MODULES" --chromium "$CHROMIUM" --variant empty

No authentication, private data, downloads, repository writes or live requests. The source is copied from exact Git objects, with relative file hashes. Both helper calls use actual browser/page/response implementations. This proves only the hide path and owned local fixtures, not full storeShows, Access login, stale capability or active-rate-limit behavior.
