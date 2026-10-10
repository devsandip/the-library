---
status: current
updated: 2026-10-09
---

# The Library: Build Plan

Milestones for rebuilding Phase 1 from scratch, riskiest unknown first. Design details are in [architecture.md](architecture.md).

Every milestone ends with `pnpm test`, `pnpm lint` and `pnpm typecheck` green, and one commit on `main` pushed to the private repo. The first build attempt is kept, uncommitted, in `scratch/first-pass/` for reference; pieces are reused only after review.

Open work (fixes, new features, the rest of Phase 2) is tracked as [GitHub issues](https://github.com/devsandip/the-library/issues). This file keeps the plan for each phase.

## Status (2026-10-10)

| Milestone | State |
|---|---|
| R0 to R4, R6, R7 | Done. 86 unit tests, 14 integration tests on dev. |
| R2 | Done. Amplify rule live; every hosting check passes through `sandip.dev`. |
| R5 | Done. 4-week backfill: 549 messages, 394 newsletters, 155 filtered, 0 errors. Two-hourly schedule and staleness alarm on. |
| R8 | Live, and Sandip has signed in. Left: rate, archive and reopen issues on iPhone and Mac. |
| Clean list | The new look (#12, direction B), the sender picker (#9), topic chips (#10), the Summary page with read-time relevance (#11) and the Mac standfirst (#14). 144 unit tests, 15 API integration tests on dev. On dev only: the prod deploy waits for an SSO sign-in (the session expired 2026-10-10), then acceptance on iPhone and Mac. |
| R9 | README and `pnpm reprocess` done. The errors alarm emailed during the first backfill attempt, so alerting works end to end. Left: a week with no alarms, the AWS Budget (#6), the `sandip.dev` repo change (#7). |

## Phase 1 (rebuild)

| # | Milestone | Done when |
|---|---|---|
| R0 | **Reset and re-plan.** First pass archived; this file and `architecture.md` rewritten. | Docs describe the system as it will be built. |
| R1 | **Workspace.** pnpm workspace (`packages/core`, `services/ingest`, `services/api`, `web`, `infra`), TypeScript 6.0, eslint, prettier, vitest, esbuild as a root devDependency, `allowBuilds` for esbuild. | Empty workspace passes test, lint, typecheck. |
| R2 | **Hosting spike.** CDK app with `stage` context. Deploy a `TheLibrary-prod` skeleton: web bucket, app distribution, SPA function, headers policy, placeholder shell, and a temporary unauthenticated echo Lambda behind the HTTP API. `scripts/amplify-proxy.ts` (dry run by default) and `scripts/check-hosting.sh`. **With Sandip's OK**, apply the Amplify rewrite rule. | `check-hosting.sh` passes through `https://sandip.dev/thelibrary`, or a fallback from architecture section 4 is chosen and recorded there. Root site unchanged. |
| R3 | **Core library.** `sources.ts`, parse, sanitize, extract, `processMessage`, keys, shared API types. Synthetic fixtures for every sender type and noise type. | Every fixture classified correctly; view-online and unsubscribe asserted per fixture; no script, handler, `cid:` image or pixel survives sanitizing. |
| R4 | **Storage and ingest.** Table with all 4 GSIs, content bucket with lifecycle, ingest Lambda (Gmail over fetch, `Store`), Scheduler created disabled, errors alarm with SNS email. `TheLibrary-dev` stack. `scripts/seed-dev.ts` and `pnpm test:int` harness. | Unit tests on the ingest loop; integration on dev: seeding twice creates no duplicates, sender counters and S3 objects correct. |
| R5 | **Gmail hookup** (needs Sandip's Google Cloud setup; does not block R6 and R7). `pnpm gmail:auth`, `pnpm gmail:check`, enable the schedule, staleness alarm, `pnpm backfill --weeks 4`. | Newsletter + filtered count equals the Gmail query count; rerun inserts 0; 5 real issues spot-checked. |
| R6 | **API and auth.** Cognito (Essentials, managed login with branding, TOTP), JWT authorizer, router + repo, echo stub removed. Minimal web shell: sign in, callback, `/status` page. | Router unit tests; dev integration tests for every route; no token = 401 through `sandip.dev`. **Checkpoint:** Sandip signs in on prod and sees `/status`, which proves branding, TOTP, callback, audience and proxy auth together. |
| R7 | **Reader UI.** Home (unread/all/archived, sender filter, load more, refresh now, "No new numbers."), issue view (sandboxed srcdoc, Relevant/Irrelevant toggles, read/unread, archive, open original), sender page (mute, unsubscribe link), senders index. Mock mode. | Helper unit tests; browser check in mock mode at 390px and desktop, light and dark. |
| R8 | **Go live.** Full web deploy with generated `config.json`. | Sandip rates, archives and reopens issues on iPhone and Mac; state persists across devices; `check-hosting.sh` passes. |
| R9 | **Hardening.** Forced-error alarm test, `reprocess` command (re-sanitize from `raw/` for issues under 30 days old), README (setup, deploy, token rotation, adding sender rules), AWS Budget on the project tag, `robots.txt` change proposed for the `sandip.dev` repo. | Fresh clone deploys from the README alone; `/status` shows ~9 runs a day; one week with no alarms. |

## Things only Sandip can do

| When | What |
|---|---|
| R2 | Approve the one Amplify rewrite rule on the live `sandip.dev` app (existing rules preserved and backed up; removable with `--remove`). |
| Before R5 | Google Cloud OAuth setup (architecture section 3 lists scope; steps in README at R5): project, Gmail API, consent screen External and **published to "In production"** (Testing mode expires tokens after 7 days), Desktop OAuth client. About 10 minutes. |
| R4 | Confirm the SNS subscription email. |
| R6 | First sign-in: set a password, enroll TOTP. |
| R9 | Decide on the `robots.txt` and shared-origin note in the `sandip.dev` repo. |

## Phase 2: ranking (after ~1 week of Phase 1 ratings)

Reshaped by issues #2 to #5 (2026-10-09): Must Read shipped (#2); enrichment and the News/Learning tabs are built and deployed dark, waiting for Anthropic model access on the AWS account (#4, #3); ranking becomes a sort inside each tab (#5).

| # | Milestone | Done when |
|---|---|---|
| P2.1 | Enrichment per issue: Haiku summary, News/Learning shelf, one topic, promo flag (thinking off); Titan embedding into the `EMB` item; retry for un-enriched issues; topic list proposed once; enrich the backfill. | Every non-filtered issue enriched; backfill cost logged. |
| P2.2 | Ranking math in `packages/core` + rank step after ingest and after each rating. | Cold start orders keep-list senders above neutral; 5 Irrelevant ratings drop a sender; order stable within a day. **Math done** (`rank.ts`, all three checks are unit tests); it scores the Summary page at read time. The stored rank step is left. |
| P2.3 | Rank sort, reason line, yellow box on top 5, topic filter, digest logging. | Ranked list with reasons; one digest row per day. |
| P2.4 | Success metric: rolling 14-day share of digest items rated Relevant. | Visible in the app; target >= 60%. |

## Phase 3 (optional, later)

Audio briefing, per architecture section 13.
