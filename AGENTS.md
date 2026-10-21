# Agent contract

- Read [SKILL.md](SKILL.md) and [runner/README.md](runner/README.md) before changing a journey.
- One journeys run on beta.sm0ky.dev at a time, from anywhere. Check this repo's Actions page first.
- Never add a live run to pull request or push workflows. Tests.yml stays offline.
- Name secrets, never their values. The public run log shows only pass or fail, plus a failed journey's step names and fixed kinds of failure.
- A new journey starts `@next` and becomes `@running` only after it passes on the beta store.
- PRs go to `main` and pass ClawSweeper. The owner merges.
