---
status: current
updated: 2026-10-09
source: docs/prd.md
---

# The Library: Technical Spec

How [prd.md](prd.md) gets built. Milestones and acceptance checks are in [build-plan.md](build-plan.md).

This is the second version. The first assumed `sandip.dev` sat on a CloudFront distribution we could extend; it is actually Amplify Hosting. Everything below reflects facts verified on 2026-10-09.

## 1. Decisions on the PRD's open questions

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Gmail API polling vs. SES inbound | **Gmail API polling**, `gmail.readonly` | Labels already exist; polling can backfill; no per-sender forwarding filters. |
| 2 | AWS region | **us-east-1** | Verified: `us.anthropic.claude-haiku-5-5` and `amazon.titan-embed-text-v2:0` are available there. Mumbai only has the `global.` Haiku 5.5 profile. Static assets come from the nearest edge, so only API calls pay the round trip. |
| 3 | Sync read state to Gmail | **No** (v1) | Keeps the token read-only. |
| 4 | Frontend stack | **Preact + Vite + TypeScript, plain CSS** | Small runtime, React-style components, handles the `/thelibrary/` base path. |
| 5 | Retention | Raw `.eml` 30 days, sanitized HTML 365 days, text/metadata/ratings forever | S3 lifecycle rules; raw MIME exists only to re-run the sanitizer. |
| 6 | Backfill | **4 weeks**, configurable | Enough to rate in week one. |
| 7 | Where `sandip.dev` is hosted | **Amplify Hosting** (app `demw5c5zfs2r9`, static, repo `devsandip/sandip.dev`, not IaC-managed). The app gets its own CloudFront distribution; `sandip.dev/thelibrary/*` is exposed with **one Amplify reverse-proxy rewrite rule**. | Leaves the root site's hosting untouched and is removable in one command. Proven by a spike (build plan R2) before anything else is built; fallbacks in section 4. |

### Deviations from the PRD

- **SSM Parameter Store (SecureString)** instead of Secrets Manager for the Gmail token. Same encryption, free instead of $0.40/month (20% of the budget).
- **Hosting via an Amplify rewrite**, not CloudFront path behaviors on the root distribution (there isn't one we control).
- **Summaries move to Phase 2.** Phase 1 shows Gmail's snippet. Phase 1 makes no Bedrock calls.
- **Exploration is Thompson sampling** on sender affinity (Phase 2), not a separate random factor.
- **Cut from Phase 1:** dwell-time logging and keyboard shortcuts. Only "opened" is logged as an implicit signal.

## 2. System overview

```
Browser --> sandip.dev (Amplify, unchanged) --rewrite /thelibrary/<*>--> App CloudFront (CDK)
                                                                          |-- /thelibrary/api/*  --> HTTP API (Cognito JWT authorizer) --> api Lambda
                                                                          '-- /thelibrary/*      --> web bucket (OAC), SPA rewrite function

EventBridge Scheduler (every 2h, 06:00-22:00 IST) --> ingest Lambda --> Gmail API (refresh token from SSM)
                                                          |--> S3 content bucket: raw/ html/ text/
                                                          '--> DynamoDB single table

Cognito user pool (Essentials, one user, TOTP required) + public PKCE client, managed login
```

One AWS account, us-east-1, TypeScript everywhere, one pnpm workspace.

## 3. Ingest

### Schedule and query

- EventBridge Scheduler, `cron(0 6-22/2 * * ? *)` in `Asia/Kolkata`: 9 runs a day. Scheduler retries 0, and the Lambda's async `retryAttempts` is 0, so a failure is one failed run, not three. The next run catches up.
- Query per run:

  ```
  {label:Newsletters label:Meco_97675919-0d09-4077-a165-9d5569fa1957
   from:bytebytego@substack.com from:pragmaticengineer@substack.com
   from:pragmaticengineer+deepdives@substack.com from:substack.com} newer_than:3d
  ```

  `from:substack.com` is broad because Lenny's address is a wildcard; classification narrows it. Every message ID returned is stored once (as a newsletter or as a filtered marker), so nothing is fetched twice.
- Dedupe: `BatchGetItem` on returned IDs; fetch only unknown ones with `format=raw`. The 3-day overlap self-heals missed runs.
- Backfill: same code path with `newerThanDays: 28`, via `pnpm backfill --weeks 4`.

### Classification (`packages/core/src/sources.ts`)

- **Include** if the message carries either newsletter label, or the From address matches the allowlist (`bytebytego@substack.com`, `pragmaticengineer(+deepdives)?@substack.com`, `/^lenny.*@substack\.com$/`).
- **Filter** (stored as `state=filtered`, never listed): `@github.com` senders; Substack platform mail (`no-reply@substack.com`, "new notes", "Weekly Stack"); receipts (subject patterns, Stripe/Paddle/Apple/Razorpay/Gumroad senders).
- Anything else from the broad query is filtered as `not-a-source`.

### Pipeline per message

1. Parse MIME (`mailparser`). Prefer HTML; wrap plain text in an escaped `<pre>`.
2. Classify.
3. Store raw `.eml` at `raw/<msgId>.eml`.
4. Sanitize (`sanitize-html` allowlist): drop scripts, iframes, objects, forms, `base`, meta refresh, `on*` attributes, `javascript:` URLs, `cid:` images; keep `<style>` and inline styles (rendering is script-free, see section 8); remove tracking pixels (size <= 3px, hidden, known tracker hosts); unwrap redirect wrappers whose target is a query parameter; strip `utm_*`; force `target="_blank" rel="noopener noreferrer"`.
5. Extract clean text, word count, reading minutes, view-online link (anchor text, else Substack post permalink, cleaned), unsubscribe link (`List-Unsubscribe` https entry, else last "unsubscribe" anchor).
6. Write `html/` and `text/` objects, then one `TransactWriteItems`: put the issue (condition: not exists) and upsert the sender.

One bad message is logged and counted; the run continues; the message is retried next run because it is still unknown. A run with any errors fails the invocation so the alarm fires.

### Monitoring

- Alarm: ingest Lambda `Errors >= 1` over 6 hours.
- Alarm: custom metric `IngestSucceeded` (EMF, emitted once per clean run) one-day sum `< 1`, missing data counts as breaching. Created after Gmail is connected (build plan R5), otherwise it fires immediately.
- Both email `dev.sandip@gmail.com` via SNS (subscription must be confirmed once).
- `GET /status` returns the last run's stats.

## 4. Hosting on `sandip.dev/thelibrary`

### App distribution (CDK)

| Behavior | Origin | Cache | Notes |
|---|---|---|---|
| `/thelibrary/api/*` | HTTP API | CachingDisabled | Origin request policy `AllViewerExceptHostHeader` (forwards `Authorization`). |
| default `*` | web bucket via OAC, objects under `thelibrary/` | CachingOptimized | Viewer-request CloudFront Function (below). |

SPA function, applied to the default behavior:
- `/thelibrary/assets/*`, `/thelibrary/config.json`, `/thelibrary/favicon.svg`: pass through.
- `/thelibrary/about.html`, `/thelibrary/privacy.html`, `/thelibrary/terms.html`: pass through. Public static pages (no user data) that Google requires as the OAuth app's home page, privacy policy and terms before it can be published to production.
- Any other path under `/thelibrary/`: rewrite to `/thelibrary/index.html`. No extension guessing: sender URLs use opaque IDs, but this rule means a dot in a path can never cause a 403.
- `/` or `/thelibrary`: 301 with a **relative** `Location` (`/thelibrary/`), so a proxied request never bounces to the `cloudfront.net` domain.
- Anything else: 404.

Response headers policy on both behaviors: CSP (section 8), `X-Robots-Tag: noindex, nofollow`, HSTS, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.

### The Amplify rule

Inserted first in the `sandip.dev` app's custom rules; existing rules (www to apex) are preserved and backed up to `scratch/amplify-rules-backup-<ts>.json` first:

```json
{ "source": "/thelibrary/<*>", "target": "https://<app-distribution>.cloudfront.net/thelibrary/<*>", "status": "200" }
```

`scripts/amplify-proxy.ts` reads the distribution domain from stack outputs, shows a diff (`--dry-run`, the default), applies with `--apply`, and `--remove` takes it out. It never touches other rules.

**Live since 2026-10-09** (approved by Sandip), targeting `dg0r0gfgrfwem.cloudfront.net`. If the distribution is ever replaced, rerun `pnpm amplify-proxy --apply`.

**Spike result (2026-10-09): every check passed through `https://sandip.dev/thelibrary`, no fallback needed.** Deep links serve the shell, one CSP and the `X-Robots-Tag` arrive, missing assets 404, encoded query strings and dotted paths arrive intact, the `Authorization` header and a custom header both arrive, POST/PATCH/PUT/DELETE bodies arrive, API responses are not cached, a 3 MB response works, and the root site carries none of our headers. Amplify already redirects `/thelibrary` to `/thelibrary/`.

**Operational note:** a newly created HTTP API took about 16 minutes to get a public DNS record (the first one was replaced for that reason, the second one too took minutes), and CloudFront edges cache the failed lookup for up to 15 minutes, so the API path returns intermittent 502s for a while after the API is created. Replacing the HTTP API is therefore a slow, disruptive change; keep its construct ID stable.

### Caching rules (Amplify's cache sits in front of ours)

Amplify proxies with its managed cache policy: it honors origin `Cache-Control`, and its cache clears only on an Amplify deploy, never on our CDK deploy. So:
- API responses: `Cache-Control: no-store`.
- `index.html` and `config.json`: `no-cache`.
- Hashed assets under `assets/`: `public, max-age=31536000, immutable`.
- Nothing unhashed ever gets a `max-age`.

### Spike checks and fallback ladder

`scripts/check-hosting.sh` (rerunnable any time) verifies through `https://sandip.dev/thelibrary`: trailing-slash redirect, deep links serve the shell, missing assets 404 without redirects, exactly one CSP and the `X-Robots-Tag`, query strings with encoded characters arrive intact, POST and PATCH bodies arrive, `Authorization` and a custom `x-library-auth` header arrive (the echo returns hashes, never values), two identical requests return different nonces (no caching), large compressed responses work, and the root site still has no CSP.

If a check fails, the fix is chosen in this order:
1. `Authorization` stripped but custom header survives: the JWT authorizer reads `x-library-auth` instead.
2. PATCH dropped: all writes become POST.
3. Query strings dropped: list parameters move into the path.
4. API unusable through the proxy: the frontend calls the app distribution's domain directly, with CORS limited to `https://sandip.dev`.
5. Shell itself unusable: stop and decide with Sandip (subdomain `thelibrary.sandip.dev` is the fallback).

### Shared-origin invariant

Through the proxy the app runs on the `https://sandip.dev` origin, so anything on the root site can read the app's `localStorage` (where the refresh token lives). Today the root site has one first-party inline script, Google Fonts CSS, no service worker. **The root site must not add third-party scripts or a service worker.** This is recorded here and should be noted in the `sandip.dev` repo.

### Crawlers

`X-Robots-Tag` on every app response, `<meta name="robots" content="noindex,nofollow">` in the shell, and `Disallow: /thelibrary/` in the root site's `robots.txt` (currently 404; change belongs to the `sandip.dev` repo).

## 5. Data model

### DynamoDB: one table, on-demand, PITR on (prod)

All four GSIs are defined before the first deploy because CloudFormation adds only one GSI per update. Projections are `ALL`; anything large (Phase 2 embeddings) lives in its own item so it never lands in an index.

| Entity | pk | sk | Notes |
|---|---|---|---|
| Issue | `ISSUE#<gmailMsgId>` | `META` | `senderId`, `publication`, `fromAddr`, `fromName` (kept so sender rules can be re-applied after the raw message expires), `subject`, `receivedAt`, `snippet`, `viewOnlineUrl`, `unsubscribeUrl`, `wordCount`, `readMinutes`, `state` (`unread`\|`read`\|`archived`\|`filtered`), `rating` (`1`\|`-1`), `ratedAt`, `s3Keys`, `labelIds`. Phase 2 adds `summary`, `topics`, `score`, `scoreReason`. |
| Embedding (P2) | `ISSUE#<id>` | `EMB` | 512 float32 as binary. |
| Event | `ISSUE#<id>` | `EVT#<iso>#<rand>` | `type` (`rating`\|`state`\|`open`), `value`, `prev`. Append-only. |
| Sender | `SENDER#<senderId>` | `META` | `senderKey` (readable, e.g. `pragmaticengineer@substack.com`), `publication`, `addresses` (set), `muted`, `onKeepList`, `up`, `down`, `issueCount`, `lastSeenAt`, `unsubscribeUrl`. |
| Ingest state | `STATE` | `INGEST` | `lastRunAt`, `lastRunStats`, `lastError`. |
| Digest (P2) | `DIGEST#<yyyy-mm-dd>` | `META` | Top-N issue IDs shown that day. |

`senderId` is opaque: `s` + the first 12 hex characters of SHA-256 of the canonical sender key (alias key, or the From address lowercased with any `+tag` removed). It is URL-safe, so `@` and `/` never travel through two proxies.

Sender rules live in `packages/core/src/sources.ts`. Aliases name a newsletter by address (Platformer, not "Casey Newton") and merge several addresses into one. Addresses that send several newsletters, told apart only by the From name (every TLDR edition comes from `dan@tldrnewsletter.com`), get `#<name>` appended to the key, so each edition is its own sender. After changing the rules, `pnpm rebuild-senders` re-keys stored issues and recomputes every sender item from its issues (counts, ratings, addresses, names), keeping flags such as `muted`. It runs inside the ingest Lambda, whose concurrency of 1 keeps it from overlapping an ingest run.

| Index | pk | sk | Present on | Serves |
|---|---|---|---|---|
| `gsi1` | `INBOX` \| `ARCHIVE` \| `SENDERS` | `<receivedAt>#<id>` (senders: lowercase publication) | non-filtered issues, senders | "All" and "Archived" views, sender list |
| `gsi2` | `UNREAD` | `<receivedAt>#<id>` | unread issues only (sparse) | "Unread" view, Phase 2 candidates (`gsi2sk > now-14d`) |
| `gsi3` | `SENDER#<senderId>` | `<receivedAt>#<id>` | non-filtered issues | Sender page, sender filter |
| `gsi4` | `RATED` | `<ratedAt>#<id>` | rated issues only (sparse) | Phase 2 taste profile |

Every write that changes `state` or `rating` recomputes all index keys from the target value (set or remove), in the same request.

### S3: content bucket (private, SSE-S3)

`raw/` (expire 30 days), `html/` (expire 365 days), `text/` (keep), `audio/` (reserved for Phase 3). Text lives in S3 because long issues can exceed DynamoDB's 400 KB item limit.

## 6. API

HTTP API, one route `ANY /thelibrary/api/{proxy+}` behind the Cognito JWT authorizer (issuer = user pool, audience = app client). One Node 24 Lambda with an explicit route table. All responses are JSON with `Cache-Control: no-store`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/thelibrary/api/issues?view=unread\|all\|archived&sender=&cursor=&limit=` | Newest first. Home views hide muted senders. |
| GET | `/thelibrary/api/issues/{id}` | Metadata + sanitized HTML (from S3). |
| PATCH | `/thelibrary/api/issues/{id}` | `{ "state": "unread" \| "read" \| "archived" }` |
| POST | `/thelibrary/api/issues/{id}/rating` | `{ "value": 1 \| -1 \| 0 }` (0 clears) |
| POST | `/thelibrary/api/issues/{id}/events` | `{ "type": "open" }` (logged only) |
| GET | `/thelibrary/api/senders` | All senders with counts, mute state, unsubscribe link. |
| GET | `/thelibrary/api/senders/{senderId}` | Sender + its issues. |
| PATCH | `/thelibrary/api/senders/{senderId}` | `{ "muted": true \| false }` |
| POST | `/thelibrary/api/ingest` | Async "refresh now". |
| GET | `/thelibrary/api/status` | Last ingest run, counts. |

**Listing:** query the view's index newest first with a `FilterExpression` excluding muted senders, and keep querying until `limit` items are collected or the index is exhausted. The cursor is built from the **last returned item's** keys (table keys + that index's keys), never from a `LastEvaluatedKey` after trimming. A malformed cursor is a 400.

**Rating:** read the current rating, then one transaction: conditional update of the issue (`rating` equals the value read, or absent), `ADD up/down` on the sender by the delta, put an event. A concurrent change from another device fails the condition and returns 409; the UI refetches.

**Errors:** validation 400, unknown id 404, condition failure 409, everything else 500 with the error logged.

## 7. Auth

- **User pool:** Cognito Essentials feature plan (1 MAU costs at most a few cents), self-signup off, sign-in by email, TOTP MFA required (no SMS), password minimum 12.
- **Login UI:** managed login (version 2) on the prefix domain `thelibrary-sandip.auth.us-east-1.amazoncognito.com`, with a `CfnManagedLoginBranding` resource using Cognito's default style. Without a branding resource, a CloudFormation-created client's managed login page errors.
- **App client:** public (no secret), authorization code + PKCE, scopes `openid email`. Callback and sign-out URLs: `https://sandip.dev/thelibrary/auth/callback` and `https://sandip.dev/thelibrary/`, plus the app distribution domain (for testing before the proxy rule) and `http://localhost:5173/thelibrary/...` (local dev). Access/ID tokens 60 min, refresh 30 days, token revocation on, refresh-token rotation if the token endpoint supports it (checked at R6).
- **Tokens in the browser:** access/ID in memory; refresh token in `localStorage` so phone and laptop stay signed in. Sign-out calls `/oauth2/revoke` and clears storage. See the shared-origin invariant in section 4.
- **User creation:** `scripts/create-user.sh` runs `admin-create-user` for `dev.sandip@gmail.com`; Cognito emails a temporary password; Sandip signs in, sets a password, enrolls TOTP. Nobody else ever handles the credentials.

## 8. Frontend

- Preact 11, `preact-iso` routing, Vite 8 with `base: "/thelibrary/"`, plain CSS with light/dark variables. Dev server on port 5173.
- Routes: `/` (home list), `/issue/:id`, `/senders`, `/senders/:senderId`, `/auth/callback`, `/status`.
- `config.json` (written by CDK at deploy time) supplies API base, Cognito domain, client ID, redirect URIs. A mock API (`VITE_MOCK=1`) lets the UI run with no AWS.
- **Rendering newsletters:** `<iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" srcdoc=...>`. No `allow-scripts`, so nothing in an email executes; `allow-same-origin` only lets the app measure the content height to size the frame. Injected viewport meta and `img, table { max-width: 100% }`. Always a light card, even in dark mode.
- **CSP** (srcdoc frames inherit it, so it must allow email images and styles):
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' https: data:; connect-src 'self' https://thelibrary-sandip.auth.us-east-1.amazoncognito.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests`
  (`upgrade-insecure-requests` also fixes `http:` images in old newsletters.)

## 9. Infrastructure

One CDK app, one stack per stage, selected with `-c stage=dev|prod`. Tags `project=thelibrary`, `stage=<stage>` on everything.

| | prod (`TheLibrary-prod`) | dev (`TheLibrary-dev`) |
|---|---|---|
| DynamoDB table, content bucket | yes, `RETAIN`, PITR, deletion protection | yes, `DESTROY` |
| ingest Lambda | yes, with Scheduler and alarms | yes, no schedule (fed by `seed-dev`) |
| api Lambda | yes, behind HTTP API + authorizer | yes, invoked directly by integration tests |
| Cognito, HTTP API, CloudFront, web bucket | yes | no |

Lambda details: Node 24, arm64, `NodejsFunction` bundled locally by esbuild (esbuild is a root devDependency; no Docker), ESM output with a `createRequire` banner for CommonJS dependencies, `@aws-sdk/*` external (provided by the runtime), root `pnpm-lock.yaml` as `depsLockFilePath`. Explicit log groups with 14-day retention.

Web deploy: two `BucketDeployment`s with `prune: false`. Hashed `assets/` with immutable caching (old chunks survive for open tabs); `index.html` plus a generated `config.json` (`Source.jsonData`, which resolves deploy-time values) with `no-cache`. If `web/dist` does not exist (fresh clone, CDK tests), synth uses a placeholder.

Gmail credentials: SSM SecureString `/thelibrary/prod/gmail/oauth`, created by `pnpm gmail:auth`, read by the ingest Lambda at cold start.

## 10. Testing

- **Unit (`pnpm test`, local, no AWS):** core parsing/sanitizing/classification against synthetic fixtures (with per-fixture asserts on view-online and unsubscribe links); ingest loop with fakes; API router against an in-memory repo (status codes, validation); frontend auth/API helpers; CDK assertions on key resources.
- **Integration (`pnpm test:int`, serial, needs AWS credentials and a deployed dev stack):** refuses to run unless the target stack is `TheLibrary-dev` (checked via stack outputs and tags); wipes and seeds dev from fixtures through the real `Store`; invokes the api Lambda directly with crafted JWT claims for every route; checks pagination, view transitions across indexes, rating counters, mute filtering; polls until GSIs catch up.
- **Hosting (`scripts/check-hosting.sh`):** the section 4 checks, rerun after every web or API deploy.
- **UI:** built-in browser against mock mode at 390px and desktop widths, light and dark.
- **Acceptance:** Sandip on iPhone and Mac against prod (Claude cannot sign in through Cognito on Sandip's behalf).

## 11. Ranking (Phase 2)

Formula unchanged from v1 (see git history of this file for the derivation):

```
score = 0.40 * S_sender + 0.40 * S_topic + 0.20 * R
```

- `S_sender`: Thompson sample from Beta(prior + up, prior + down), keep list prior (3,1), others (2,2), seeded by date + sender so the order is stable within a day.
- `S_topic`: cosine to a liked centroid (seeded with the five interests, `k = 5` pseudo-counts, 60-day half-life) minus 0.5 x cosine to a disliked centroid, z-scored across candidates.
- `R`: `0.5^(age_hours / 48)`.
- Candidates: unread issues from the last 14 days only (`gsi2sk > now-14d`).
- Reason line from the dominant component; yellow box on the top 5; top 5 logged to `DIGEST#<date>` so the success metric (share of digest items later rated Relevant, rolling 14 days, target >= 60%) is measurable.

Models: Titan Text Embeddings V2, 512 dimensions, normalized. Claude Haiku 5.5 via `us.anthropic.claude-haiku-5-5` (launched 2026-10-07) for a 20-word summary and 1 to 3 tags from a fixed taxonomy. Haiku 5.5 has adaptive thinking on by default; summary calls turn it off and keep output short. Input is truncated to ~1,500 tokens. Verify pricing at P2.1.

## 12. Cost (steady state, ~25 issues/day)

| Item | Phase 1 | Phase 2 |
|---|---|---|
| Lambda, DynamoDB, S3, HTTP API, CloudFront, SSM | ~$0.10 | ~$0.10 |
| Amplify proxy data transfer (~100 MB/month) | ~$0.02 | ~$0.02 |
| Cognito Essentials, 1 MAU | <= $0.02 | <= $0.02 |
| CloudWatch logs (14 days) + 2 alarms + 1 custom metric | ~$0.05 | ~$0.05 |
| DynamoDB PITR (tiny table) | ~$0.02 | ~$0.02 |
| Titan embeddings ($0.02 per M tokens) | n/a | ~$0.03 |
| Haiku 5.5 summaries | n/a | ~$1 to $1.50 (unverified price) |
| **Total** | **~$0.20/month** | **~$1.40 to $1.80/month** |

An AWS Budget filtered on `project=thelibrary` alerts at $2 (set up in R9, once the cost-allocation tag is active).

## 13. Phase 3 readiness (audio briefing)

`DIGEST#<date>` lists the day's top items; clean text in `text/` is the script input; `audio/` is reserved; a private feed can be another path on the app distribution behind an unguessable token. Nothing to build now.
