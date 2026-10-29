# Nutgraf for any reader: the plan (#176)

Sandip, 2026-10-29: build it for Sandip for now, to test the app before a broader launch; at that launch, anyone can sign up. This is the plumbing that takes Nutgraf from one reader to a regular newsletter reader with sign-up, and the order to build it in. What was built for one reader is listed in `docs/reports/2026-10-29-single-reader-audit.md`.

## In one minute

- **Size:** about 38 pull requests in 7 milestones (11 to 17 below). That is about 40% of the 94 pull requests merged so far. Two milestones carry the risk: moving the data to per-reader keys (13), and the new way mail comes in (14).
- **Nothing breaks on the way.** The live app stays Sandip's until launch. Every merge leaves it working; reader-facing pieces ship behind switches, as highlights do now.
- **Start early.** Milestones 11 to 13 change little that Sandip sees, and every feature built single-user before them is more to move later. From milestone 11 on, new features take a reader.
- **Not only code:** a domain, SES production access, the move of Sandip's prod data, legal pages and a price are Sandip's to do or decide (below). The calendar depends on those and on review, more than on writing the code.
- **The number to watch is AI cost per reader:** about $5.40 to $6 a month at Sandip's 25 issues a day (`docs/architecture.md` section 12), nearly all of it Claude reading each issue. A free tier needs limits or shared work across readers (milestone 17).

## The shape at launch

| Area | Today | At launch |
| --- | --- | --- |
| Accounts | One Cognito user, made by a script; sign-up off | Sign-up with email (verified through SES), password reset, an authenticator optional; an operator group for ops pages |
| Who is calling | The API checks the token and drops it | Every route reads the reader (the token's `sub`) and passes it down to every read and write |
| Data | No owner in any key; fixed index partitions (`INBOX`, `SAVED`, …); shared `STATE`, `CONFIG`, `DIGEST#<day>` items | The reader's id leads every partition key and every index partition; S3 objects under the reader's prefix; a reader's data can be listed and deleted |
| Mail in | Gmail polled every 2 hours with one token, Sandip's labels and senders | A private address per reader on Nutgraf's domain (SES inbound): readers subscribe with it or forward from Gmail or Outlook. Each message is processed as it lands. Gmail import later, if it is worth Google's review |
| Processing | One Lambda run over the whole table: ingest, enrich, stories, shelves, follow, predictions, the day in brief | Per message: parse, store, enrich, split, shelve, from a queue. Per reader, at their local time: the day in brief, the top 5, settling predictions, the rest of the daily jobs |
| Taste and time | India's day; one reader line in every prompt; Sandip's five interests; Sandip's Learning; one topic list | A settings item per reader: time zone, interests, the reader line, what Learning means, topics proposed and applied on their own |
| Search, Ask, Related | One corpus of every story, kept in the warm API | One corpus per reader, cached per reader |
| Limits and cost | None per reader; one API throttle | Every Claude and Bedrock call metered per reader; daily limits on Ask, Takes, Timeline and Source; caps on mail in |
| Hosting | `sandip.dev/nutgraf` through the site's Amplify app; the refresh token on the `sandip.dev` origin | Nutgraf's own domain on CloudFront, its own sign-in domain; old URLs redirect |
| Privacy | Pages for a private, single-user app | A privacy policy and terms for a public service; export and deletion; agreements with each vendor |

The table stays one DynamoDB table with the reader in the keys (the usual pooled model), not a table or a stack per reader: sign-up for anyone rules out a deploy per person.

## How to build it

- **Sandip is reader one.** The first reader id is Sandip's; every step keeps today's behaviour for Sandip.
- **Behind switches, merged early.** Reader-facing pieces (sign-up, the address, onboarding) merge switched off, like `HIGHLIGHTS` in `web/src/features.ts`, so `main` never waits on a launch.
- **Isolation is tested, not assumed.** From milestone 13, the integration tests on dev sign in as two readers and check that neither can read, change or search the other's data. A failure blocks the Deploy.
- **New features per reader.** From milestone 11, a new feature takes the reader like the rest, so the list in the audit does not grow.

## The milestones

Each becomes a GitHub milestone with one issue per pull request when it is next; until then it is this section. Sizes are pull requests.

### 11. Every request knows its reader (4)

Nothing changes for Sandip; the code stops assuming Sandip.

1. The API reads the reader from the token and passes a `Reader` through routes, services and the repository (43 routes, 51 repository methods).
2. Ingest and the scripts take the reader explicitly; Sandip's id comes from one place.
3. The stored `"sandip"` in `setBy` and `shelfSetBy` becomes "the reader", kept readable for old items.
4. The integration tests sign in as a second test reader on dev (a second Cognito user on dev only).

Done when: no route, job or script reads data without a reader, and the Deploy's tests pass unchanged.

### 12. Settings instead of Sandip (5)

Can start beside 13 once 11 is merged.

1. A settings item per reader (time zone, interests, the reader line, what Learning means), seeded with Sandip's values.
2. Days by the reader's time zone, with daylight saving: `packages/core/src/days.ts` and `web/src/format.ts`.
3. Prompts take the reader's line instead of `READER` (13 files).
4. Ranking seeds from the reader's interests; News and Learning from the reader's meaning of Learning, with a default for new readers.
5. Topics proposed and applied on their own after a reader's first issues, instead of `pnpm topics --apply`; a Settings page for time zone and interests.

Done when: a test reader in New York with other interests gets New York days, their own ranking reasons and prompts, while Sandip's stay as they are.

### 13. Every item has an owner (7)

The riskiest milestone: the keys of everything stored change.

1. The key design: the reader leads every partition key and index partition (31 key builders, 4 indexes, about 10 fixed partitions), and a sender's id per reader. Written into `docs/architecture.md` first.
2. Issues and reading state on the new keys, behind a switch (the repository and ingest's store).
3. Senders and ranking on the new keys.
4. Stories, events, takes and timelines on the new keys.
5. Follow, predictions, highlights, the digest and the day in brief on the new keys.
6. The corpus per reader.
7. The move: a script copies Sandip's items to Sandip's keys and checks the counts, on dev first, then on prod (Sandip runs it); the switch flips; old items are deleted a week later. S3 objects stay where they are (each item keeps its S3 key); new mail goes under the reader's prefix.

Done when: two readers on dev see only their own data in every screen, search and answer, the isolation tests pass in the Deploy, and prod runs on the new keys with Sandip's data whole.

### 14. Mail in for anyone (6)

1. Nutgraf's domain in SES: inbound mail on a subdomain (MX), DKIM, SPF and DMARC; a receipt rule into S3 and a queue.
2. A private address per reader (random, can be changed), shown in Settings.
3. Each message processed as it lands: the existing parser (`packages/core/src/process.ts`) and enrichment from a queue, with a limit per reader.
4. Account mail shown to the reader: Gmail's forwarding confirmation code, welcome and confirm-your-subscription mail (`docs/features/account-mail.md`).
5. Limits: size, messages per day, senders a reader blocks.
6. Sandip's Gmail forwards to Sandip's address; the Gmail poller and the label list retire.

Done when: mail forwarded to a test reader's address on dev is in the app, enriched, within about a minute, with no laptop step.

### 15. Daily work per reader, metered (5)

1. The daily jobs (the day in brief, the top 5, settling predictions, follow checks, archiving old News, tune-up, audit) run per reader at the reader's local time, from an hourly schedule through a queue.
2. Every Claude, Titan and Jev call recorded per reader with its cost.
3. Daily limits on Ask, Takes, Timeline and Source, with a plain message when one is reached; a throttle per reader.
4. Per-reader health: no mail for a week tells the reader; an operator view across readers.
5. A load test: 50 synthetic readers on dev for a day, cost per reader measured.

Done when: the 50 readers' jobs run on time within their limits, and the cost per reader is known from the meter, not estimated.

### 16. Sign-up and accounts (6)

1. Cognito sign-up with email verification and password reset, mail sent through SES; the authenticator optional for readers; the operator group for Status and the ops pages.
2. Onboarding: time zone (detected), interests, the address and how to forward from Gmail and Outlook, then a wait for the first issue.
3. Export: everything a reader has, as Markdown and JSON, highlights included.
4. Delete account: every item, every S3 object and the Cognito user.
5. Highlights back for every reader: the reader, the Highlights page and the Markdown export, without the Obsidian script.
6. The invite switch: sign-up open, or by invitation only.

Done when: a stranger can sign up on dev, forward a newsletter, read it ranked, export it and delete the account, leaving nothing behind.

### 17. Ready to launch (5, plus Sandip's part)

1. Nutgraf's domain for the app on CloudFront and a custom sign-in domain; `sandip.dev/nutgraf` redirects; the token leaves the shared origin.
2. Privacy policy, terms and about for a public service; retention; consent for anything optional (India's DPDP Act first, GDPR if Europe).
3. Abuse: sign-up rate limits, bot protection on sign-up, inbound spam.
4. Errors and costs watched: error tracking, a cost dashboard per reader, the budget alarm for many readers (`docs/features/analytics.md` section 7.2 has the tools).
5. A landing page; crawlers allowed on it, never on the app.

Done when: a launch checklist is green and sign-up opens with one switch.

## Only Sandip can do

- **Choose and buy Nutgraf's domain.** Milestone 14 needs it for mail; 17 for the app.
- **Ask AWS for SES production access** (out of the sandbox), in the console, once the domain is verified; it usually takes a day.
- **Run the prod move** in milestone 13 (a prod data job, run from the laptop like `pnpm reprocess`).
- **Set the Gmail filter** that forwards newsletters to the new address, and confirm Gmail's code.
- **Approve the public pages:** privacy policy, terms, about.

## Decisions for Sandip

1. **The domain**, before milestone 14.
2. **Jev.** It sends story text to TypeSafe, outside AWS. Keep it with an agreement and a line in the privacy policy, or move News and Learning to a Bedrock model. Before milestone 17.
3. **Gmail import.** Reading a reader's past mail needs Google's verification and a yearly security assessment for `gmail.readonly`. Launch with forwarding only (recommended) and decide later.
4. **Sign-in with Google or Apple**, besides email. Optional in milestone 16; each is a console setup.
5. **The price.** Free, free with limits, or paid. The plumbing (meter, limits, an invite switch) is in 15 and 16; taking payment (Stripe) is its own milestone after 17.

## After launch, not in this plan

- **Shared work across readers:** many readers get the same edition of a popular newsletter. Its summary and stories could be made once and shared (each reader's copy, links and state stay their own). The biggest lever on cost per reader.
- Payment, native apps, languages other than English, Gmail import, the full analytics stack.
- Milestone 10 (highlights to Obsidian) stays paused; highlights return for everyone in milestone 16, and the Obsidian script (#169) stays out of the product.
