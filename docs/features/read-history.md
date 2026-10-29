# Read history (#42)

A page of what I read, one day at a time. Marked as the priority on 2026-10-10.

## What it does

- `/history` shows the issues read on one day (India's calendar), latest first, each with the time it was read. An issue read several times that day shows once, at its latest read.
- Earlier and later name the nearest days that have reads and skip the rest. A date field goes to any day; Today comes back. The day is in the URL, so Back works and a day can be linked.
- On the Mac the rows open in the reading pane; on the phone they are cards. The sidebar links to it on the Mac, a clock button in the header on the phone.

## Decisions

- **Index the open events, no new items.** Opening an issue has been logged as an event since the reader went live on 2026-10-09. Each open now also gets `gsi1` keys under `OPENS`, by time, so one query reads a day and a one-item query finds the nearest day with reads either side. There is one source of truth, and nothing else to keep in step.
- **What counts as read:** opening an issue, the same moment that marks it read. Since #56 (2026-10-11), also a peek left open 2 seconds (was: opening only). Tap for a summary (#41) shipped the same evening as a second way to read an issue, and five digests read that way that night never showed here. A peek marks the issue read too, so everything in history is read; it does not move Now reading, which has no place to keep for a peek. Rows say "Read" with the time, since a peek is not an open. The five peeks from 2026-10-10 were added from the API's request log.
- **One row per issue per day.** An issue opened on two days shows on both.
- **Opens before this shipped** were indexed once by `pnpm history-backfill`, which runs in the ingest Lambda and only touches opens without the keys, so it is safe to run again.
- **Days come from one helper** (`@library/core/days`): the API and the web app agree on where the reader's day starts. Since #185 that is the reader's time zone from their settings (India without settings); days step by date and a day's bounds come from the zone's offset that day, so a day across a daylight-saving change is 23 or 25 hours.

## Open

- Re-reading from the history page logs a new open, so the issue moves to today. That is intended: it was read today.
