# Now reading (#44)

One click back to the last issue I opened, at the place I left off, on either device.

## What it does

- A Now reading card shows the last issue opened, how far in it is ("35% read") and a thin bar. On the phone it sits under Home's header; on the Mac, under the main links in the sidebar.
- One click opens the issue at the place I stopped. On a Mac wide enough for the reading pane it opens in Home's pane; otherwise on the issue's own page.
- The place is saved while I read, so I can start on the Mac and carry on on the iPhone.
- The card goes away once I reach the end of the issue, archive it, or rate it.

## Decisions

- **One `STATE/NOW_READING` item**, not a place per issue: the issue, the place, when it became Now reading (`since`) and when the place was last saved. Opening an issue points it there. Reopening the same unfinished issue keeps the place; a finished one starts again from the top.
- **The place is a share of the newsletter, not pixels.** The window scrolls, not the newsletter's frame: the frame is sized to its content, so its own scroll never moves. The place is the share of the frame above the top of the screen. The phone's narrower frame is taller, and a share lands near the same words there; a pixel offset would not.
- **Putting the place back** happens on the frame's first fit, and again on each fit while late images resize it, until the reader moves (wheel, touch, a key or a click, listened for in the frame's document too, since input over the newsletter happens there). After 8 seconds it stops regardless.
- **Saving** happens at most every 5 seconds while the place moves by at least 1%, and again as the page goes away (`fetch` with `keepalive`, since a beacon cannot carry the sign-in token). Nothing is saved while the place is being put back.
- **Finished** means the bottom of the screen reached the end, give or take the footer: within 5% of the newsletter's height or 600 px, whichever is smaller. That saves 1, and finishing is final for that visit, so scrolling back up does not bring the card back.
- **A place saved in another issue moves Now reading back to it.** An older window (the Mac, say) still open on an issue, scrolled again after the phone opened something else, means I am reading it again. Finishing such an issue leaves Now reading alone.
- **Rated hides it only when rated after it became Now reading**, so an issue rated from the list and opened later still shows.
- **No new event per save.** Opens stay in the event log (read history, #42); places are one overwritten item, so a long read does not write hundreds of events.

## Open

- Only the last issue keeps its place. If I want places in several issues at once, the place moves to the issue item.
- An issue short enough to fit on one screen cannot be scrolled to its end, so it stays Now reading until I open another, archive it or rate it.
