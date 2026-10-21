# DinkusKit live journeys

Saved Playwright journeys that prove the DinkusKit Registry plugins (Commerce,
Payments, Ship) work together on a live test store, beta.sm0ky.dev, with Stripe
TEST cards and Ship sandbox labels only.

- [runner/](runner/README.md): the journeys, their stages (`@running`, `@next`)
  and every setting.
- [SKILL.md](SKILL.md): how an agent runs them and how a plugin release uses them.
- [references/setup.md](references/setup.md): first-time setup.
- The **Live journeys** workflow runs every `@running` journey from its
  Run workflow button. Each plugin's Cut beta presses it after publishing a beta.
  It never runs on pull requests or pushes, and only one run is on the store at a time.
- The **Tests** workflow runs the runner's offline checks on every pull request.

Proof (steps, screenshots, console output, videos) goes to a private R2 bucket.
The public run page shows only pass or fail, the plugin versions tested and, for a
journey that failed, its step names with one fixed kind of failure (such as
"timed out after 30 s"), never what a step found.
