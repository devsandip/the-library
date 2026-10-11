# The Library: product requirements as user stories

Prepared 2026-10-11 for a UX redesign. Built from what is shipped, the open backlog (GitHub issues #1 to #56), the product brief, the feature docs, the journal and the decisions made along the way.

Read `1-PRODUCT-OVERVIEW.md` first for the vocabulary (issue, story, digest, News, Learning, Must Read and so on).

## How to read this

- Every story uses the form **As a [type of user], I want to [action or goal] so that [benefit]**.
- Stories describe needs, not today's screens. Where Sandip asked for a specific interaction by name (a swipe, a double tap), the story says so, because that interaction is itself the requirement. Everything else is open to redesign.
- **Status:** `Shipped` is live today. `Planned` is on the backlog and the design must leave room for it. `Parked` is a known idea on hold; design for awareness only. `Fix` is a known bug with an agreed fix.
- **Source:** a GitHub issue number, `Brief` for the product brief, or the feature doc it came from.

### Types of user

There is one human user, Sandip. The stories name the mode he is in:

| User type | Meaning |
|---|---|
| **reader** | Sandip using the app to read, on any device |
| **phone reader** | Sandip on the iPhone: short sessions, often one-handed |
| **Mac reader** | Sandip on the Mac: longer sessions, wide screen, keyboard |
| **owner** | Sandip running the app: health, rules, privacy, cost |

### Scope for the redesign

Design every `Shipped`, `Planned` and `Fix` story. Count: 185 stories across 15 areas (142 shipped, 41 planned, 1 fix, 1 parked). Business rules that constrain the design are listed at the end.

---

## 1. Access, privacy and installing the app

| ID | User story | Status | Source |
|---|---|---|---|
| ACC-01 | As the owner, I want the reader behind a sign-in with a password and an authenticator code so that nobody else can read my email. | Shipped | Brief |
| ACC-02 | As the owner, I want only one account to be possible so that the app stays mine alone. | Shipped | R6 |
| ACC-03 | As a reader, I want to stay signed in on each device for about a month so that opening the app is one tap, not a login. | Shipped | Spec 7 |
| ACC-04 | As a reader, I want to sign out of a device so that I can end a session on a browser I don't own. | Shipped | Spec 7 |
| ACC-05 | As a phone reader, I want to install the app on my iPhone home screen with its own icon and name so that it opens like an app. | Shipped | #35 |
| ACC-06 | As the owner, I want the app hidden from search engines and crawlers so that private pages never appear in search results. | Shipped | Brief |
| ACC-07 | As the owner, I want public About, Privacy and Terms pages so that Google's consent screen can link to them. | Shipped | README |
| ACC-08 | As a reader, I want a clear message and a way to retry when the app cannot start so that I am never stuck on a blank page. | Shipped | App |
| ACC-09 | As a reader, I want a friendly "nothing here" page for a broken or old link so that I can get back to the library in one step. | Shipped | App |
| ACC-10 | As the owner, I want email content to stay in my own cloud account, except for the AI model calls, so that my reading stays private. | Shipped | Brief |
| ACC-11 | As the owner, I want Gmail access to be read-only so that the app can never change, delete or send mail. | Shipped | Spec 1 |

## 2. Collecting newsletters

| ID | User story | Status | Source |
|---|---|---|---|
| ING-01 | As a reader, I want new issues collected from my Gmail labels automatically every two hours through the day so that they are waiting without any effort. | Shipped | Brief |
| ING-02 | As a reader, I want newsletters that land unlabeled in my inbox (ByteByteGo, The Pragmatic Engineer, Lenny's Newsletter) included so that I don't miss the ones I care about most. | Shipped | Brief |
| ING-03 | As a reader, I want to trigger a check for new issues myself so that an issue I know just arrived shows up now. | Shipped | R7 |
| ING-04 | As a reader, I want to know when mail was last checked so that I can tell whether the list is current. | Shipped | Status |
| ING-05 | As a reader, I want each issue stored once, however often it is fetched, so that I never see duplicates. | Shipped | Brief |
| ING-06 | As a reader, I want GitHub notifications, Substack's own digests, receipts and other non-newsletter mail kept out so that the library only holds newsletters. | Shipped | Brief |
| ING-07 | As a reader, I want verification codes, sign-in links, email confirmations and password resets kept out, even when they come from a newsletter's own address, so that account mail never shows up as an issue. | Shipped | #50 |
| ING-08 | As a reader, I want newsletters that share one sending address (the TLDR editions) treated as separate newsletters so that I can star, mute or filter each one on its own. | Shipped | #1 |
| ING-09 | As a reader, I want each newsletter shown by its publication name rather than its author's name so that I recognize it at a glance. | Shipped | #1 |
| ING-10 | As a reader, I want scripts, trackers and tracking pixels stripped from every issue so that reading is safe and private. | Shipped | Brief |
| ING-11 | As a reader, I want each issue's original web link and unsubscribe link kept so that I can open it as published or leave the newsletter. | Shipped | Brief |
| ING-12 | As a reader, I want the last four weeks of newsletters imported on day one so that I have something to read and rate from the start. | Shipped | Spec 1 |
| ING-13 | As the owner, I want to see the mail the rules or Claude filtered out and restore a misfire so that a real issue is never lost without my knowing. | Planned | account-mail doc |

## 3. Sorting by Claude

| ID | User story | Status | Source |
|---|---|---|---|
| SRT-01 | As a reader, I want a one-line summary of every issue so that I can decide what to read without opening it. | Shipped | #4 |
| SRT-02 | As a reader, I want every issue sorted into News (time-bound) or Learning (still worth reading in three months) so that quick news and deep reads don't compete for my attention. | Shipped | #3 |
| SRT-03 | As a reader, I want to move any issue between News and Learning so that I can correct a wrong call. | Shipped | #3 |
| SRT-04 | As a reader, I want to set a newsletter to always land in News, always in Learning, or let Claude decide per issue so that I can fix a whole newsletter at once. | Shipped | #3 |
| SRT-05 | As a reader, I want my own corrections to always win over Claude so that a choice I made never gets undone. | Shipped | #3 |
| SRT-06 | As a reader, I want one topic tagged on every issue from a short fixed list so that I can scan and filter by subject. | Shipped | #3 |
| SRT-07 | As a reader, I want promos (course sales, event invites, subscription offers) archived automatically but still findable so that selling mail stays out of my way without being lost. | Shipped | #3 |
| SRT-08 | As a reader, I want an issue that only carries a sponsor slot treated as a normal issue so that good issues are not hidden as promos. | Shipped | #4 |
| SRT-09 | As a reader, I want unread News older than a week archived on its own, except Must Read and saved issues, so that News is always this week's. | Shipped | #3 |
| SRT-10 | As a reader, I want to see why an issue was archived automatically (a promo, or a week old) so that I can trust the rules. | Shipped | #3 |
| SRT-11 | As a reader, I want an issue I restore from the archive to stay restored so that the rules don't fight me. | Shipped | Spec 11 |
| SRT-12 | As a reader, I want every issue split into its stories, each with a headline, a short summary and its own link, so that a digest's dozen items can be seen and used one by one. | Shipped | #15 |
| SRT-13 | As a reader, I want stories about the same event in different newsletters recognized as one event so that I can see coverage across sources. | Shipped | #15 |
| SRT-14 | As a reader, I want promos archived only when the sorting is confident so that fewer real issues get swept away. | Planned | #27 |
| SRT-15 | As a reader, I want an issue that sits between two topics tagged with both so that it shows up under either. | Planned | #27 |
| SRT-16 | As a reader, I want to create, rename, remove and regroup topics, with Claude re-sorting the issues and my manual moves kept, so that the topic list matches how I think. | Parked | #8 |

## 4. Browsing what is unread

| ID | User story | Status | Source |
|---|---|---|---|
| BRW-01 | As a reader, I want every unread issue from every newsletter in one place so that I stop checking 30 inboxes. | Shipped | Brief |
| BRW-02 | As a reader, I want News and Learning kept apart, each with its unread count, so that I know how much is waiting of each kind. | Shipped | #3 |
| BRW-03 | As a reader, I want my Must Read newsletters' unread issues ahead of everything else, and marked as Must Read, so that I never miss them and can see why they are on top. | Shipped | #2 |
| BRW-04 | As a reader, I want to scan the rest of the unread issues by subject, in a consistent order, so that I can find what I'm in the mood for. | Shipped | #10 |
| BRW-05 | As a reader, I want to switch topic filters on and off, several at once, each with its unread count, so that I can narrow the list to what I'm in the mood for. Sandip asked for these as chips he can activate and deactivate. | Shipped | #10 |
| BRW-06 | As a reader, I want to filter by a topic straight from an issue's topic label so that I can find more like it in one step. | Shipped | #10 |
| BRW-07 | As a reader, I want to filter by one or several newsletters, with Must Read ones easy to find and the list searchable, so that I can work through one newsletter's backlog. | Shipped | #9 |
| BRW-08 | As a reader, I want active filters always visible and removable one at a time or all at once so that I know what I'm looking at and can get back to everything. | Shipped | #9 |
| BRW-09 | As a reader, I want switching between News and Learning to clear the topic filters but keep the newsletter filters so that filters stay sensible across the two. | Shipped | Worklog |
| BRW-10 | As a reader, I want to switch between Unread, All, Archived and Saved so that I can find something I've already dealt with. | Shipped | R7, #43 |
| BRW-11 | As a reader, I want the current filters and view kept in the address so that Back, reload and links return to exactly the list I left. | Shipped | Spec 8 |
| BRW-12 | As a reader, I want each issue in a list to show the newsletter, Claude's line, the subject, how old it is, the reading time, its topic and whether I rated or saved it so that I can judge it without opening it. | Shipped | Brief |
| BRW-13 | As a reader, I want to load older issues on demand in a long list so that everything stays reachable without a slow first load. | Shipped | R7 |
| BRW-14 | As a reader, I want a calm "No new numbers." when a list is empty so that an empty list feels like being done, not like an error. | Shipped | Brief |
| BRW-15 | As a reader, I want muted newsletters left out of the unread lists but still reachable in Archived and on their own page so that I can quiet a newsletter without losing its issues. | Shipped | R7 |
| BRW-16 | As a reader, I want the unread counts to update as I read, rate, save and archive so that the numbers I see are always true. | Shipped | Worklog |
| BRW-17 | As a reader, I want a "Best first" order inside News and Learning once there are enough ratings so that the best issues rise to the top everywhere, not only in the Summary. | Planned | #5 |
| BRW-18 | As a reader, I want a one-line reason beside each ranked issue ("Because you liked 4 Platformer issues", "Matches: AI, startups") so that I understand and trust the order. | Planned | Brief, #5 |
| BRW-19 | As a reader, I want "Newest first" to stay the default until the ranking has enough ratings to be trusted so that the order is never worse than date order. | Planned | #5 |

## 5. Peeking inside an issue

| ID | User story | Status | Source |
|---|---|---|---|
| PEK-01 | As a reader, I want to see what is inside an issue (a digest's stories with headline, one line and source link, or a little more than the one-line summary for a single story) without leaving the list so that I can decide whether it is worth opening. Sandip asked for one tap to show this. | Shipped | #41 |
| PEK-02 | As a reader, I want a double tap to open the issue directly, without the peek flashing first, so that peeking never slows down opening. Sandip asked for this pairing. | Shipped | #41 |
| PEK-03 | As a reader, I want to open a story's own source link from the peek so that I can go straight to the one item I care about. | Shipped | #41 |
| PEK-04 | As a reader, I want to open the full issue from inside the peek so that I can go from a glance to reading in one step. | Shipped | #41 |
| PEK-05 | As a Mac reader, I want keyboard shortcuts to open and to peek (Enter opens, Space peeks) so that I can triage without the trackpad. | Shipped | #41 |
| PEK-06 | As a reader, I want an issue I have read through a peek to count as read, marked read and listed in History as "Read" with the time, so that my unread counts and history are honest. A peek held open for about 2 seconds counts; one closed at once does not. | Fix | #56 |
| PEK-07 | As a reader, I want a fuller summary in the peek for single-story issues so that the peek says more than the list already does. | Planned | tap-for-a-summary doc |
| PEK-08 | As a reader, I want an issue that has not been split into stories yet to say so in the peek, with its opening line, so that I know why it looks thin. | Shipped | tap-for-a-summary doc |

## 6. The Summary and the day in brief

| ID | User story | Status | Source |
|---|---|---|---|
| SUM-01 | As a reader with a few minutes, I want the 20 most relevant unread News issues in one short list, best first, so that I can catch up on what matters in about a minute. | Shipped | #11 |
| SUM-02 | As a reader, I want at most three issues from any one newsletter in that list so that one prolific newsletter can't crowd out the rest. | Shipped | #31 |
| SUM-03 | As a reader, I want each item in the list to say in plain words why it ranks there ("From a Must Read newsletter", "Close to your interest in AI", "You rated this newsletter Relevant 3 times", "Trying a newsletter you haven't rated yet") so that the ranking is explainable. | Shipped | #11, #31 |
| SUM-04 | As a reader, I want the day's top 5 marked with the yellow box so that the best of today stands out. | Shipped | Brief, #34 |
| SUM-05 | As a reader, I want the day's top 5 fixed once I have first seen them so that the marked items don't change under me during the day. | Shipped | #34 |
| SUM-06 | As a reader, I want to dismiss (archive) an item straight from the list so that I can clear what I don't want without opening it. | Shipped | #11 |
| SUM-07 | As a reader, I want to mark the whole list read and get the next most relevant items so that I can work through the news in batches. | Shipped | #11 |
| SUM-08 | As a reader, I want to know how many unread News issues there are and roughly how long the list takes to skim so that I can decide whether to start now. | Shipped | App |
| SUM-09 | As a reader, I want the last day's news written up as three to six short threads, each about one development and naming the newsletters it came from, so that I get the shape of the day before reading any issue. | Shipped | #18 |
| SUM-10 | As a reader, I want each thread's newsletter names to open the issues behind it so that I can go deeper on any thread. | Shipped | #18 |
| SUM-11 | As a reader, I want to know how fresh the write-up is and how many stories and newsletters it covers so that I know what it does and doesn't include. | Shipped | #18 |
| SUM-12 | As a reader, I want to put the day's write-up out of the way once I've read it, and have that remembered, so that the ranked list is right there when I want it. | Shipped | #18 |
| SUM-13 | As a Mac reader, I want to read the day's write-up and pick from the ranked list without switching back and forth so that the overview and the choices stay connected. | Shipped | narrative doc |
| SUM-14 | As a reader, I want to see how well the top 5 matched my taste over the last 14 days (the share I rated Relevant, against an aim of 60%) so that I know whether the ranking is working. | Shipped | Brief, #34 |

## 7. Reading an issue

| ID | User story | Status | Source |
|---|---|---|---|
| RD-01 | As a reader, I want any newsletter shown clean and readable at my screen's width, without pinching or sideways scrolling, so that reading on the phone is comfortable. | Shipped | Brief |
| RD-02 | As a reader, I want nothing inside an email able to run code or track me so that opening an issue is always safe. | Shipped | Spec 8 |
| RD-03 | As a reader, I want an issue to open fast on the phone so that a spare minute is enough to read something. | Shipped | Brief |
| RD-04 | As a reader, I want to see the newsletter, subject, date, reading time, News or Learning and topic before the content so that I know what I'm about to read. | Shipped | R7 |
| RD-05 | As a reader, I want Claude's summary shown with the issue so that I get the gist before committing to read it all. Sandip asked for this on the Mac and was happy without it on the phone. | Shipped | #14 |
| RD-06 | As a reader, I want to rate an issue Relevant or Irrelevant while reading, and undo a rating, so that the ranking learns my taste. | Shipped | Brief |
| RD-07 | As a reader, I want opening an issue to mark it read, and to be able to mark it unread again, so that I control what is still waiting. | Shipped | R7 |
| RD-08 | As a reader, I want to archive an issue, and move an archived one back, so that my list stays clear and nothing is lost. | Shipped | R7 |
| RD-09 | As a reader, I want to save an issue for later while reading it so that I can set it aside and come back. | Shipped | #43 |
| RD-10 | As a reader, I want to open the original web version so that I can see it as published, share it or comment. | Shipped | Brief |
| RD-11 | As a reader, I want to move an issue between News and Learning while reading it so that I fix a wrong call where I notice it. | Shipped | #3 |
| RD-12 | As a reader, I want to go from an issue to its newsletter's page so that I can star, mute or unsubscribe while the issue is fresh in mind. | Shipped | R7 |
| RD-13 | As a reader, I want to filter the library by an issue's topic from the issue itself so that I can find more like it. | Shipped | #10 |
| RD-14 | As a reader, I want to see related issues from before and since, with newsletter, date and one line each, and nothing when nothing is close, so that I can follow a subject over time. | Shipped | #20 |
| RD-15 | As a reader, I want related stories matched for each story inside a digest so that a single TLDR item finds its own relatives. | Planned | #20 |
| RD-16 | As a Mac reader, I want to go from one issue to the next in a list without losing my place in it so that working through a list is quick. | Shipped | #12 |
| RD-17 | As a phone reader, I want the actions I use most within reach of my thumb so that I can read and act one-handed. | Shipped | #12 |
| RD-18 | As a reader, I want a notice when an issue was archived automatically, saying why, with a way to restore it, so that I understand what happened. | Shipped | #3 |
| RD-19 | As a reader, I want to act on a single story inside a digest (open its source, see its relatives, ask about it, follow it) so that a digest isn't treated as one blurry item. | Planned | #15 to #23 |

## 8. Rating and teaching the ranking

| ID | User story | Status | Source |
|---|---|---|---|
| RAT-01 | As a phone reader, I want to swipe an issue one way for Relevant and the other way for Irrelevant so that rating takes one gesture and I can rate a whole list quickly. Sandip asked for swipe right for Relevant, swipe left for Irrelevant. | Shipped | #13 |
| RAT-02 | As a phone reader, I want to see what a swipe will do while I drag, and have it spring back if I don't go far enough, so that I never rate by accident. | Shipped | #13 |
| RAT-03 | As a phone reader, I want an Irrelevant swipe to also archive the issue, with Undo for a few seconds, so that a bad issue leaves my list in the same gesture and a mistake is easy to reverse. | Shipped | #13 |
| RAT-04 | As a reader, I want rated issues to show their rating wherever they appear so that I can see what I've already judged. | Shipped | #13 |
| RAT-05 | As a reader, I want my ratings to change what ranks first, with no weights for me to tune, so that the app learns on its own. | Shipped | Brief |
| RAT-06 | As a reader, I want my five interests (tech industry, startups, AI, product management, system design) to seed the ranking so that it is useful from day one, before I've rated anything. | Shipped | Brief |
| RAT-07 | As a reader, I want newsletters I rarely rate to still surface now and then so that the ranking doesn't lock me into the same few sources. | Shipped | Brief |
| RAT-08 | As a reader, I want the order to stay the same through a day so that the list doesn't reshuffle every time I look. | Shipped | Spec 11 |
| RAT-09 | As a reader, I want only my explicit ratings to drive the ranking, with opens only logged, so that the app learns from what I say rather than what I happen to tap. | Shipped | Brief |
| RAT-10 | As a reader, I want the ranking re-scored after every collection and every rating so that it reacts to what I just told it. | Planned | #5 |
| RAT-11 | As a reader, I want a fast relevance guess that updates after every swipe, using my recent ratings as examples, so that the ranking improves before a full week of data exists. | Planned | #27 |
| RAT-12 | As a reader, I want a weekly tune-up that reviews my corrections (tab moves, issues pulled back from the archive, Irrelevant ratings on top items), tests rule changes on past issues and proposes the winners with before and after numbers for me to approve so that sorting improves without me writing rules. Nothing changes until I approve. | Planned | #26 |

## 9. Coming back to things

| ID | User story | Status | Source |
|---|---|---|---|
| RET-01 | As a reader, I want one tap back to the last issue I was reading, at the place I stopped, so that I can pick up where I left off. Sandip asked for one click. | Shipped | #44 |
| RET-02 | As a reader, I want my reading place carried between the Mac and the iPhone so that I can start on one and finish on the other. | Shipped | #44 |
| RET-03 | As a reader, I want to see how far into that issue I am so that I know how much is left before I go back in. | Shipped | #44 |
| RET-04 | As a reader, I want the way back to disappear once I finish, archive or rate the issue so that it never nags me about something I'm done with. | Shipped | #44 |
| RET-05 | As a reader, I want reading places kept in several issues at once so that I can have more than one long read going. | Planned | now-reading doc |
| RET-06 | As a reader, I want to save any issue for later from anywhere it appears so that I can set aside something long without opening it. | Shipped | #43 |
| RET-07 | As a reader, I want saved issues out of the unread list and safe from the automatic archive rules so that they wait for me without cluttering today. | Shipped | #43 |
| RET-08 | As a reader, I want a Saved list, newest saved first, with a count, so that I can see my read-later queue at a glance. | Shipped | #43 |
| RET-09 | As a reader, I want saving to be separate from reading, so an issue can be read and still saved, so that I can keep something I want to reread. | Shipped | #43 |
| RET-10 | As a reader, I want saving or unsaving from a list to leave the item where it is until the list reloads so that nothing jumps under my finger. | Shipped | save doc |
| RET-11 | As a reader, I want to sort or group the Saved list by newsletter or topic once it gets long so that I can pick by mood. | Planned | save doc |
| RET-12 | As a reader, I want a history of what I read, a day at a time, with the time of each, so that I can find something I read earlier but didn't save. Sandip asked for its own page, navigated by date. | Shipped | #42 |
| RET-13 | As a reader, I want to step to the nearest earlier or later day that has reads, jump to any date, and come back to today so that I can move through history quickly. | Shipped | #42 |
| RET-14 | As a reader, I want an issue read on two different days to show on both days, once each, so that each day's history is complete. | Shipped | #42 |
| RET-15 | As a reader, I want the day being viewed kept in the address so that Back steps through the days I visited. | Shipped | #42 |

## 10. Searching the archive

| ID | User story | Status | Source |
|---|---|---|---|
| SCH-01 | As a reader, I want to search everything my newsletters have said, read or unread, saved or archived, so that I can find the thing I half remember. | Shipped | #53 |
| SCH-02 | As a reader, I want results that hold my exact words first, with the words highlighted, so that I can see why each one matched. | Shipped | #53 |
| SCH-03 | As a reader, I want results that are close in meaning but don't use my words, kept as a separate group after the exact matches, so that I find related items without confusing them with exact hits. | Shipped | #53 |
| SCH-04 | As a reader, I want the matching story named when the match is inside a digest so that I can see which of its dozen stories I was looking for. | Shipped | #53 |
| SCH-05 | As a reader, I want results to appear as I type so that searching feels instant. | Shipped | #53 |
| SCH-06 | As a reader, I want to order results by best match or newest first so that I can find the latest coverage or the best fit. | Shipped | #53 |
| SCH-07 | As a reader, I want Back from a result to return to my results, and Back from the results to leave search, so that I can open several results in turn. | Shipped | #53 |
| SCH-08 | As a Mac reader, I want a keyboard shortcut that jumps to search (/) so that I can search without the trackpad. | Shipped | #53 |
| SCH-09 | As a reader, I want to peek, open, rate and save results like any other issue so that search results are fully usable. | Shipped | #53 |
| SCH-10 | As a reader, I want a clear "nothing found" when nothing matches so that I know to try other words. | Shipped | #53 |
| SCH-11 | As a reader, I want to narrow results by newsletter and date so that a broad query becomes useful. | Planned | search doc |
| SCH-12 | As a reader, I want to ask a question in plain words ("What have my newsletters said about agent evals this month?") and get an answer that links every issue it draws on, and says so when the archive has nothing, so that my newsletters become a reference I can query. | Planned | #21 |
| SCH-13 | As a reader, I want to choose whether a question may also check the web so that I control when answers go beyond my own newsletters. | Planned | #21 |

## 11. Managing newsletters

| ID | User story | Status | Source |
|---|---|---|---|
| SND-01 | As a reader, I want a list of every newsletter, Must Read first, with how many issues it sent and when it last arrived, so that I can see my subscriptions in one place. | Shipped | R7 |
| SND-02 | As a reader, I want to mark a newsletter Must Read, from the list or its own page, so that its issues always come first and skip the week-old archive rule. | Shipped | #2 |
| SND-03 | As a reader, I want to mute a newsletter so that its issues leave my unread lists without unsubscribing. | Shipped | Brief |
| SND-04 | As a reader, I want a page for each newsletter with its issues and how many I rated Relevant and Irrelevant so that I can judge whether it earns its place. | Shipped | Brief |
| SND-05 | As a reader, I want each newsletter's unsubscribe link easy to find so that I can leave one in a tap. | Shipped | Brief |
| SND-06 | As a reader, I want to set a newsletter to always News, always Learning, or Claude decides so that a mixed newsletter is sorted the way I want. | Shipped | #3 |
| SND-07 | As a reader, I want a monthly report card per newsletter (how often I open it, how often I rate it Relevant, how much it repeats my other newsletters, what only it covers) with suggestions to drop, each backed by the numbers, so that my subscriptions stay worth the attention. | Planned | #25 |
| SND-08 | As a reader, I want suggestions of well-regarded newsletters in topics where I'm thin, each with a sample issue and why it fits, so that gaps in my reading get filled. | Planned | #25 |
| SND-09 | As a reader, I want any unsubscribing to happen only when I tap it, through the newsletter's own link, so that nothing leaves without my say. | Planned | #25 |
| SND-10 | As a reader, I want each newsletter's prediction track record on its page so that I know whose calls to trust. | Planned | #24 |

## 12. Going deeper on a story (on demand, AI agents)

These take tens of seconds and cost cents per run. Results are kept per event, so a second look is instant and free.

| ID | User story | Status | Source |
|---|---|---|---|
| DEEP-01 | As a reader, I want a short dated timeline of how a story developed over the last few weeks of my own newsletters, every point linked to an issue I received, so that I understand today's news in context. | Planned | #19 |
| DEEP-02 | As a reader, I want "how we got here" for a story (5 to 8 dated points with links, from my archive and the web, ending at today) so that I understand the backstory my archive doesn't cover. | Planned | #16 |
| DEEP-03 | As a reader, I want to see how each of my newsletters covered the same event, side by side and grouped by where they land, so that I see the range of takes I already receive. | Planned | #17 |
| DEEP-04 | As a reader, I want what informed people across the web say about a story, grouped by stance (for, against, it depends) or by role (builders, researchers, investors, regulators), each person identified and each quote linked and checked against its source, so that I hear more than my inbox. | Planned | #17 |
| DEEP-05 | As a reader, I want to check a newsletter's claim against the original paper, filing or post, with what the newsletter said, what the source says, quotes and a verdict (holds up, goes further than the source, not in the source), so that I know what to believe. | Planned | #23 |
| DEEP-06 | As a reader, I want to be told plainly when a source is paywalled or unreadable instead of a guess so that I can trust what I'm shown. | Planned | #23 |
| DEEP-07 | As a reader, I want to follow a story and see updates only when it actually moves forward, never repeats, so that I can track a developing story without rereading the same news. | Planned | #22 |
| DEEP-08 | As a reader, I want one place listing the stories I follow, each with its timeline and a count of new developments, so that I can check what moved since I last looked. | Planned | #22 |
| DEEP-09 | As a reader, I want a followed story with no movement for 30 days to go quiet, and to unfollow any time, so that the list stays current. | Planned | #22 |
| DEEP-10 | As a reader, I want dated, checkable predictions pulled from my newsletters, listed by when they come due and settled as right, wrong or unclear with evidence, so that I learn who called it. | Planned | #24 |
| DEEP-11 | As a reader, I want to overrule any verdict on a prediction so that the record reflects my judgment. | Planned | #24 |
| DEEP-12 | As a reader, I want a slow result to show that it is working and fill in when ready, without blocking the rest of the app, so that I can keep reading while it runs. | Planned | #16 |
| DEEP-13 | As a reader, I want results kept for a story, so a second visit or a related story the next day is instant and free, so that deep dives are cheap to revisit. | Planned | #16, #17, #23 |
| DEEP-14 | As the owner, I want costly AI actions to run only when I ask, with some sense of what they cost, so that spend stays deliberate. | Planned | #16, #17 |

## 13. Briefings in other formats

| ID | User story | Status | Source |
|---|---|---|---|
| FMT-01 | As a reader, I want a daily spoken briefing of about 10 minutes from my top items, in a private podcast feed, so that I can catch up while walking or commuting. | Planned | Brief, Phase 3 |
| FMT-02 | As a reader, I want a daily narrated video of about 10 minutes covering my top stories over pictures, each story showing its newsletter, so that I can watch the news my newsletters carried. | Planned | #28 |
| FMT-03 | As a reader, I want that video split into chapters, one per story, each linking to its issue, so that I can skip around and go deeper. | Planned | #28 |
| FMT-04 | As a reader, I want to watch it on the phone and the Mac so that it fits wherever I am. | Planned | #28 |
| FMT-05 | As a reader, I want a newscast version with a human-like presenter so that it feels like a news programme. Expensive, likely weekly if built. | Planned | #29 |

## 14. Running the app (owner)

| ID | User story | Status | Source |
|---|---|---|---|
| OPS-01 | As the owner, I want one page that shows when mail was last checked, what the last run stored, filtered and failed, how story splitting and Claude's sorting went, and the success measure, so that I can tell at a glance whether the pipeline is healthy. | Shipped | R6, Status |
| OPS-02 | As the owner, I want an email when collection fails or hasn't run cleanly for 24 hours so that I find out before the library goes stale. | Shipped | R4, R5 |
| OPS-03 | As the owner, I want the last collection error shown in plain view so that I know what to fix (a revoked Gmail connection, for example, means reconnecting). | Shipped | README runbook |
| OPS-04 | As the owner, I want to see how many account-mail items Claude filtered on the last run so that I can spot misfires. | Shipped | #50 |
| OPS-05 | As the owner, I want monthly spend kept around $6, with a budget alert, so that this stays a cheap personal tool. | Planned | #6 |
| OPS-06 | As the owner, I want a fix to the cleaning or sender rules re-applied to the last 30 days, keeping my ratings and read state, so that past issues get the fix too. | Shipped (command line) | README |
| OPS-07 | As the owner, I want to reach newsletter management from the owner tools so that health checks and sender fixes sit together. | Shipped | App |

## 15. Across devices

| ID | User story | Status | Source |
|---|---|---|---|
| DEV-01 | As a reader, I want the app on both my iPhone and my Mac, each laid out for how I use it there, so that I can read wherever I am. | Shipped | Brief |
| DEV-02 | As a reader, I want read state, ratings, saves, Must Read stars, mutes and my reading place identical on every device so that I never redo work. | Shipped | Brief |
| DEV-03 | As a reader, I want changes made on the other device to show up when I come back to the app so that I'm never looking at stale state. | Shipped | #44 |
| DEV-04 | As a Mac reader, I want everything reachable in one step from anywhere (News, Learning, the Summary, Saved, History, search, filters, the way back to my last read) so that I never have to go "home" first. | Shipped | #12 |
| DEV-05 | As a Mac reader, I want the navigation to stay tidy as my topics and newsletters grow, showing what I use and tucking away what I don't, so that the screen never feels crowded. | Shipped | #36 |
| DEV-06 | As a Mac reader, I want a light and a dark appearance that follow my system setting so that the app is comfortable day and night. | Shipped | Spec 8 |
| DEV-07 | As a phone reader, I want an appearance that suits reading in low light so that late-night reading is comfortable. | Shipped | #12 |
| DEV-08 | As a reader, I want large enough tap targets, full keyboard support and reduced motion when my system asks for it so that the app is comfortable to use. | Shipped | Spec 13 |
| DEV-09 | As a reader, I want the Person of Interest touches (Relevant and Irrelevant, the yellow box, "No new numbers.") kept light so that the app has character without getting in the way of reading. | Shipped | Brief |

---

## Business rules the design must respect

These are product decisions already made. A design can present them differently, but should not contradict them without flagging it.

**Lists and states**
1. An issue is in exactly one state: unread, read or archived. Saved is a separate flag.
2. Opening an issue marks it read. (Planned, #56: a peek held for about 2 seconds also marks it read.)
3. Saving takes an issue out of Unread and out of the unread counts and the Summary. It stays saved when read.
4. Archiving a saved issue also unsaves it. An archived issue cannot be saved. Undo after an Irrelevant swipe restores both.
5. Muted newsletters are left out of the unread lists, the counts and the Summary, but their issues stay in Archived, search and the newsletter's own page.
6. Filtered mail (receipts, account mail) is never listed anywhere.

**Sorting and archiving**
7. The order of authority for News or Learning: the reader's move on that issue, then the newsletter's "always" setting, then Claude.
8. Promos are archived automatically. Unread News older than 7 days is archived automatically, except Must Read newsletters. Neither rule touches a saved issue, and each rule archives an issue at most once, so a restore sticks.
9. Every issue has exactly one topic today (two is planned, #27). Topic names never contain commas.

**Ranking and the Summary**
10. Only unread News from the last 14 days is ranked.
11. The Summary shows up to 20 issues, at most 3 per newsletter (the best of the rest fill in if that leaves fewer than 20).
12. Must Read issues in the Summary are marked but not pinned; the list stays in relevance order.
13. The first Summary shown each day (India time) fixes that day's top 5, which carry the yellow box all day. The success measure counts those, over 14 days, against an aim of 60% rated Relevant.
14. The order is stable within a day.

**The day in brief**
15. It covers News stories from issues received in the last 24 hours, leaving out promos and muted newsletters.
16. It is rewritten at most every 6 hours and only when at least 5 new stories have arrived; it is shown while less than a day old.
17. Every thread links only to issues the reader actually received.

**Reading place and history**
18. Only the last issue opened keeps a reading place today. It is stored as a share of the issue, not pixels.
19. "Finished" means the bottom of the screen reached the end of the issue. Finishing, archiving or rating the issue after opening it ends Now reading.
20. History shows one row per issue per day, at its latest open. An issue read on two days shows on both.

**Search**
21. Search covers every listed issue: unread, read, saved and archived. Filtered mail, promos and muted newsletters are left out.
22. Exact-word matches come first; close-in-meaning matches follow as their own group. Up to 50 results.

**Swipes (phone)**
23. Right is Relevant (the issue stays, unread). Left is Irrelevant and archive, with Undo for about five seconds. A second swipe the same way does nothing.
24. Swipes start away from the screen edge (iOS reserves the edge for Back).

**Privacy and cost**
25. Nothing in an email can run code. The app makes no requests to third parties.
26. On-demand AI features run only when the reader asks, and their results are kept per event.
