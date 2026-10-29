# Every item has an owner

2026-10-29 19:50. Previous: [2026-10-29-1700-nutgraf-for-any-reader.md](2026-10-29-1700-nutgraf-for-any-reader.md)

## What happened

Everything Nutgraf stores now can belong to a reader. Each item's key starts with its reader's id, so one reader's newsletters, stories, answers and settings can never show up in another's library; on dev, a second test reader finds an empty library and gets "not found" for my issues by id, in every deploy. It all sits behind a switch that is on for dev and off for prod, because my own library has to be copied onto my reader's keys first. The script for that copy is built and tried on dev; running it on prod is mine to do, and reminders are in TickTick for Saturday and Tuesday.

The next milestone didn't need the copy, so it was built meanwhile. Every model call is now metered against the reader who caused it, so a reader's cost is measured instead of guessed: today's test run was about 1.7 cents. Ask and the deep dives stop at 50 a day with a plain message. Predictions are settled for each reader at seven in their morning, and a new library gets its topics on its own once it has twenty issues. `pnpm readers` shows who is there and what they used today.

## Why

The keys are the part of opening Nutgraf up that cannot be bolted on later: once two people's mail is in one table, keeping it apart has to be built in. The meter and limits come next because AI cost per reader decides whether a free tier is possible at all.

## Where we are now

Milestone 14 is closed; milestone 13 waits on my prod copy. Then comes sign-up by email code, which first needs two things only I can do: DNS records for sending mail from sandip.dev, and asking AWS to let it mail anyone.
