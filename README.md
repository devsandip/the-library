# Nutgraf

A private, single-user newsletter reader. It was called The Library until 2026-10-12; the repository, the stacks and the AWS resources keep that name. It pulls newsletters from Gmail every two hours, shows them in one clean list, and records Relevant/Irrelevant ratings that Phase 2 uses to rank what comes first.

Live at **https://sandip.dev/nutgraf/** (behind Cognito sign-in with an authenticator app). Every old `https://sandip.dev/thelibrary/...` URL redirects to the same place there.

- Product brief: [docs/prd.md](docs/prd.md)
- Technical spec: [docs/architecture.md](docs/architecture.md)
- Build plan and status: [docs/build-plan.md](docs/build-plan.md)
- Backlog: [GitHub issues](https://github.com/devsandip/the-library/issues)

## How it fits together

`sandip.dev` is an Amplify Hosting site. Amplify rewrite rules send `/nutgraf/*` (and the old `/thelibrary/*`, which the distribution redirects) to this app's own CloudFront distribution, which serves the web app from S3 and the API from API Gateway + Lambda. An ingest Lambda reads Gmail with a read-only token kept in SSM, sanitizes each issue, and stores it in S3 and DynamoDB. Everything is one CDK stack per stage, in us-east-1.

## Prerequisites

- Node 24 or newer, pnpm 11 (`corepack enable`)
- AWS CLI with the `admin` SSO profile: `aws sso login --profile admin`
- CDK is installed per project (`pnpm cdk ...`); the account is already bootstrapped in us-east-1

```bash
pnpm install
```

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests (no AWS) |
| `pnpm lint` / `pnpm typecheck` | eslint + prettier, TypeScript |
| Merge a pull request | GitHub Actions deploys it: dev, the integration tests, then prod and the hosting checks |
| `pnpm sync-main` | Fast-forward the main checkout after a merge (only when it is on main and clean) |
| `pnpm track 81 "In progress" Sorting` | Put an issue or pull request on the [Nutgraf project](https://github.com/users/devsandip/projects/10) and set its Status and Track |
| `AWS_PROFILE=admin pnpm cdk deploy -c stage=dev` | Deploy the disposable dev stack, to try a branch before its pull request |
| `AWS_PROFILE=admin pnpm deploy` | Fallback only, when GitHub Actions is down: build the web app and deploy prod from this folder |
| `AWS_PROFILE=admin pnpm seed-dev` | Reset dev to the fixture inbox |
| `AWS_PROFILE=admin pnpm test:int` | Integration tests against dev (wipes and reseeds it) |
| `pnpm check-hosting` | Hosting and auth checks through https://sandip.dev/nutgraf |
| `pnpm --filter @library/web dev:mock` | Run the UI locally against an in-memory backend |
| `AWS_PROFILE=admin pnpm topics` | Claude proposes the topic list (dry run; `--apply` stores it) |
| `AWS_PROFILE=admin pnpm enrich` | Claude sorts and summarizes issues not done yet (`--days 30`, `--force`) |
| `AWS_PROFILE=admin pnpm jev:score <labels.json>` | Score Jev's News or Learning call against labelled stories (#81); stores nothing |
| `AWS_PROFILE=admin pnpm rebuild-senders` | Re-key issues after a sender-rule change (dry run; `--apply`) |
| `AWS_PROFILE=admin pnpm reprocess` | Re-run the mail rules and cleaning on the last 30 days of raw mail after a change to `packages/core`; files as filtered what a new noise rule catches (`--days`) |

## Shipping a change

Prod runs what main holds, and only GitHub Actions deploys it ([docs/features/pipeline.md](docs/features/pipeline.md)).

1. Cut a branch from a fresh main (`git fetch`, then branch from `origin/main`). One change per branch; merge it before starting the next.
2. Open a pull request. CI (`check`: typecheck, lint, unit tests, the web build) must pass before it can merge.
3. Squash and merge. The Deploy workflow deploys dev, runs the integration tests there, deploys prod and runs the hosting checks, one run at a time. Its progress is on the Actions tab.
4. `pnpm sync-main` brings the main checkout up to date.

## First-time setup

These steps were done once in October 2026; they are here for a rebuild or a new account.

1. **Deploy.** `AWS_PROFILE=admin pnpm deploy`. Confirm the "AWS Notification - Subscription Confirmation" email so alarms reach you.
2. **Expose it on sandip.dev.** `AWS_PROFILE=admin pnpm amplify-proxy` shows the change; add `--apply` to make it. It only touches the `/nutgraf/<*>` and `/thelibrary/<*>` rules and backs up the rest to `scratch/`.
3. **Create your login.** `AWS_PROFILE=admin pnpm create-user`. Cognito emails a temporary password; sign in at https://sandip.dev/nutgraf/, choose a password, and scan the QR code with an authenticator app. The app is single-user (every account has full control), so the script refuses to create a second account; rerun it to resend your own unused invite.
4. **Connect Gmail** (below).
5. **Let GitHub deploy.** `AWS_PROFILE=admin pnpm cdk deploy -c stage=ci` creates the role GitHub Actions deploys with; set the repository variable `AWS_ROLE_ARN` to the ARN it prints, and create the `dev` and `prod` environments with only `main` allowed to deploy.
5. **Backfill and turn on the schedule** (below).

### Connect Gmail

In the [Google Cloud console](https://console.cloud.google.com/), signed in as the Gmail account that receives the newsletters:

1. Create a project called `the-library` (project picker at the top > **New project**), and make sure it is selected in the picker.
2. APIs & Services > Library: enable the **Gmail API**.
3. Navigation menu > **Google Auth platform** (or open https://console.cloud.google.com/auth/overview). A new project shows "Google Auth platform not configured yet": click **Get started**. The wizard asks for:
   - **App information:** App name "Nutgraf" (it was "The Library" until 2026-10-12), User support email: your Gmail. **Next**.
   - **Audience:** **External**. **Next**.
   - **Contact information:** your Gmail. **Next**.
   - **Finish:** tick "I agree to the Google API Services: User Data Policy", **Continue**, then **Create**.

   Only after this do **Branding**, **Audience**, **Clients** and **Data Access** appear in the left menu.
4. **Data Access** > **Add or remove scopes**: paste `https://www.googleapis.com/auth/gmail.readonly` under "Manually add scopes", **Add to table**, **Update**, then **Save**.
5. **Branding**: fill in the fields Google requires before publishing, then **Save**. Leave App logo empty (uploading one forces Google's verification review).
   - Application home page: `https://sandip.dev/nutgraf/about.html`
   - Application privacy policy link: `https://sandip.dev/nutgraf/privacy.html`
   - Application terms of service link: `https://sandip.dev/nutgraf/terms.html`
   - Authorized domains: **Add domain** > `sandip.dev`
   - Developer contact information: your Gmail

   Then **Audience** > **Publish app** (status changes from "Testing" to "In production"). Apps left in Testing get refresh tokens that expire after 7 days, which would quietly break ingest every week. Personal use does not need Google's verification: you will click through a "Google hasn't verified this app" warning once (Advanced > Go to The Library). Unverified apps are capped at 100 users, which does not matter here.
6. **Clients** > **Create client**: Application type **Desktop app**, name "The Library CLI", **Create**, then **Download JSON**.

Then, on your Mac:

```bash
AWS_PROFILE=admin pnpm gmail:auth --credentials ~/Downloads/client_secret_XXXX.json
AWS_PROFILE=admin pnpm gmail:check
```

`gmail:auth` opens Google's consent page, stores the token in SSM (`/thelibrary/prod/gmail/oauth`), and prints nothing secret. You can delete the downloaded JSON afterwards. `gmail:check` confirms both labels are visible and shows how many messages a backfill would consider.

### Backfill and schedule

```bash
AWS_PROFILE=admin pnpm backfill --weeks 4
```

Then set `INGEST_SCHEDULE_ENABLED = true` in `infra/lib/config.ts` and deploy. That turns on the two-hourly schedule (06:00 to 22:00 IST) and the "no clean run in 24 hours" alarm.

## Runbook

- **"ingest failed" alarm email.** Open https://sandip.dev/nutgraf/library/status for the last error. `invalid_grant` means the Gmail token was revoked (password change, removed access, or the app was left in Testing): rerun `pnpm gmail:auth`. Anything else: CloudWatch logs for the ingest Lambda. Failed messages retry on the next run automatically.
- **A newsletter is missing or noise is getting through.** Edit `packages/core/src/sources.ts` (labels, sender allowlist, noise rules, sender aliases), add a fixture test, merge (merging deploys).
- **A newsletter shows the wrong name, or two newsletters are merged into one sender.** Add an alias or a split-by-name rule in `packages/core/src/sources.ts`, add a test, merge, then once it is deployed `AWS_PROFILE=admin pnpm rebuild-senders` to see the plan and `pnpm rebuild-senders --apply` to re-key stored issues. Read state, ratings and mutes are kept.
- **An issue renders badly.** Fix the sanitizer or extractor in `packages/core`, add a fixture test, merge, then once it is deployed `AWS_PROFILE=admin pnpm reprocess` to rebuild the last 30 days (raw messages are kept 30 days; state and ratings are untouched).
- **Remove the app from sandip.dev.** `AWS_PROFILE=admin pnpm amplify-proxy --remove`.
- **The distribution was replaced** (rare). Rerun `pnpm amplify-proxy --apply`; the rule points at the distribution domain.
- **Changing the HTTP API.** Avoid replacing it (keep its construct ID): a new API took about 16 minutes to get a DNS record, during which the API returns 502s.
- **Summaries or tabs missing.** Library > Status (`/library/status`) shows Claude's last run. "Waiting for the topic list": run `pnpm topics --apply`. `AccessDeniedException ... not available for this account`: the AWS account has not completed Anthropic's one-time use-case form (Bedrock console, Model catalog), or the model in `MODELS.classify` (`services/ingest/src/bedrock.ts`) is not enabled for the account. Haiku 5.5 was not, as of 2026-10-09; Haiku 4.5 is. Then `pnpm enrich --days 30` catches up.
- **Cost.** About $0.20/month in Phase 1. Every resource is tagged `project=thelibrary`.

## Backlog

Open work lives in [GitHub issues](https://github.com/devsandip/the-library/issues). Each issue notes what it depends on.

- Labels: `bug`, `enhancement`, `chore`, and `needs-decision` for anything waiting on Sandip.
- When work on an issue starts, its design notes go in `docs/features/<name>.md`, and the commit that finishes it says `Closes #N`.
- `docs/build-plan.md` keeps the phase plan; the issues carry status.

## Repo layout

```
docs/              prd.md, architecture.md, build-plan.md
packages/core/     classification, sanitizing, extraction, keys, shared API types
services/ingest/   Gmail client, ingest loop, Lambda handler
services/api/      reader API: routes, DynamoDB repository, Lambda handler
web/               Preact app (base path /nutgraf/)
infra/             CDK app: one stack per stage, and the role GitHub Actions deploys with
.github/workflows/ ci (every pull request), deploy (every push to main)
scripts/           amplify-proxy, check-hosting, create-user, gmail-auth, gmail-check, backfill, reprocess, rebuild-senders, seed-dev, sync-main, track, jev-score
```
