# The Library: product overview

Prepared 2026-10-11 for a UX redesign. Sources: the product brief (`docs/prd.md`), the technical spec, nine feature docs, the project journal and worklog, and all 38 GitHub issues (shipped and open).

This document describes what the product is and what it does. On purpose, it says nothing about how today's screens look or where controls sit today. Treat every feature as a need to design for, not as an existing layout to keep.

---

## 1. In one paragraph

The Library is a private newsletter reader for one person. It pulls about 30 newsletters out of Gmail every two hours, throws away the noise, and uses Claude to summarize each issue, sort it into News or Learning, tag a topic and split digests into their individual stories. It ranks what is unread by learned taste, writes a short briefing of the day's news, and lets the reader rate, save, search and come back to issues on an iPhone and a Mac. The name comes from Harold Finch's headquarters in the TV show *Person of Interest*.

## 2. The problem

Sandip subscribes to about 25 to 30 newsletters, spread over two Gmail labels and the inbox, and reads almost none of them. Existing readers (Meco, Gmail tabs) show everything in date order with no sense of what he cares about. A daily digest like TLDR holds a dozen unrelated stories, so "one email" is the wrong unit for deciding what to read.

## 3. Goal and how success is measured

- **Goal:** one place that learns his taste from simple Relevant and Irrelevant ratings, puts the best items on top, and is readable on any device.
- **Success:** he opens it most days, and the day's top 5 are things he would rate Relevant at least 3 times in 5, measured over a rolling 14 days, after two weeks of use. The app tracks this number itself.

## 4. Who it is for

Exactly one user: Sandip, the owner. Nobody else will ever sign in. It helps to think of him in three modes:

| Mode | Where | What he wants |
|---|---|---|
| **The spare-minute reader** | iPhone, often one-handed, a few minutes at a time (installed to the home screen) | See what matters today, triage fast (rate, save, dismiss), read one thing properly |
| **The sit-down reader** | Mac browser, wide screen, keyboard and trackpad | Work through a list, read long issues, search the archive, go deep on a story |
| **The owner** | Either device, rarely | Check the pipeline is healthy, manage which newsletters count, fix misfiled mail |

His interests, which seed the ranking: the tech industry, startups, AI, product management and system design, plus some general business news. He lives in India; the app's "day" runs on India time (IST).

## 5. How it works, in plain words

1. **Collect.** Every two hours from 6 am to 10 pm IST, the app reads two Gmail labels plus a short list of senders that land in the inbox. Read-only: it can never change or send mail.
2. **Filter.** Rules drop mail that is not a newsletter issue: GitHub notifications, Substack's own digests, receipts, verification codes and sign-in links.
3. **Clean.** Each issue's HTML is sanitized: scripts and tracking pixels removed, the original "view in browser" link and the unsubscribe link kept.
4. **Sort (Claude).** For every issue Claude writes a one-line summary (at most 25 words), decides News or Learning, picks one topic from a fixed list, and decides whether it is a normal issue, a normal issue with ads, a pure promo, or account mail. Promos are archived automatically; account mail is filtered out.
5. **Split into stories (Claude).** Every issue is split into its stories: a headline, a one or two sentence summary, the people and companies named, and the story's own link. A digest gives 7 to 17 stories; an essay gives one.
6. **Link events.** Stories about the same event in different newsletters are linked together, so the app knows that three newsletters covered the same launch.
7. **Rank.** Unread News is scored by how the reader has rated that newsletter, how close the issue is to what he rated Relevant (and to his five interests), and freshness, with a little randomness so quiet newsletters still surface.
8. **Brief.** Up to four times a day, Claude writes the last day's news as 3 to 6 short threads, each naming the newsletters it came from.
9. **Read.** The reader browses, filters, reads, rates, saves, searches and comes back to issues on either device. Everything he does (ratings, saves, read state, reading place) is the same on both devices.

## 6. Vocabulary

These are the product's nouns. The redesign can rename anything shown to the user, but the concepts exist in the data.

| Term | Meaning |
|---|---|
| **Issue** | One email from a newsletter. The basic thing you open and read. |
| **Newsletter** (also "sender") | A publication, such as Platformer or TLDR Dev. One email address can send several newsletters; the app splits them. |
| **Digest** | An issue that bundles many unrelated stories (TLDR, WSJ What's News). |
| **Story** | One item inside an issue: headline, short summary, names, its own link. An essay is a single story. Many planned features act on a story, not a whole issue. |
| **Event** | Stories from different newsletters about the same real-world happening, linked together. |
| **News** | Time-bound: not worth reading in three months. About 70% of issues. |
| **Learning** | Evergreen: still worth reading in three months (explainers, deep dives, essays). About 30%. |
| **Topic** | One of nine subjects Claude tags on every issue: AI & LLMs, AI Infrastructure, Product Management, System Design, Software Engineering, Startups & Business, Tech Industry, Data & Analytics, General Interest. |
| **Must Read** | A star the reader puts on a newsletter he never wants to miss (11 of 32 today). Its unread issues come first and are exempt from the 7-day archive rule. |
| **Relevant / Irrelevant** | The two ratings (thumbs up and down). The only signal the ranking learns from. |
| **Unread / Read / Archived** | An issue's state. Opening marks it read. Archived is "done with it", not deleted. |
| **Saved** | Set aside to read later. A separate queue: a saved issue leaves Unread and the archive rules never touch it. |
| **Muted** | A newsletter whose issues are hidden from the unread lists without unsubscribing. |
| **Promo** | An issue that exists only to sell (course sale, event invite, subscription offer). Archived automatically. About 10% of issues. |
| **Filtered mail** | Mail that is not an issue at all (receipts, verification codes). Never listed. |
| **The Summary** | The 20 most relevant unread News issues right now, best first. |
| **The day in brief** | Claude's short write-up of the last day's news, as 3 to 6 threads with their source newsletters. |
| **The top 5 and the yellow box** | The first five Summary items of the day, fixed once seen, marked with the Machine's yellow box (see section 7). |
| **The success measure** | The share of the last 14 days' top-5 items later rated Relevant. Aim: 60%. |
| **Now reading** | The last issue opened, with the place the reader stopped, on either device. |
| **Peek** | A quick look inside an issue (its stories, or a longer summary) without opening it. |
| **History** | The issues the reader opened, a day at a time. |
| **Related** | Issues from before and since that cover the same subject as the one being read. |

## 7. Character and tone

Light *Person of Interest* touches, never at the cost of readability. Sandip's words in the brief: "The theme is a garnish, not a costume." Visual style asked for: clean, dark-friendly, typography first.

These touches are part of the brief and should survive the redesign in some form:

- Ratings are labeled **Relevant** and **Irrelevant**.
- The day's top items get the Machine's **yellow box**: a thin yellow corner-bracket frame (the show's surveillance overlay).
- The empty state says **"No new numbers."**
- Sandip picked an app icon: a typewriter-style capital L inside the yellow box. It is a brand asset he chose; the designer can refine it.

## 8. What is built today (shipped to production, 2026-10-09 to 2026-10-11)

Grouped by job, not by screen.

**Getting mail in**
- Gmail collection every two hours, a four-week backfill on day one, a manual "check now".
- Noise rules and Claude together keep out non-issues (receipts, GitHub, Substack platform mail, verification codes, sign-in links).
- Newsletters that share an address are split; newsletters show by publication name, not author.
- Clean, safe rendering of any newsletter's HTML, with the original link and unsubscribe link kept.

**Sorting and organizing**
- A one-line summary, News or Learning, a topic and a promo verdict for every issue.
- The reader can move any issue between News and Learning, or set a newsletter to always land in one. His choices always win over Claude's.
- Must Read star per newsletter; mute per newsletter.
- Automatic archiving: promos, and unread News older than 7 days (except Must Read and saved issues). Restoring an issue keeps it restored.
- Every issue split into stories; stories linked into events across newsletters.

**Finding something to read**
- All unread issues in one place, split into News and Learning, with Must Read first.
- Filter by topic (several at once) and by newsletter (several at once). Views: Unread, All, Archived, Saved. Filters live in the address, so Back restores them.
- The Summary: top 20 unread News by relevance, at most three from one newsletter, each with a plain reason ("From a Must Read newsletter", "Close to your interest in AI"). Archive from the list; mark all read to bring up the next 20.
- The day in brief: 3 to 6 threads of the day's news with links to the issues behind each.
- The yellow box on the day's top 5 and the success measure.
- Peek: a quick look inside an issue (a digest's stories with headline, line and source link) without leaving the list.

**Reading**
- A clean reading view of the newsletter, with Claude's summary, publication, date, reading time, News/Learning and topic.
- Actions on an issue: Relevant, Irrelevant, mark read or unread, archive or restore, save, open the original, move to the other tab, go to the newsletter.
- Related issues from before and since, when something close exists (about half of issues).
- On a wide screen, the reader moves from issue to issue without losing his place in the list.

**Rating fast**
- On the phone, swipe one way for Relevant and the other for Irrelevant (which also archives), with Undo.

**Coming back**
- Now reading: one tap back to the last issue, at the place he stopped, carried between Mac and iPhone; it shows how far in he is and goes away when he finishes, archives or rates it.
- Save for later and a Saved list, newest saved first.
- History: what he opened, a day at a time, with jump to the nearest earlier or later day with reads, and a date picker.

**Searching**
- Search across everything received (unread, read, saved, archived): by words, with matches highlighted, and by meaning ("AI assistants that arrange vacations" finds "OpenAI ships agents that book travel"). Exact-word matches come first, then a separate "close in meaning" group. For a digest, the matching story is named. Best match or newest first. Searches as you type.

**Managing newsletters**
- A list of every newsletter with issue count, when it last arrived and its Must Read star.
- A page per newsletter: star, mute, always News / always Learning / let Claude decide, its unsubscribe link, its issues and rating counts.

**Owner tools**
- A Status page: signed-in account, when Gmail was last checked, the last run's counts and errors, story and Claude runs, the success measure, check now, sign out.
- Email alarms when collection fails or has not run cleanly in 24 hours.
- Sign-in with password plus an authenticator app; stays signed in for 30 days on each device.
- Public About, Privacy and Terms pages (Google's consent screen links to them).

## 9. What is planned (backlog)

Status as of 2026-10-11. The redesign should leave room for all of these, so the information architecture does not have to be redone when they ship. "Agent" means Claude works for 30 to 90 seconds (searching, reading, deciding), so the result arrives later and costs real money per run.

**Next up**
| Feature | What it is | Design notes |
|---|---|---|
| Peek counts as reading (bug #56, priority) | A peek held open for 2 seconds marks the issue read and puts it in History ("Read 9:31 PM" rather than "Opened"). | History needs to show read-by-peek and read-by-opening. |
| Ranking everywhere (#5) | A stored relevance score, re-ranked after each collection and each rating, as a "Best first" order inside News and Learning, with a one-line reason. Waits for about a week of ratings. | Newest first stays the default until there is enough data. Reasons per item. |
| Related stories inside a digest (#20, second version) | While reading a digest, each story shows its own relatives from the archive. | Needs a way to act on one story inside a digest. |
| How this evolved (#19) | For a story, a short dated timeline from the last few weeks of the reader's own newsletters, every point linked. About a cent, a few seconds. | Entry point on an issue or story; a timeline format. |

**Going deeper on a story (agents, on demand, cached per event)**
| Feature | What it is | Design notes |
|---|---|---|
| Background: how did we get here (#16) | 5 to 8 dated points with links, ending at today, from the archive plus the web. 10 to 30 cents a run, up to 90 seconds. | A "researching" state that fills in later; cached so a second visit is free. |
| What experts say, grouped (#17) | Layer 1: how each of the reader's newsletters covered the same event, side by side, grouped by stance. Layer 2: commentary from people with standing across the web, grouped by stance (for, against, it depends) or by role (builders, researchers, investors, regulators), every quote checked against its source. 20 cents to $1 a run. | Grouped takes with who said it and a link. |
| Ask the Library (#21) | A question in plain words, answered from the archive with a link to every issue used. Says so when the archive has nothing. 5 to 20 cents a question. | A question box and an answer with citations; can take tens of seconds. |
| Follow a story (#22) | Follow a story; a Following list with a dated timeline per story, updated only when the story actually moves; a count of new movement; goes quiet after 30 days; cap of about 5 followed stories for the web check. No push notifications exist. | A new top-level destination with unseen counts. |
| Go to the source (#23) | Check a newsletter's claim against the original paper, filing or post: what the newsletter said, what the source says, and a verdict (holds up, goes further than the source, not in the source), with quotes. Says so when a source is paywalled. | A verdict format with evidence. |
| Who called it (#24) | Dated, checkable predictions pulled from issues; a Predictions list by due date; settled as right, wrong or unclear with evidence; the reader can overrule; each newsletter gets a track record. Pays off over months. | A new destination; track record on each newsletter's page. |

**Managing the subscriptions**
| Feature | What it is | Design notes |
|---|---|---|
| Subscription audit (#25) | Monthly or on demand: a report card per newsletter (how often opened, how often rated Relevant, how much it repeats others, what only it covers), suggestions to drop, and suggestions of new newsletters to fill gaps. Unsubscribing only on the reader's tap. | A report view with numbers behind each suggestion. |
| Weekly tune-up (#26) | Once a week Claude reviews the reader's corrections (tab moves, issues pulled back from Archived, Irrelevant swipes on top items), tries changes to the sorting rules on past issues, and proposes the winners with before and after numbers. Nothing changes until he approves. | A proposal and approval flow. |
| Topic editor (#8, parked) | Create, remove, rename and regroup topics, with Claude re-sorting issues. Parked until it is missed. | Awareness only. |
| A list of filtered mail | See what the rules or Claude filtered, and restore a misfire. Today a misfire is only visible in logs. | Owner tool. |

**Other formats**
| Feature | What it is | Design notes |
|---|---|---|
| Audio briefing (Phase 3) | A daily 10-minute spoken briefing of the top items as a private podcast feed. | Mostly outside the app; a place to find the feed link. |
| Narrated video briefing (#28) | A daily 10-minute video: Claude's script read by a voice over pictures, a chapter per story linked to its issue. About $1 a video. | A Watch page with chapters, on phone and Mac. |
| AI anchor video (#29) | The same, with a human-like presenter on screen. $12 to $60 a video, so likely weekly if ever. | Same Watch page. |

**Smaller open items from the feature docs**
- Keep a reading place in several issues at once, not only the last one.
- Sort or group the Saved list by newsletter or topic once it is long.
- Sender and date filters on search results.
- A longer summary in the peek for single-story issues.
- Decision-model bake-off (#27): a cheaper model that returns calibrated probabilities could archive promos only when it is sure, and tag two topics when an issue sits between them.

## 10. Not in scope

- Anyone but Sandip. No sharing, social features or multiple accounts.
- Native apps. Responsive web only (installed to the iPhone home screen, and a Mac browser).
- Replying to, sending or managing email; syncing read state back to Gmail.
- RSS or any source that is not email.
- Push notifications (none exist today).

## 11. Platform facts and hard constraints

These come from how the app is built and hosted. A design that breaks one of them needs a reason.

- **Devices.** iPhone (smallest target 375 px wide, used as a home-screen web app) and a Mac browser (from a half-width window to a wide external display). Occasionally other browsers.
- **Newsletter content is uncontrolled HTML.** Each newsletter arrives with its own layout, fonts, colors and images, mostly built as 600 px wide email tables. It renders inside a sandboxed frame with no scripts. It is effectively always light, even when the app is dark. The app can frame it, not restyle it.
- **Privacy.** The app is private and hidden from search engines. No third-party requests: fonts and assets must be self-hosted (a strict content security policy). Email content never leaves the owner's AWS account except to the AI models.
- **Address.** The app lives at `https://sandip.dev/thelibrary/`; every view should be a URL so Back, links and reloads work.
- **Slow things are asynchronous.** The API answers within 15 seconds. Anything that takes longer (the planned agents, the day in brief) runs in the background and shows up when ready.
- **Cost-aware.** Spend today is about $5.50 a month. On-demand AI features cost cents per use, so they should be deliberate actions, not things that fire on every page view.
- **Accessibility.** Tap targets at least 44 px, full keyboard use on the Mac, reduced motion respected, readable contrast in light and dark.
- **iOS Safari owns the screen edges.** A swipe that starts at the left edge goes Back in the browser.
- **Stack.** Preact and plain CSS. Any design system needs to be buildable without a component library.

## 12. Content realities to design with

Real numbers from production, so layouts hold up with real data:

- About 25 issues a day; about 90 News stories on a weekday. The archive held 568 stored items and 2,242 stories on 2026-10-11, growing about 75 stories a day.
- About 30 newsletters (32 senders on 2026-10-09), 11 starred Must Read. Names run from short ones like "The Ken" to "Lewis C. Lin's Newsletter" and "System Design Newsletter"; one address can send several (TLDR IT, TLDR Dev, TLDR Data...).
- Subjects vary from 3 words to long clickbait lines. Claude's summary is at most 25 words.
- A digest holds 7 to 17 stories; the average issue has about 6. Story headline at most 12 words; story summary at most 45 words; up to 6 names per story.
- The day in brief: 3 to 6 threads, each a title of at most 8 words and 2 to 4 sentences (at most 80 words), with 1 or more source newsletters.
- The Summary: up to 20 items. Search: up to 50 results, in two groups (exact words, then close in meaning).
- About half of issues have at least one related issue; up to 3 earlier and 3 since.
- Many issues have no usable images. Every issue has an estimated reading time.
- History starts on 2026-10-09: 7 issues opened that day, 9 the next.
- Counts matter to the reader: unread per tab, per topic, per newsletter, and saved.

## 13. Lessons from the first build

Design-neutral facts learned while building, worth knowing before designing:

- **Room at 375 px is tight.** The first build ran out of space for top-level controls and per-issue actions on the narrowest iPhone more than once, and had to push some of them to awkward places. There are at least eight destinations today and several more planned, so navigation needs a plan from the start.
- **Single tap versus double tap costs time.** Telling a single tap from a double tap means waiting about 250 ms before the single-tap action runs, which makes it feel slower. The reader asked for this pairing (tap to peek, double tap to open), so if it stays, the delay needs hiding.
- **Content that expands in place and horizontal scrolling don't mix.** An item that grows stretches everything beside it.
- **Peek and open are both reading.** The first build counted only opening as reading, so issues read by peeking stayed unread and missing from History (bug #56).
- **Reading place is a share, not pixels.** The same newsletter is much taller on a phone, so the place is stored as a percentage.
- **One look or two?** The first build gave the phone and the Mac very different visual identities. Whether they should share one identity is an open question for the redesign.

## 14. Timeline so far

| Date | Milestone |
|---|---|
| 2026-10-09 | Brief written. Hosting, ingest, reader and sign-in built and live by midday. Gmail connected; 4-week backfill (394 issues). Must Read, Claude sorting, News and Learning. |
| 2026-10-10 | Topic and newsletter filters, the Summary with live ranking, the yellow box and success measure, swipe to rate, related issues, app icon, story splitting and event linking, the day in brief, History, Now reading, Save for later, peek. |
| 2026-10-11 | Account mail kept out; search by words and meaning. Sandip decides the UX needs a redesign on both phone and desktop. |
