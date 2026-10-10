# The day in brief (#18)

Today's news as a few threads, at the top of the Summary. Built on the story index (#15).

## What it does

- **Input.** News stories from the issues received in the last 24 hours: the issue's shelf decides, and promos and muted newsletters are left out. Stories of one event (#15's links) are merged into one line with every newsletter that carried it.
- **Write.** One forced tool call to Haiku 4.5 (`write_narrative`) returns 3 to 6 threads. A thread is one development: one big story, or several stories about the same development. Each has a title (at most 8 words), 2 to 4 plain sentences (at most 80 words) and the ids of the stories it draws on. The code checks the ids and turns them into the issues behind them, so every link is to an issue Sandip received.
- **When.** After the story index on every scheduled run, if the day has at least 8 News stories, the last version is at least 6 hours old, and at least 5 stories are new to it. Never after the run's 9-minute mark. `pnpm narrative --force` writes one now.
- **Where.** `GET /summary` returns the latest version while it is less than a day old. The Summary shows it above the list in a card that folds shut, remembered per browser. On the Mac with the reading pane, it fills the empty pane instead, so the list column keeps the top 5 in view; its newsletter links open their issues in the pane.

## Decisions

- **Written on the schedule, not when the Summary opens.** The API Lambda times out at 15 seconds and a call takes 5 to 15, so the ingest Lambda writes it and the page only reads it. Ready when Sandip looks, at the cost of versions nobody reads.
- **At most every 6 hours, and only when 5 stories are new.** About a cent a version, so at most four a day: about $1 a month. Every run would have been 12 a day.
- **One stored version (`STATE/NARRATIVE`), overwritten.** No history until a feature needs one.
- **Stories merged by event before the call,** so a story five newsletters carried counts once and the thread can name all five.
- **No em-dashes:** the prompt says so, and any that slip through become commas, Sandip's house style.
- **Where it shows:** the issue left placement open, with the top of the Summary as the default. The Mac's reading pane is empty until an issue is opened, which is the better spot there; the narrow list column keeps the top 5 in view.

## Probe (2026-10-10, prod, a quiet Saturday)

39 News stories from 5 newsletters: 3,900 tokens in, 700 out, $0.0074. The first prompt joined unrelated stories under one title (TSMC's revenue with IBM's quantum spinoff) and used an em-dash. The second, which says every story in a thread must be about its one development, kept each thread to one development, and merged the Surface Laptop stories from TLDR Hardware and Installer into one thread through their event link.

## Open

- Weekday volume (about 90 News stories) roughly doubles the input; check the threads and cost after a working day.
- Haiku 5.5 when the account gets access.
