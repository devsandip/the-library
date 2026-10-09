---
status: draft for review
created: 2026-10-09
source: docs/prd.md
---

# The Library: Technical Spec

This turns [prd.md](prd.md) into a buildable design. It resolves the PRD's open questions, defines the data model, API, ranking formula, CDK layout, auth flow and Gmail OAuth setup. The milestone plan lives in [build-plan.md](build-plan.md).

## 1. Decisions on the open questions

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Gmail API polling vs. SES inbound | **Gmail API polling** | Labels already exist, so no filters or forwarding to set up. Polling can backfill old issues; SES cannot. SES inbound needs MX on a (sub)domain plus a Gmail forwarding filter per sender, which is more moving parts for one user. Polling cost is negligible. |
| 2 | AWS region | **us-east-1 for everything** | Claude Haiku 5.5 and Titan Text Embeddings V2 are both available there. The Sept 2026 India expansion brought Haiku 4.5 (not 5.5) to Mumbai via geo inference, and Titan V2 is not listed in-region for ap-south-1. ACM for CloudFront must be in us-east-1 anyway. Latency from India is mostly hidden: static assets come from the Delhi edge, and only API calls (~250 ms RTT) go to Virginia. Re-check availability with `aws bedrock list-inference-profiles` before Phase 2. |
| 3 | Sync read state back to Gmail | **No, not in v1** | Keeps the OAuth scope at `gmail.readonly`, which limits blast radius if the token leaks. Can add one-way "mark read in Gmail" later with `gmail.modify`. |
| 4 | Frontend stack | **Preact + Vite + TypeScript, plain CSS** | ~4 KB runtime, React-style components, `preact-iso` for routing, Vite handles the `/thelibrary/` base path. No CSS framework: the UI is mostly typography, and CSS variables cover light/dark. |
| 5 | Retention | Raw `.eml`: **30 days**. Sanitized HTML: **365 days**. Clean text, metadata, ratings, embeddings: **forever**. | Raw MIME only exists to re-run the sanitizer after a bug fix. Text and embeddings are the training data and are tiny (~9k issues/year, <200 MB). S3 lifecycle rules enforce this; no app logic. |
| 6 | Backfill | **4 weeks** (~700 issues), configurable | Enough to rate a meaningful set in week one and to learn the sender list, without paying to summarize stale mail. |
| 7 | Where `sandip.dev` is hosted | **Route 53 + CloudFront (`d1onqceep3yjzz.cloudfront.net`) + S3 origin.** Plan: add `/thelibrary*` behaviors to that distribution. | Verified via DNS and response headers on 2026-10-09. **Still unknown:** which account/stack owns that distribution. See section 9. |

### Deviations from the PRD

- **SSM Parameter Store (SecureString) instead of Secrets Manager** for the Gmail refresh token. Secrets Manager costs $0.40/secret/month, 20% of the $2 budget, and buys nothing here (no rotation). Standard SecureString parameters are free and KMS-encrypted with the AWS-managed key.
- **One-line summaries move to Phase 2.** Phase 1 shows Gmail's free `snippet` instead. This keeps Phase 1 Bedrock-free and puts all model work in one place.
- **Exploration is Thompson sampling on sender affinity**, not a separate random factor. Same effect, no extra knob (see section 5).

## 2. System overview

```
                       sandip.dev (existing CloudFront distribution)
                       ├── /*                  -> existing root site (unchanged)
                       ├── /thelibrary/api/*   -> API Gateway HTTP API  -> api Lambda
                       └── /thelibrary*        -> S3 web bucket (OAC) + SPA rewrite function

EventBridge Scheduler (every 2h)
        -> ingest Lambda --Gmail API (refresh token from SSM)--> Gmail
                |
                |-> S3 content bucket: raw/, html/, text/
                |-> DynamoDB table: issues, senders, feedback, state
                '-> (Phase 2) Bedrock: Titan embed + Haiku summary/tags, then rank

Cognito User Pool (single user, no self-signup) -> JWT authorizer on the HTTP API
```

Everything runs in **us-east-1** in one AWS account. All code is TypeScript (CDK, Lambdas, frontend) in one pnpm workspace.

## 3. Ingest

### Schedule and query

- EventBridge Scheduler, every 2 hours, 06:00 to 24:00 IST (`cron(0 0/2 * * ? *)` with timezone `Asia/Kolkata`, skipping 00:00 to 06:00). About 10 runs/day. Daily is the PRD minimum; this is still free.
- Each run calls `users.messages.list` with:

  ```
  {label:Newsletters label:Meco_97675919-0d09-4077-a165-9d5569fa1957
   from:bytebytego@substack.com from:pragmaticengineer@substack.com
   from:pragmaticengineer+deepdives@substack.com from:substack.com}
  newer_than:3d
  ```

  `{}` is Gmail's OR. `from:substack.com` is deliberately broad because Lenny's address is a wildcard (`lenny*@substack.com`); the source rules below narrow it in code.
- Dedupe: batch-check returned message IDs against DynamoDB and fetch only new ones (`format=raw`). The 3-day overlap means a missed run self-heals. No `historyId` bookkeeping; at ~25 messages/day it is not worth the complexity.
- Backfill is the same code path with `newer_than:28d`, run once via `pnpm backfill --weeks 4`.

### Source and noise rules

A single `packages/core/src/sources.ts` config, unit-tested against fixtures:

- **Include** if labeled `Newsletters` or `Meco_…`, or the From address matches the allowlist (`bytebytego@substack.com`, `pragmaticengineer(+deepdives)?@substack.com`, `/^lenny.*@substack\.com$/`).
- **Exclude** (stored as `state=filtered` so they are never refetched, never listed):
  - `notifications@github.com` and other `@github.com` senders
  - Substack platform mail: subjects matching "new notes", "Weekly Stack", and `no-reply@substack.com` digests
  - Receipts: subject matches `/receipt|invoice|payment|your order|subscription (confirmed|renewed)/i`, or sender is a known billing domain (Stripe, Paddle, Apple)
- Messages matching neither rule are dropped.

### Processing pipeline (per message)

1. Parse MIME (`mailparser`). Prefer `text/html`; fall back to wrapping `text/plain` in `<pre>`.
2. Apply source rules.
3. Write raw `.eml` to `s3://content/raw/<msgId>.eml` (30-day lifecycle).
4. **Sanitize** (`sanitize-html`, allowlist based):
   - Drop `script`, `iframe`, `object`, `embed`, `form`, `base`, `meta[http-equiv=refresh]`, all `on*` attributes, `javascript:` URLs.
   - Keep `<style>` and inline styles; newsletters are unreadable without them. They render in a script-free sandboxed iframe (see section 6), so CSS cannot execute anything.
   - Remove tracking pixels: `img` with width or height <= 3, `display:none` images, and images from known open-tracking hosts (list in `sources.ts`).
   - Unwrap tracked redirects when the destination is recoverable from a query parameter (Mailchimp, ConvertKit, beehiiv, Sendgrid `url=`/`u=` patterns). Substack's opaque `substack.com/redirect/…` tokens are left alone. Strip `utm_*` params from all links.
   - Force `target="_blank" rel="noopener noreferrer"` on links.
5. Extract clean text (`html-to-text`), word count, reading minutes.
6. Extract metadata:
   - `publication`: From display name, overridden by a sender map in `sources.ts` (e.g. both Pragmatic Engineer addresses map to one publication).
   - `viewOnlineUrl`: anchor whose text matches `/view (it |this )?(online|in (your )?browser|on the web)/i`, else Substack's canonical `/p/<slug>` link.
   - `unsubscribeUrl`: the `https:` entry of `List-Unsubscribe`, else the last anchor whose text contains "unsubscribe".
7. Write `html/<msgId>.html` and `text/<msgId>.txt` to S3, then the issue item and sender upsert to DynamoDB in one `TransactWriteItems`.
8. (Phase 2) Enrichment and ranking, see section 5.

Failures are per message: one bad email logs an error and the run continues. The next run retries it because it is still not in DynamoDB.

## 4. Data model

### DynamoDB: one table, on-demand

`pk` / `sk` strings, two GSIs. Single user, so no tenant key.

| Entity | pk | sk | Key attributes |
|---|---|---|---|
| Issue | `ISSUE#<gmailMsgId>` | `META` | `senderId`, `publication`, `subject`, `fromAddr`, `receivedAt` (ISO), `snippet`, `viewOnlineUrl`, `unsubscribeUrl`, `wordCount`, `readMinutes`, `state` (`unread`\|`read`\|`archived`\|`filtered`), `rating` (`1`\|`-1`\|absent), `ratedAt`, `s3Keys`. Phase 2: `summary`, `topics[]`, `embedding` (binary, 512 x float32 = 2 KB), `enrichedAt`, `score`, `scoreReason`, `rankedAt` |
| Feedback event | `ISSUE#<id>` | `EVT#<isoTs>` | `type` (`rating`\|`state`\|`open`\|`dwell`), `value`, `ms`. Append-only log; the Issue item holds current state. |
| Sender | `SENDER#<senderId>` | `META` | `publication`, `addresses[]`, `muted`, `priorAlpha`, `priorBeta`, `up`, `down`, `issueCount`, `lastSeenAt`, `unsubscribeUrl` |
| Ingest state | `STATE` | `INGEST` | `lastRunAt`, `lastRunStats`, `lastError` |
| Taste profile (P2) | `PROFILE` | `TASTE` | `likedCentroid`, `dislikedCentroid`, `seedVectors`, `updatedAt` |
| Daily digest (P2) | `DIGEST#<yyyy-mm-dd>` | `META` | ordered top-N issue IDs with scores. Logged once per day so the success metric is measurable, and Phase 3 audio reads from it. |

`senderId` is the From address lowercased with any `+tag` removed (`pragmaticengineer@substack.com`). The sender map can merge several addresses into one ID.

**GSI1 (list by state, newest first):** `gsi1pk = "STATE#<state>"`, `gsi1sk = <receivedAt>#<msgId>`. Changing state moves the item between partitions by rewriting `gsi1pk`. "All" = query `unread` and `read`, merge. Filtered issues get `STATE#filtered` and are never queried.

**GSI2 (per sender):** `gsi2pk = "SENDER#<senderId>"`, `gsi2sk = <receivedAt>`.

Ranked sort (Phase 2) reads the unread partition (at most a few hundred items) and sorts by `score` in the Lambda. No index needed at this scale.

### S3: content bucket (private, SSE-S3, block public access)

| Prefix | Content | Lifecycle |
|---|---|---|
| `raw/` | original `.eml` | expire after 30 days |
| `html/` | sanitized HTML | expire after 365 days |
| `text/` | clean text | keep |
| `audio/` | reserved for Phase 3 | n/a |

Text lives in S3, not DynamoDB, because long issues can exceed the 400 KB item limit.

A separate **web bucket** holds the built frontend under the `thelibrary/` key prefix, served only through CloudFront OAC.

## 5. Ranking (Phase 2)

Recomputed for all unread issues at the end of each ingest run, and asynchronously (debounced async Lambda invoke) after each rating. "Updates for the next refresh," with no tuning knobs exposed.

### Enrichment

Per new issue, input = subject + first ~1,500 tokens of clean text:

- **Titan Text Embeddings V2** (`amazon.titan-embed-text-v2:0`), 512 dimensions, `normalize: true`.
- **Claude Haiku 5.5** (exact inference-profile ID resolved at build time), one call returning JSON via tool use: `summary` (<= 20 words) and `topics` (1 to 3 from a fixed taxonomy). Taxonomy starts with the five seed interests (AI, startups, tech industry, product management, system design) plus ~15 others (business news, engineering careers, infrastructure, security, design, finance, policy, …). Fixed tags keep the topic filter usable.

Issues missing `enrichedAt` are retried each run, capped at 50 per run.

### Score

For unread, non-muted issue *i* from sender *s*:

```
score_i = 0.40 * S_sender + 0.40 * S_topic + 0.20 * R
```

**Sender affinity with built-in exploration (Thompson sampling).**
Sender *s* has a Beta prior (α₀, β₀): keep-list senders (3, 1), everyone else (2, 2).
Draw `p ~ Beta(α₀ + up_s, β₀ + down_s)` and set `S_sender = 2p − 1` (range −1..1).
Senders with little data have wide distributions and occasionally draw high, which is the exploration. The RNG is seeded with `date + senderId`, so the order is stable within a day and does not reshuffle on every reload.

**Topic similarity.**
`μ⁺ = normalize( k * seed + Σ w_j * e_j )` over liked issues, where `seed` is the mean of the five interest embeddings, `k = 5` pseudo-counts, and `w_j = 0.5^(age_days / 60)` so taste can drift.
`μ⁻` is the same over disliked issues, with no seed.
`raw_i = cos(e_i, μ⁺) − 0.5 * cos(e_i, μ⁻)` (second term is 0 until there are dislikes).
Titan cosine values cluster in a narrow band, so `S_topic = clip(z-score of raw_i across the candidate set, −2, 2) / 2`.

**Recency.** `R = 0.5^(age_hours / 48)`. Two-day half-life.

Weights are fixed constants in code. Once there are ~150 ratings, a later milestone can fit them with logistic regression offline. That is still "no manual weights" from the user's side.

### Reason for rank (one line)

Pick the component with the largest weighted contribution:

| Dominant | Condition | Text |
|---|---|---|
| Sender | `up_s >= 2` | "Because you marked 4 Platformer issues Relevant" |
| Sender | keep-list, few ratings | "From your reading list" |
| Topic | always | "Matches: AI, startups" (issue topics that overlap seed interests or topics of liked issues) |
| Exploration | sampled `p` exceeds the Beta mean by > 0.25 | "Something different" |
| Recency | always | "New today" |

### Yellow box

The top 5 of the ranked unread list get the corner-bracket frame. The same 5 are written to `DIGEST#<date>` the first time the list is served that day. **Success metric:** share of digest items later rated Relevant, over a rolling 14 days. Target >= 60% (3 of 5).

## 6. Reader API

API Gateway **HTTP API** (cheaper than REST), Cognito JWT authorizer on every route, one Node 22 Lambda with a small router. Routes include the `/thelibrary/api` prefix so CloudFront forwards paths unchanged.

| Method | Path | Purpose |
|---|---|---|
| GET | `/thelibrary/api/issues?state=unread\|all\|archived&sender=&topic=&sort=date\|rank&cursor=` | List. Returns publication, subject, snippet/summary, reason, date, rating, state. `topic` and `sort=rank` are Phase 2. |
| GET | `/thelibrary/api/issues/{id}` | Metadata plus sanitized HTML (read from S3, returned inline; typical 50 to 200 KB). |
| POST | `/thelibrary/api/issues/{id}/rating` | `{ "value": 1 \| -1 \| 0 }`. 0 clears. Updates issue, sender counts, event log. |
| PATCH | `/thelibrary/api/issues/{id}` | `{ "state": "unread" \| "read" \| "archived" }` |
| POST | `/thelibrary/api/issues/{id}/events` | Implicit signals `{ "type": "open" \| "dwell", "ms" }`. Logged only; never used for ranking in v1. |
| GET | `/thelibrary/api/senders` | Senders with counts, mute status, unsubscribe link. |
| GET | `/thelibrary/api/senders/{id}` | One sender plus its issues (GSI2). |
| PATCH | `/thelibrary/api/senders/{id}` | `{ "muted": true \| false }` |
| POST | `/thelibrary/api/ingest` | Manual "refresh now" (invokes ingest Lambda async). |

Opening an issue marks it read; "Mark unread" undoes it.

### Rendering newsletters safely

The issue view puts sanitized HTML in an `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" srcdoc=…>`. No `allow-scripts`, no `allow-same-origin`. Newsletter CSS can't touch the app, and nothing in the email can read the app's tokens. The iframe gets an injected `<meta name="viewport">` and `img, table { max-width: 100% !important; height: auto }` so 600 px email tables fit on an iPhone. Emails always render on a light card, even in dark mode; inverting arbitrary email HTML looks broken more often than not.

## 7. Auth

- **Cognito User Pool**, self-signup off. One user created with `aws cognito-idp admin-create-user`. TOTP MFA required. Free at 1 MAU.
- **App client:** public, no secret, Authorization Code + PKCE. Callback `https://sandip.dev/thelibrary/auth/callback`. Sign-out `https://sandip.dev/thelibrary/`.
- **Login UI:** Cognito managed login on its default domain (`thelibrary-sandip.auth.us-east-1.amazoncognito.com`). A custom `auth.sandip.dev` domain is possible later; it costs nothing but adds a cert and DNS record.
- **Tokens:** access/ID tokens in memory. Refresh token (30-day validity) in `localStorage` so phone and laptop stay signed in for a month. The XSS risk is contained by a strict CSP on the app (`script-src 'self'`) and by sandboxing all email HTML.
- **API:** HTTP API JWT authorizer validates issuer and audience. The Lambda also checks `sub` against a single allowed user ID from config (belt and braces).

## 8. Gmail OAuth setup (one time, manual)

1. Google Cloud Console: create project `the-library`.
2. APIs & Services: enable **Gmail API**.
3. OAuth consent screen ("Google Auth Platform"): User type **External**, app name "The Library", your email as support and developer contact. Add scope `https://www.googleapis.com/auth/gmail.readonly`. Add yourself as a test user.
4. **Publish the app to "In production."** Apps left in "Testing" get refresh tokens that expire after 7 days, which would silently break ingest every week. Unverified production apps are allowed for personal use (up to 100 users); you'll click through an "unverified app" warning once.
5. Credentials: create an OAuth client ID of type **Desktop app**. Note the client ID and secret.
6. Locally: `pnpm gmail:auth`. The script opens the browser, catches the loopback redirect on `127.0.0.1`, exchanges the code, and writes `{clientId, clientSecret, refreshToken}` to SSM `/thelibrary/gmail/oauth` as a SecureString. Nothing is written to disk.
7. The ingest Lambda reads the parameter once per cold start.

Refresh tokens are revoked if you change your Google password or revoke access. A CloudWatch alarm on ingest errors emails you via SNS so a dead token is noticed within a day. Fix = rerun step 6.

## 9. Hosting on `sandip.dev/thelibrary`

Confirmed: `sandip.dev` uses Route 53 (`awsdns` nameservers) and resolves to CloudFront distribution `d1onqceep3yjzz.cloudfront.net` with an S3 origin.

Two behaviors are added to that distribution, ordered before the default `/*`:

| Path pattern | Origin | Cache | Notes |
|---|---|---|---|
| `/thelibrary/api/*` | HTTP API (`*.execute-api.us-east-1.amazonaws.com`) | CachingDisabled | Origin request policy `AllViewerExceptHostHeader` (forwards `Authorization`). |
| `/thelibrary*` | web bucket via OAC | CachingOptimized; `index.html` with `no-cache` | Viewer-request CloudFront Function: paths without a file extension rewrite to `/thelibrary/index.html` (SPA routing); `/thelibrary` redirects to `/thelibrary/`. |

A response headers policy on both behaviors adds `X-Robots-Tag: noindex, nofollow`, a strict CSP, `Referrer-Policy: no-referrer`, and HSTS. The root site's `robots.txt` should also get `Disallow: /thelibrary` (that file is outside this repo).

**Open item: who owns the distribution.** CDK can't add behaviors to a distribution it doesn't manage. Options, in order of preference:

1. **Root site is already in CDK/CloudFormation:** add the two behaviors there, importing origins from this app's stack outputs.
2. **Root site was built by hand:** move the root site's distribution into a small CDK stack in this repo (import, or recreate with the same S3 origin and cert, then switch the Route 53 alias). This takes ownership of `sandip.dev` hosting.
3. **Root site is Amplify Hosting** (its managed distribution can't take extra behaviors): put a new CDK-owned distribution in front, with the default behavior pointing at the Amplify domain and the two `/thelibrary` behaviors pointing here, then switch the alias.
4. **Fallback:** `thelibrary.sandip.dev` with its own distribution. Simplest, but not what the PRD asked for.

Needs `aws login` so I can run `aws cloudfront get-distribution` and `aws cloudformation describe-stack-resources`. Decided at milestone M6; nothing before that depends on it.

## 10. CDK layout

```
infra/
  bin/app.ts                 # env: account from profile, region us-east-1
  lib/stateful-stack.ts      # LibraryStateful: DynamoDB table, content bucket, web bucket,
                             #   Cognito user pool + client. RemovalPolicy.RETAIN everywhere.
  lib/app-stack.ts           # LibraryApp: ingest Lambda + Scheduler, api Lambda + HTTP API,
                             #   SNS alarm topic, BucketDeployment of web/dist, CloudFront
                             #   function + response headers policy, SSM param reference
  lib/hosting.ts             # the section 9 integration (shape depends on the open item)
```

Two stacks so `cdk destroy LibraryApp` can never take data with it. Lambdas use `NodejsFunction` (esbuild bundling, Node 22, arm64). Log groups have 14-day retention.

### Repo layout

```
the-library/
  docs/                      # prd.md, architecture.md, build-plan.md
  packages/core/             # shared types, sources.ts, sanitize, extract, ranking math
  services/ingest/           # ingest + backfill handler
  services/api/              # reader API handler
  web/                       # Preact + Vite app, base '/thelibrary/'
  infra/                     # CDK app
  scripts/                   # gmail-auth.ts, backfill.ts, create-user.sh
  pnpm-workspace.yaml
```

Testing: `vitest` throughout. Ingest is tested against real (scrubbed) `.eml` fixtures, one per known sender type plus each noise type. CDK gets assertion tests on the key resources.

## 11. Cost estimate (steady state, ~25 issues/day)

| Item | Phase 1 | Phase 2 |
|---|---|---|
| Lambda (ingest ~10 runs/day, API) | $0 (free tier) | $0 |
| DynamoDB on-demand | ~$0.05 | ~$0.05 |
| S3 storage + requests | ~$0.03 | ~$0.03 |
| API Gateway HTTP API (~10k req) | ~$0.01 | ~$0.01 |
| CloudFront (existing distribution) | $0 (free tier) | $0 |
| Cognito (1 MAU) | $0 | $0 |
| SSM SecureString | $0 | $0 |
| CloudWatch logs (14-day) + 2 alarms | ~$0.05 | ~$0.05 |
| Titan embeddings (~750 issues x 2k tokens) | n/a | ~$0.03 |
| Haiku 5.5 summaries/tags (~750 x 1.5k in, 80 out) | n/a | **~$1.40** (assumes Haiku 4.5's $1/$5 per M tokens; verify 5.5 pricing) |
| **Total** | **~$0.15/month** | **~$1.60/month** |

Haiku is nearly the whole Phase 2 bill. If pricing comes in higher: cut input to 800 tokens (the lede is enough for a summary), skip enrichment for muted senders, or batch the 4-week backfill through Bedrock batch inference (50% off; one-time ~$1.40 otherwise).

## 12. Phase 3 readiness (audio briefing)

Nothing to build now, but these choices keep it bolt-on:
- `DIGEST#<date>` already lists the day's top items in rank order.
- Clean text in `text/` is the script input; summaries and topics are on the issue items.
- `audio/` prefix reserved in the content bucket. A future `/thelibrary/feed.xml` behavior on the same distribution serves the private RSS (protected by an unguessable path token, since podcast apps can't do Cognito).
- A third stack (`LibraryAudio`) can subscribe to the same schedule without touching the first two.
