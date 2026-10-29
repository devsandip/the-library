# Built for one reader: an audit (2026-10-29)

Sandip, 2026-10-29: Nutgraf is an app for general use by any reader, not only Sandip; the Obsidian vault is just Sandip's own setup. This audit lists what was built for one reader, from `main` at 32c39c5. It changes nothing; it is the input for that decision.

**The short answer:** single-user is not a few stray choices. It is the PRD's founding decision ("A private, single-user web reader that ingests my newsletters", `docs/prd.md:19`; "One user: me", `:41`), and the data, the API, mail in, the prompts and the operations all follow it. Today no one else can sign in.

Highlights were taken out of the live app first (#174, PR 175). Highlighting itself (select, keep, note, the Highlights page, Markdown export) works the same for anyone; the personal part was the Obsidian script (#169, PR 173, now a draft on hold).

## Blocks other readers

Another person cannot use the app, or would see someone else's data, until these change.

| Area | What was built | Where |
| --- | --- | --- |
| Sign-in | One Cognito account, no sign-up; `create-user.sh` refuses a second account. | `infra/lib/auth.ts:22,38`, `scripts/create-user.sh:27-31` |
| Who is calling | The API checks the token is valid, then drops the claims; no route or repository call knows the reader. | `services/api/src/handler.ts`, `infra/lib/library-stack.ts:76-78` |
| The data | No key has an owner: issues, senders, Continue (`STATE/NOW_READING`), the day's top 5 (`DIGEST#<day>`), Following, Predictions, interests, topics, every index partition (`INBOX`, `SAVED`, `HIGHLIGHTS`…), and S3's `raw/` and `html/`. A sender's id hashes only its address, so two readers of one newsletter would share its stars and mutes. | `packages/core/src/keys.ts`, `packages/core/src/sources.ts:156-165` |
| The shared story pool | Search, Related, Timeline, Takes, Ask, Follow and settling read every story in the table, and events link stories across all mail. A second reader's answers would quote the first reader's newsletters. | `docs/architecture.md:337,369,440,449` |
| Mail in | One Gmail token per stage, made on Sandip's Mac by `pnpm gmail:auth`; the query keeps only the two label ids from Sandip's mailbox and the senders listed in code. Another mailbox's labels have other ids, so its mail would be ignored. | `infra/lib/ingest.ts:25`, `scripts/gmail-auth.ts`, `packages/core/src/sources.ts:7-19` |
| Google's rules | `gmail.readonly` is a restricted scope: a public app needs Google's verification and a yearly independent security assessment. The app is unverified, for personal use, capped at 100 users. | `docs/features/analytics.md:139`, `README.md:91` |
| Onboarding | The four-week backfill, `pnpm topics --apply` (without it nothing is classified), reprocess, enrich and the rest run from a laptop with `AWS_PROFILE=admin`; a lapsed Gmail token is fixed by rerunning `gmail:auth`. | `README.md:41-48,106-120`, `services/ingest/src/enrich.ts:284` |
| Privacy and terms | The pages say "a private, single-user newsletter reader operated by Sandip Dev for personal use"; mail sits in Sandip's AWS account. | `web/public/privacy.html:83-90`, `about.html`, `terms.html`, `docs/prd.md:104` |

## Works, but as if every reader were Sandip

| Area | What was built | Where |
| --- | --- | --- |
| Time zone | Every "day" is India's (`Asia/Kolkata`, `+05:30`, no daylight saving): History, the day's top 5, Ask's dates, predictions coming due, the highlights filter, every date shown. Ingest runs 06:00-22:00 IST, so a reader in New York gets nothing from about 12:30 to 20:30; predictions settle at 07:30 IST. | `packages/core/src/days.ts:8-10`, `web/src/format.ts`, `infra/lib/ingest.ts:73-77`, `infra/lib/api.ts:86-92` |
| Who the reader is | Every Claude prompt says "The reader is a senior product manager interested in the tech industry, startups, AI, product management and system design" (enrich, stories, narrative, predictions, Ask, timeline, takes, source, settle, Jev). | `packages/core/src/claude.ts:19-21` |
| Ranking | Sandip's five interests seed everyone's taste; "Close to your interest in …" names them. | `packages/core/src/rank.ts:26` |
| News and Learning | Learning means Sandip's craft (product, system design, AI, startups), checked by Jev against 59 of Sandip's own labels; the topic list was drawn from Sandip's issues and has no editor. | `services/ingest/src/jev.ts:84-101`, `docs/features/story-shelves.md`, `services/ingest/src/enrich.ts:116-119` |
| One of everything | One day in brief for all, one Follow cap of 20, one daily budget for settling predictions; "no em-dashes" is "Sandip's house style". | `docs/features/narrative.md`, `docs/features/follow.md`, `services/api/src/settle.ts:23` |
| Jev | Story text goes to TypeSafe's API on Sandip's key, outside AWS, which the PRD's privacy line does not allow for. | `docs/features/story-shelves.md:53`, `docs/prd.md:104` |
| Costs and limits | Sized for one reader (under $2 a month, an $8 budget alarm); Ask, Timeline, Takes and Source call Claude with no per-reader limit, behind one shared API throttle. | `docs/prd.md:103`, `docs/architecture.md:451,480`, `infra/lib/api.ts:109` |
| Language | Account-mail rules, the search stemmer and the prediction screen are English only. | `docs/features/account-mail.md`, `search.md`, `predictions.md` |
| Devices | Designed for an iPhone and a Mac: SF Pro and New York, ⌘K and Mac keys. The icon is drawn from SF Pro, whose licence was flagged for this day. | `docs/architecture.md:264,271`, `docs/features/redesign.md:49` |
| Highlights | Vault notes from a laptop script; Markdown escaped for Obsidian. | `docs/features/highlights.md` |

## Hosting, branding and the operator

- The app lives at `sandip.dev/nutgraf` through the sandip.dev Amplify app. Its refresh token sits in `localStorage` on the `sandip.dev` origin, so any script on sandip.dev could read every reader's token (`docs/architecture.md:149`).
- The sign-in page's domain is `thelibrary-sandip` (`infra/lib/config.ts:12`); the invite email and Google's consent screen point at sandip.dev; alarms email Sandip (`config.ts:38`), and a reader whose Gmail lapses is never told.
- The Status page's "check now" runs ingest for everyone: the owner and the reader are the same person.
- "The reader moved it" is stored as `"sandip"` (`setBy`, `shelfSetBy`).
- The docs are written as Sandip ("my newsletters", "my research lives in Obsidian").

## Two ways to open it

**A. One copy per reader.** Deploy a separate stack for each reader. Data, the story pool and the shared state are separate for free. Still needed: settings for time zone, interests, what Learning means, topics and newsletter sources; connecting Gmail from the app instead of a laptop; onboarding jobs that run on their own. Each copy costs its own fixed AWS spend and is deployed by hand. Fits a few invited readers; the 100-user Gmail cap does not bite.

**B. One app for many readers.** The reader's id in every key, index and S3 path, read from the token by every route; Sandip's data moved under Sandip's own id; sign-up; an ingest run per reader; per-reader limits and costs; its own domain; a privacy policy with deletion. For mail, a forwarding address per reader (SES inbound) avoids Gmail's restricted-scope review entirely, at the cost of each reader setting up forwarding. This is a rebuild of the data layer.

**Either way, first:** update the PRD to say who Nutgraf is for, and turn Sandip's own choices (time zone, the reader line in the prompts, interests, Learning, topics, sources) into settings per reader. That work is the same on both paths.
