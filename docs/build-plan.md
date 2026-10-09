---
status: draft for review
created: 2026-10-09
---

# The Library: Build Plan

Small milestones, each with a concrete check that proves it works. Design details live in [architecture.md](architecture.md).

**Blockers that need Sandip:**
- **Before M2:** Google Cloud OAuth setup (architecture section 8, steps 1 to 5). About 10 minutes in the console.
- **Before M1 deploy:** `aws login` (the CLI session has expired).
- **Before M6:** confirm who owns the `sandip.dev` CloudFront distribution (architecture section 9).

## Phase 1: Ingest + reader

| # | Milestone | Done when |
|---|---|---|
| M0 | Repo, docs, pnpm workspace, lint/format, vitest wired | `pnpm test` and `pnpm lint` pass on an empty workspace |
| M1 | CDK app with `LibraryStateful` (table + GSIs, content bucket with lifecycle rules, web bucket, Cognito pool/client) | `cdk synth` assertion tests pass; `cdk deploy LibraryStateful` succeeds |
| M2 | `pnpm gmail:auth` script writes refresh token to SSM | Script run once; a smoke command lists your Gmail labels using only the SSM parameter |
| M3 | Ingest core in `packages/core`: source rules, MIME parse, sanitize, text/metadata extraction | Fixture tests: each keep-list sender type parses with correct publication, view-online and unsubscribe links; each noise type (GitHub, Substack notes, Weekly Stack, receipt) is filtered; no `<script>`, `on*`, or 1x1 pixel survives sanitization |
| M4 | Ingest Lambda + Scheduler + SNS error alarm + `pnpm backfill --weeks 4` | Backfill count in DynamoDB matches the Gmail query count minus filtered; a second run inserts 0 (dedupe); a forced error sends the alarm email |
| M5 | API Lambda + HTTP API + JWT authorizer, all Phase 1 routes | Integration test with a real Cognito token: list, get, rate, change state, mute; request without a token gets 401 |
| M6 | Hosting: CloudFront behaviors on `sandip.dev`, SPA rewrite, response headers | `https://sandip.dev/thelibrary/` serves the app shell with `X-Robots-Tag: noindex`; `/thelibrary/api/issues` returns 401 without auth; the root site is unchanged |
| M7 | Frontend: login, date-sorted list, unread/all, sender filter, issue view (sandboxed iframe), Relevant/Irrelevant, read/unread, archive, open original, sender page with mute + unsubscribe, "No new numbers." empty state | Playwright smoke at iPhone and desktop widths covers login, open, rate, archive; ratings survive reload |
| M8 | Hardening + README (setup, deploy, rotate Gmail token, add a sender rule) | Fresh-clone deploy works by following the README alone; one week of real use with no ingest alarms |

Phase 1 ships after M8. Then collect about a week of ratings.

## Phase 2: Ranking

| # | Milestone | Done when |
|---|---|---|
| P2.1 | Resolve Haiku 5.5 inference-profile ID and pricing; enrichment step (Titan embed + Haiku summary/topics) with retry; backfill enrichment | Every non-filtered issue has `summary`, `topics`, `embedding`; Bedrock cost for the backfill is logged |
| P2.2 | Ranking math in `packages/core` (Thompson-sampled sender affinity, topic centroids, recency) + rank step after ingest and after ratings | Unit tests: cold start orders keep-list senders above neutral ones; a sender with 5 Irrelevant ratings drops; same-day order is stable across calls |
| P2.3 | `sort=rank`, reason line, yellow box on top 5, topic filter, `DIGEST#<date>` logging | UI shows ranked list with one-line reasons; digest row written once per day |
| P2.4 | Success metric view: rolling 14-day share of digest items rated Relevant | Number visible in the app's settings/about page; target >= 60% |

## Phase 3 (optional, later)

Audio briefing per architecture section 12. Not planned in detail.
