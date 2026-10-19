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
| 4 | Frontend stack | **Preact + Vite + TypeScript, plain CSS** | Small runtime, React-style components, handles the `/nutgraf/` base path. |
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
Browser --> sandip.dev (Amplify, unchanged) --rewrite /nutgraf/<*>--> App CloudFront (CDK)
                                                                       |-- /nutgraf/api/*  --> HTTP API (Cognito JWT authorizer) --> api Lambda
                                                                       '-- /nutgraf/*      --> web bucket (OAC), SPA rewrite function

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
- **Filter** (stored as `state=filtered`, never listed): `@github.com` senders; Substack platform mail (`no-reply@substack.com`, "new notes", "Weekly Stack"); receipts (subject patterns, Stripe/Paddle/Apple/Razorpay/Gumroad senders); account mail (#50): sign-in codes and links, email and subscription confirmations, password resets. Account mail can come from a newsletter's own address (a Substack verification code from `bytebytego@substack.com`), so its rule reads only the subject, and only phrases addressed to the account holder ("643423 is your Substack verification code", "Confirm your email"), never a bare "code" or "login": issues write about those too. What the rules miss, enrichment catches (section 11).
- After a rule change, `pnpm reprocess` re-runs the rules on the last 30 days of raw mail and files as filtered any stored issue a noise rule now catches, unless Sandip rated or saved it; it lists the first few so a misfire shows. An issue from a sender that is no longer a source is left alone.
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

## 4. Hosting on `sandip.dev/nutgraf` (`/thelibrary` until 2026-10-12)

### App distribution (CDK)

| Behavior | Origin | Cache | Notes |
|---|---|---|---|
| `/nutgraf/api/*` | HTTP API | CachingDisabled | Origin request policy `AllViewerExceptHostHeader` (forwards `Authorization`). |
| default `*` | web bucket via OAC, objects under `nutgraf/` | CachingOptimized | Viewer-request CloudFront Function (below). |

SPA function, applied to the default behavior:
- `/nutgraf/assets/*`, `/nutgraf/config.json`: pass through.
- `/nutgraf/icons/*` and `/nutgraf/manifest.json`: pass through. The tab icon (SVG, with a 32 px PNG for browsers without SVG favicons), the iPhone home-screen icon, and the web manifest with its 192, 512 and maskable icons (see `scripts/icons.sh`).
- `/nutgraf/about.html`, `/nutgraf/privacy.html`, `/nutgraf/terms.html`: pass through. Public static pages (no user data) that Google requires as the OAuth app's home page, privacy policy and terms before it can be published to production.
- Any other path under `/nutgraf/`: rewrite to `/nutgraf/index.html`. No extension guessing: sender URLs use opaque IDs, but this rule means a dot in a path can never cause a 403.
- `/` or `/nutgraf`: 301 with a **relative** `Location` (`/nutgraf/`), so a proxied request never bounces to the `cloudfront.net` domain.
- `/thelibrary` and everything under it (the app's path until 2026-10-12): 301 to the same path under `/nutgraf/` with the same query parameters (their values as received; CloudFront may reorder them), so bookmarks and the old home-screen icon keep working. A bare `/thelibrary` takes two hops: Amplify adds the slash first. `infra/test/spa-function.test.ts` runs the function against sample requests.
- Anything else: 404.

Response headers policy on both behaviors: CSP (section 8), `X-Robots-Tag: noindex, nofollow`, HSTS, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.

### The Amplify rules

Inserted first in the `sandip.dev` app's custom rules; existing rules (www to apex) are preserved and backed up to `scratch/amplify-rules-backup-<ts>.json` first. Two rules since 2026-10-12: the app's path, and its old one, which the distribution answers with a 301 to the new path.

```json
{ "source": "/nutgraf/<*>", "target": "https://<app-distribution>.cloudfront.net/nutgraf/<*>", "status": "200" }
{ "source": "/thelibrary/<*>", "target": "https://<app-distribution>.cloudfront.net/thelibrary/<*>", "status": "200" }
```

`scripts/amplify-proxy.ts` reads the distribution domain from stack outputs, shows a diff (`--dry-run`, the default), applies with `--apply`, and `--remove` takes them out. It never touches other rules.

**Live since 2026-10-09** (approved by Sandip), targeting `dg0r0gfgrfwem.cloudfront.net`; the `/nutgraf/<*>` rule since 2026-10-12. If the distribution is ever replaced, rerun `pnpm amplify-proxy --apply`.

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

`X-Robots-Tag` on every app response, `<meta name="robots" content="noindex,nofollow">` in the shell, and `Disallow: /nutgraf/` in the root site's `robots.txt` (currently 404; change belongs to the `sandip.dev` repo).

## 5. Data model

### DynamoDB: one table, on-demand, PITR on (prod)

All four GSIs are defined before the first deploy because CloudFormation adds only one GSI per update. Projections are `ALL`; an issue's embedding lives in its own item so it never lands in an index. Story items (#15) are the exception on purpose: linking reads a window of stories with their vectors in one `gsi1` query.

| Entity | pk | sk | Notes |
|---|---|---|---|
| Issue | `ISSUE#<gmailMsgId>` | `META` | `senderId`, `publication`, `fromAddr`, `fromName` (kept so sender rules can be re-applied after the raw message expires), `subject`, `receivedAt`, `snippet`, `viewOnlineUrl`, `unsubscribeUrl`, `wordCount`, `readMinutes`, `state` (`unread`\|`read`\|`archived`\|`filtered`), `rating` (`1`\|`-1`), `ratedAt`, `s3Keys`, `labelIds`. Enrichment (section 11) adds `summary`, `shelf` (`news`\|`learning`, what Home's tabs filter on), `shelfAuto` (Claude's call), `shelfSetBy` (`claude`\|`sender`\|`sandip`), `topic`, `promo`, `enrichedAt`, `embeddedAt`, and `autoArchived` (`promo`\|`old-news`) when a rule archived it. `savedAt` when Sandip saved it for later (#43). `filterReason` once filtered; an issue filed as filtered after it was stored (#50) keeps its other fields, minus its index keys. Phase 2 ranking adds `score`, `scoreReason`. |
| Embedding | `ISSUE#<id>` | `EMB` | Titan V2, 512 float32 as binary, for Phase 2 ranking. |
| Story (#15) | `ISSUE#<id>` | `STORY#<nn>` | `n` (from 1), `headline`, `summary`, `names` (companies, people, products), `link` (the story's own source, one of the issue's links), `eventId`, `senderId`, `receivedAt`, `vector` (Titan V2 float32 binary), `model`, `embedModel`, `at`; once Jev has read it (#81), `shelf` (`news` or `learning`), `learning` (Jev's probability of Learning; 0.5 and up is Learning), `shelfSetBy` (`jev` or `sandip`), `shelfModel`, `shelvedAt`. In `gsi1` under `STORIES`. The issue's META gets `storiedAt` and `storyCount`, or `storyError` and `storyAttempts` after a failed split. |
| Topic list | `CONFIG` | `TOPICS` | `topics` (`name`, `description`), proposed once by Claude (`pnpm topics`). Names cannot contain commas: the API takes several as one comma-separated parameter. |
| Interests | `CONFIG` | `INTERESTS` | The five PRD interests (`name`, `text`, `vector` as Titan float32 binary). Written by enrichment when missing or when the list in `packages/core/src/rank.ts` changes; read by the API to seed the taste profile. |
| Event | `ISSUE#<id>` | `EVT#<iso>#<rand>` | `type` (`rating`\|`state`\|`open`\|`peek`\|`saved`), `value`, `prev`. Append-only. `open` and `peek` events also sit in `gsi1` under `OPENS` (sort key `<iso>#<id>`), for read history (#42, #56); opens logged before 2026-10-10 were indexed once by `pnpm history-backfill`. |
| Sender | `SENDER#<senderId>` | `META` | `senderKey` (readable, e.g. `pragmaticengineer@substack.com`), `publication`, `addresses` (set), `muted`, `mustRead` (Sandip's star, seeded once from the PRD keep list), `shelf` ("always News/Learning"; unset means Claude decides per issue), `up`, `down`, `issueCount`, `lastSeenAt`, `unsubscribeUrl`. |
| Ingest state | `STATE` | `INGEST` | `lastRunAt`, `lastRunStats`, `lastError`. |
| Digest (P2) | `DIGEST#<yyyy-mm-dd>` | `META` | `ids`: the Summary's top 5 the first time it is shown on that day (IST), `at`. Written once a day by `GET /summary` (issue #5). |
| Narrative | `STATE` | `NARRATIVE` | The day in brief (#18), overwritten by each new version: `at`, `threads` (`title`, `text`, `sources` as issue id and publication), `stories`, `newsletters`, `storyKeys` (what the next run compares against), `model`. |
| Now reading | `STATE` | `NOW_READING` | The issue to come back to (#44), overwritten: `issueId`, `position` (the share of the newsletter above the top of the screen, 0 to 1, where 1 means finished), `since` (when it became Now reading; a rating after that hides it), `at` (last saved). Each open points it at the issue, keeping the place when the same unfinished issue is reopened. |

`senderId` is opaque: `s` + the first 12 hex characters of SHA-256 of the canonical sender key (alias key, or the From address lowercased with any `+tag` removed). It is URL-safe, so `@` and `/` never travel through two proxies.

Sender rules live in `packages/core/src/sources.ts`. Aliases name a newsletter by address (Platformer, not "Casey Newton") and merge several addresses into one. Addresses that send several newsletters, told apart only by the From name (every TLDR edition comes from `dan@tldrnewsletter.com`), get `#<name>` appended to the key, so each edition is its own sender. After changing the rules, `pnpm rebuild-senders` re-keys stored issues and recomputes every sender item from its issues (counts, ratings, addresses, names), keeping the `muted` and `mustRead` flags (a split sender inherits them). It runs inside the ingest Lambda, whose concurrency of 1 keeps it from overlapping an ingest run.

| Index | pk | sk | Present on | Serves |
|---|---|---|---|---|
| `gsi1` | `INBOX` \| `ARCHIVE` \| `SENDERS` \| `STORIES` \| `OPENS` | `<receivedAt>#<id>` (senders: lowercase publication; stories: `<receivedAt>#<id>#<nn>`; opens: `<openedAt>#<id>`) | non-filtered issues, senders, stories, open and peek events | "All" and "Archived" views, sender list, stories in a time window, read history by day |
| `gsi2` | `UNREAD` \| `SAVED` | `<receivedAt>#<id>` (saved: `<savedAt>#<id>`) | unread issues, and saved ones (sparse); a saved issue sits in `SAVED` instead, read or not | "Unread" view, Phase 2 candidates (`gsi2sk > now-14d`), the Saved list (#43), newest saved first |
| `gsi3` | `SENDER#<senderId>` | `<receivedAt>#<id>` | non-filtered issues | Sender page, sender filter |
| `gsi4` | `RATED` | `<ratedAt>#<id>` | rated issues only (sparse) | Phase 2 taste profile |

Every write that changes `state`, `rating` or `savedAt` recomputes all index keys from the target value (set or remove), in the same request.

### S3: content bucket (private, SSE-S3)

`raw/` (expire 30 days), `html/` (expire 365 days), `text/` (keep), `audio/` (reserved for Phase 3). Text lives in S3 because long issues can exceed DynamoDB's 400 KB item limit.

## 6. API

HTTP API, one route `ANY /nutgraf/api/{proxy+}` behind the Cognito JWT authorizer (issuer = user pool, audience = app client). One Node 24 Lambda with an explicit route table. All responses are JSON with `Cache-Control: no-store`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/nutgraf/api/issues?view=unread\|all\|archived\|saved&shelf=news\|learning&topic=&sender=&cursor=&limit=` | Newest first; `saved` (#43) newest saved first, read or not, hiding no one. `sender` (up to 50 ids) and `topic` (up to 20) each take several, comma-separated, meaning any of them. Home views hide muted senders unless they are picked. Unread without a sender filter lists Must Read newsletters first; every list marks their issues `mustRead`. `shelf=news` also returns issues Claude has not sorted yet. |
| GET | `/nutgraf/api/issues/{id}` | Metadata + sanitized HTML (from S3), and `position` when this is the issue Now reading points at and it is unfinished (#44). |
| PATCH | `/nutgraf/api/issues/{id}` | `{ "state"?: "unread" \| "read" \| "archived", "shelf"?: "news" \| "learning", "saved"?: boolean }`. A shelf set here is Sandip's (`shelfSetBy: sandip`): neither Claude nor a sender setting moves it back. Saving (#43) takes the issue out of Unread whatever its state; archiving a saved issue also unsaves it, and an archived issue cannot be saved (400). |
| POST | `/nutgraf/api/issues/{id}/rating` | `{ "value": 1 \| -1 \| 0 }` (0 clears) |
| POST | `/nutgraf/api/issues/{id}/events` | `{ "type": "open" }`: logged, indexed by time for read history, and Now reading points at the issue (#44). `{ "type": "peek" }`: a peek left open 2 seconds (#56), logged and indexed the same way; Now reading stays put |
| GET | `/nutgraf/api/now-reading` | Now reading (#44): `{ nowReading?: { issue, position, at } }`, empty once the issue is finished, archived, or rated after it was opened. |
| PUT | `/nutgraf/api/now-reading` | `{ "id", "position" }` (0 to 1; 1 means finished), 204. A place in another issue moves Now reading back to it (an older window still open on it), unless that place is 1. 404 for an unknown issue. |
| GET | `/nutgraf/api/history?day=YYYY-MM-DD` | Read history (#42): the issues read on that day in India (today by default), opened or peeked at (#56), each once at its latest read, latest first, with `openedAt` and `via` (`open` or `peek`, so History can say Opened or Read); and `previousDay` and `nextDay`, the nearest days with anything read, so paging skips empty days. 400 for anything but a real date. |
| GET | `/nutgraf/api/issues/{id}/stories` | The issue's stories from the story index (#15), in order: `n`, `headline`, `summary`, `link` and `names` (when the story names any; no embeddings). Empty until the issue is split. For a tap on a row (#41). |
| GET | `/nutgraf/api/issues/{id}/related` | `{ earlier, since, stories? }`: the closest stories from other issues, received before and after this one, closest first, each as its issue's row with a `similarity` and, inside a digest, the matching `story` (section 11). An issue with one story, or not split yet, has up to three each side in `earlier` and `since`; a digest has up to three for each of its stories in `stories` (`n`, `headline`, `earlier`, `since`), only those with any. Promos and muted newsletters are left out. Worked out at read time; nothing is stored. |
| GET | `/nutgraf/api/search?q=&sort=best\|newest` | Search (#53, section 11): the issues that hold the query's words, then those only close in meaning, each group best match first or newest first, up to 50. Each hit carries `match` (`words`, `meaning` or `both`) and, inside a digest, the matching `story`'s headline; the response carries the query's `terms` as matched, for highlighting, and `byMeaning: false` when Titan was unavailable (words alone). Filtered mail, promos and muted newsletters are left out; archived issues are in. 400 for an empty `q` or one over 200 characters. |
| GET | `/nutgraf/api/senders` | All senders with counts, mute state, unsubscribe link. |
| GET | `/nutgraf/api/senders/{senderId}` | Sender + its issues. |
| PATCH | `/nutgraf/api/senders/{senderId}` | `{ "muted"?, "mustRead"?, "shelf"?: "news" \| "learning" \| null }`, at least one. Setting `shelf` moves the sender's issues there (except ones Sandip moved); `null` hands them back to Claude's call. |
| GET | `/nutgraf/api/topics` | The topic list. The web shows the News/Learning tabs once it is non-empty. |
| GET | `/nutgraf/api/unread-counts` | Unread issues counted by sender, shelf and topic (muted senders included), for the numbers on the tabs, topic chips and sender picker, and `saved`, how many issues are saved (#43). The web works out every combination of filters from this one list. |
| GET | `/nutgraf/api/summary` | The 20 most relevant unread News issues from the last two weeks, best first and at most three from one newsletter, each with a `scoreReason`, plus how many were scored. Scored at read time (section 11). The first call of the day logs the top 5 as the day's digest (`digestAt` says when); every call returns it (`digest`) with the success measure (`digestStats`), and the day in brief (`narrative`, #18) while it is less than a day old. |
| POST | `/nutgraf/api/ingest` | Async "refresh now". |
| GET | `/nutgraf/api/status` | Last ingest run, counts, the success measure (`digestStats`). |

**Listing:** one picked sender reads that sender's index (`gsi3`); several filter the view's index with `senderId IN (...)`. Several topics add `topic IN (...)`. Otherwise query the view's index newest first with a `FilterExpression` excluding muted senders, and keep querying until `limit` items are collected or the index is exhausted. The cursor is built from the **last returned item's** keys (table keys + that index's keys), never from a `LastEvaluatedKey` after trimming. A malformed cursor is a 400. Unread without a sender filter is two such streams over the `UNREAD` index, read one after the other: Must Read senders (`senderId IN (...)`), then everyone else (`NOT IN` starred and muted). Its cursor names the stream it continues and wraps that stream's cursor.

**Rating:** read the current rating, then one transaction: conditional update of the issue (`rating` equals the value read, or absent), `ADD up/down` on the sender by the delta, put an event. A concurrent change from another device fails the condition and returns 409; the UI refetches.

**Errors:** validation 400, unknown id 404, condition failure 409, everything else 500 with the error logged.

## 7. Auth

- **User pool:** Cognito Essentials feature plan (1 MAU costs at most a few cents), self-signup off, sign-in by email, TOTP MFA required (no SMS), password minimum 12.
- **Login UI:** managed login (version 2) on the prefix domain `thelibrary-sandip.auth.us-east-1.amazoncognito.com`, with a `CfnManagedLoginBranding` resource using Cognito's default style. Without a branding resource, a CloudFormation-created client's managed login page errors.
- **App client:** public (no secret), authorization code + PKCE, scopes `openid email`. Callback and sign-out URLs: `https://sandip.dev/thelibrary/auth/callback` and `https://sandip.dev/thelibrary/`, plus the app distribution domain (for testing before the proxy rule) and `http://localhost:5173/thelibrary/...` (local dev). Access/ID tokens 60 min, refresh 30 days, token revocation on, refresh-token rotation if the token endpoint supports it (checked at R6).
- **Tokens in the browser:** access/ID in memory; refresh token in `localStorage` so phone and laptop stay signed in. Sign-out calls `/oauth2/revoke` and clears storage. See the shared-origin invariant in section 4.
- **User creation:** `scripts/create-user.sh` runs `admin-create-user` for `dev.sandip@gmail.com`; Cognito emails a temporary password; Sandip signs in, sets a password, enrolls TOTP. Nobody else ever handles the credentials.

## 8. Frontend

- Preact 11, `preact-iso` for the location (`web/src/paths.ts` turns paths into screens and back), Vite 8 with `base: "/nutgraf/"`, plain CSS with light and dark tokens. Dev server on port 5173.
- **Look (the redesign, 2026-10-11; `docs/features/redesign.md`, spec in `docs/mockups/redesign/`):** one identity on both devices. Since 2026-10-12 the app is Nutgraf, in Apple's type and colour: system fonts only (SF Pro Display for titles, SF Pro Text for body, controls and labels, New York for quotes), so no font files and no font requests. Every background is a token from the handoff's table; there is no blue. The logo is the folded page. Yellow is only ever the Machine's box, one CSS rule (`.ybox`) at three sizes. Dark is the default; the theme follows the system unless Library > Settings pins it on that device (`localStorage`, `data-theme` on `<html>`). Two layouts split at 760 px (`web/src/media.ts`).
- **Phone (up to 760 px): four tabs** at the bottom (Today, Browse, Saved, Library), hidden while reading. The top of every screen is one title line, plus the filter sentence in Browse. **Continue** (#44) is a pill at the right of every header.
  - **Today** (`/today`, `web/src/phone/today.tsx`, `deck.tsx`): the Summary (#11) as a deck of cards, best first, with the day in brief (#18) as the first card until it is folded for the day. The five (#5) carry the yellow box. A swipe only moves through the deck (2026-10-19, `docs/features/thumbs.md`): the card follows the finger and turns about its bottom edge; past 100 px or a flick it flies out, left to the next card and right to the one before (from the first card, back to the brief). At either end it springs back. The thumbs on the card say whether the issue was useful and leave the deck where it is; Later saves it and moves on; a tap opens it. `/today/list` is the same 20 as a ranked list, the five inside one frame; `/today/brief` is the whole brief.
  - **Browse** (`/browse?kind=&show=&topic=&sender=`, `web/src/phone/browse.tsx`): every unread issue of News or Learning, Must Read first with ★. The filter bar is one sentence, `{count} {show} in {kind}, {topics}, {senders}.`, whose underlined words open the Show, Topics and Senders sheets (changes apply live and replace the URL); tapping the kind switches it, clearing topics and keeping senders. Topics and senders are slugs in the URL. A tap peeks (#41) after 260 ms and a double tap opens; rows do not swipe (2026-10-19). A row read or saved from the list stays in place, faded, until the view changes (`web/src/list.ts`).
  - **Saved** (`/saved`): the read-later queue (#43), newest saved first.
  - **Library** (`/library`): Search, History, Newsletters, Status, Settings, then the places still to come. Its pages (`/library/search?q=`, `/library/history?day=`, `/library/newsletters[/:slug]`, `/library/status`, `/library/settings`) are shared with the Mac (`web/src/pages/`).
  - **Reader** (`/issue/:id`, `web/src/phone/reader.tsx`): a way back named for where it came from, the newsletter's page, and an action bar of thumbs up and down (was it useful?), Save, Archive, and Stories for a digest. A story opens as a sheet (`/issue/:id/story/:n`) with two heights, ‹ › steppers, the names it mentions and where else it ran, its source and its related stories (#20).
- **Mac (above 760 px): the console** (`web/src/mac/`): a 48 px top bar (logo, NEWS · LEARNING · SAVED with counts, ⌘K, the last check), three panes and a 30 px status line. The queue (`/news`, `/learning`, `/saved`, with `?show=&order=&topic=&sender=`) has a short filter sentence; News, unread, best first is the ranked Summary with the five in one frame, then the other unread News. The reader shows Claude's summary and key buttons. The story index shows the issue's stories, the selected one with its source and related stories. An open issue and story are in the path (`/news/:id/story/:n`, replaced, so Back leaves the console). Keys: J/K and arrows move through the queue, [ ] through the stories, Space peeks, Y (useful) N (not useful) S E M U O act, / and ⌘K open the palette, 1 2 3 switch queues, Esc closes. Below 1100 px the story index slides over, opened with [. Library's pages open in the same frame.
- **Every view is a URL** and Back restores it: lists keep their place on screen (`web/src/nav.ts` remembers the scroll per URL), cached data shows at once when a view comes back (`useAsync`'s cache key), and `redirect()` in `web/src/paths.ts` sends pre-redesign URLs (`/`, `/summary`, `/history`, `/search`, `/senders`, `/status`) and the other device's URLs to their place.
- **Shared actions** (`web/src/actions.ts`): the thumbs (useful, not useful; again clears it, and nothing else changes), Save, Archive and Move change an issue at once, go to the API, come back if it refuses, and offer Undo, which restores the rating, archive state and saved state together (rules 3 and 4). Toasts sit above the tab bar on the phone and in the status line on the Mac.
- **Pull to refresh** on Today and Browse asks for a Gmail check (`POST /ingest`) and reloads the lists 8 seconds later. Browse's date line shows the last check.
- **Now reading** (#44, `web/src/components/now-reading.tsx`, `web/src/place.ts`): the place is the share of the newsletter above the top of the screen (the window scrolls on both devices; the Mac's queue and story index are sticky), put back on open and saved at most every 5 seconds and as the page goes away (`keepalive`). Reaching the end saves 1, finished.
- **Deep dives, Follow and Ask** are in the design but not built: their tabs and buttons appear when #16, #17, #19, #21, #22 and #23 ship.
- `config.json` (written by CDK at deploy time) supplies API base, Cognito domain, client ID, redirect URIs. A mock API (`VITE_MOCK=1`) lets the UI run with no AWS.
- **Rendering newsletters:** `<iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" srcdoc=...>`. No `allow-scripts`, so nothing in an email executes; `allow-same-origin` only lets the app measure the content height to size the frame. Injected viewport meta and `img { max-width: 100% }`; a newsletter wider than the column (a 600 px table on a phone) is scaled down with CSS `zoom`, so there is no sideways scroll. Always a white page, never recoloured; dark mode dims it to 94%.
- **CSP** (srcdoc frames inherit it, so it must allow email images and styles):
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' https: data:; connect-src 'self' https://thelibrary-sandip.auth.us-east-1.amazoncognito.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests`
  (`upgrade-insecure-requests` also fixes `http:` images in old newsletters.)

## 9. Infrastructure

One CDK app, one stack per stage, selected with `-c stage=dev|prod`. Tags `project=thelibrary`, `stage=<stage>` on everything. A third, `-c stage=ci` (`TheLibrary-ci`), holds only the role GitHub Actions deploys with.

Deploys (`docs/features/pipeline.md`): only GitHub Actions deploys prod, from main. Every pull request runs CI (`check`: typecheck, lint, unit tests, web build; no AWS). Every push to main runs CI, deploys dev, runs the integration tests there, deploys prod and runs the hosting checks, one run at a time; pushes that change only Markdown, `docs/` or `journal/` skip it. The jobs sign in through the account's GitHub OIDC provider as `TheLibrary-github-deploy`, which trusts only this repository's `dev` and `prod` environments (GitHub lets only `main` deploy to them) and can assume only CDK's bootstrap roles, plus the dev-stack and Bedrock access the integration tests need. Main is protected: pull requests only, `check` required, squash merges, merged branches deleted. `pnpm run deploy` from a laptop is the fallback for when GitHub Actions is down.

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
- **Hosting (`scripts/check-hosting.sh`):** the section 4 checks, rerun after every web or API deploy (the Deploy workflow's last step).
- **CI:** unit tests, typecheck, lint and the web build on every pull request; all of that plus the integration tests on dev before every prod deploy (section 9).
- **UI:** built-in browser against mock mode at 390px and desktop widths, light and dark.
- **Acceptance:** Sandip on iPhone and Mac against prod (Claude cannot sign in through Cognito on Sandip's behalf).

## 11. Ranking (Phase 2)

Formula unchanged from v1 (see git history of this file for the derivation):

```
score = 0.40 * S_sender + 0.40 * S_topic + 0.20 * R
```

- `S_sender`: Thompson sample from Beta(prior + up, prior + down), Must Read prior (3,1), others (2,2), seeded by date + sender so the order is stable within a day.
- `S_topic`: cosine to a liked centroid (seeded with the five interests, `k = 5` pseudo-counts, 60-day half-life) minus 0.5 x cosine to a disliked centroid, z-scored across candidates, then mapped to 0..1 with the normal CDF so all three parts share a scale (a raw z-score would swamp the other two). Issues without an embedding sit at 0.5.
- `R`: `0.5^(age_hours / 48)`.
- Candidates: unread issues from the last 14 days only (`gsi2sk > now-14d`).
- Reason line from the dominant component; yellow box on the top 5; top 5 logged to `DIGEST#<date>` so the success metric (share of digest items later given a thumbs up, rolling 14 days, target >= 60%) is measurable.

Embeddings come from enrichment (below). Ranking is a "Best first" sort inside each tab; Must Read issues stay on top. The topic filter planned for P2.3 is covered by topic labels.

**Built so far (2026-10-10):** the math lives in `packages/core/src/rank.ts` as pure functions with unit tests. The Summary page (`GET /summary`) uses it at read time over unread News from the last 14 days: senders' counts, candidate and rated-issue embeddings (batch reads of the `EMB` items, up to the 300 latest ratings from `gsi4`) and the interest vectors (`CONFIG/INTERESTS`). Beta samples use whole-number parameters, drawn exactly as the a-th smallest of a + b - 1 seeded uniforms; the seed is the reader's day in IST plus the sender. Reason lines name the part that lifts an issue most above the candidates' average: a newsletter found useful, a Must Read newsletter, the interest or thumbed-up issue it stands out on, or freshness. "Stands out on" is a z-score per anchor across the candidates, because newsletters sit closer to one another than to a one-line interest: by raw cosine, one rated issue was named as the reason for most of the list. The Summary keeps at most three issues from one newsletter (`SUMMARY_PER_SENDER`; the best of the rest fill in if that leaves fewer than 20). With one rating and no interest vectors stored, 15 of the first prod Summary's 20 came from The Ken. The digest log, the yellow box and the success measure are built (2026-10-10): the first Summary of each IST day logs its top 5 to `DIGEST#<date>`, those five carry the yellow box all day, and `digestStats` counts, over the last 14 days' digests (each issue once), how many have a thumbs up and a thumbs down by now (`useful`, `notUseful`). The PRD's aim is 3 in 5. The digest is logged when the Summary is opened, not on a schedule, so it measures what was shown. Still to build in #5, once there are about a week of ratings: the stored score and the "Best first" sort inside the tabs.

### Related stories (`packages/core/src/related.ts`, `services/api/src/related.ts`, issue #20)

Nearest neighbours on the story index's embeddings (#15), so a story inside a digest finds its own relatives; decisions and the calibration are in `docs/features/related.md`.

- **Match:** the open issue's stories, read fresh, against every story in the corpus search keeps in the warm Lambda (`services/api/src/corpus.ts`, read once per 5 minutes on prod). A relative needs a raw cosine of at least 0.45, read off prod pairs; no centring, since Claude wrote every story and newsletter style barely shows (0.10 within a newsletter against 0.07 across, 2,264 stories on 2026-10-11). One per issue, its closest story. The same newsletter's story at 0.80 or more is a rerun and is left out.
- **Shape:** an issue with one story is the issue itself: up to three each side of its date. A digest gets up to three for each story, the closest, and only stories with any are listed. On prod, half of all stories have a relative; a digest lists a median of 4 of its stories (90th percentile 8), and 37% of one-story issues have any. Matching takes 3 to 11 ms per issue.
- **Fallback, the first version:** an issue with no embedded stories (not split yet, a promo, a muted newsletter's) is matched as a whole on enrichment's issue embeddings. Raw cosines there favour a newsletter's own issues (0.34 on average within a newsletter against 0.19 across, 404 issues on 2026-10-10), so each vector first loses the corpus mean and its newsletter's mean, shrunk as n / (n + 3); a match needs a centred cosine of 0.27. The API keeps those vectors once read. Fine to a few thousand issues, after which they belong packed in one object.

### Enrichment (`services/ingest/src/enrich.ts`)

Each issue gets one forced tool call to Claude Haiku (cross-region profile, `thinking: disabled`, temperature 0). The plan was Haiku 5.5 (`us.anthropic.claude-haiku-5-5`), but it answers "not available for this account" on this AWS account as of 2026-10-09, so enrichment runs on Haiku 4.5 (`us.anthropic.claude-haiku-4-5-20251001-v1:0`); Anthropic says 5.5 runs about 75% cheaper, so switching is worth doing once access arrives, and it is one constant in `services/ingest/src/bedrock.ts` (the ingest role allows both). Haiku 5.5 thinks by default and omitting the field does not turn it off, hence the explicit `disabled`. Input: newsletter name, subject, and the first ~6,000 characters of clean text. Output, validated before it is stored: a summary of at most 25 words, `shelf` (test: "would this still be worth reading in three months?" no is News, yes is Learning; digests are News), one `topic` from the stored list, and `selling`: `none`, `ad-supported` (a normal issue with sponsor slots, which is most of them), `promo` (exists only to sell) or `account` (no issue at all: account mail the noise rules missed, #50, answered only when the mail plainly is one). The first backlog run asked a yes/no "is it a promo?" and Haiku flagged 158 of 396 issues, mostly ones that merely carry an ad; the three-way question flags the real ones (42 on the same set). Text is compacted first: newsletters pad their preview text with invisible characters. Titan Text Embeddings V2 (512 dimensions, normalized) embeds name, subject, summary and text into the `EMB` item.

- **When:** after every ingest run, for issues from the last 14 days that are not yet enriched (failures retry next run), within an 8-minute budget; `pnpm enrich --days 30` for the backlog; `--force` redoes everything after a prompt or topic change. Enrichment errors show on `/status` and never fail the ingest run.
- **Topic list:** proposed once by Claude from the stored subjects (`pnpm topics`, then `--apply`), shaped around the reader's interests (product management and system design get their own topics; AI at most two). Classification waits until it exists. Prod's list (2026-10-09): AI & LLMs, AI Infrastructure, Product Management, System Design, Software Engineering, Startups & Business, Tech Industry, Data & Analytics, General Interest. Changing it later means `--replace` and `pnpm enrich --force`; the topic editor is parked (issue #8).
- **Shelf precedence:** Sandip's move, then the sender's "always" setting, then Claude.
- **Rules:** an issue Claude marks as a promo is archived; unread News older than 7 days is archived after each run, except from Must Read newsletters. Neither touches a saved issue (#43). Each rule archives an issue at most once (`autoArchived`), so restoring one keeps it restored. Both log a state event with `by: rule:<reason>`.
- **Account mail** (#50): an issue Claude calls `account` is filed as filtered (`Store.fileAsFiltered`) and not embedded: out of every index, its stories deleted, its sender's `issueCount` one lower, a state event with `by: claude:account`. Never an issue Sandip rated or saved. `/status` counts them, and read history leaves out an issue filtered after it was opened.
- **Access:** Anthropic models need a one-time use-case form on the AWS account (Bedrock console, model catalog). Titan needs nothing.
- **Cost:** Haiku 4.5 and 5.5 both cost about $1 and $5 per million input and output tokens; an issue is ~1,500 tokens in and ~60 out, so the 4-week backlog costs under $1 and daily runs a few cents.

### Search (`packages/core/src/search.ts`, `services/api/src/search.ts`, issue #53)

What the newsletters said, across every listed issue (unread, read, saved, archived), never the full text in S3: the stories already say what an issue holds.

- **By words.** Documents are each issue (subject weight 3, newsletter name 2, Claude's line 1.5) and each story (headline 3, names 2.5, summary 1, the newsletter's name 1, so "TLDR agents" finds TLDR's story about agents). Words are lowercased, stripped of accents and stemmed with Porter's stemmer, so "rate limiting" finds "rate limits" and "product manager" finds "product management"; a term of three letters or more also matches a longer word it starts (0.6), for a word still being typed. Common words ("how", "the") are dropped. A document needs every term, or with three terms or more, all but one, ranked after those with every term and kept only when the issue is at least loosely close in meaning (cosine 0.20): without that check, "product manager interviews" brought in every issue about managing products. BM25 scores the weighted fields, and two terms side by side in a field score again, so a walkthrough of "rate limiting" beats a markets digest with "rate" and "limit" in different sentences. An issue scores its best document; its best-scoring story is the one shown.
- **By meaning.** Titan V2 embeds the query in the API (the API role may call Titan and nothing else), and every story's embedding is compared with it. A story counts at a cosine of 0.30: on prod's 2,242 stories (2026-10-11), relevant stories scored 0.30 to 0.57, and queries with nothing relevant in the archive ("gardening tips", "rate cut") topped out under 0.30. An issue scores its closest story. Query embeddings are kept (200), so retyping costs no call; if Titan fails, the search goes on by words alone.
- **One list.** The issues that hold the words come first, ordered by reciprocal rank fusion with the meaning list (1 / (60 + rank) from each list an issue is in), then the issues only close in meaning, closest first. Fused together, a story just over the meaning cutoff ranked beside exact matches ("Size Limit measures bundle size" came second for "rate limiting"). Newest first reorders each group by date.
- **Reading.** The corpus (`services/api/src/corpus.ts`, shared with related stories: every listed issue's words; every story's text and embedding, about 5 MB for 2,242 stories) is read once and kept in the warm Lambda for 5 minutes, so a query typed a few letters at a time reads DynamoDB once; stories are read a week at a time, eight weeks at once, rather than one 1 MB page after another. Dev reads it every time, since integration tests rewrite it between searches. The rows shown (state, rating, saved) are read fresh for the hits, and one Claude has since found to be a promo is dropped. Ranking takes under 15 ms. When a full read gets slow, the next step is an S3 Vectors index written by the ingest run beside the story items (`docs/features/story-index.md`).
- **For Ask the Library (#21):** `searchIssues` and the API's `Search` are the archive searches its agent will call.

### Story index (`services/ingest/src/stories.ts`, `packages/core/src/stories.ts`, issue #15)

Claude splits every issue into its stories and stories about the same event are linked across newsletters; decisions and the probe are in `docs/features/story-index.md`.

- **Split:** a second forced tool call to Haiku per issue (`record_stories`), reading the whole issue up to 60,000 characters from the stored HTML, with each outside link marked `[n]`. Each story gets a headline (at most 12 words), a summary (at most 45 words), up to 6 names and the number of its own source link, which the code turns back into the URL. Sponsor slots and housekeeping are left out; an essay is one story. Promos and muted newsletters are skipped.
- **Embed and link:** Titan V2 embeds headline, summary and names (no newsletter name). In arrival order, a story joins the event of the most similar story from another issue within 3 days at a cosine of 0.70, or 0.55 with a shared name; otherwise it starts an event named after itself. Both cutoffs were read off prod pairs (feature doc); on the backlog they give 64 events covered by more than one newsletter, the largest 8 stories. `pnpm stories --relink` recomputes every link without model calls, for threshold changes.
- **When:** after enrichment on every scheduled run, for the last 14 days, inside the run's time budget; `pnpm stories --days 30` for the backlog. A split that fails three times is left alone (`--force` retries). Like enrichment, it never fails the ingest run; `/status` shows the last run's line.
- **Cost:** about 0.6 cents per issue. The backlog (357 issues, 2,210 stories, 2026-10-10) took 1.12 million tokens in and 225,000 out: $2.25. About $3 a month at ~25 issues a day.

### The day in brief (`services/ingest/src/narrative.ts`, issue #18)

Today's news as 3 to 6 threads, each a short paragraph naming the newsletters it came from; decisions and the probe are in `docs/features/narrative.md`.

- **Input:** News stories from issues received in the last 24 hours (the issue's shelf; promos and muted newsletters left out), merged by event so a story several newsletters carried appears once, with its newsletters listed.
- **Call:** one forced tool call to Haiku (`write_narrative`): threads of one development each, every story in a thread about that development, plain sentences, only what the stories say, no em-dashes (any that slip through become commas). Thread story ids are checked against the input; sources are the issues behind them.
- **When:** after the story index on every scheduled run, if there are at least 8 News stories, at least 6 hours have passed since the last version, and at least 5 stories are new to it; never after the run's 9-minute mark. `pnpm narrative --force` writes one now. It never fails the ingest run.
- **Cost:** about a cent per version (39 stories: 3,900 tokens in, 700 out), at most four a day: about $1 a month.

## 12. Cost (steady state, ~25 issues/day)

| Item | Phase 1 | Phase 2 |
|---|---|---|
| Lambda, DynamoDB, S3, HTTP API, CloudFront, SSM | ~$0.10 | ~$0.10 |
| Amplify proxy data transfer (~100 MB/month) | ~$0.02 | ~$0.02 |
| Cognito Essentials, 1 MAU | <= $0.02 | <= $0.02 |
| CloudWatch logs (14 days) + 2 alarms + 1 custom metric | ~$0.05 | ~$0.05 |
| DynamoDB PITR (tiny table) | ~$0.02 | ~$0.02 |
| Titan embeddings ($0.02 per M tokens) | n/a | ~$0.03 |
| Search (#53): a Titan call per new query, about 5 MB of DynamoDB reads per corpus load | n/a | < $0.01 |
| Haiku 5.5 enrichment (~25 issues/day) | n/a | ~$1.50 |
| Story index: Haiku 4.5 reading whole issues (#15) | n/a | ~$3 |
| The day in brief, up to 4 versions a day (#18) | n/a | ~$1 |
| **Total** | **~$0.20/month** | **~$5.40 to $5.80/month** |

An AWS Budget filtered on `project=thelibrary` alerts at $8 (set up in R9, once the cost-allocation tag is active; it was $2 before the story index and the day in brief).

## 13. Phase 3 readiness (audio briefing)

`DIGEST#<date>` lists the day's top items; clean text in `text/` is the script input; `audio/` is reserved; a private feed can be another path on the app distribution behind an unguessable token. Nothing to build now.
