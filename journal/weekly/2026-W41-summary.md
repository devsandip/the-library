# 2026-W41: from a brief to a redesign

Monday 2026-10-05 to Sunday 2026-10-11. The project began on Friday, so this is the first week and the first weekly summary. Previous week: none.

## The week in one paragraph

I wrote the brief on Friday morning. By Sunday afternoon the reader was live on the iPhone and the Mac: ranked, split into stories, searchable, and redesigned. The week had one shape three times. Claude built quickly, the speed outgrew something underneath, and that thing was rebuilt. Whole issues were too coarse a unit for news, so every issue was split into stories. Hand deploys from Claude's worktrees left prod, main and my checkout disagreeing, so only main deploys now. Two looks grown one feature at a time stopped fitting, so Claude Design redrew the app from the requirements and it shipped the same day. Two things did not move: ranking has no verdict yet, and I have not tried any of it on a real iPhone.

## What happened

**Friday: from a brief to a sorted inbox.** I wrote the brief (`docs/prd.md`) in the morning: one private reader that learns my taste from Relevant and Irrelevant and puts the best on top. The reader was live at `sandip.dev/thelibrary` by 11:37, on its own CloudFront distribution behind one Amplify rewrite rule. The afternoon went to Gmail access and the first backfill, which stored 394 newsletters once it was paced. Claude sorted all 398 issues into News or Learning and a topic for about $1.61. A Must Read star replaced the keep list, and the backlog moved to GitHub issues.

**Saturday: the reader fills in.** I was busy, so Claude merged and deployed on its own. Seven pull requests reached prod in the afternoon: briefing cards on the phone and two panes on the Mac, an honest Summary with at most three issues per newsletter, swipe to rate, related issues, the icon, and the success measure. The day's top 5 is saved and boxed in yellow, and the aim is that I rate 60% of them Relevant. Then the unit changed from the issue to the story. Claude splits every issue into its stories, the same event is linked across newsletters, and the day in brief is written from them. Spend went from about $1.50 to about $5.50 a month. In the evening I added four ideas and all four shipped by 21:11: read history, Now reading, Save for later, and a tap to look inside an issue.

**Sunday: the foundations catch up.** Overnight work kept account mail out of the list (#50) and added search by words and by meaning (#53). The morning found two faults in how the work was done. The peek had shipped without logging a read, so history missed five digests I had read through it (#56). And prod was deployed by hand from whichever worktree Claude was in, so branches were stitched together on a laptop to be tested and my checkout fell behind. Claude built a pipeline: CI on every pull request, and merging to main deploys dev, runs the integration tests there, then deploys prod. The first run failed on how GitHub names this repository to AWS, and the second deployed everything. In the early afternoon Related moved from whole issues to stories, calibrated on prod's 2,264 stories before any code was written.

Then I said I don't like the UX on either device. Claude wrote a brief for Claude Design with 185 user stories and a second pack with no screens of the old UI, so the design would not anchor on it. The handoff came back within the hour and Claude built it in one pull request (#66). The phone has four tabs, with Today as a deck of cards and Browse under a filter sentence. The Mac is a keyboard console. Both have one look. It was on prod before 15:00.

## State at end of week

- Prod runs e5f277c: ingest every two hours, Claude's sorting, stories and the day in brief, ranking at read time, search, Related by story, history, Continue, Saved and the peek, all in the redesign on both devices.
- Spend is about $5.50 a month, mostly Claude.
- Every change is a pull request whose CI check passes, main is protected, and merging deploys in about 5 minutes. Nothing deploys prod by hand.
- Ratings count toward the 60% aim since 2026-10-10. It is too early to read (#5).
- The redesign was tested in mock mode only. Nothing since Saturday has been tried on a real iPhone.
- The design's deep dives, Follow and Ask are not built. They wait for their backends, starting with how a story evolved (#19).

## Beliefs that changed

- **The unit of news.** On Friday the reader was a list of issues. By Saturday evening the story is the unit. A digest's single embedding blurred a dozen stories together, and stories now carry the event links, the brief, search and Related.
- **What quality costs.** On Friday I expected Haiku at about half a cent an issue. With stories and the brief it is about a cent, and the month about $5.50 instead of $1.50. I took that trade on purpose.
- **Speed needs one path to prod.** On Saturday, Claude deploying on its own was the fast way. On Sunday the cost showed: prod, main and my checkout drifting apart. Now merging is deploying, and nothing else is.
- **One look, not two.** On Saturday I chose different looks for the phone and the Mac on purpose. By Sunday the two looks were the problem, and the redesign gives both one identity.
- **Calibrate on real data first.** Every similarity cutoff this week came from reading prod pairs, and twice the data overturned the plan. Looser event links chained two weeks of Muse coverage into one event, so they need 0.70. House style had to come out of whole issues, but it barely shows in stories, so Related by story skips that step.
- **Unchanged.** Ratings plus my five interests should be enough to rank well, still untested (#5). The *Person of Interest* touches stay a garnish; the redesign keeps yellow for the Machine's box alone.

## Decisions

- The app has its own CloudFront distribution behind one Amplify rewrite rule, because `sandip.dev` is Amplify Hosting.
- A Must Read star, set by hand, instead of a keep list of newsletters.
- Sorting, stories and the brief run on Haiku 4.5 until 5.5 reaches the account.
- Every issue is split into stories, not only digests. Event links need a cosine of 0.70, or 0.55 with a shared name.
- The day in brief is written on the schedule, at most every 6 hours and only when 5 stories are new.
- The day's top 5 is saved when the Summary first opens; the aim is 60% Relevant over 14 days.
- Saved is its own queue: saving takes an issue out of Unread.
- A peek left open two seconds counts as a read.
- Search shows word matches first, then "Close in meaning", with no Claude call.
- Related matches stories at 0.45 and leaves out a newsletter's own reruns at 0.80 or more.
- Only main deploys prod, through GitHub Actions, dev and the integration tests. Merges are squash merges.
- The redesign started from the requirements with Claude Design, briefed without the old screens, and gives both devices one identity.
- No controls for features without a backend: the deep dives, Follow and Ask wait for their issues.
- Claude merges on my word. Auto mode refused that once as self-approval; with auto mode off, the merges go through.

## Direction changes

- Hosting: was an extension of `sandip.dev`'s distribution, now the app's own behind a rewrite rule.
- Priors: was a keep list of newsletters, now the Must Read star.
- The unit of news: was the issue, now the story.
- Spend: was about $1.50 a month, now about $5.50. The budget alert plan went from $2 to $8.
- What counts as read: was opening an issue, now opening it or a peek left open two seconds.
- Unread: was every unread issue, now every unread issue I have not saved.
- Related: was whole issues with house style taken out, now stories.
- Shipping: was Claude deploying prod by hand from its worktree, now merging to main deploys. Merges were rebase, now squash.
- The look: was a cleaner list, then briefing cards on the phone and two panes on the Mac, now one identity with four tabs on the phone and a keyboard console on the Mac.
- A single tap: was open, then look inside, now look inside in Browse and open in Today's deck.

## Needs revisit

These carry into W42.

- The whole app on a real iPhone: swipes, the icon, Continue across devices, the peek, search at 375 px, and the redesign's safe areas, pull to refresh, sheet drag and VoiceOver (`docs/features/redesign.md`, Open).
- Ranking against the 60% aim after two weeks of ratings, around 2026-10-24 (#5).
- How a story evolved (#19), the first of the deep dives. Its `needs-decision` label asked whether it waits for the redesign, which has now shipped.
- The day in brief on a weekday, with about 90 news stories: threads and cost (`docs/features/narrative.md`, Open). Monday 2026-10-12.
- The AWS Budget at $8, around 2026-10-16 (#6).
- Cold starts: the first search waits about 3.3 seconds and Related about 3 (`docs/features/search.md`, `docs/features/related.md`).
- Pull to refresh waits a fixed 8 seconds for the Gmail check (`docs/features/redesign.md`, Open).
- The brief's packs are still untracked in the worktree `ux-redesign-handoff-9f9bf3`. What came back is in `docs/mockups/redesign/`.
- My calls: `robots.txt` on `sandip.dev` (#7) and the decision model (#27).
- Haiku 5.5, when the account gets it.

## Daily entries from this week

- [2026-10-10 19:28: Bootstrap, from a brief to a sorted inbox](../entries/2026-10-10-1928-bootstrap.md)
- [2026-10-10 19:29: The reader is live on the phone and the Mac](../entries/2026-10-10-1929-reader-live-on-phone-and-mac.md)
- [2026-10-10 19:30: Stories, and the day in brief](../entries/2026-10-10-1930-stories-and-the-day-in-brief.md)
- [2026-10-10 19:49: Read history, and four more ideas](../entries/2026-10-10-1949-read-history.md)
- [2026-10-10 21:11: Now reading, Saved, and a peek inside](../entries/2026-10-10-2111-now-reading-saved-and-a-peek.md)
- [2026-10-11 11:18: Search, and one way to prod](../entries/2026-10-11-1118-search-and-one-way-to-prod.md)
- [2026-10-11 13:37: Related stories inside a digest](../entries/2026-10-11-1337-related-stories-inside-a-digest.md)
- [2026-10-11 13:53: A redesign, briefed without the old screens](../entries/2026-10-11-1353-ux-redesign-brief.md)
- [2026-10-11 14:44: Today, Browse and the console](../entries/2026-10-11-1444-today-browse-and-the-console.md)
