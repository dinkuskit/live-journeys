# EmDash 1.6 editor: Show settings on a phone, Unpublish asks first

EmDash 1.6.0 changed two things the product journeys touch in the store admin's editor. The owner approved
the 1.6 upgrade on 25 Nov 2026; no store runs 1.6 yet, so this is fixed before the first journeys run on one.

1. **Phone settings button.** 1.6 removed distraction-free mode. On a phone-sized window the editor's
   settings sheet now opens from a **Show settings** button (Hide settings once open) instead of a
   **Settings** button in the main area. `openSidePanel` accepts either name.
2. **Unpublish asks first.** On 1.6, Unpublish opens a dialog, "Unpublish Product?", with Cancel and
   Unpublish. `republishProductPage` presses that dialog's Unpublish when it appears within 5 seconds, and
   goes on as before when it doesn't (1.5).

## What was seen

A local template store filled on EmDash 1.5.0 and started on 1.6.0 (footer "EmDash v1.6.0 (bbe73edfc)"),
Commerce 0.9.0-beta.5 from its Registry build. Read with the same locators the runner now uses:

| Check | Seen on 1.6.0 |
| --- | --- |
| Main-area button named exactly "Settings" (Pixel 7) | 0 |
| Button named exactly "Show settings" (Pixel 7) | 1, and it opens the sheet with the Dinkus Commerce panel |
| A published product page's Unpublish button | "Unpublish Product" |
| What it opens | dialog "Unpublish Product? Visitors won't see it until you publish it again. It stays as a draft." with Cancel and Unpublish |

Cancel was pressed for the picture, so the page stayed published.

| Picture | SHA-256 |
| --- | --- |
| [`phone-show-settings-commerce-panel.png`](phone-show-settings-commerce-panel.png) (Pixel 7) | `40ad1e1a9070898e2921030a7c0994bdf46114f81c21d680080d0ae080e01a2a` |
| [`unpublish-asks-first.png`](unpublish-asks-first.png) (1440 × 900) | `d5f2567578391091ab1b2b47198037cfafed168723c0ea7820ee17acb700a6f7` |

The template store's own paired browser tests needed the same phone fix and pass on 1.6.0 with it
(dinkuskit/template-store, EmDash 1.6 PR).

## Checks

`node --test` over `runner/unit`: 260 of 260 passed on Node 24.22.0. The full journeys run on a 1.6 store
happens after that store is upgraded, on the owner's go.
