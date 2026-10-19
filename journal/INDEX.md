# Nutgraf: Journal

Last refreshed: 2026-10-19 11:35
Latest entry: [2026-10-19-1135-thumbs-instead-of-relevant.md](entries/2026-10-19-1135-thumbs-instead-of-relevant.md)

A private newsletter reader for one person: my Gmail newsletters in, one ranked list out, on the iPhone and the Mac. Called The Library until 2026-10-12. Live at https://sandip.dev/nutgraf/.

## Where we are now

The reader is live on both devices and does what the brief asked of Phase 1: ingest every two hours, clean reading, and a thumbs up or down for whether an issue was useful. Claude sorts every issue into News or Learning and a topic; rules archive promos and week-old news, and since 2026-10-11 keep account mail, like sign-in codes, out of the list.

Ranking runs when Today opens, and Today leads with the day in brief, written from the stories every issue is split into. Since 2026-10-11 search finds any issue or story in the archive, by its words or by what it means, and under every newsletter Related lists the closest stories from before and since; a digest lists them for each of its stories. Spend is about $5.50 a month, mostly Claude.

Three ways back to an issue: Continue, Saved, and a peek inside before opening it. History lists what I read, a day at a time, and since 2026-10-11 a peek left open two seconds counts too; the five digests I peeked at on 2026-10-10 were added to it. None of this has been tried on a real iPhone yet.

How changes ship changed on 2026-10-11. Main is protected: every change is a pull request whose CI check passes, and merging deploys it through dev and the integration tests to prod in about 5 to 10 minutes. Nothing deploys prod by hand any more. The first run failed on how GitHub names this repository to AWS, and the second deployed everything. Next: how a story evolved (#19).

Since 2026-10-11 both devices have one look, from a Claude Design redesign briefed without the old screens (`docs/features/redesign.md`). The phone has four tabs: Today is the Summary as a deck of cards, Browse is everything else under a filter sentence, then Saved and Library. The Mac is a keyboard console of queue, reader and stories. The design's deep dives, Follow and Ask wait for their backends, starting with how a story evolved (#19).

Since 2026-10-12 the app is Nutgraf, at sandip.dev/nutgraf, and every /thelibrary link redirects there. A second handoff gave it Apple's type and colour (SF Pro, true black, no blue, yellow the one highlight) and a logo: a folded page over an n. A tap on a row's title opens the issue. The repository and the AWS resources keep the old name. None of the redesign has been tried on a real iPhone yet.

Since 2026-10-19 the thumbs ask one thing: was it useful? Relevant and Irrelevant are gone. Ratings had stalled at 12 in ten days, none for six, and a swipe both rated a card and cleared it. Now a swipe on Today only moves to the next card or back, and a thumb changes nothing but the rating. Work is tracked on the GitHub project Nutgraf (#86). Jev, TypeSafe's decision model, is to sort each story into News or Learning (#81): its scoring script shipped (#87) and the step after ingest waits to merge (#88).

## Recent entries

- [2026-10-19 11:35: Thumbs instead of Relevant](entries/2026-10-19-1135-thumbs-instead-of-relevant.md)
- [2026-10-12 09:51: Nutgraf](entries/2026-10-12-0951-nutgraf.md)
- [2026-10-11 14:44: Today, Browse and the console](entries/2026-10-11-1444-today-browse-and-the-console.md)
- [2026-10-11 13:53: A redesign, briefed without the old screens](entries/2026-10-11-1353-ux-redesign-brief.md)
- [2026-10-11 13:37: Related stories inside a digest](entries/2026-10-11-1337-related-stories-inside-a-digest.md)
- [2026-10-11 11:18: Search, and one way to prod](entries/2026-10-11-1118-search-and-one-way-to-prod.md)
- [2026-10-10 21:11: Now reading, Saved, and a peek inside](entries/2026-10-10-2111-now-reading-saved-and-a-peek.md)
- [2026-10-10 19:49: Read history, and four more ideas](entries/2026-10-10-1949-read-history.md)
- [2026-10-10 19:30: Stories, and the day in brief](entries/2026-10-10-1930-stories-and-the-day-in-brief.md)
- [2026-10-10 19:29: The reader is live on the phone and the Mac](entries/2026-10-10-1929-reader-live-on-phone-and-mac.md)

## Weekly summaries

- [2026-W41: from a brief to a redesign](weekly/2026-W41-summary.md)

## Working hypotheses

- Thumbs plus my five interests are enough to put things I find useful in the top 5 at least 3 times in 5 after two weeks (`docs/prd.md`; measured since 2026-10-10, as Relevant until 2026-10-19).
- A thumb that only judges, apart from the swipe that moves on, gets used where Relevant did not (2026-10-19).
- The story, not the issue, is the right unit for following news across newsletters (#15).
- Haiku is good enough for sorting, story splitting and the brief at about a cent an issue (`docs/architecture.md`, sections 11 and 12).
- Brute-force similarity is enough at this volume for years; a vector index waits until a feature needs to search everything at once (`docs/features/story-index.md`).
- Search can read every story's vector into the API's memory for a while: about 5 MB now, growing about 55 MB a year (`docs/features/search.md`).

## Open questions

- Will ranking hit the 60% aim once thumbs are used? On 2026-10-19 the five stood at 6 of 29 useful, 23 not rated (#5).
- How do the day in brief's threads and cost hold up on a weekday, with about 90 news stories?
- Will Claude be able to merge its own pull requests, as I asked, or does auto mode keep treating it as self-approval?
- Jev sorts story shelves (#81). Is it the model for the other bounded calls too (#27)?
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
- Search as one merged list: a story just over the meaning cutoff ranked beside exact matches, so words come first and meaning follows under its own heading (2026-10-11).
- Requiring every search word, or allowing any one to be missing: the first found nothing for "how Discord stores messages", the second let in noise (2026-10-11).
- Deploying prod from a laptop: prod now deploys only from main, through GitHub Actions (2026-10-11).
- Rebase merges: squash merges leave one commit per pull request and no branch behind to diverge (2026-10-11).
- Taking house style out of story embeddings for Related: Claude wrote every story, so stories of one newsletter average 0.10 against 0.07 across (2026-10-11).
- A lower Related cutoff for stories that share a name: from 0.40 to 0.45 they were related about as often without one (2026-10-11).
- Polishing the current UI: the redesign starts from the requirements, not today's screens (2026-10-11).
- A look per device (dark cards on the phone, two panes on the Mac): one identity on both (2026-10-11).
- Showing the design's deep dives, Follow and Ask before their backends exist: no dead controls (2026-10-11).
- Self-hosted web fonts: system fonts only, so the app downloads none (2026-10-12).
- An Amplify redirect rule for /thelibrary: the app's CloudFront function sends the 301s, in code and under test (2026-10-12).
- Checking the old URLs for one hop and the same query order: Amplify adds the slash first and CloudFront reorders parameters, so the check follows each URL to where it ends (2026-10-12).
- Relevant and Irrelevant, given by swipe: 12 ratings in ten days and none for six, so a thumbs up or down for whether it was useful, and swipes only move through the deck (2026-10-19).
- Swipes on list rows: rows are not cards, and a swipe no longer rates (2026-10-19).
