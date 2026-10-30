# Nutgraf: Journal

Last refreshed: 2026-10-30 18:40
Latest entry: [2026-10-30-1840-email-codes-wait-on-one-command.md](entries/2026-10-30-1840-email-codes-wait-on-one-command.md)

A newsletter reader: Gmail newsletters in, one ranked list out, on the iPhone and the Mac. Built for me first, and since 2026-10-29 being opened to any reader. Called The Library until 2026-10-12. Live at https://sandip.dev/nutgraf/.

## Where we are now

Since 2026-10-29 Nutgraf is being opened to any reader, in steps that leave my own app working (`docs/features/multi-reader.md`). Built: the reader on every request, settings per reader, daily work at each reader's own morning, every model call metered with daily limits, export, delete account, onboarding and an operator group. Each reader's data on their own keys runs on dev; prod waits on my move. Cognito mails through SES since 2026-10-30. Email-code sign-in is two draft pull requests that wait on one command from me, because optional MFA would otherwise drop my authenticator. Still to build: mail in, Google sign-in and the launch. The app is still only mine to use, and highlights are hidden until I decide.

The reader is live on both devices and does what the brief asked of Phase 1: ingest every two hours, clean reading, and a thumbs up or down for whether an issue was useful. Claude gives every issue a line and a topic, and Jev sorts every story into News or Learning; rules archive promos and week-old news, and since 2026-10-11 keep account mail, like sign-in codes, out of the list.

Ranking runs when Today opens, and Today leads with the day in brief, written from the stories every issue is split into. Since 2026-10-11 search finds any issue or story in the archive, by its words or by what it means, and under every newsletter Related lists the closest stories from before and since; a digest lists them for each of its stories. Spend is about $5.50 a month, mostly Claude.

Three ways back to an issue: Continue, Saved, and a peek inside before opening it. History lists what I read, a day at a time, and since 2026-10-11 a peek left open two seconds counts too; the five digests I peeked at on 2026-10-10 were added to it. None of this has been tried on a real iPhone yet.

How changes ship changed on 2026-10-11. Main is protected: every change is a pull request whose CI check passes, and merging deploys it through dev and the integration tests to prod in about 5 to 10 minutes. Nothing deploys prod by hand any more. The first run failed on how GitHub names this repository to AWS, and the second deployed everything. Next: how a story evolved (#19).

Since 2026-10-11 both devices have one look, from a Claude Design redesign briefed without the old screens (`docs/features/redesign.md`). The phone has four tabs: Today is the Summary as a deck of cards, Browse is everything else under a filter sentence, then Saved and Library. The Mac is a keyboard console of queue, reader and stories. The design's deep dives, Follow and Ask wait for their backends, starting with how a story evolved (#19).

Since 2026-10-12 the app is Nutgraf, at sandip.dev/nutgraf, and every /thelibrary link redirects there. A second handoff gave it Apple's type and colour (SF Pro, true black, no blue, yellow the one highlight) and a logo: a folded page over an n. A tap on a row's title opens the issue. The repository and the AWS resources keep the old name. None of the redesign has been tried on a real iPhone yet.

Since 2026-10-27 Learning lists stories, not issues: Jev calls each story craft or news, so a how-to inside a TLDR digest shows up in Learning while the digest stays in News, and reading it leaves the digest unread. An issue is Learning only when all its stories are, and the day in brief takes News stories by their own shelf. Ask Nutgraf answers a question from the archive with a link to every story it used, and a story's Takes tab shows how each of my newsletters covered the same news, beside its Timeline (#19, since 2026-10-23). A story's Source tab checks it against the page it links to, quoting the page only where the quote is really there, and Follow keeps a story's dated steps current: after each ingest, only stories that move it on are added, marked new in Library › Following. All five were built overnight on 2026-10-27 and checked through the API on prod, not yet by me on a device. The repository is public since then, to keep GitHub Actions free, and work runs one GitHub milestone at a time.

Since 2026-10-28 Check the source follows a news page's links to the original, the paper, filing or company post its claims come from, up to five pages, and checks the story against that. It runs in the background for up to two minutes, reads one page per site, and the Source tab lists each page as it is read and the way there once kept. On real links it reached an original in four of eight checks it could start, for 1 to 3 cents; 14 of 22 links were refused at the first page, mostly paywalls. Milestone 6 is closed. After every milestone I now get a status report, filed in `docs/status/`.

Since 2026-10-28 my newsletters' predictions are kept: forecasts and promises with a deadline, spotted as each issue arrives, and settled each morning from later newsletters as right, wrong or unclear, with the stories that show it. Library › Predictions lists them and lets me overrule any verdict; a newsletter's page shows how its own calls came out. The archive gave 117, five already settled.

Since 2026-10-28 Library has a Subscription audit: a card per newsletter over the last month, from the first open logged, with what it sent, what I opened and rated, and what it repeats or alone covers, ending in worth dropping, keep or too few to tell, with its unsubscribe link and Mute. Rules on counts, no model. On my archive about 7 of 30 come out worth dropping, all for being hardly opened; repeats across newsletters turned out rare.

Since 2026-10-28 Library has a Tune-up: when I keep moving one newsletter's stories to the same shelf, it proposes "always Learning" or "always News" for it, with what the rule would have fixed and would move, and nothing changes until I tap Apply. It counts the promos I pull back too. Rules from my moves, no model; Jev's question stays frozen. On my archive there was nothing to count: I have never moved a story or pulled a promo back.

Since 2026-10-19 the thumbs ask one thing: was it useful? Relevant and Irrelevant are gone. Ratings had stalled at 12 in ten days, none for six, and a swipe both rated a card and cleared it. Now a swipe on Today only moves to the next card or back, and a thumb changes nothing but the rating. Work is tracked on the GitHub project Nutgraf (#86). Jev, TypeSafe's decision model, is to sort each story into News or Learning (#81): its scoring script shipped (#87) and the step after ingest waits to merge (#88).

## Recent entries

- [2026-10-30 18:40: Email codes wait on one command](entries/2026-10-30-1840-email-codes-wait-on-one-command.md)
- [2026-10-29 19:50: Every item has an owner](entries/2026-10-29-1950-every-item-has-an-owner.md)
- [2026-10-29 17:00: Nutgraf for any reader](entries/2026-10-29-1700-nutgraf-for-any-reader.md)
- [2026-10-28 19:05: Weekly tune-up](entries/2026-10-28-1905-weekly-tune-up.md)
- [2026-10-28 14:50: Subscription audit](entries/2026-10-28-1450-subscription-audit.md)
- [2026-10-28 10:50: Who called it](entries/2026-10-28-1050-who-called-it.md)
- [2026-10-28 09:05: The hunt on real links](entries/2026-10-28-0905-the-hunt-on-real-links.md)
- [2026-10-28 08:40: The hunt for the original](entries/2026-10-28-0840-the-hunt-for-the-original.md)
- [2026-10-27 23:55: Check the source, and Follow a story](entries/2026-10-27-2355-source-and-follow.md)
- [2026-10-27 22:30: Learning lists stories, Ask, and Takes](entries/2026-10-27-2230-learning-ask-and-takes.md)
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
- The story, not the issue, is the right unit for following news across newsletters (#15), and for what to keep: Learning lists stories since 2026-10-27 (#81).
- My own archive is enough to answer most questions about the last two months, without the web (#21, 2026-10-27).
- Later newsletters report enough to settle most of my newsletters' predictions without the web (#24, 2026-10-28).
- Haiku is good enough for sorting, story splitting and the brief at about a cent an issue (`docs/architecture.md`, sections 11 and 12).
- Brute-force similarity is enough at this volume for years; a vector index waits until a feature needs to search everything at once (`docs/features/story-index.md`).
- Search can read every story's vector into the API's memory for a while: about 5 MB now, growing about 55 MB a year (`docs/features/search.md`).

## Open questions

- Will ranking hit the 60% aim once thumbs are used? On 2026-10-19 the five stood at 6 of 29 useful, 23 not rated (#5).
- How do the day in brief's threads and cost hold up on a weekday, with about 90 news stories?
- Jev sorts story shelves (#81, live since 2026-10-23, listing since 2026-10-27). Is it the model for the other bounded calls too (#27)?
- Will I work through Learning's unread stories (428 on 2026-10-27, none expiring), or will it become a backlog to archive?
- Which search provider, if any, for the web halves of Ask, Backstory and Takes (#16, #17)?
- What to do about `robots.txt` on `sandip.dev` (#7)?
- When does the AWS account get Haiku 5.5? Still no on 2026-10-30.
- How should sign-up open: closed, by invitation or open (#225)? And do highlights come back with it?
- How does mail in work for other readers: a forwarding address, their Gmail, or both?

## Things ruled out

- Making MFA optional and allowing email codes in one update: Cognito refuses it and CloudFormation rolls back, so it takes two deploys (2026-10-30).
- Making MFA optional and assuming my authenticator stays: an account enrolled while MFA was required has no preferred MFA and signs in with its password alone, so the preference is set first (2026-10-30).
- Creating the SES identity in CDK: `sandip.dev` was already verified outside this repo, so the pool only points at it (2026-10-30).
- Asking Haiku to skip companies' announced dates when spotting predictions: it kept them; it labels them instead and the code drops them (2026-10-28).
- Asking Claude to keep the source hunt off a page's own site: it saw only "[n]", so the code withholds those links instead (2026-10-28).
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
