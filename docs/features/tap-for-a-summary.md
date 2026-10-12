# Tap for a summary (#41)

One tap on a row shows what is inside the issue, under the row; a double tap opens it. Since 2026-10-12 a tap on the row's title opens it at once.

## What it does

- One tap on a card or a Summary line on the phone, or a row on the Mac without the reading pane, opens a peek under it. For a digest it lists the stories inside, each with its headline, a line and its source link. For a single story it says a little more than the row's one line. A Read it button opens the issue.
- A second tap within 250 ms opens the issue, as a single tap used to. A tap on an open peek's row folds it away.
- A tap on the title opens the issue at once, with no wait and no peek (2026-10-12).
- Keyboard: Enter opens, Space peeks.

## Decisions

- **A row is the story** (the default in the issue, which Sandip picked with it on 2026-10-10): the tap peeks at the issue on that row, and a digest shows its stories inside it.
- **From the story index, no new Claude call.** `GET /issues/{id}/stories` returns the headline, summary and link Claude wrote when it split the issue (#15), without the embeddings. Read once per issue a page load.
- **The double-tap window is 250 ms.** A single tap waits it out before the peek opens; a double tap opens the issue without the peek flashing first. A click with no pointer behind it (Enter) opens at once.
- **The reading pane keeps its click.** With the pane, a click already opens the issue beside the list, with Claude's summary at the top (#14), so peeking applies on the phone and on the Mac without the pane.
- **The Must Read row's lead cards open on a tap.** The row scrolls sideways and stretches its cards to one height, so a card that grew would stretch them all; those cards already show the most text.
- **The title opens; the rest of the row peeks** (2026-10-12; was: one tap anywhere on the row peeked). Sandip asked for it: a tap on the headline should take him to the issue, with no 260 ms wait. A tap on the newsletter line, Claude's line or the tags still peeks, and a double tap anywhere still opens. It holds for every list of rows: Browse, Saved, Today's list view, History, Newsletters and Search.
- **Swipe is unchanged.** A drag never counts as a tap: swipe already swallows the click that follows a drag.
- **Only web links.** A story's link comes from the newsletter, so the peek shows it only when it starts with http or https.
- **A peek left open 2 seconds reads the issue** (#56, 2026-10-11; was: a peek changed nothing). Read history lists it and an unread issue is marked read, as opening it would. One folded away sooner was only a glance. Now reading stays on the last issue opened.

## Open

- An issue not yet split (it arrived since the last run) shows "Not split into stories yet" with its opening line.
- A longer summary for single-story issues, if the story's own summary proves too thin: about a cent an issue at enrichment.
