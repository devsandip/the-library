# Worklog

Append-only session log. Newest entry at the bottom.

## 2026-10-10: Clean list look, sender and topic filters, Summary page with live ranking

**Did:**

- Built the Clean list look (#12, direction B) on every page, with the sender picker (#9), topic chips (#10), the Summary page (#11) and Claude's summary under the headline on the Mac (#14).
- Wrote the ranking math (`packages/core/src/rank.ts`, P2.2) and used it at read time for `GET /summary`. Added `GET /unread-counts` and several values for `sender` and `topic` on `GET /issues`. Enrichment now stores the five interest embeddings (`CONFIG/INTERESTS`).
- Deployed the API to dev. 144 unit tests and 15 API integration tests pass; lint and typecheck clean. Checked mock mode in the browser at phone and Mac widths, light and dark.
- Filed backlog #13 to #29 (swipe, Mac summary, context and agentic features, a decision-model bake-off, narrated and AI-anchor video). Saved the AI news video research to Obsidian and Notion.

**State now:**

- All of it is uncommitted on `main`, on top of 562ff0e, together with the 2026-10-09 Haiku 5.5 price fix in `docs/architecture.md` and `services/ingest/src/bedrock.ts`.
- Dev runs the new API. Prod does not: the SSO session expired before the prod deploy.
- Prod has no `CONFIG/INTERESTS` item yet. The first scheduled enrichment after the prod deploy writes it; until then the Summary ranks by sender and freshness only.

**Next:**

- Once Sandip has run `aws sso login --profile admin`: `eval "$(aws configure export-credentials --profile admin --format env)" && AWS_REGION=us-east-1 pnpm run deploy`, then `pnpm check-hosting`. Ask Sandip to try Home, the sender picker, topic chips and `/summary` on iPhone and Mac, and whether to commit. Close #9, #10, #11, #12 and #14 once accepted. Then build #13 (swipe to rate).

**Decisions:**

- Sandip picked Clean list (direction B).
- The Unread/All/Archived switch and the check-Gmail button sit in a small bar above the list; Sign out moved to Status; the Senders page is reached from the picker and from Status.
- Switching News/Learning clears the topic chips and keeps picked senders. Every number is an unread count, worked out on the client from one tally (`web/src/counts.ts`).
- Ranking: the topic part is z-scored, then mapped to 0..1 with the normal CDF so the three parts share a scale. Beta draws are exact for whole numbers; the seed is the IST day plus the sender; candidates are unread News from the last 14 days; nothing is stored.
- Topic names cannot contain commas, because the API takes several as one comma-separated value; `parseTopics` rejects them.
- Fonts are self-hosted from `@fontsource-variable` packages, so no CSP change.
- CDK cannot resolve the account from `AWS_PROFILE=admin`; deploys export the SSO credentials into the command's environment instead.

## 2026-10-10: New look shipped, swipe, related issues, digest log, icon, story index

**Did:**

- Merged and deployed to prod, each with `pnpm check-hosting` passing: the new look (#30), honest Summary reasons with at most three per newsletter (#31), swipe to rate on the phone (#32), related issues while reading (#33), the digest log, yellow box and success measure (#34), the app icon and favicon (#35), and folding Topics and Senders in the Mac sidebar (#36).
- Built the story index (#15, PR #37): Claude splits each issue into stories with names and source links, Titan embeds them, and stories about one event are linked across newsletters. Ran the backlog on prod: 357 issues, 2,210 stories, $2.25, no errors.
- Calibrated the event links on prod pairs: 0.70 alone, 0.55 with a shared name (`docs/features/story-index.md`).
- Stored the five interests on prod, activated the `project` cost-allocation tag (#6), and noted on #6 that the budget alert should be $6.

**State now:**

- Prod runs everything above. The scheduled run now classifies, then splits new issues into stories, inside its time budget. `/status` shows a Stories line.
- Not yet tried by Sandip on a real iPhone: swipe, the icon on the home screen, the yellow box.
- Nothing reads stories yet; they are groundwork for #16 to #23.

**Next:**

- #18, today's news as a narrative: one Claude call over today's News stories grouped by `eventId`, stored per day, shown collapsible at the top of the Summary. Generate it in the ingest Lambda (the API Lambda times out at 15 seconds).
- Then #20's second version (related stories inside a digest) and #19 (how a story evolved).
- Around 2026-10-16: create the AWS Budget (#6) at $6 once a week of tagged costs exists.

**Decisions:**

- Every issue gets a story split, not only digests: essays name the people and companies linking needs. About $3 a month.
- Links are numbered in Claude's input and it answers with a number, so URLs never pass through the model.
- Stories live in `gsi1` under `STORIES` instead of a new index; no infra change.
- Event linking has no merging and compares names exactly; `pnpm stories --relink` recomputes all links for free after a threshold change.
- Sandip picked icon option 1, the typewriter L in the yellow box.

## 2026-10-10: The day in brief

**Did:**

- Built the day in brief (#18, PR #39): after the story index on each scheduled run, one Haiku call writes the last day's News stories, merged by event, as 3 to 6 threads with the issues they came from.
- Probed it on prod data first. The first prompt joined unrelated stories under one title; the shipped one keeps each thread to one development. Em-dashes become commas.
- Deployed to prod and wrote the first version with `pnpm narrative --force`: 6 threads from 39 News stories, $0.007. `GET /summary` returns it.

**State now:**

- On prod, a new version is written at most every 6 hours, once 5 News stories are new to it: about $1 a month. The planned budget alert (#6) is now $8.
- It shows above the Summary's list in a card that folds shut, and in the Mac's empty reading pane. Sandip has not seen it on a device yet.

**Next:**

- After a weekday (about 90 News stories), read the threads and check the cost in the CloudWatch logs (`narrative done`).
- Then #20's second version (related stories inside a digest, from the story index) or #19 (how a story evolved).

**Decisions:**

- Written on the schedule, not when the Summary opens: the API Lambda times out at 15 seconds.
- On a wide Mac it fills the empty reading pane, so the list column keeps the top 5 in view.

## 2026-10-10: Read history, four backlog items, the journal

**Did:**

- Filed #41 (tap for a summary, double tap to open), #42 (read history), #43 (Save for later) and #44 (Now reading). Read history got a new `priority` label, as Sandip asked.
- Built read history (#42, PR #45): `GET /history?day=` and a History page that pages by day, skipping empty days. Open events are indexed by time in `gsi1` under `OPENS`; `pnpm history-backfill` indexed the 18 opens logged before, so history starts on 2026-10-09.
- Deployed to prod; `pnpm check-hosting` passes. Prod returns 9 issues for 2026-10-10 and 7 for 2026-10-09.
- Bootstrapped the journal (`journal/INDEX.md` and four entries). It is not committed: the journal skill asks for Sandip's review first.

**State now:**

- Prod has everything through PR #45.
- The journal waits in the session worktree (`.claude/worktrees/open-backlog-items-7dd3ce/journal/`) for Sandip's review.

**Next:**

- Commit the journal once Sandip has read it.
- Then Save for later (#43) or Now reading (#44). Each has open questions in its issue.

**Decisions:**

- Read history indexes the open events that already exist rather than keeping a separate history. One row per issue per day, at its latest open.
- The reader-day helpers moved to `@library/core/days`, shared by the API and the web app.

## 2026-10-10: Now reading, Save for later, tap for a summary

**Did:**

- Committed the journal as Sandip approved it (PR #47). Checked the first scheduled run with the brief step (20:00 IST): clean, the brief skipped as designed ("written recently"), one story split failed on a Substack verification code.
- Built, merged and deployed three backlog items, each with `pnpm check-hosting` passing: Now reading (#44, PR #48), Save for later (#43, PR #49) and a tap for a summary (#41, PR #51).
- Filed #50 at Sandip's request: keep account mail (verification codes, sign-in links) out of the list. The code arrived from ByteByteGo's own address, so the sender allowlist let it in.
- Wrote the journal entry for the evening and refreshed `journal/INDEX.md`.

**State now:**

- Prod runs everything through 4f7e7a7. `pnpm test` 212, `pnpm test:int` 41 on dev, typecheck and lint clean (prettier only flags the app's own `.claude/settings.local.json`).
- Prod has no `STATE/NOW_READING` item and no saved issues yet; the first issue Sandip opens fills Now reading.
- Not tried on a real iPhone: Now reading from the Mac to the phone, the bookmarks, the Saved page, and the single tap that now peeks.
- Sandip's main checkout is 4 commits behind `origin/main`, with no local changes. The old worktree `open-backlog-items-7dd3ce` still holds an untracked copy of the journal, now redundant.

**Next:**

- Ask Sandip how the three features feel on the iPhone, starting with the single tap, which changed from open to peek.
- Then #50: an `account` noise rule beside `receipt` in `packages/core/src/sources.ts` (verification and login codes, sign-in links, email confirmations, password resets), a fixture test, deploy, and `pnpm reprocess` to filter item `1a1261e7cc130a34`.
- Monday 2026-10-12: the weekly journal summary for 2026-W41, and read a weekday's day in brief and its cost (`narrative done` in the ingest logs).

**Decisions:**

- Now reading: one `STATE/NOW_READING` item; the place is the share of the newsletter above the top of the screen, saved at most every 5 seconds and as the page goes away (`keepalive`). A place saved in an older window moves Now reading back to that issue. Rating after opening, archiving or finishing hides it.
- Save for later: saved issues move from `UNREAD` to a `SAVED` partition of `gsi2`, so Unread, the counts, the Summary and the 7-day rule leave them out unchanged; `autoArchive` skips them outright. Archiving unsaves; an archived issue cannot be saved. On the phone, Save sits at the top of the issue page because the bottom bar is full.
- Tap for a summary: `GET /issues/{id}/stories` from the story index, no new Claude call. A 250 ms double-tap window; Enter opens, Space peeks. The reading pane keeps its click, and the Must Read row's lead cards open on a tap.

## 2026-10-11: Account mail and search live, the peek fix, and a pipeline

**Did:**

- Merged #54 (account mail, #50) and #55 (search, #53) on Sandip's word, deployed main (934c6d2) to prod by hand, the last laptop deploy: hosting checks pass. `pnpm reprocess` filed exactly the stored verification code (`1a1261e7cc130a34`, now 404). Search checked against prod ("kafka" by words and meaning, "AI assistants that arrange vacations" by meaning).
- Filed #56 at Sandip's request (history should hold what I read): the five digests peeked at on 2026-10-10 21:30 to 21:40 IST were missing from history and still unread. Fixed in PR #57: a peek left open 2 s logs a `peek` event (indexed under `OPENS`, like an open) and marks the issue read; Now reading is untouched; history rows say "Read". 45 of 45 integration tests on dev.
- Explained to Sandip why main, prod and the main checkout drifted (no CI, prod deployed from the worktree, the main checkout outside the flow, rebase merges rewriting commits) and built the pipeline Sandip approved, PR #58: CI on every pull request; Deploy on every push to main (CI, dev and `pnpm test:int`, prod and `pnpm check-hosting`); the `TheLibrary-ci` stack with the role `TheLibrary-github-deploy` (deployed); `pnpm sync-main`; a repo `CLAUDE.md` with the shipping rules.
- On GitHub: environments `dev` and `prod`, deployable only from `main`; variable `AWS_ROLE_ARN`; squash merges only, merged branches deleted. The repository was already private.

**State now:**

- Prod runs main at 934c6d2. Open and waiting for Sandip to merge: #57 (peek fix), #58 (pipeline), and this worklog's pull request. Auto mode refused my merge of #57 as self-approval.
- #58's CI passed on GitHub (`check`, 70 s). The Deploy workflow has never run: only main can use the environments, so its first run is the first real test of the role.
- Main's branch protection is not on yet, on purpose: #57 predates CI and would need an update and a fresh run before it could merge.
- Sandip's main checkout is at 934c6d2, even with `origin/main`.

**Next:**

- Once #58 and #57 are merged (that order is best: a pipeline problem then shows without an app change riding on it): check the Deploy runs with `gh run list --workflow Deploy`; if a step lacks permissions, widen `infra/lib/ci-stack.ts` in a pull request and `pnpm cdk deploy -c stage=ci` by hand.
- Turn on main's branch protection: required check `check` (GitHub Actions), pull requests only, admins included, linear history, no force pushes or deletion (the command is in the resume).
- After #57 is deployed: put the five peeks from 2026-10-10 into history and mark them read (ids and times in the resume), then `pnpm sync-main`.
- Monday 2026-10-12: the weekly journal summary for 2026-W41.

**Decisions:**

- A peek left open 2 s counts as reading the issue; one folded away sooner was a glance.
- Prod deploys only from main through GitHub Actions; dev and the integration tests gate prod; one branch per change from a fresh main; squash merges. `pnpm run deploy` is the fallback when GitHub Actions is down.
- The deploy role trusts the GitHub environments, not branches, and the environments allow only main. The role's stack is deployed by hand, but CDK's bootstrap roles can change anything, so main's protection is the real gate.
- Third-party actions are pinned to commit SHAs, since the deploy jobs hold AWS credentials.

## 2026-10-11: The pipeline's first runs

**Did:**

- Found #57, #58 and #59 still open after Sandip's merge (GitHub had no merge on record), and merged them once Sandip switched off auto mode. Turned on main's branch protection: the `check` job from GitHub Actions required, pull requests only, admins included, linear history, no force pushes or deletion. `pnpm sync-main` moved the main checkout from 934c6d2 to 774afeb, then to 0f2597e.
- The first Deploy run failed before touching AWS: GitHub could not assume `TheLibrary-github-deploy`. This repository has GitHub's immutable subjects on, so its tokens say `repo:devsandip@19489947/the-library@1411266741:environment:dev`, and the role expected the name-only form; CloudTrail's refused `AssumeRoleWithWebIdentity` calls showed the real subject. Cancelled #57's queued run, fixed the trust policy in PR #60 (the first pull request through the protected main: blocked until its `check` passed), and deployed `TheLibrary-ci` from main by hand.
- The next run, from main at 0f2597e (#58, #57, #60), passed end to end in about 5 minutes: CI 69 s, dev 102 s (deploy, then 45 of 45 integration tests), prod 121 s (deploy, then every hosting check). Prod answers peek events.
- Put the five peeks from 2026-10-10 into prod's history, at the times in the API's request log, and marked the five issues read. History for 2026-10-10 lists 16 issues.

**State now:**

- Prod runs main at 0f2597e, deployed by the pipeline; nothing deploys prod by hand any more. #56 is closed.
- Every change now goes through a pull request whose `check` passes. Merging deploys within about 5 to 10 minutes; docs-only pushes skip the deploy.
- Sandip's main checkout is even with main.

**Next:**

- Monday 2026-10-12: the weekly journal summary for 2026-W41 (the entries from 2026-10-10 and 2026-10-11).
- Then #20's second version (related stories inside a digest), then #19 (how a story evolved).
- Still open from search: the result count wrapping at 375 px. The first search after a cold start took 3.3 s (2.8 s reading the corpus); the ones after it 40 to 210 ms.

**Decisions:**

- The deploy role trusts GitHub's immutable subject (owner and repository IDs), not the name-only one, so a renamed or recreated repository cannot match.
- The role's stack stays a hand deploy, from main, after `cdk diff -c stage=ci`.
