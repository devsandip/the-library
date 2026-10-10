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
