# Weekly tune-up (#26, the rules layer)

Learn from my corrections. When I keep moving one newsletter's stories to the same shelf, Nutgraf proposes the rule that would have done it for me ("always Learning"), replays it over that newsletter's stories, and shows what it would have fixed and what it would move. Nothing changes until I tap Apply.

Milestone 9 builds it in three pieces: the API (#158), the page on the phone and the Mac (#159), and the thresholds checked against prod's archive (#160).

## What changed from the issue

#26 was written on 2026-10-09, when Claude put each issue on a shelf and the "158 flagged, 42 real" promo fix was the model to follow: try changes to Claude's instructions against past issues, keep the ones that fix more than they break. Since #81, Jev puts each story on a shelf, and on 2026-10-17 I called its accuracy good enough: no more tuning of its question (`docs/features/story-shelves.md`). Claude's prompt now only writes the summary, the topic and the promo call.

So this layer leaves both wordings alone and proposes **rules**, which are mine to set anyway: a newsletter's "always" shelf already exists (#94). Trying wording changes against past issues waits until there are far more corrections than a month gives.

## Corrections (#158)

`GET /nutgraf/api/tuneup` (`services/api/src/tuneup.ts`, the rules in `packages/core/src/tuneup.ts`). Worked out when asked from what is stored: no model call. The only thing kept is what I put off.

- **A move:** a story I put on a shelf myself, by moving it or its whole issue (`shelfSetBy: sandip`). Moving an issue moves every story in it.
- **Against Jev:** a move to the shelf Jev's stored probability did not pick. A move Jev agreed with (moving a whole issue often is one, for most of its stories) is counted as a move, not a correction.
- **Unsure:** of the moves against Jev, the ones Jev answered between 0.4 and 0.6. Many corrections in the unsure band say Jev is guessing there; corrections outside it say it is confidently wrong.
- **Promos pulled back:** issues the promo rule archived (`autoArchived: promo`) that are no longer archived. A promo I opened but left in Archived is not counted.
- **Story moves keep no date** (unlike issue moves, which log a `shelf` event), so the counts are over everything stored rather than over the last week.

## Proposals

"Always Learning" or "always News" for a newsletter, the first and only kind for now. Proposed when all of these hold:

| Rule | Why |
|---|---|
| At least 3 of its stories moved to that shelf against Jev | One or two moves are a story, not a newsletter. |
| None of its stories moved to the other shelf, against Jev or not | I have said it is mixed. |
| At least three quarters of its shelved stories are on that shelf already | The rule finishes a pattern; on a mixed newsletter like TLDR Dev it would overrule Jev on hundreds of stories. |
| It has no "always" setting and is not muted | There is nothing to propose. |

Each proposal is replayed over the newsletter's stored stories: `fixes`, the moves it would have made for me; `moves`, the stories Jev put on the other shelf that I left there, which the rule would take; `stories` and `onShelf`. Up to three headlines of each, latest first.

- **Apply** is the newsletter's own setting (`PATCH /senders/{id}` `{ shelf }`), which re-shelves its stories except the ones I moved, and their issues follow.
- **Not now** (`POST /tuneup/dismissed`) keeps the proposal's `fixes`. It stays hidden until I move more of the newsletter's stories that way.

## Decisions

- **Rules, not wording** (2026-10-28): Jev's question stays as I left it on 2026-10-17, and Claude no longer picks the shelf. A rule is visible, mine, and undone by clearing the setting.
- **Worked out when asked, no schedule.** A weekly run only matters once a model is called; the counts are always current this way.
- **Promo pullbacks are counted, not acted on.** There is no "never a promo" setting; #160 files one if prod shows a newsletter with two or more pullbacks.
- **The unsure band is shared with ingest** (`UNSURE` moved to `packages/core/src/shelves.ts`).
