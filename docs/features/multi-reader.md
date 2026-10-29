# Nutgraf for any reader: the plan (#176)

Sandip, 2026-10-29: build it for Sandip for now, to test the app before a broader launch; at that launch, anyone can sign up. This is the plumbing that takes Nutgraf from one reader to a regular newsletter reader with sign-up, and the order to build it in. What was built for one reader is listed in `docs/reports/2026-10-29-single-reader-audit.md`.

**Decided (Sandip, 2026-10-29):**

- Nutgraf stays at `sandip.dev/nutgraf` for now.
- Readers sign up with an email address and sign in with a one-time code or a link sent by email; no password.
- Google sign-in comes later.
- Mail in, by reading a reader's Gmail or by a forwarding address, comes later; which of the two is decided then.

## In one minute

- **Now:** about 26 pull requests in 5 milestones (11 to 15 below): the reader on every request, settings per reader, an owner for every item, daily work per reader with a meter, and sign-up by email.
- **Later:** about 12 more for mail in, Google sign-in and launch. About 39 in all, some 40% of the 96 pull requests merged so far.
- **The risk** is in milestone 13, where the keys of everything stored change and Sandip's prod data moves.
- **Mail in gates the launch.** A reader who signs up before it is built has nothing to read, so sign-up merges switched off and opens only once mail in is built.
- **Nothing breaks on the way.** The live app stays Sandip's until launch. Every merge leaves it working; reader-facing pieces ship behind switches, as highlights do now.
- **Start early.** Milestones 11 to 13 change little that Sandip sees, and every feature built single-user before them is more to move later. From milestone 11 on, new features take a reader.
- **The number to watch is AI cost per reader:** about $5.40 to $6 a month at Sandip's 25 issues a day (`docs/architecture.md` section 12), nearly all of it Claude reading each issue. A free tier needs limits (milestone 14) or shared work across readers (after launch).

## The shape at launch

| Area | Today | At launch |
| --- | --- | --- |
| Accounts | One Cognito user, made by a script; sign-up off; password and authenticator | Sign-up with an email address; sign-in with a one-time code (or link) by email, sent through SES; Google sign-in later. Sandip keeps password and authenticator; an operator group for ops pages |
| Who is calling | The API checks the token and drops it | Every route reads the reader (the token's `sub`) and passes it down to every read and write |
| Data | No owner in any key; fixed index partitions (`INBOX`, `SAVED`, …); shared `STATE`, `CONFIG`, `DIGEST#<day>` items | The reader's id leads every partition key and every index partition; S3 objects under the reader's prefix; a reader's data can be listed and deleted |
| Mail in | Gmail polled every 2 hours with one token, Sandip's labels and senders | Decided later: each reader connects their Gmail, or forwards to a private address on a `sandip.dev` subdomain. Either way, mail is processed per reader from a queue |
| Processing | One Lambda run over the whole table: ingest, enrich, stories, shelves, follow, predictions, the day in brief | Per message: parse, store, enrich, split, shelve. Per reader, at their local time: the day in brief, the top 5, settling predictions, the rest of the daily jobs |
| Taste and time | India's day; one reader line in every prompt; Sandip's five interests; Sandip's Learning; one topic list | A settings item per reader: time zone, interests, the reader line, what Learning means, topics proposed and applied on their own |
| Search, Ask, Related | One corpus of every story, kept in the warm API | One corpus per reader, cached per reader |
| Limits and cost | None per reader; one API throttle | Every Claude and Bedrock call metered per reader; daily limits on Ask, Takes, Timeline and Source; caps on mail in |
| Hosting | `sandip.dev/nutgraf` through the site's Amplify app | The same. The refresh token stays on the `sandip.dev` origin, so the rule that the root site adds no third-party script or service worker (`docs/architecture.md` section 4) becomes a launch requirement |
| Privacy | Pages for a private, single-user app | A privacy policy and terms for a public service; export and deletion; agreements with each vendor |

The table stays one DynamoDB table with the reader in the keys (the usual pooled model), not a table or a stack per reader: sign-up for anyone rules out a deploy per person.

## How to build it

- **Sandip is reader one.** The first reader id is Sandip's; every step keeps today's behaviour for Sandip.
- **Behind switches, merged early.** Reader-facing pieces (sign-up, onboarding) merge switched off, like `HIGHLIGHTS` in `web/src/features.ts`, so `main` never waits on a launch.
- **Isolation is tested, not assumed.** From milestone 13, the integration tests on dev sign in as two readers and check that neither can read, change or search the other's data. A failure blocks the Deploy.
- **New features per reader.** From milestone 11, a new feature takes the reader like the rest, so the list in the audit does not grow.

## Now: milestones 11 to 15

Each becomes a GitHub milestone with one issue per pull request when it is next; until then it is this section. Sizes are pull requests.

### 11. Every request knows its reader (3)

[Milestone 11](https://github.com/devsandip/the-library/milestone/11). Nothing changes for Sandip; the code stops assuming Sandip.

1. **The API reads the reader** (#179). The handler reads the token's `sub` into a `Reader` (`packages/core/src/reader.ts`) and refuses a request that names none with 401. Each reader's services (repository, corpus, deep dives) are built on their first request and kept while the Lambda is warm, 20 readers at most. A source check carries its reader to the jobs Lambda.
2. **The owner** (#180): `CONFIG/OWNER` names the reader whose Gmail the poller reads and whom the daily jobs serve; ingest, the jobs and the scripts build their store for that reader.
3. **"reader", not "sandip"** (#181): the stored `"sandip"` in `setBy` and `shelfSetBy` becomes `"reader"`, old items read the same.

Done when: no route, job or script reads data without a reader, and the Deploy's tests pass unchanged. A second test reader in the integration tests waits for milestone 13, where it can check that two readers are kept apart.

### 12. Settings instead of Sandip (5)

[Milestone 12](https://github.com/devsandip/the-library/milestone/12): issues 184 to 188. Topics proposed on their own moved to milestone 14, since topics can be a reader's own only once issues are.

Can start beside 13 once 11 is merged.

1. A settings item per reader (time zone, interests, the reader line, what Learning means), seeded with Sandip's values.
2. **Days by the reader's time zone** (#185), with daylight saving: `packages/core/src/days.ts` steps days by date and finds a day's bounds from the zone's offset that day. The API reads the zone from the reader's settings (History, the Summary's day and digest, Ask's dates, predictions coming due, the dates in prompts); ingest and settling use the owner's. The web app loads it before the first screen (`web/src/zone.ts`) and shows every date in it.
3. **Prompts take the reader's line** (#186) instead of `READER`: every prompt builder takes `about` (today's line when missing). The API passes the asking reader's (Ask, Takes, Timeline, Source and its hunt, settling); ingest passes the owner's (sorting, topics, stories, predictions, the day in brief, follow checks, Jev's question).
4. **Ranking and Learning from the reader's settings** (#187). Saving interests embeds them (`services/api/src/settings.ts`) into the reader's `INTERESTS`, which the Summary ranks with and names in its reasons; a reader who never set interests ranks with `CONFIG/INTERESTS`. Jev asks with the reader's `learning` (`shelfQuestions`); Sandip's craft (`CRAFT`) is the default, and `PLAIN_LEARNING` is there for new readers' onboarding (milestone 15).
5. **The Settings page** (#188): the reader's time zone (any zone the browser knows, with the device's offered when it keeps another clock) and interests (add, edit, remove, up to 10), saved through `PATCH /settings` on the phone and the Mac. Topics proposed on their own moved to milestone 14.

Done when: a test reader in New York with other interests gets New York days, their own ranking reasons and prompts, while Sandip's stay as they are.

### 13. Every item has an owner (7)

The riskiest milestone: the keys of everything stored change.

[Milestone 13](https://github.com/devsandip/the-library/milestone/13): keys bound to a reader behind `READER_KEYS` (#195), the API's repository (#196) and ingest's store (#197) on them, two readers kept apart on dev (#198), "reader" instead of "sandip" (#181), the move (#199), prod on reader keys (#200). The key design is in `docs/architecture.md` section 5: `R#<readerId>#` in front of every partition key and index partition, sort keys and ids unchanged.

1. The key design: the reader leads every partition key and index partition (31 key builders, 4 indexes, about 10 fixed partitions), and a sender's id per reader. Written into `docs/architecture.md` first.
2. Issues and reading state on the new keys, behind a switch (the repository and ingest's store).
3. Senders and ranking on the new keys.
4. Stories, events, takes and timelines on the new keys.
5. Follow, predictions, highlights, the digest and the day in brief on the new keys.
6. The corpus per reader.
7. The move: a script copies Sandip's items to Sandip's keys and checks the counts, on dev first, then on prod (Sandip runs it); the switch flips; old items are deleted a week later. S3 objects stay where they are (each item keeps its S3 key); new mail goes under the reader's prefix.

Done when: two readers on dev see only their own data in every screen, search and answer, the isolation tests pass in the Deploy, and prod runs on the new keys with Sandip's data whole.

**Built so far:** keys bound to a reader (#195, PR 201), the API's repository (#196, PR 202) and ingest's store (#197, PR 203) on them. **Dev on reader keys** (#198): `READER_KEYS` is on for dev. The integration tests read and write as the reader `int-test` (`INT_READER`, `devKeys` and `devStore` in `scripts/dev-stack.ts`), the API's `sub` in their calls and dev's owner, which wiping the table names again; and a second reader, `int-test-other`, finds an empty library, gets 404 for the first reader's issue and newsletter by id, finds none of their newsletters in search, and keeps settings apart. **"reader", not "sandip"** (#181): a move the reader makes is stored as `"reader"` (`READER_MOVE`); `byReader` reads both, so moves stored before say `"sandip"` and still win, and the move rewrites them as it copies. With dev on reader keys, the Deploy's integration tests cover the keyed path; prod's path (switch off) is covered by unit tests until prod turns on.

### 14. Daily work per reader, metered (5)

1. The daily jobs (the day in brief, the top 5, settling predictions, follow checks, archiving old News, tune-up, audit) run per reader at the reader's local time, from an hourly schedule through a queue.
2. Every Claude, Titan and Jev call recorded per reader with its cost.
3. Daily limits on Ask, Takes, Timeline and Source, with a plain message when one is reached; a throttle per reader.
4. Per-reader health: an operator view across readers (and, once mail in exists, a note to a reader whose mail stops).
5. A load test: 50 synthetic readers on dev, their issues seeded, for a day; cost per reader measured.

Done when: the 50 readers' jobs run on time within their limits, and the cost per reader is known from the meter, not estimated.

### 15. Sign-up by email (6)

1. **Mail from `sandip.dev` through SES.** The domain verified in SES (DKIM records in `sandip.dev`'s DNS); Cognito sends its mail through SES, which sign-in codes need; SES production access, so codes reach any address.
2. **Sign-up and sign-in by email code.** Cognito's passwordless sign-in with a one-time code by email (the pool already has the Essentials plan it needs), in the managed login. Email codes do not work while MFA is required, so the pool's MFA moves to optional. Sandip keeps password and authenticator: Cognito does not offer the email code to an account with MFA on.
3. **The operator group**, for Status and the ops pages; readers see only their own.
4. **Onboarding:** time zone (detected), interests, and a "connect your mail" step that says it is coming, until mail in is built.
5. **Export and delete account.** Everything a reader has, as Markdown and JSON, highlights included; deletion removes every item, every S3 object and the Cognito user.
6. **Highlights back for every reader** (the reader, the Highlights page, the Markdown export; no Obsidian script), and the sign-up switch: closed, by invitation, or open.

Done when: a test reader on dev signs up with only an email address, signs in with the code, sets a time zone and interests, exports and deletes the account leaving nothing behind, and Sandip's sign-in is unchanged.

**A link instead of a code.** Cognito has no built-in sign-in link: it needs a custom sign-in flow (three Lambda triggers) and care of its own: one use, a short expiry, a link opened on another device than the one asking. About 2 more pull requests. The code comes first; the link is added if Sandip wants it.

## Later, when Sandip says

### Mail in (about 6)

Decided when it is next. Both ways share the processing per reader from a queue, with limits on size and messages a day.

- **A forwarding address.** SES receives mail on a `sandip.dev` subdomain (an MX record in its DNS); each reader gets a private address and forwards from Gmail or Outlook, or subscribes with it. Gmail's forwarding confirmation code is shown in the app (`docs/features/account-mail.md`). No review by Google; no past mail, only what arrives from then on.
- **Reading the reader's Gmail.** "Connect Gmail" in the app, a token per reader, ingest per reader on a schedule; the past four weeks can be read on day one. `gmail.readonly` is a restricted scope: up to 100 readers while the app is unverified, and a public launch needs Google's verification and a yearly independent security assessment (`docs/features/analytics.md`).

Either way, Sandip's mail moves to the same path and the Gmail poller with Sandip's labels retires.

### Google sign-in (about 2)

Google as a sign-in provider in Cognito, from an OAuth client in Google Cloud (Sandip's to create), and a reader who signed up by email able to add Google. Signing in with Google asks only for the reader's name and email, so it needs none of Gmail's review.

### Ready to launch (about 4, plus Sandip's part)

1. Privacy policy, terms and about for a public service; retention; consent for anything optional (India's DPDP Act first, GDPR if Europe).
2. Abuse: sign-up rate limits, bot protection on sign-up, inbound spam.
3. Errors and costs watched: error tracking, a cost dashboard per reader, the budget alarm for many readers (`docs/features/analytics.md` section 7.2 has the tools).
4. A landing page at `sandip.dev/nutgraf`; crawlers allowed on it, never on the app ([issue 7](https://github.com/devsandip/the-library/issues/7)).

Done when: a launch checklist is green and sign-up opens with one switch.

## Only Sandip can do

- **Milestone 13:** run the prod move (a prod data job, from the laptop like `pnpm reprocess`).
- **Milestone 15:** add SES's DKIM records to `sandip.dev`'s DNS, and ask AWS for SES production access in the console (it usually takes a day).
- **Mail in:** an MX record for the subdomain, or the Google Cloud setup and verification for Gmail; and the Gmail filter or connection for Sandip's own mail.
- **Google sign-in:** the OAuth client in Google Cloud.
- **Launch:** approve the privacy policy, terms and about.

## Decisions still open

1. **Code or link** for signing in (milestone 15): code first is recommended.
2. **Mail in:** a forwarding address or reading Gmail, when it is next.
3. **Jev.** It sends story text to TypeSafe, outside AWS. Keep it with an agreement and a line in the privacy policy, or move News and Learning to a Bedrock model. Before launch.
4. **The price.** Free, free with limits, or paid. The meter and limits are in milestone 14 and the sign-up switch in 15; taking payment (Stripe) is its own milestone after launch.

## After launch, not in this plan

- **Shared work across readers:** many readers get the same edition of a popular newsletter. Its summary and stories could be made once and shared (each reader's copy, links and state stay their own). The biggest lever on cost per reader.
- Nutgraf's own domain, payment, native apps, languages other than English.
- Milestone 10 (highlights to Obsidian) stays paused; highlights return for every reader in milestone 15, and the Obsidian script (#169) stays out of the product.
