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

## 4. Hosting on `sandip.dev/thelibrary`

### App distribution (CDK)

| Behavior | Origin | Cache | Notes |
|---|---|---|---|
| `/thelibrary/api/*` | HTTP API | CachingDisabled | Origin request policy `AllViewerExceptHostHeader` (forwards `Authorization`). |
| default `*` | web bucket via OAC, objects under `thelibrary/` | CachingOptimized | Viewer-request CloudFront Function (below). |

SPA function, applied to the default behavior:
- `/thelibrary/assets/*`, `/thelibrary/config.json`: pass through.
- `/thelibrary/favicon.svg`, `/thelibrary/favicon-32.png`, `/thelibrary/apple-touch-icon.png`: pass through. The tab icon, its PNG fallback for browsers without SVG favicons, and the iPhone home-screen icon (see `scripts/icons.sh`).
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

All four GSIs are defined before the first deploy because CloudFormation adds only one GSI per update. Projections are `ALL`; an issue's embedding lives in its own item so it never lands in an index. Story items (#15) are the exception on purpose: linking reads a window of stories with their vectors in one `gsi1` query.

| Entity | pk | sk | Notes |
|---|---|---|---|
| Issue | `ISSUE#<gmailMsgId>` | `META` | `senderId`, `publication`, `fromAddr`, `fromName` (kept so sender rules can be re-applied after the raw message expires), `subject`, `receivedAt`, `snippet`, `viewOnlineUrl`, `unsubscribeUrl`, `wordCount`, `readMinutes`, `state` (`unread`\|`read`\|`archived`\|`filtered`), `rating` (`1`\|`-1`), `ratedAt`, `s3Keys`, `labelIds`. Enrichment (section 11) adds `summary`, `shelf` (`news`\|`learning`, what Home's tabs filter on), `shelfAuto` (Claude's call), `shelfSetBy` (`claude`\|`sender`\|`sandip`), `topic`, `promo`, `enrichedAt`, `embeddedAt`, and `autoArchived` (`promo`\|`old-news`) when a rule archived it. `savedAt` when Sandip saved it for later (#43). `filterReason` once filtered; an issue filed as filtered after it was stored (#50) keeps its other fields, minus its index keys. Phase 2 ranking adds `score`, `scoreReason`. |
| Embedding | `ISSUE#<id>` | `EMB` | Titan V2, 512 float32 as binary, for Phase 2 ranking. |
| Story (#15) | `ISSUE#<id>` | `STORY#<nn>` | `n` (from 1), `headline`, `summary`, `names` (companies, people, products), `link` (the story's own source, one of the issue's links), `eventId`, `senderId`, `receivedAt`, `vector` (Titan V2 float32 binary), `model`, `embedModel`, `at`. In `gsi1` under `STORIES`. The issue's META gets `storiedAt` and `storyCount`, or `storyError` and `storyAttempts` after a failed split. |
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

HTTP API, one route `ANY /thelibrary/api/{proxy+}` behind the Cognito JWT authorizer (issuer = user pool, audience = app client). One Node 24 Lambda with an explicit route table. All responses are JSON with `Cache-Control: no-store`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/thelibrary/api/issues?view=unread\|all\|archived\|saved&shelf=news\|learning&topic=&sender=&cursor=&limit=` | Newest first; `saved` (#43) newest saved first, read or not, hiding no one. `sender` (up to 50 ids) and `topic` (up to 20) each take several, comma-separated, meaning any of them. Home views hide muted senders unless they are picked. Unread without a sender filter lists Must Read newsletters first; every list marks their issues `mustRead`. `shelf=news` also returns issues Claude has not sorted yet. |
| GET | `/thelibrary/api/issues/{id}` | Metadata + sanitized HTML (from S3), and `position` when this is the issue Now reading points at and it is unfinished (#44). |
| PATCH | `/thelibrary/api/issues/{id}` | `{ "state"?: "unread" \| "read" \| "archived", "shelf"?: "news" \| "learning", "saved"?: boolean }`. A shelf set here is Sandip's (`shelfSetBy: sandip`): neither Claude nor a sender setting moves it back. Saving (#43) takes the issue out of Unread whatever its state; archiving a saved issue also unsaves it, and an archived issue cannot be saved (400). |
| POST | `/thelibrary/api/issues/{id}/rating` | `{ "value": 1 \| -1 \| 0 }` (0 clears) |
| POST | `/thelibrary/api/issues/{id}/events` | `{ "type": "open" }`: logged, indexed by time for read history, and Now reading points at the issue (#44). `{ "type": "peek" }`: a peek left open 2 seconds (#56), logged and indexed the same way; Now reading stays put |
| GET | `/thelibrary/api/now-reading` | Now reading (#44): `{ nowReading?: { issue, position, at } }`, empty once the issue is finished, archived, or rated after it was opened. |
| PUT | `/thelibrary/api/now-reading` | `{ "id", "position" }` (0 to 1; 1 means finished), 204. A place in another issue moves Now reading back to it (an older window still open on it), unless that place is 1. 404 for an unknown issue. |
| GET | `/thelibrary/api/history?day=YYYY-MM-DD` | Read history (#42): the issues read on that day in India (today by default), opened or peeked at (#56), each once at its latest read, latest first, with `openedAt`; and `previousDay` and `nextDay`, the nearest days with anything read, so paging skips empty days. 400 for anything but a real date. |
| GET | `/thelibrary/api/issues/{id}/stories` | The issue's stories from the story index (#15), in order: `n`, `headline`, `summary`, `link` (no embeddings). Empty until the issue is split. For a tap on a row (#41). |
| GET | `/thelibrary/api/issues/{id}/related` | `{ earlier, since }`: up to three issues each, received before and after this one, closest first, each with a `similarity` (section 11). Promos and muted newsletters are left out. Worked out at read time; nothing is stored. |
| GET | `/thelibrary/api/search?q=&sort=best\|newest` | Search (#53, section 11): the issues that hold the query's words, then those only close in meaning, each group best match first or newest first, up to 50. Each hit carries `match` (`words`, `meaning` or `both`) and, inside a digest, the matching `story`'s headline; the response carries the query's `terms` as matched, for highlighting, and `byMeaning: false` when Titan was unavailable (words alone). Filtered mail, promos and muted newsletters are left out; archived issues are in. 400 for an empty `q` or one over 200 characters. |
| GET | `/thelibrary/api/senders` | All senders with counts, mute state, unsubscribe link. |
| GET | `/thelibrary/api/senders/{senderId}` | Sender + its issues. |
| PATCH | `/thelibrary/api/senders/{senderId}` | `{ "muted"?, "mustRead"?, "shelf"?: "news" \| "learning" \| null }`, at least one. Setting `shelf` moves the sender's issues there (except ones Sandip moved); `null` hands them back to Claude's call. |
| GET | `/thelibrary/api/topics` | The topic list. The web shows the News/Learning tabs once it is non-empty. |
| GET | `/thelibrary/api/unread-counts` | Unread issues counted by sender, shelf and topic (muted senders included), for the numbers on the tabs, topic chips and sender picker, and `saved`, how many issues are saved (#43). The web works out every combination of filters from this one list. |
| GET | `/thelibrary/api/summary` | The 20 most relevant unread News issues from the last two weeks, best first and at most three from one newsletter, each with a `scoreReason`, plus how many were scored. Scored at read time (section 11). The first call of the day logs the top 5 as the day's digest; every call returns it (`digest`) with the success measure (`digestStats`), and the day in brief (`narrative`, #18) while it is less than a day old. |
| POST | `/thelibrary/api/ingest` | Async "refresh now". |
| GET | `/thelibrary/api/status` | Last ingest run, counts, the success measure (`digestStats`). |

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

- Preact 11, `preact-iso` routing, Vite 8 with `base: "/thelibrary/"`, plain CSS with light/dark variables. Dev server on port 5173.
- **Look (issue #12; Sandip picked a combination on 2026-10-10, replacing the earlier Clean list):** two layouts split at 760px (`web/src/media.ts`). **Phone: briefing cards** (direction D): always dark, Figtree for the interface and Literata for reading, one yellow accent. Home has a header with the date, Summary and Status; News | Learning as two pills; Must Read as a sideways row of large cards; the rest as cards under their topic headings in Claude's order. **Mac: two-pane** (direction C): IBM Plex Sans and Serif, one teal accent, light by default and the phone's dark palette in dark mode. A sidebar sits beside every page (a search field, News, Learning, Summary, topic chips, the sender list with search and checkboxes, Manage senders, Status), where Topics and Senders each fold shut from their heading and the browser remembers which are folded (`localStorage`); Home is a list column grouped Must Read / Everything else; from 1100px a reading pane opens issues beside the list (`?issue=<id>`, which replaces the history entry). All four typefaces are self-hosted from `@fontsource` packages (bundled into `assets/`, so no third-party requests and no CSP change); browsers fetch only the faces a layout uses. Shared data (topics, senders, the unread tally) lives in `web/src/library.tsx` and refreshes on every route change.
- Routes: `/` (home list), `/summary`, `/saved`, `/history`, `/search`, `/issue/:id`, `/senders`, `/senders/:senderId`, `/auth/callback`, `/status`.
- **Search** (issue #53, `web/src/routes/search.tsx`, `web/src/components/search-box.tsx`): on the Mac a field at the top of the sidebar, which `/` jumps to; on the phone a search button in Home's list bar, beside the view menu (the header has no room for a fourth control at 375 px: it wrapped the wordmark onto two lines), opening a page with its own field. It searches as you type, after a 300 ms pause. The query and the order live in the URL (`/search?q=&sort=newest`): the first search from another page adds a step to Back, and typing on the results page replaces it, so Back leaves search. Results are rows on the Mac (with the reading pane, `?issue=`) and cards on the phone, with the query's words marked (`web/src/components/highlight.tsx`, by the API's own word rules in `@library/core/search`), the subject added on cards, and a digest's matching story on its own line under an accent bar; then a "Close in meaning" group. Tap to peek and double tap to open, as everywhere; swiping a result rates it and leaves it in place, since an archived issue is still a result. While the next query runs, the last results stay on screen.
- **Save for later** (issue #43, `web/src/components/save.tsx`, `web/src/routes/saved.tsx`): a bookmark on every row and card (Home, the Summary, Saved, History, a sender's page; on the Mac it shows on hover until saved), on the issue page (a labelled Save button on the Mac; on the phone, top right beside the way back, since the bottom bar is full) and nowhere on archived issues. Saving takes an issue out of Unread and its counts; the row stays put, bookmark filled, until the list loads again. The Saved page lists every saved issue, newest saved first, with the reading pane on the Mac and swipe on the phone; it is reached from the sidebar (with the count) and from Saved in Home's view menu. Archiving a saved issue, by button or swipe, takes it off the list; a swipe's Undo saves it again.
- **History page** (`/history?day=YYYY-MM-DD`, issue #42): the issues read on one day, latest first, each with the time it was read: opened, or peeked at for 2 seconds (#56). Earlier and later buttons name the nearest days with reads and skip the rest; a date field goes to any day; Today comes back. The day is in the URL, so Back steps through the days visited. Rows on the Mac open in the reading pane; cards on the phone. Linked from the sidebar on the Mac and a clock button in the phone's header.
- **Home filters**, all in the URL so Back restores them: the News | Learning tabs with unread counts; senders (several at once, Must Read first, with search: a bottom sheet on the phone with picked senders as removable chips, checkboxes in the Mac sidebar); topic chips (several at once; switching tabs clears them, picked senders stay; tapping a topic heading on the phone, or the topic on an open issue, switches its chip on); a view menu (Unread, All, Archived) and a check-Gmail button. Counts come from `/unread-counts` through `web/src/counts.ts`.
- **Summary page** (`/summary`, issue #11): the 20 most relevant unread News issues (at most three from one newsletter), each as the newsletter, Claude's one line and the reason it ranks there, with archive per line and "Mark all read" to bring up the next ones. Today's digest (the top 5 as first shown) carries the yellow box, and a line under the list gives the success measure, also on Status. One card of lines on the phone; a list column with the reading pane on the Mac. **The day in brief** (#18) sits above the list in a card that folds shut (remembered in `localStorage`); on the Mac with the reading pane it fills the pane until an issue is opened, and its newsletter links open their issues there.
- **Swipe to rate** (issue #13, phone only): on Home's topic cards, the Summary and a sender's page, swipe right to rate Relevant, left to rate Irrelevant and archive, with "Archived. Undo" for five seconds. Past 40% of the row's width, or a quick flick, commits; anything less springs back, and a swipe that would change nothing resists. Touch only, with `touch-action: pan-y` so scrolling stays native; the Must Read row scrolls sideways, so its cards do not swipe. Rules in `web/src/gesture.ts`, the gesture and Undo in `web/src/components/swipe.tsx`; no API change.
- **Now reading** (issue #44, `web/src/components/now-reading.tsx`, `web/src/place.ts`): a card with the last issue opened, how far in it is and a thin bar, under the phone's Home header and under the main links in the Mac sidebar. On a Mac wide enough for the reading pane it opens the issue in Home's pane, otherwise on its own page. The window scrolls, not the newsletter's frame (the frame is sized to its content), so the place is the share of the frame above the top of the screen, which lands near the same words on a phone, where the frame is taller. The reader puts it back on open, again each time late images resize the frame, until the reader scrolls, taps or presses a key (inside the frame too). It saves the place at most every 5 seconds while it changes, and as the page goes away (`keepalive`). Reaching the end (the bottom of the screen within 5% or 600 px of the newsletter's end) saves 1, finished. The card reloads on every route change and when the app comes back to the foreground, so a place saved on the other device shows up.
- **Tap for a summary** (issue #41, `web/src/components/peek.tsx`): on the phone's cards and Summary lines, and on the Mac's rows and Summary lines where there is no reading pane, one tap peeks inside the issue, under its row: a digest's stories (headline, a line, the source link), or what a single story says, from `GET /issues/{id}/stories`, read once per issue a page load. A second tap within 250 ms opens the issue instead, without the peek flashing first; the peek also has a Read it button. Enter opens, Space peeks. A peek left open 2 seconds reads the issue (#56): read history lists it, and an unread issue is marked read, as opening it would; one folded away sooner was only a glance. With the reading pane a click still opens the issue there, and the Must Read row's lead cards open on a tap, since a card that grew would stretch the whole sideways row. Swipe is unchanged.
- **Related** (issue #20, `web/src/components/related.tsx`): under the newsletter, on the issue page and in the reading pane, "Earlier" and "Since" with the newsletter, date and Claude's line for each. In the pane, a related issue opens in the pane. Nothing shows when nothing is close.
- **Issue page** (`web/src/components/issue-reader.tsx`, also the reading pane): on the Mac, Claude's summary sits in a box under the headline (issue #14) and the actions are a row of labelled buttons; the phone keeps the headline alone, with the actions in a bar at the bottom.
- `config.json` (written by CDK at deploy time) supplies API base, Cognito domain, client ID, redirect URIs. A mock API (`VITE_MOCK=1`) lets the UI run with no AWS.
- **Rendering newsletters:** `<iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" srcdoc=...>`. No `allow-scripts`, so nothing in an email executes; `allow-same-origin` only lets the app measure the content height to size the frame. Injected viewport meta and `img, table { max-width: 100% }`. Always a light card, even in dark mode.
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
- Reason line from the dominant component; yellow box on the top 5; top 5 logged to `DIGEST#<date>` so the success metric (share of digest items later rated Relevant, rolling 14 days, target >= 60%) is measurable.

Embeddings come from enrichment (below). Ranking is a "Best first" sort inside each tab; Must Read issues stay on top. The topic filter planned for P2.3 is covered by topic labels.

**Built so far (2026-10-10):** the math lives in `packages/core/src/rank.ts` as pure functions with unit tests. The Summary page (`GET /summary`) uses it at read time over unread News from the last 14 days: senders' counts, candidate and rated-issue embeddings (batch reads of the `EMB` items, up to the 300 latest ratings from `gsi4`) and the interest vectors (`CONFIG/INTERESTS`). Beta samples use whole-number parameters, drawn exactly as the a-th smallest of a + b - 1 seeded uniforms; the seed is the reader's day in IST plus the sender. Reason lines name the part that lifts an issue most above the candidates' average: a newsletter rated Relevant, a Must Read newsletter, the interest or Relevant-rated issue it stands out on, or freshness. "Stands out on" is a z-score per anchor across the candidates, because newsletters sit closer to one another than to a one-line interest: by raw cosine, one rated issue was named as the reason for most of the list. The Summary keeps at most three issues from one newsletter (`SUMMARY_PER_SENDER`; the best of the rest fill in if that leaves fewer than 20). With one rating and no interest vectors stored, 15 of the first prod Summary's 20 came from The Ken. The digest log, the yellow box and the success measure are built (2026-10-10): the first Summary of each IST day logs its top 5 to `DIGEST#<date>`, those five carry the yellow box all day, and `digestStats` counts, over the last 14 days' digests (each issue once), how many are rated Relevant and Irrelevant by now. The PRD's aim is 3 in 5. The digest is logged when the Summary is opened, not on a schedule, so it measures what was shown. Still to build in #5, once there are about a week of ratings: the stored score and the "Best first" sort inside the tabs.

### Related issues (`packages/core/src/related.ts`, issue #20)

Nearest neighbours over every stored issue's embedding (the inbox and the archive), computed per request in the API; the Lambda instance keeps embeddings it has read, since they do not change. Raw cosines favour a newsletter's own issues (on prod, 0.34 on average within a newsletter against 0.19 across, 404 issues on 2026-10-10), so each vector first loses the corpus mean and its newsletter's mean, shrunk as n / (n + 3) for newsletters with few issues. A match needs a centred cosine of at least 0.27, picked by reading prod pairs around the cutoff; half of prod's issues then have at least one. Up to three each side of the issue's date. Digests match loosely (whole-issue embeddings); the story index (#15) is what makes a digest item find its own relatives. Cost grows with the archive: fine to a few thousand issues, after which the vectors belong packed in one object.

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
- **Reading.** The corpus (every listed issue's words; every story's text and embedding, about 5 MB for 2,242 stories) is read once and kept in the warm Lambda for 5 minutes, so a query typed a few letters at a time reads DynamoDB once; stories are read a week at a time, eight weeks at once, rather than one 1 MB page after another. Dev reads it every time, since integration tests rewrite it between searches. The rows shown (state, rating, saved) are read fresh for the hits, and one Claude has since found to be a promo is dropped. Ranking takes under 15 ms. When a full read gets slow, the next step is an S3 Vectors index written by the ingest run beside the story items (`docs/features/story-index.md`).
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
