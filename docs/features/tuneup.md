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

## The page (#159)

`web/src/pages/tuneup.tsx`, in Library after Subscription audit with how many rules are waiting, and from ⌘K on the Mac (whose hint shows the count once the page has been read).

- **Proposed rules first:** the newsletter, the rule ("Always Learning"), why in numbers ("You moved 4 stories to Learning that Jev put on News, and none the other way"), what it would do ("60 of 62 stories on Learning now · would move 2 more from News"), and up to three headlines of each. **Apply** takes the card off at once and sets the newsletter's setting; **Not now** takes it off and says how many are put off.
- **Then my corrections**, per newsletter: moves, the ones against Jev by where to, how many Jev was unsure of, and promos archived and pulled back. A newsletter with a setting says so.
- **Empty:** says what counts and that three moves one way make a rule.
- Mock mode has two proposals (ByteByteGo always Learning, The Juggernaut always News) and four newsletters with corrections, one of them only promos.

## Checked against prod (#160)

Prod's archive on 28 October, by a read-only probe from the laptop running this code (`readTuneup`, then the rules), and a scan of the table for what the tune-up does not count:

- **No corrections yet.** 639 issues, 3,536 stories from 33 newsletters, every story on the shelf Jev picked: none moved by me, so none against Jev and none unsure. Nothing the tune-up leaves out either: no `shelf` event anywhere in the table (5,929 items scanned), no issue I shelved myself, no newsletter with an "always" setting, none muted. I have read in Nutgraf since 9 October without moving a story or an issue to the other shelf.
- **Promos:** 65 issues archived by the promo rule, none pulled back. So no newsletter has two or more, and no "never a promo" setting is filed.
- **So the page shows its empty state** ("0 corrections", what counts, and that three moves one way make a rule), and no threshold can be checked against a correction.
- **What the share rule allows instead.** By Jev's calls, 25 of the 29 newsletters with stories have 75% or more on one shelf, 17 of them all; between them, 73 stories are on the other shelf. The other 4 are mixed, 53% to 66% on one shelf, with 252 on the other. A rule at 75% finishes a pattern, moving a handful of stories; at 60%, three more newsletters qualify and a rule could overrule Jev on up to 171 stories of one of them.
- **Jev is unsure** (0.4 to 0.6) **on 227 stories, 6%.** 451 are on Learning (13%) and 3,085 on News.
- **The read** is every story stored: 11 pages, about 10 MB (each story carries its embedding) and 1,282 read units an open, a fraction of a cent. From the laptop it took 13.8 s, each page 0.6 to 0.8 s against a 0.3 s round trip, so roughly 3 to 6 s in the API. Not measured there: the page has not been opened on prod. It grows by about 520 stories a week and would near the API's 28 s in roughly 7 to 10 months, so bounding it is #163.

So the thresholds stay as they are: 3 moves against Jev, none the other way, 75% on the shelf already. With no corrections, nothing argues for moving them; 75% is where Jev's own split divides the near-uniform newsletters from the mixed ones; and with 73 stories across 25 newsletters on the minority shelf, one or two moves would propose a rule after nearly any correction. Look again once I have moved stories for a few weeks. Per-newsletter numbers stay out of this public repo.

## Decisions

- **Rules, not wording** (2026-10-28): Jev's question stays as I left it on 2026-10-17, and Claude no longer picks the shelf. A rule is visible, mine, and undone by clearing the setting.
- **Worked out when asked, no schedule.** A weekly run only matters once a model is called; the counts are always current this way.
- **Promo pullbacks are counted, not acted on.** There is no "never a promo" setting; #160 would have filed one for a newsletter with two or more pullbacks, and prod had none.
- **The thresholds stayed after prod (#160).** Prod had no corrections to test them on; see above.
- **The unsure band is shared with ingest** (`UNSURE` moved to `packages/core/src/shelves.ts`).
