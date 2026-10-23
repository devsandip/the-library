# How this evolved (#19)

A story against the last four weeks of my newsletters, as a timeline. It is the first of the redesign's deep dives, on the Timeline tab where the handoff draws it (`docs/mockups/redesign/README.md`, P4 and "Deep dives"). Built on related stories (#20) and the story index (#15).

## What it does

- **Where.** On the phone, the story sheet has a Timeline tab under Source and Related (`/issue/:id/story/:n/timeline`). On the Mac, the story index's key grid has an L row, and the timeline shows under the selected story once written.
- **Never on its own.** The tab says what it does, where it looks and what it costs (`Your newsletters · last 4 weeks · ~1¢ · a few seconds`), with Run. On the Mac, L is the asking. While it writes, the tab shows ● and a ticking "Writing · 0:03"; once kept, ✓.
- **Retrieve.** The story's closest stories, the way related stories finds them (a cosine of 0.45 or more, one per issue, reruns, promos and muted newsletters left out), from four weeks before the story up to now. At most 14, the closest. With none, there is no call, and the tab says "Nothing close in your newsletters from the last four weeks."
- **Write.** One Claude call (Haiku 4.5, `write_timeline`) reads them oldest first, with the open story marked. It keeps the stories that are steps in this story's own development and leaves out other news about the same company or field. Each step is one point of one sentence; several newsletters on the same step make one point. A gist says in one sentence how the story moved.
- **Checked by the code.** Every story id must be one it sent. A point's date is its earliest story's date, never Claude's, and the points are put in that order. The one point that cites the open story is marked as this story, with a yellow dot. With fewer than two points there is nothing to tell, and nothing is kept.
- **Each point opens the issue** that first carried it, at its story when that issue is a digest.
- **Kept for the event.** The timeline is stored under the story's event (#15), so the same news reached from another newsletter opens it free. The receipt says when it was written, how long it took and what it cost; "Write again" writes a new one in its place.

## Decisions

- **In the request, not a job.** The handoff's deep dives run as jobs because Backstory and Takes take up to 90 seconds. A timeline is one call of 4 to 9 seconds (probe below), so the API answers it directly and the API Lambda's timeout goes from 15 to 28 seconds (HTTP API waits at most 30). No job line and no polling. A run still carries on when the sheet closes: the answer lands in the page's state, and the tab shows ✓ when you come back.
- **Its matches are related stories', from four weeks before the story up to now.** #19 says "the last few weeks", default 4. Stories since count too, so an older story's timeline says what happened next.
- **Up to 14 stories in, up to 8 points out.** Enough for a month of a big story (the Anthropic IPO read 15 and kept 8 steps), and small enough for half a cent.
- **Claude picks the steps; the code owns the dates and the links.** As with the day in brief, ids go in and come back, so every point links to an issue I received.
- **Kept per event, written only on POST.** The GET is two reads. Nothing is written when there is nothing to tell, so Run stays there to try again once more has arrived.
- **One current point.** Claude sometimes cites the open story in two points (a launch and its numbers). The latest of them is marked, and the prompt asks for exactly one.
- **The model id and the reader line are shared.** `CLAUDE_MODEL` and `READER` moved to `packages/core/src/claude.ts`, so the API and ingest switch to Haiku 5.5 together (#85). The API role may now call the same models as ingest.
- **Cost shown as ~1¢.** The handoff's figure. The real calls cost 0.3 to 0.5 cents; the receipt shows each one's.
- **Mock mode** writes a stand-in from the mock's related stories, one point each, after a pause, so the states can be tried without AWS.

## Probe (2026-10-23, prod, read-only)

Six recent stories with the most close stories, run from a laptop against prod's table with nothing stored.

| Story | Stories read | Points | Tokens in / out | Cost | Time |
|---|---|---|---|---|---|
| WSJ: Anthropic's IPO prospectus | 15 | 8 | 2,471 / 474 | 0.5¢ | 6.8 s |
| The Pragmatic Engineer: the ROI of AI spending | 13 | 8 | 2,255 / 467 | 0.5¢ | 8.9 s |
| Pirate Wires: Anthropic's public benefit fund | 12 | 7 | 2,180 / 395 | 0.4¢ | 5.3 s |
| Fortune 500 Digest: Anthropic's $2 trillion IPO | 12 | 7 | 2,215 / 448 | 0.4¢ | 5.9 s |
| TLDR IT: runtime governance for enterprise AI | 9 | 5 | 1,716 / 247 | 0.3¢ | 3.9 s |
| TLDR Dev: AI spending and output | 9 | 8 | 1,831 / 423 | 0.4¢ | 5.4 s |

- **A news story reads as intended.** The Anthropic IPO went from the Akamai cloud deal (25 Sep) through the leaked S-1, two quarters of revenue and the public benefit fund, to the prospectus and the Nscale compute deal (21 Oct), drawing on six newsletters.
- **An essay's topic reads as a theme.** The ROI piece's timeline is a month of AI-spending numbers from Fortune, TLDR and the System Design Newsletter: a chronology of the argument rather than of one event. Useful, but not "how this evolved" in the strict sense.
- **The double current** (Fortune's story cited in two points) is what led to the one-current rule.

## Open

- Whether essay topics want a different prompt (or none) once I have used it on Learning stories.
- A relink (`pnpm stories --relink`) or a forced re-split can give a story a new event id; its kept timeline is then not found, and Run writes a new one.
- Haiku 5.5 when the account gets access (#85).
- The Mac shows a kept timeline under the story without asking; on the phone it waits behind the tab, as the handoff draws it.
