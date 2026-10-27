# Takes from my newsletters (#17, the first layer)

When several of my newsletters covered the same event, each one's take side by side, grouped by where they land: DEEP-03 in the redesign, on the story's Takes tab beside Timeline. Grounded in what I received. The second layer, what informed people across the web say (DEEP-04), waits for #16's search tool.

## What it does

- **`GET` and `POST /nutgraf/api/issues/{id}/stories/{n}/takes`** (`services/api/src/takes.ts`), like the timeline's: the GET answers the takes kept for the story's event, and the POST writes them now and keeps them.
- **Retrieve.** The story's event (#15) across newsletters, any date, then stories within three days either side that read alike (a cosine of 0.55 or more, where the story index links on a shared name). Muted newsletters and promos are left out. One story per newsletter stands for it, the event's own first, then the closest; at most 8 newsletters besides the open story's, and never the open story's own newsletter twice.
- **Write.** One Claude call (Haiku 4.5, `group_takes`) reads them oldest first, the open story marked. It puts the newsletters in one to four groups by where they land, each under a two-to-five-word label, with one sentence per newsletter on what it says or stresses that the others do not, and a gist of where they agree and differ. Stories not about the event are left out.
- **Checked by the code.** Every story id must be one it sent; each newsletter counts once, in the first group that has it; empty groups go. A take links to its issue, at its story inside a digest; the open story's take is marked. Fewer than two newsletters left means there is nothing to compare: "Only The Ken carried this in your newsletters." Nothing is kept then, so it can be tried again when more arrive.
- **Kept for the event** (`TAKES#<eventId>`), so the same news reached from another newsletter opens free.

## The tab (#109)

- **Phone:** the story sheet's Takes tab beside Timeline (`/issue/:id/story/:n/takes`). Idle, it says what it does and costs (`Your newsletters · the same news · ~1¢ · a few seconds`) with Run; ● and "Writing · 0:02" while it writes; ✓ once kept. Kept, the gist, then each group's label over its newsletters' sentences, each opening its story; the open story's is marked "This story" with a yellow edge. Then the receipt and Write again.
- **Mac:** the story index's key grid has a T row (T writes them), and the takes show compactly under the selected story, under its timeline.
- **One deep-dive frame.** Timeline and Takes share the state per story and kind (`web/src/timeline.ts`: a small `deepDive` factory) and the panel's idle, writing, error and kept frame (`DeepPanel` in `web/src/components/timeline.tsx`); each brings its words and its kept view. Backstory and Source will slot in the same way.
- **Mock mode** writes stand-in takes from the mock's related stories, in two groups.

## Decisions

- **In the request, not a job.** The design budgets Takes at up to 90 seconds because its web layer searches. The newsletters-only layer is one call over at most nine stories, like a timeline, so it answers directly.
- **The event, then what reads alike.** The story index's event is the exact match; stories a few days either side that read alike catch coverage the linking missed. The event's own stories come first, any date, so a later follow-up in the same event can stand for its newsletter.
- **One story per newsletter.** A take is a newsletter's angle; two WSJ stories on the same news would be one take twice.
- **Claude groups and words; the code owns the links.** As with timelines, ids go in and come back, so every take links to a story I received.
- **The corpus learns each story's event id** to find the event's stories without another read.
