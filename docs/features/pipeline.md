# Pipeline: CI on every pull request, deploys only from main

Prod runs what main holds, tested as main holds it. Asked for on 2026-10-11, after main, prod and the main checkout kept drifting apart.

## Why

- **Prod was deployed by hand, from whatever folder the work happened in.** `pnpm run deploy` ships what is on disk, so nothing tied prod to main. On 2026-10-11 a build that existed only as two local cherry-picks was tested while both its pull requests waited; on other days code was merged but not deployed because the AWS sign-in had lapsed.
- **There was no CI.** Tests ran only on a laptop, on whatever combination was assembled there. Two branches cut from the same main had to be stitched together locally to be tested, and rebase merges rewrote their commits, so every local copy then looked diverged from main.
- **The main checkout was never part of the flow.** Work happened in a worktree and shipped from there, so `~/Developer/the-library` fell behind after every ship ("4 commits behind", then "5").

## What it does

- **CI** (`.github/workflows/ci.yml`) on every pull request: typecheck, lint, the unit tests (the infra tests among them) and the web build, on Node 24 like the Lambdas. No AWS access. Main's branch protection requires its job, `check`.
- **Deploy** (`.github/workflows/deploy.yml`) on every push to main: CI again, then dev (`cdk deploy -c stage=dev`) and the integration tests against it, then prod (`pnpm run deploy`) and the hosting checks. One run at a time: a push that lands mid-run waits, and a newer push replaces it in the wait, so the newest main is always the one that deploys. A push that changes only Markdown, `docs/` or `journal/` skips it. The Actions tab can run it by hand.
- **AWS access** is one role, `TheLibrary-github-deploy` (`infra/lib/ci-stack.ts`, stack `TheLibrary-ci`), that GitHub signs in to through the account's GitHub provider. It trusts only this repository's `dev` and `prod` environments, and GitHub lets only main deploy to those. It can hand work only to CDK's bootstrap roles, plus what the integration tests do to the dev stack and the models they call. Its ARN is the repository variable `AWS_ROLE_ARN`.
- **Main is protected:** a change arrives only through a pull request whose `check` passed, for admins too, and nothing force-pushes. Merges are squash merges (the pull request's title, then its commits' messages), and merged branches are deleted.
- **The main checkout follows main:** `pnpm sync-main` fetches and fast-forwards it, and leaves it alone unless it is on main with no local changes.

## Decisions

- **Prod deploys only from main, on every merge** (was: `pnpm run deploy` from a laptop, at any time). Prod is the last main commit whose run passed; the `prod` environment's deployment history on GitHub says which. `pnpm run deploy` stays as the fallback for when GitHub Actions is down.
- **Dev and its integration tests gate prod.** A merge reaches prod in about 10 minutes instead of 2. The integration tests call Claude and Titan on Bedrock, a few cents a run.
- **Pull requests run CI only.** The integration tests share the one dev stack, so they run on main, before prod, not on each pull request. Deploying a branch to dev by hand to run them first is still fine.
- **Squash merges** (was: rebase). One commit per pull request, whatever happened on the branch, and the branch is deleted, so nothing lingers to diverge.
- **One branch per change, cut from a fresh main, merged before the next starts.** If two are open at once, the second takes in main with GitHub's Update branch and CI runs again. No more testing several branches together on a laptop.
- **The role is deployed by hand** (`pnpm cdk deploy -c stage=ci`), and the pipeline never deploys its stack. That does not put the role out of the pipeline's reach: CDK's bootstrap roles can change anything in the account, so a change merged to main could change the role too. The real gate is main itself, so the GitHub account that merges is now part of prod's security.
- **The GitHub provider is the account's existing one.** An AWS account has one per URL, and another project created it.
- **The role matches GitHub's immutable subject** (`repo:devsandip@19489947/the-library@1411266741:environment:dev`, and `prod`). The repository has immutable subjects on, so its tokens name the owner and the repository by ID as well as by name, and a renamed or recreated repository cannot match. The first Deploy run failed on the name-only subject the role first expected; CloudTrail's refused `AssumeRoleWithWebIdentity` calls showed the real one.
- **Actions are pinned to commits**, with the release in a comment, since the deploy jobs hold AWS credentials.
- **The repository stays private.** It already was on 2026-10-11.

## Open

- **Who merges.** Sandip asked Claude to merge its own pull requests once Sandip says ship. Claude Code's auto mode refused that as self-approval on #57, so Sandip merges until a permission rule allows Claude's `gh pr merge`.
- **Rollback** is a revert on main, which deploys like any other change. A failed run stops at the failing step and prod stays where it was.
- **Deleting the GitHub provider** in the other project would break these deploys.
