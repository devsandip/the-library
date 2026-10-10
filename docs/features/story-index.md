# Story index (#15)

Groundwork for #16 to #23: the narrative (#18), "how this evolved" (#19), related stories (#20, second version) and "your sources" (#17). Nothing new to read in the app yet; `/status` shows each run's line.

## What it does

- **Split.** Claude (Haiku 4.5, the classification model) reads the whole issue, up to 60,000 characters, and calls `record_stories` with every story in it: a headline (at most 12 words), a summary (one or two sentences, at most 45 words), the names the story is about (companies, people, products, organisations; at most 6) and the number of its own source link. A digest gives 7 to 17 stories, an essay one. Sponsor slots and the newsletter's housekeeping are left out.
- **Links.** The input comes from the stored HTML with each outside link marked `[n]` after its text (`storyText` in `packages/core/src/extract.ts`). Claude answers with a number and the code looks the URL up, so a story's link is always a real link from the issue. Tracking redirects (TLDR, WSJ) are kept as they are. Issues whose HTML has expired (a year) fall back to the stored text, without links.
- **Embed.** Titan V2 embeds each story's headline, summary and names. The newsletter's name is left out so stories match on what they say.
- **Link stories into events.** In arrival order, a story joins the event of the most similar story from another issue received within 3 days, if their cosine is at least 0.80, or at least 0.60 and they share a name. Otherwise it starts an event, whose id is the story's own key (`<issueId>#<nn>`). There is no merging: a story that fits two events joins the closer one.
- **Store.** `ISSUE#<id>` / `STORY#<nn>` items, which also sit in `gsi1` under `STORIES` (sort key `<receivedAt>#<id>#<nn>`), so any time window is one query. The issue's META item gets `storiedAt` and `storyCount`.
- **When.** After enrichment on every scheduled run, for the last 14 days (it needs the promo flag). `pnpm stories --days 30` does the backlog, `--force` redoes issues after a prompt change, and `--relink` recomputes every event link without calling a model.

## Decisions

- **Every issue gets a call, not only digests.** Essays name the companies and people that linking leans on, and picking out digests first would mean classifying everything again. Measured on 5 prod issues (2026-10-10): about 0.7 cents per issue, so about $3 for the 4-week backlog and about $3 a month.
- **A separate call from classification,** as #15 planned: classification reads the first 6,000 characters for 300 tokens out; this reads the whole issue for up to 4,000.
- **URLs never pass through the model.** Numbered links cost fewer tokens and cannot be misspelled.
- **Promos and muted newsletters get no stories:** they hold nothing worth following, and every feature built on stories leaves them out anyway.
- **A failed split counts against the issue** (`storyAttempts`, `storyError`). After three failures the issue is skipped, since each try costs a call; `--force` still retries it.
- **`gsi1` gets a `STORIES` partition instead of a new index.** No infrastructure change, and the readers to come (#18, #19) want time windows. Story items carry their vectors into the index on purpose: linking reads a window of stories with their vectors in one query.
- **No per-event index yet.** Readers take a window and group by `eventId`. Add one when a feature needs every story of an event regardless of time.

## Probe (2026-10-10, five prod issues, $0.037)

TLDR IT: 12 stories, sponsor left out. WSJ What's News: 7. The Ken: 17. Pirate Wires Daily: 7. Lenny's Newsletter (one essay): 1.

## Open

- Calibrate the two linking thresholds on prod pairs once the backlog has stories, then `pnpm stories --relink`.
- Switch to Haiku 5.5 when the account gets access (about 75% cheaper).
- Brute-force similarity over a 3-day window stays cheap for years at this volume; a vector index (S3 Vectors) only if a feature needs to search all stories at once.
