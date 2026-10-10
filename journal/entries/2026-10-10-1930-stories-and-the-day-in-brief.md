# Stories, and the day in brief

2026-10-10 19:30. Previous: [2026-10-10-1929-reader-live-on-phone-and-mac.md](2026-10-10-1929-reader-live-on-phone-and-mac.md)

## What happened

The unit changed from the issue to the story. A digest like TLDR holds a dozen stories, and matching whole issues blurs them together.

- **The story index (#15, PRs #37 and #38).** Claude reads each whole issue and lists its stories: a headline, a short summary, the people, companies and products named, and the story's own link. Titan embeds each story, and stories about the same event are linked across newsletters. The backlog came to 357 issues, 2,210 stories and $2.25. Claude checked the linking against real pairs: from a cosine of 0.70 up, every sampled pair was the same event, and looser cutoffs chained two weeks of coverage of Meta's Muse into one event. With the final cutoffs, 64 events are covered by more than one newsletter.
- **The day in brief (#18, PR #39).** After each scheduled run, if enough news has arrived, one Claude call writes the last day's news as three to six short threads, each naming the newsletters it came from. In a dry run the first prompt joined unrelated stories under one title; the shipped one keeps each thread to one development. On the phone it is a card at the top of the Summary that folds shut. On the Mac it fills the empty reading pane. The first one on prod had 6 threads from 39 stories.
- **A new idea for the backlog (#41).** One tap on a story shows Claude's summary in place; a double tap opens it.

## Where we are now

Every issue is split into stories, and the Summary opens with a written briefing. Monthly AWS spend goes from about $1.50 to about $5.50: about $3 for stories, about $1 for the brief. The planned budget alert moves from $2 to $8.

## Decisions

- Every issue gets a story split, not only digests: essays name the people and companies linking needs. About $3 a month.
- Links are numbered in Claude's input and it answers with a number, so URLs never pass through the model.
- Event links need a cosine of 0.70, or 0.55 with a shared name, read off prod pairs.
- The brief is written on the schedule, at most every 6 hours and only when 5 stories are new: the API times out too soon to write it on open, and every run would mean 12 a day.
- On a wide Mac the brief fills the empty reading pane, so the list keeps the top 5 in view.
- Budget alert plan: $8 (#6).

## Direction changes

- The unit of news: was the issue, now the story inside it.
- Planned monthly spend: was about $1.50 to $1.80, now about $5.40 to $5.80.
- The budget alert: was planned at $2, now $8.

## Needs revisit

- The brief on a weekday, with about 90 news stories: threads and cost (`docs/features/narrative.md`, Open).
- What "story" means in #41: a row in the lists, or one story inside a digest (open question in #41).
- The decision-model bake-off needs my call (#27).
- Haiku 5.5 when the account gets access, about 75% cheaper (`docs/features/story-index.md`, Open).
