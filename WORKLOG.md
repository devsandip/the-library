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
