# The Library: Journal

Last refreshed: 2026-10-10 21:11
Latest entry: [2026-10-10-2111-now-reading-saved-and-a-peek.md](entries/2026-10-10-2111-now-reading-saved-and-a-peek.md)

A private newsletter reader for one person: my Gmail newsletters in, one ranked list out, on the iPhone and the Mac. Live at https://sandip.dev/thelibrary/.

## Where we are now

The reader is live on both devices and does what the brief asked of Phase 1: ingest every two hours, clean reading, and Relevant and Irrelevant ratings by thumb or by swipe. Claude sorts every issue into News or Learning and a topic, and rules archive promos and week-old news.

Ranking runs when the Summary opens: the 20 most relevant unread News issues, at most three per newsletter, the day's top 5 in the yellow box, and a line that tracks the success measure. The stored score and "Best first" inside the tabs wait for a week of ratings.

Since 2026-10-10 every issue is split into stories, linked into events across newsletters, and the Summary opens with the day in brief: three to six threads written from the last day's news. A History page lists what I opened, a day at a time, back to 2026-10-09. Spend is about $5.50 a month, mostly Claude.

Three ways back to an issue went live on the evening of 2026-10-10. Now reading takes me back to the last issue at the place I stopped, on either device. A bookmark keeps an issue on the Saved list, out of Unread and away from the archive rules. One tap on a row shows what is inside the issue, from the story index, and a double tap opens it. None of it has been tried on a real iPhone yet.

Next: keep account mail, like a Substack verification code, out of the list (#50), then related stories inside a digest (#20, second version) and how a story evolved (#19).

## Recent entries

- [2026-10-10 21:11: Now reading, Saved, and a peek inside](entries/2026-10-10-2111-now-reading-saved-and-a-peek.md)
- [2026-10-10 19:49: Read history, and four more ideas](entries/2026-10-10-1949-read-history.md)
- [2026-10-10 19:30: Stories, and the day in brief](entries/2026-10-10-1930-stories-and-the-day-in-brief.md)
- [2026-10-10 19:29: The reader is live on the phone and the Mac](entries/2026-10-10-1929-reader-live-on-phone-and-mac.md)
- [2026-10-10 19:28: Bootstrap, from a brief to a sorted inbox](entries/2026-10-10-1928-bootstrap.md)

## Weekly summaries

None yet. The first, 2026-W41, is due on Monday 2026-10-12.

## Working hypotheses

- Ratings plus my five interests are enough to put things I would rate Relevant in the top 5 at least 3 times in 5 after two weeks (`docs/prd.md`; measured since 2026-10-10).
- The story, not the issue, is the right unit for following news across newsletters (#15).
- Haiku is good enough for sorting, story splitting and the brief at about a cent an issue (`docs/architecture.md`, sections 11 and 12).
- Brute-force similarity is enough at this volume for years; a vector index waits until a feature needs to search everything at once (`docs/features/story-index.md`).

## Open questions

- Will ranking hit the 60% aim once ratings exist (#5)?
- How do the day in brief's threads and cost hold up on a weekday, with about 90 news stories?
- How to keep account mail out: a subject rule, a fourth answer to Claude's promo question, or Jev (#50)?
- Which decision model for the bounded calls: Claude, Jev or OpenAI Decisions (#27)?
- What to do about `robots.txt` on `sandip.dev` (#7)?
- When does the AWS account get Haiku 5.5?

## Things ruled out

- Extending `sandip.dev`'s CloudFront distribution: it is Amplify Hosting, so the app has its own distribution behind a rewrite rule (2026-10-09).
- A keep list of newsletter patterns as the ranking prior: it matched the wrong newsletters; a Must Read star instead (2026-10-09).
- A yes or no promo question: it flagged 158 of 396 issues; the three-way question flags 42 (2026-10-09).
- The cleaner list look: replaced by briefing cards on the phone and two panes on the Mac (2026-10-10).
- Raw similarity for related issues: it matched newsletters with their own issues, so house style is taken out first (2026-10-10).
- Event links at a cosine of 0.50 with a shared name: two weeks of Muse coverage became one event (2026-10-10).
- Matching names on their leading words: one more event in 2,210 stories (2026-10-10).
- Writing the brief on every run: 12 calls a day for little change (2026-10-10).
- A Save button in the phone's bottom bar: a sixth control cut off the Relevant and Irrelevant labels, so it sits at the top of the issue page (2026-10-10).
- Peeking in the Must Read row: one card that grew would stretch the whole sideways row, so those cards open on a tap (2026-10-10).
- A reading place in pixels: the phone's narrower frame is taller, so the place is a share of the newsletter (2026-10-10).
