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

## 2026-10-11: Related stories inside a digest (#20, second version)

**Did:**

- Calibrated story-to-story similarity on prod's 2,264 stories (read-only dump, `scratch/related2-*`, gitignored): house style barely shows (0.10 within a newsletter, 0.07 across), so no centring; pairs read by band set the cutoff at 0.45; same-newsletter pairs at 0.80 and up are reruns (The Ken, Fortune's Altman interview about ten times).
- Built it in PR #62: `closestStories` and `relatedStories` in `packages/core/src/related.ts`; `services/api/src/related.ts`; search's corpus cache moved to `services/api/src/corpus.ts` and shared; the Related component lists a digest's stories with up to three relatives each. Issues without embedded stories fall back to the first version.
- Tests: 332 unit (10 new); the branch deployed to dev, 46 integration tests (one new, with Titan embeddings). Mock UI checked at 375 px and in the Mac's reading pane.
- Merged #62 on Sandip's ship (auto mode off). Deploy run 38123331070 passed in 5.5 minutes; prod runs b00373b. Prod's answer for WSJ What's News of 2026-10-09 matched the offline run exactly; the API logged 2,978 ms cold (2,524 ms reading the corpus) and 163 ms warm.

**State now:**

- Related stories live on prod. Main at b00373b plus this docs pull request; the main checkout synced.
- `docs/features/related.md` holds the decisions and calibration; `docs/architecture.md` section 11 and the API table updated.

**Next:**

- Monday 2026-10-12: the weekly journal summary for 2026-W41 (entries from 2026-10-10 and 2026-10-11) before other work.
- Then #19 (how a story evolved). Start from `closestStories` in `packages/core/src/related.ts`: the FlyDubai thread in `docs/features/related.md` is the shape #19 wants, before any Claude call.
- Read a long digest's Related on the phone (TLDR Dev, The Ken) and decide whether it wants fewer stories or folding.

**Decisions:**

- Related matches stories at a raw cosine of 0.45, one relative per issue, up to three per digest story or three each side for a one-story issue.
- The same newsletter's story at 0.80 or more is a rerun and left out; another newsletter's near copy stays.
- Earlier and Since headings only once something arrived after the open issue.
- `RelatedResponse` keeps `earlier` and `since` and adds `stories`, so an old web build shows nothing for a digest instead of breaking.

## 2026-10-11: The UX redesign brief for Claude Design

**Did:**

- Built the brief for redesigning the UX on both devices with Claude Design, in two packs under `design-handoff/` in the worktree `ux-redesign-handoff-9f9bf3` (untracked). Both share `1-PRODUCT-OVERVIEW.md` (what the app is, vocabulary, built and planned, constraints, content sizes, lessons) and `2-PRODUCT-REQUIREMENTS.md` (185 user stories in 15 areas, 144 shipped, 40 planned, 1 parked, plus 26 business rules).
- The no-screens pack describes needs only, so the design doesn't anchor on today's UI. The with-screens pack adds `3-CURRENT-DESIGN-AND-SCREENS.md` and 123 screenshots from mock mode (phone, Mac light and dark, 1024 px, public pages), reduced to 256 colours to fit SendUserFile's 30 MiB limit.
- Kept the Playwright capture script in `design-handoff/capture-tool/`, so the same screens can be retaken after the redesign.
- Brought the docs up to date for #56 and #20, which shipped while the packs were being written; the zips were not rebuilt.
- Merged #63 (another session's journal) and #64 (this session's journal entry) on Sandip's ship. Labelled #19 `needs-decision`: does it wait for the redesign?

**State now:**

- Main at acd123d plus this pull request; prod unchanged at b00373b. No code changed.
- The packs exist only in the worktree. The zips predate the #56 and #20 updates.

**Next:**

- Decide where the packs live: commit the stories as `docs/user-stories.md` from a fresh `origin/main`, move the folders out of the repo, or both. Keep the screenshots out of git unless Sandip wants them.
- Sandip adds his own critique to both READMEs, then sends a pack to Claude Design.
- Monday 2026-10-12: the weekly journal summary for 2026-W41 before other work.

**Decisions:**

- Redesign from first principles, not a polish: one pack without screens so the design doesn't anchor, one with screens for reference.
- Interactions are named in the stories only where Sandip asked for them; a better pattern comes as a proposal, not a silent swap.
- Screenshots from mock mode, since Claude does not sign in for Sandip.

## 2026-10-11: The redesign, built from the Claude Design handoff (#66)

**Did:**

- Built the Claude Design handoff (`docs/mockups/redesign/README.md`, with its HTML as the visual reference) in PR #66:
  - the phone has four tabs (Today as a deck, Browse under the filter sentence, Saved, Library) and a reader with a story sheet;
  - the Mac is a keyboard console of queue, reader and story index, with a ⌘K palette;
  - new tokens, dark by default; self-hosted Newsreader, IBM Plex Sans and Mono, and Courier Prime; the yellow-box rule; the icon redrawn from Courier Prime's own L.
- Replaced `web/src/routes/` and most of `web/src/components/` with `web/src/phone/`, `web/src/mac/` and `web/src/pages/`. URLs are parsed in `web/src/paths.ts`, and old URLs redirect.
- Added three API fields: each story's `names`, the Summary's `digestAt`, and History's `via` (open or peek). The integration tests assert all three.
- 355 unit tests pass; typecheck and lint clean. Checked in mock mode at phone and Mac widths, light and dark: the deck's swipes, spring-back, fold and Undo; Browse's sheets, peek, and Back restoring rows; the reader and story sheet; the console's keys, palette and slide-over. The first story starts at 10 to 17% of the screen height.
- Merged #66 on Sandip's word; Deploy run 38127624439 passed. Wrote the journal entry (#67, merged) and the 2026-W41 weekly summary (this pull request).

**State now:**

- Prod runs e5f277c (#66). Main is at c8d14fa plus this docs pull request; the main checkout is synced.
- The redesign was tested in mock mode only. Nobody has used it on a real iPhone.
- Not built, by decision: the deep dives (Timeline, Backstory, Takes, Source), the job line, verdicts, Follow and Ask (#19, #16, #17, #23, #22, #21). `docs/features/redesign.md` has the reasons.
- The handoff download sits untracked at `claude-design/` in the main checkout. Its content is committed under `docs/mockups/redesign/`.

**Next:**

- Open the home-screen app on the iPhone and work through `docs/features/redesign.md`, Open: safe areas, pull to refresh inside the standalone app, the story sheet's drag between heights, VoiceOver, and the deck's swipes. File what breaks as issues.
- Monday 2026-10-12: read a weekday's day in brief and its cost (`narrative done` in the ingest logs).
- Then #19 (how a story evolved), the first deep dive, as the Timeline tab where the handoff draws it. Start from `closestStories` in `packages/core/src/related.ts`. Take #19's `needs-decision` label off first: the redesign it was waiting for has shipped.

**Decisions:**

- No controls for features without a backend. Each deep dive arrives with its issue, in the place the design gives it.
- One tap opens a card in Today's deck (the handoff's proposed alternative); Browse keeps tap to peek and double tap to open.
- Irrelevant always archives, from every place it appears.
- Rows read or saved stay in place, faded, until the view changes (RET-10).
- A newsletter wider than the column is scaled down with CSS `zoom`, so its layout survives.
- On the Mac, `/library` lands on the News queue; Library's pages open from ⌘K.

## 2026-10-12: Nutgraf: the Apple look, the folded page, and sandip.dev/nutgraf (#73 to #76)

**Did:**

- Built the second Claude Design handoff in #73. It kept every layout from #66 and changed three things:
  - the name is Nutgraf (the handoff spells it Nurgraf; Sandip confirmed Nutgraf, and the copy under `docs/mockups/redesign/` is corrected);
  - the look is Apple's: the tokens exactly as the handoff's "Backgrounds (exact)" table, SF Pro and New York from the system (the four `@fontsource` packages are removed), 11 px tabular labels, no blue;
  - the logo is the folded page. The icon SVGs are drawn from SF Pro's own `n`, so they need no font, and `pnpm icons` renders the PNGs into `web/public/icons/`. A web manifest is new, and a pinned theme also sets `theme-color`.
- #74: a tap on a row's title opens the issue; the rest of the row still peeks (Sandip asked for it).
- #75: moved the app to `/nutgraf/` (`BASE_PATH`, the API route, Cognito's URLs, the S3 prefix, Vite's base, the manifest). The CloudFront function answers every `/thelibrary/*` URL with a 301 to the same path and query parameters, and `infra/test/spa-function.test.ts` runs it against sample requests. Before merging, `pnpm amplify-proxy --apply` added the `/nutgraf/<*>` rule on sandip.dev (backup: `scratch/amplify-rules-backup-2026-10-12T04-03-51-247Z.json` in the main checkout).
- #75's Deploy (run 38202272444) deployed prod but failed 2 of 32 hosting checks that were too strict: Amplify adds the slash to a bare `/thelibrary` before our 301, and CloudFront reorders query parameters. #76 makes the check follow each old URL to where it ends.
- Deployed #75's branch to dev first; `pnpm test:int` passed (46). Unit tests: 360.
- Merged #73, #74, #75, #76 and #68 on Sandip's word.

**State now:**

- Prod runs 2f9acc3 (#76); Deploy run 38203184707 passed check, dev and prod, with every hosting check. Main is at c100f00 (#68) plus this docs pull request.
- Live at https://sandip.dev/nutgraf/, in the new look; every `/thelibrary` URL redirects there. Checked in mock mode and by following old URLs on prod. Nobody has used it on a real iPhone.
- Internal names keep "library": the repository, the stacks, the SSM paths, the Cognito domain and the storage keys.
- The about, privacy and terms pages still say The Library, as Google's consent screen does.
- #72 (one line in `docs/features/redesign.md`) is still open and needs updating from main.

**Next:**

- Sandip deletes the home-screen icon and adds it again from `https://sandip.dev/nutgraf/`, then does the real-iPhone pass against `docs/features/redesign.md`, Open. File what breaks as issues.
- Sandip, on Google's OAuth consent screen (Branding): point the home page, privacy and terms links at `/nutgraf/`, and rename the app to Nutgraf. Then rename the about, privacy and terms pages in `web/public/`.
- Read a weekday's day in brief and its cost (`narrative done` in the ingest logs), carried from last session.
- Then #19 (how a story evolved), as the Timeline tab, from `closestStories` in `packages/core/src/related.ts`.

**Decisions:**

- The name is Nutgraf, not the handoff's Nurgraf.
- Three pull requests in order: the look, the title tap, the address. The address waited because it touches the API, Cognito and sandip.dev's Amplify rules.
- The 301s come from the app's CloudFront function, not an Amplify redirect rule, so they live in the CDK code and are tested; Amplify proxies both paths.
- The manifest is `manifest.json`, not `.webmanifest`, so S3 serves it as JSON whatever the deployment's content-type table knows.
- Internal names keep "library": renaming stacks or SSM paths would rebuild resources for no visible gain.

## 2026-10-12: Addendum: the about pages, a flaky test, and TickTick without #

**Did:**

- #78: the about, privacy and terms pages say Nutgraf, after Sandip renamed the app on Google's OAuth consent screen and pointed its links at `/nutgraf/`. Its first Deploy run (38207008908) failed in dev on a flaky integration test; re-running the failed jobs passed check, dev and prod.
- #79 (open): that test, "archives week-old unread news except from Must Read newsletters", now waits for the GSIs to show its writes before running the rule, as the API and store tests already do. 8 of 8 pass against dev.
- A rule in `~/.claude/CLAUDE.md`: never write `#` in a TickTick task, because TickTick makes it a tag; titles say "PR 73". localyap PR 181 (merged) brought ryvl's protocol in line.
- TickTick: four Nutgraf tasks in the Inbox (update PR 72, tighten the CSP's `font-src`, the SF Pro licence, re-add the home-screen icon and do the iPhone pass). In ryvl, the review task for localyap PR 181, completed when it merged.

**State now:**

- Prod runs 37d5638 (#78), from the second attempt of Deploy run 38207008908.
- Open: #79 (the test fix) and #72 (needs an update from main).
- Google's consent screen is renamed and points at `/nutgraf/`.

**Next:**

- Ship #79.
- The four Nutgraf tasks in the TickTick Inbox, starting with the home-screen icon and the iPhone pass.

**Decisions:**

- A Deploy that fails on a flaky test gets its failed jobs re-run, never a deploy by hand; the test is fixed in its own pull request.
- No `#` in anything sent to TickTick.

## 2026-10-19: Jev for story shelves, work on a GitHub project, and thumbs instead of Relevant (#86 to #89)

**Did:**

- #86: all work is tracked on the GitHub project Nutgraf (project 10). `pnpm track <n> <status> [track]` sets a card's status (Backlog, Up next, In progress, In review, Waiting, Done) and track (Reading, Sorting, Stories, Briefings, Agentic, Ops).
- #81 settled: Learning means craft, the story is the unit, and Jev (TypeSafe's decision model) sorts. Jev was scored against Sandip's labels and he accepted the accuracy. #87 shipped the Jev client and the scoring script.
- #88 (open): Jev shelves every new story after ingest, and `pnpm shelves` runs the backfill. CI passes. It was updated from main after #89.
- #89 shipped: a thumbs up or down for whether an issue was useful replaces Relevant and Irrelevant. Swipes on Today only move between cards (back to the brief from the first). Thumbs down no longer archives. The phone's reader gets Archive for digests, rows stop swiping, and the Mac's keys are Y and N. Deploy run 39206115951 passed check, dev and prod.
- The rating numbers on prod, for the why: 12 ratings in ten days, none from 2026-10-13 to 2026-10-18, and 6 of the 29 digest issues rated Relevant with 23 never rated.

**State now:**

- Prod runs 8b8f643 (#89).
- Open: #88 (waits for ship) and this handoff's pull request.
- #81's step 4 waits on three answers from Sandip. Does reading a Learning story mark the story or its issue? Do Learning stories expire? Do thumbs rate the story or its issue? (That last one was about swipes until #89.)
- #85 (Haiku 5.5) is Waiting: the account has no access yet.

**Next:**

- Ship #88. After its deploy, run `AWS_PROFILE=admin pnpm shelves --days 60` and repeat until it reports 0 deferred (about 2,700 stories, about 5 cents). Then run `pnpm track 88 Done Stories`.
- Sandip tries the new deck and thumbs on his iPhone (#82).
- Around 2026-10-26, read Status's "X of Y useful" line to see whether the thumbs get used (#5).

**Decisions:**

- Thumbs mean useful or not useful. Relevant asked what the ranking already guesses. And a swipe both rated and cleared a card, so moving on meant judging.
- The stored rating stays `1` or `-1`, so past ratings keep training the ranking. Only `DigestStats` changed fields, to `useful` and `notUseful`.
- A thumb changes only the rating. Swipes only move. Later saves the issue and moves on.
- Story shelves use the field `shelf`, as issues do, rather than #81's `kind`. Each environment has its own Jev key, and dev has none.

## 2026-10-27 — Tidy git on main, open PR 92 for AGENTS.md, and CI billing blocker

**Did:**
- Reconciled local `main` with `origin/main` after discovering `b64c678` was committed locally without a branch or pull request.
- Created branch `agents-md`, cherry-picked `b64c678`, pushed to origin, and opened PR 92 ("Make AGENTS.md the canonical agent instructions").
- Added PR 92 to the Nutgraf project board as "In review", "Ops" via `pnpm track`.
- Ran local validation (typecheck passed, Prettier passed on AGENTS.md/CLAUDE.md, 2,220 unit tests passed). Discovered GitHub Actions failed immediately on account billing / spending limit.

**State now:**
- Local `main` is clean and tracks `origin/main`.
- PR 92 is open and waiting for review and CI.
- GitHub Actions CI is currently blocked across the repo due to GitHub account spending limit / failed payment.
- Six stale worktrees under `.claude/worktrees/` are causing root Vitest / ESLint to report errors due to missing dependencies in worktree paths.

**Next:**
- Update GitHub account billing/spending limit under GitHub Settings -> Billing & plans to unblock Actions runs.
- Re-run CI on PR 92, squash-merge, and run `pnpm sync-main`.
- Clean up old worktrees in `.claude/worktrees/` once branches are verified merged/pushed.

**Decisions:**
- Isolated `b64c678` into branch `agents-md` rather than pushing directly to `main`, maintaining the invariant that every change goes through a branch, PR, and CI.

## 2026-10-27: Learning lists stories, Ask Nutgraf and Takes, built overnight (#92 to #113)

Sandip asked me to build milestone by milestone through the night and make the calls myself.

**Did:**

- CI was blocked: GitHub would not start Actions jobs on the private repository ("recent account payments have failed or your spending limit needs to be increased"). After an audit (gitleaks over every commit and every pull request head found no secrets; the personal details are Sandip's email, the AWS account id in old Actions logs, and his reading list), Sandip made the repository public, which gives free Actions minutes. Then #93 shipped (`font-src` without `https:`, #83; none of the 150 newest issues used a web font) and #92 (AGENTS.md).
- A rule in `~/AGENTS.md`, for every project: build one GitHub milestone at a time, one issue per pull request, each with a done-when line.
- Milestone 1, [Learning lists stories (#81)](https://github.com/devsandip/the-library/milestone/1), closed: #94 (PR 99) stories carry the effective shelf and an issue's shelf follows its stories, with `pnpm shelves --derive` run on prod (560 issues, 428 unread Learning stories); #95 (PR 100) the API; #96 (PR 101) Learning lists stories on both devices; #97 (PR 102) the day in brief reads story shelves and Claude is no longer asked for a shelf. PR 105 and PR 111 fixed two integration tests that read GSIs before they caught up; each had stopped a Deploy in dev, and prod waited until the fix.
- Milestone 2, [Ask the Library (#21)](https://github.com/devsandip/the-library/milestone/2), archive only, closed: #103 (PR 106) `POST /ask`; #104 (PR 107) Ask Nutgraf on both devices (Library, Search for a question, ⌘K).
- Milestone 3, [Takes from your newsletters (#17, first layer)](https://github.com/devsandip/the-library/milestone/3): #108 (PR 110) the API; #109 (PR 112) the Takes tab, with Timeline and Takes now sharing one deep-dive store and panel.
- #98 (PR 113): a forced re-split keeps Sandip's story moves and read state.

**State now:**

- Prod runs d67f0f3 (#113, PR 113's Deploy), which carries #112. Three Deploys failed in dev tonight and none reached prod: the two GSI flakes above, both fixed, and PR 112's, where Bedrock answered "ServiceUnavailableException" to two Claude calls; the next Deploy passed.
- On prod, read-only through the API Lambda: Learning lists 428 unread stories; Ask answered in 11.6 s warm for 0.8¢ (30 stories, 5 paragraphs, 16 sources); Takes on an event six issues carried gave 4 newsletters in 2 groups in 8.3 s for 0.3¢.
- None of tonight's screens has been used on a real phone or Mac signed in; each was checked in mock mode on the phone (390 px) and the Mac, light and dark.
- The day in brief now draws News stories only; the next scheduled version is the first to show it.
- Haiku 5.5 is still not available on the account (#85, checked tonight).
- The main checkout has the entry above uncommitted in its `WORKLOG.md`; this pull request carries it, so the local copy can go (`git -C ~/Developer/the-library checkout WORKLOG.md`) before `pnpm sync-main`.

**Next:**

- Sandip tries Learning (Browse's Learning on the phone, 2 on the Mac): read a craft story from inside a TLDR digest and check the digest stays unread in News. Then Ask Nutgraf with a real question, and the Takes tab on a story several newsletters carried. File what is off as issues.
- Read tomorrow's day in brief for Learning stories that should not be there.
- The next milestone, my pick: #23 (check a story's claim against its source), which needs only public page fetches with size and time limits. The web layers of #16 and #17 need a search provider account, which is Sandip's call.

**Decisions:**

- The repository went public to get Actions minutes back, after the audit; Sandip agreed.
- #81's three questions, settled by the proposals on Sandip's word to use judgement: reading a Learning story marks the story, not its issue; Learning stories do not expire; Archive and the shelf move act on the story and thumbs rate the issue; no Save on stories, since unread Learning stays anyway.
- A visit that starts on a story never marks its issue read, so one craft essay does not mark a whole digest read.
- A newsletter's "always" setting is stamped on its stories, not applied where they are read, because listing and counting Learning needs the shelf in an index.
- Ask is two calls (plan the searches, then answer), not an agent loop, to stay inside the API's 28 seconds with no job; nothing is kept and the log has counts only.
- Takes answers in the request like the timeline: the event's stories, then stories within three days that read alike, one per newsletter.
- Every pull request tonight was merged by me on Sandip's standing word for the night.
