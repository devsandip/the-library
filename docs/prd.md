---
tags: [project, spec, the-library, newsletter-reader]
status: draft
created: 2026-10-09
---

# The Library: Initial Spec

A personal newsletter reader. Named after Harold Finch's headquarters in *Person of Interest*.

> For Claude Code. This is the product-level brief. Your job: turn it into a detailed technical spec and build plan, resolve the open questions at the bottom, then implement Phase 1.

## Problem

I subscribe to ~25 newsletters across two Gmail labels and read almost none of them. Existing readers (Meco, Gmail tabs) show everything in date order with no sense of what I care about. I want one place that learns my taste from simple thumbs up/down and puts the best items on top, readable on any device.

## Goal

A private, single-user web reader that ingests my newsletters daily, ranks them by learned preference, and lets me read and rate them from phone or laptop.

**Success looks like:** I open it most days, and the top 5 items are things I'd thumbs-up at least 3 times out of 5 after two weeks of use.

## Name and tone

- Product name: **The Library**
- Light *Person of Interest* touches, never at the cost of readability:
  - Thumbs are labeled **Relevant** and **Irrelevant**
  - Top-ranked items get the Machine's **yellow box** (a thin yellow corner-bracket frame)
  - Empty state: *"No new numbers."*
- Visual style: clean, dark-friendly, typography first. The theme is a garnish, not a costume.

## Non-goals (v1)

- Podcast / audio (possible Phase 3, see below)
- Multiple users, sharing, social features
- Native mobile apps (responsive web only)
- Replying to or managing email in Gmail
- RSS or non-email sources

## User and context

- One user: me (dev.sandip@gmail.com)
- Interests to seed the ranking: **tech industry, startups, AI, product management, system design**, plus some general business news
- Devices: iPhone, Mac, occasionally other browsers

## Sources

- Gmail labels: `Newsletters` (id `Label_244609042207730416`) and `Meco_97675919-0d09-4077-a165-9d5569fa1957` (id `Label_18`)
- Also include these senders, which currently land in the inbox unlabeled: ByteByteGo (`bytebytego@substack.com`), The Pragmatic Engineer (`pragmaticengineer@substack.com`, `pragmaticengineer+deepdives@substack.com`), Lenny's Newsletter (`lenny*@substack.com`)
- Ignore non-newsletter noise in those labels (GitHub repo notifications, Substack "new notes" / "Weekly Stack" digests, payment receipts)

## Core features

### 1. Ingest
- Pull new issues from the sources at least daily (more often is fine if cheap)
- Store full HTML plus extracted clean text; dedupe on Gmail message ID
- Sanitize HTML: strip scripts, tracking pixels, and tracked redirect links where possible
- Capture sender, publication name, subject, date, original link ("view in browser") if present, and unsubscribe link

### 2. Rank
- Each issue gets a score combining:
  - **Sender affinity:** my thumbs history for that sender (smoothed for cold start)
  - **Topic similarity:** embedding similarity to issues I liked, minus similarity to ones I disliked
  - **Recency:** decay over a few days
  - a small **exploration** factor so low-scored senders still surface occasionally
- Cold start: seed topic preference from the five interests above, and seed sender priors (positive for Must Read newsletters, neutral otherwise)
- Ranking must be explainable in the UI in one line ("Because you liked 4 Platformer issues", "Matches: AI, startups")

### 3. Read
- Home view: ranked list of unread issues with publication, subject, one-line summary, reason-for-rank, date
- Issue view: clean, readable rendering of the newsletter; fast on mobile
- Actions per issue: Relevant (thumbs up), Irrelevant (thumbs down), mark read, archive, open original
- Filters: unread / all, by sender, by topic
- News and Learning: Home has two tabs. Claude decides per issue with one test, "would this still be worth reading in three months?", and I can move any issue or set a newsletter to always land in one tab. Claude also tags one topic per issue (tap it to filter), archives promos, and unread news archives itself after a week (except Must Read).
- Per-sender view with a "mute sender" action and a visible unsubscribe link
- Must Read: I star the newsletters I never want to miss; their unread issues come first

### 4. Learn
- Relevant/Irrelevant ratings update ranking for the next refresh; no manual weights for me to tune
- Implicit signals (opened, time on page) can be logged but should not override explicit thumbs in v1

## Keep list (seed priors)

Since 2026-10-09 this list only seeds **Must Read**: a star I put on a newsletter (sender page or Senders index). Starred newsletters' unread issues come first, and the star is the ranking prior. New senders start unstarred.

The Ken, Platformer, System Design Newsletter (Neo Kim), AlgoMaster, ByteByteGo, The Pragmatic Engineer, Lenny's Newsletter, Product Talk (Teresa Torres), Itamar Gilad, Lewis C. Lin Deep Dives, Business Insider, TLDR (main / AI / Founders, once subscribed). The Economist and Washington Post are paid and may be re-enabled.

## Architecture constraints

- **AWS only** (no Supabase or other backends). Infra as code with **AWS CDK**, deployable by me with `cdk deploy` from my Mac.
- Expected shape (Claude Code to confirm or improve):
  - EventBridge Scheduler → Lambda ingest (Gmail API, OAuth refresh token in Secrets Manager)
  - S3 for raw/clean HTML; DynamoDB for issues, feedback, sender stats, embeddings
  - Bedrock: Titan embeddings for ranking; Claude Haiku 5.5 for one-line summaries and topic tags
  - API Gateway + Lambda for the reader API
  - Static frontend on S3 + CloudFront; Cognito for single-user auth
- **Hosting: `https://sandip.dev/thelibrary`** (path, not subdomain)
  - Frontend must build and route with base path `/thelibrary/`; API under `/thelibrary/api/` or a separate API domain
  - CloudFront path behavior for `/thelibrary*`; ACM cert must be in us-east-1 for CloudFront
  - `.dev` is HTTPS-only (HSTS preloaded), so no HTTP fallback
  - Cognito callback and sign-out URLs on this path
  - Private app on a public domain: add `noindex` and block crawlers for this path
- No vector database at this scale; compute similarity in Lambda
- **Cost target: under $2/month** at ~25 issues/day
- Privacy: nothing public; reader behind auth; email content never leaves my AWS account except to Bedrock

## Phases

1. **Ingest + reader:** Gmail ingest, storage, sanitized rendering, thumbs that persist, date-sorted list. Usable end to end.
2. **Ranking:** embeddings, scoring, reason-for-rank, cold-start priors. Ship after ~1 week of Phase 1 thumbs data.
3. **(Optional, later) Daily 10-minute audio briefing:** Claude script from top-ranked items, Amazon Polly (Generative voice), private podcast RSS feed in S3. Est. ~$6 to $10/month. Design Phases 1 and 2 so this can bolt on without rework.

## Open questions for Claude Code

1. Gmail API polling vs. forwarding newsletters to an SES inbound address. Which is simpler and more reliable for one user?
2. AWS region: ap-south-1 (Mumbai) for latency vs. a region with full Bedrock model availability. Check Haiku 5.5 and Titan embeddings availability.
3. Should reading or archiving in the app sync read state back to Gmail?
4. Frontend stack: keep it minimal (plain TS + a light framework). Recommend one.
5. Retention: how long to keep full HTML vs. text and embeddings.
6. Backfill: how many weeks of existing issues to import for cold start.
7. Where is `sandip.dev` hosted today (DNS and the root site)? If the root is not on CloudFront, choose between moving it behind CloudFront, proxying `/thelibrary` from the current host, or falling back to `thelibrary.sandip.dev`.

## Deliverables expected from Claude Code

1. Detailed technical spec (data model, API, ranking formula, CDK stack layout, auth flow, Gmail OAuth setup steps)
2. Build plan broken into small, testable milestones
3. Phase 1 implementation with a README covering setup and deploy
