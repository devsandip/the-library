# The Library: notes for Claude Code

The README covers the stack, the commands and the runbook. `docs/architecture.md` is the technical spec.

## Shipping a change

Only GitHub Actions deploys prod, and only from main (`docs/features/pipeline.md`). So:

- **Start every change on a new branch cut from a fresh `origin/main`** (`git fetch` first). One change per branch, merged before the next one starts. Never combine unmerged branches locally to test them together; if two pull requests must be open at once, update the second from main after the first merges (`gh pr update-branch <n>`) and let CI run again.
- **Open a pull request.** CI's `check` (typecheck, lint, unit tests, web build) must pass. Merges are squash merges.
- **Merging is deploying.** The Deploy workflow deploys dev, runs `pnpm test:int` there, deploys prod and runs `pnpm check-hosting`. Follow it on the Actions tab or with `gh run list --workflow Deploy`. Prod is the last main commit whose run passed.
- **Never deploy prod by hand.** `pnpm run deploy` and `cdk deploy -c stage=prod` are the fallback for when GitHub Actions is down, and only when Sandip asks.
- **After every merge, run `pnpm sync-main`**, so the main checkout matches main.
- **Dev is disposable.** Deploying a branch to dev (`pnpm cdk deploy -c stage=dev`) to run the integration tests before opening its pull request is fine.
- **Prod data jobs run after their code is deployed**, from a laptop with `AWS_PROFILE=admin` (`pnpm reprocess`, `pnpm enrich`, backfills).
