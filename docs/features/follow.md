# Follow a story (#22, the newsletters' layer)

Follow a story and see it again only when it moves: DEEP-07 to DEEP-09 in the redesign, the `FOLLOW` button on a story and a Following page in Library. Grounded in what I receive. The daily web check for developments my newsletters missed waits for #16's search tool, and there are no notifications (the app has none).

Milestone 5 builds it in three pieces: the API (#120), the check after each ingest that adds the moves (#121), and the screens (#122).

## What it does

- **Follow** (`POST /nutgraf/api/issues/{id}/stories/{n}/follow`, `services/api/src/following.ts`). A follow is the story's event (#15), so the same news from another newsletter is the same follow. It starts from the event's kept timeline (#19) when one was written, otherwise from the story itself as one dated point (its summary). No Claude call: following is free and instant.
- **Following** (`GET /nutgraf/api/following`). Every followed story with its dated points, oldest first, each linking to the issue that carried it (at its story inside a digest), and how many points are new since I last looked. Moving stories first, latest movement first; quiet ones last.
- **New until seen.** A point the check after an ingest adds carries `added`; it is new while that is after the follow's `seenAt`. `POST /nutgraf/api/following/seen` marks every follow seen.
- **Quiet after 30 days.** A story with no movement for 30 days, counted from its newest move or from when it was followed, goes quiet: listed apart and no longer checked. Unfollow (`DELETE .../follow`) any time.
- **At most 20 followed stories**, so the check after each ingest stays one small call.

## Decisions

- **The event is the follow.** Timelines and takes are kept per event already, and the story index links the same news across newsletters; a follow per story would follow one event twice.
- **Starting points are the timeline's, copied.** The follow keeps its own points from then on, so writing the timeline again does not rewrite what I followed, and the check adds moves to the follow only.
- **One partition.** All followed stories are `FOLLOWING` items keyed by event id, read in one consistent query: a follow lists at once, and the check reads them all.
- **Unfollow by story, not by event id.** Event ids hold `#`, which would need escaping in a path; the web always has the story. A relink can move a story to another event, so unfollow also removes a follow that names the story itself.
- **The story sheet knows from the list.** Each follow lists the stories its points draw on (`stories`), so the web loads Following once and marks those stories followed, instead of a request per story.
