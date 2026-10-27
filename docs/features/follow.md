# Follow a story (#22, the newsletters' layer)

Follow a story and see it again only when it moves: DEEP-07 to DEEP-09 in the redesign, the `FOLLOW` button on a story and a Following page in Library. Grounded in what I receive. The daily web check for developments my newsletters missed waits for #16's search tool, and there are no notifications (the app has none).

Milestone 5 builds it in three pieces: the API (#120), the check after each ingest that adds the moves (#121), and the screens (#122).

## What it does

- **Follow** (`POST /nutgraf/api/issues/{id}/stories/{n}/follow`, `services/api/src/following.ts`). A follow is the story's event (#15), so the same news from another newsletter is the same follow. It starts from the event's kept timeline (#19) when one was written, otherwise from the story itself as one dated point (its summary). No Claude call: following is free and instant.
- **Following** (`GET /nutgraf/api/following`). Every followed story with its dated points, oldest first, each linking to the issue that carried it (at its story inside a digest), and how many points are new since I last looked. Moving stories first, latest movement first; quiet ones last.
- **New until seen.** A point the check after an ingest adds carries `added`; it is new while that is after the follow's `seenAt`. `POST /nutgraf/api/following/seen` marks every follow seen.
- **Quiet after 30 days.** A story with no movement for 30 days, counted from its newest move or from when it was followed, goes quiet: listed apart and no longer checked. Unfollow (`DELETE .../follow`) any time.
- **At most 20 followed stories**, so the check after each ingest stays one small call.

## The check after each ingest (#121)

- **When.** After the stories are split and shelved, before the day in brief (`services/ingest/src/follow.ts`). It never fails the run: an error is logged and the next run tries again.
- **Candidates.** For each followed story that is not quiet, the stories received in the last three days that are in its event (#15), or read like the story followed or its six newest point stories (a cosine of 0.45 or more, related stories' cutoff). Its own stories, stories checked before and muted newsletters are left out; the closest 8, oldest first. Three days, not two hours, so an issue split late still gets its chance.
- **One call for all of them** (Haiku 4.5, `record_moves`), and only when some follow has candidates. Claude first names each followed story's matter narrowly ("Musk's Starlink cap on Ukraine's drones", not "Musk"), then gives every candidate a kind against it: a **move** (a new step in that matter: a decision, a result, an answer, a setback, a figure that changed), a **repeat** (the same step, a recap, more detail on a step already there, or comment on one) or **other** (the same company or field, a different matter). Then it words each move in one sentence, citing every story that reports it.
- **Checked by the code.** A move counts only with stories sent under its own follow that Claude called moves. Its date is its earliest story's; its sources are those stories' issues, at the story inside a digest. Several newsletters on one development make one point.
- **Written back.** Moves are appended with `added`, so they are new until Sandip looks; `movedAt` becomes the newest move's date; every candidate, moved or not, goes into `checked` (the newest 300), so a repeat is never asked about again. A follow unfollowed while the check ran is left alone. `seenAt` is never touched.

## The screens (#122)

- **Follow, where the handoff draws it.** On the phone, the story sheet's first row is Source, Related and Follow; once followed it reads Following ✓, and a tap unfollows. On the Mac, the key grid's F row (Follow, or Unfollow with ✓ Following), and F itself. Free, so no Run step and no cost line; a toast says what happened.
- **Following** (`/library/following`, `web/src/pages/following.tsx`): on the phone a Library row, out of Coming later, showing "2 new" in yellow or how many stories; on the Mac a ⌘K line with the same count. Each followed story: its newsletter, when it was followed and last moved, its headline (opening the story), its dated points (each opening the issue that carried it, at its story), and Unfollow. Quiet stories come last under "Quiet · no news for 30 days", dimmed.
- **New, then seen.** Opening Following reads the list again (the check may have run), notes which points are new, and marks everything seen; those points keep a yellow dot and "New" for the visit, while Library's count clears. Which points are new comes from the count: the follow's newest `unseen` points by `added`.
- **One list for the page's life** (`web/src/following.ts`), like the deep dives' states: a story sheet asks it whether a story is followed (by the story refs each follow lists) instead of asking the API per story; following and unfollowing change it at once.
- **Mock mode** starts with two followed stories, one with a new move and one quiet, and follows any story from its mock timeline or itself.

## Decisions

- **The event is the follow.** Timelines and takes are kept per event already, and the story index links the same news across newsletters; a follow per story would follow one event twice.
- **Starting points are the timeline's, copied.** The follow keeps its own points from then on, so writing the timeline again does not rewrite what I followed, and the check adds moves to the follow only.
- **One partition.** All followed stories are `FOLLOWING` items keyed by event id, read in one consistent query: a follow lists at once, and the check reads them all.
- **Unfollow by story, not by event id.** Event ids hold `#`, which would need escaping in a path; the web always has the story. A relink can move a story to another event, so unfollow also removes a follow that names the story itself.
- **A kind for every candidate, after naming the matter.** Asked only for moves, Haiku called a company's other news a move (Anthropic's IPO filing under its share pledge to a fund) and a recap with exact figures a move. Asked for a kind on every candidate after naming the follow's matter, it kept both out and still found the steps of a real story (probe below). The matters and kinds are not stored; they only steer the call.
- **The event or what reads alike.** The event alone misses follow-ups, which are new news by definition; reading alike alone at the related cutoff brings in the same company's other news, which the kinds then sort out.
- **The story sheet knows from the list.** Each follow lists the stories its points draw on (`stories`), so the web loads Following once and marks those stories followed, instead of a request per story.

## Probe (2026-10-27, prod, read-only)

Five stories from 20 October with the most close stories since, followed as of that day with the story itself as the only point, and the check replayed once a day for a week (`scratch/follow-probe.ts`, nothing stored). Each run read its three days, with `checked` carried over.

| Followed story | Candidates read | Moves |
|---|---|---|
| Fortune 500 Digest: Ukraine's Starlink-equipped drones lose link above 100 mph | 5 | 4: Musk ordered the cap; the effect on Ukraine's defences; Trump called Musk and speeds rose; connections still fail above 161 km/h |
| Pirate Wires Daily: Anthropic commits 5% of shares to a public benefit fund | 10 | 0 (the IPO filing and the cofounders' stock are other matters) |
| WSJ What's News: Musk pledges a SpaceX share to every American child | 4 | 0 (a later report with exact figures is a repeat) |
| The Pragmatic Engineer: the ROI of engineers' AI spending | 5 | 1: Apollo finds no financial benefit for non-tech S&P 493 companies |
| TLDR IT: enterprise AI needs organisational unlearning | 3 | 0 |

- **7 calls, 2.3 cents for the week**, 1,400 to 2,500 tokens in each. Two runs gave the same moves.
- **Before the kinds**, asked only for moves, the same week gave the Anthropic follow the IPO filing's losses and the Musk follow its repeat; that is why the call names the matter and gives every candidate a kind.
- **An essay's topic** (the ROI piece) gets the next data point on the same question, as the timeline does (`docs/features/timeline.md`): useful, though not a development of one event.
