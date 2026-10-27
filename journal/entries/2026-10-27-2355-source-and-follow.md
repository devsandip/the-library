# Check the source, and Follow a story

2026-10-27 23:55. Previous: [2026-10-27-2230-learning-ask-and-takes.md](2026-10-27-2230-learning-ask-and-takes.md)

## What happened

The overnight build went on past the first three milestones and closed two more.

**Check the source (#23, the first version).** A story's Source tab reads the page the newsletter links to and checks the story's claims against it: what the newsletter says, what the page says, the page's own words, and whether it holds, goes further or is not there. A quote is shown only if it is on the page word for word. The page is read carefully: public addresses only, checked as the connection is made, small and quick, HTML or text. Of eight recent links on prod, five could be checked in 3 to 6 seconds for under a cent each; three sites refused (403, 429 and a paywall), and the tab says so.

**Follow a story (#22, from my newsletters).** Follow on a story's sheet, or F on the Mac. Following, in Library, lists each followed story with its dated steps. After each ingest, the last three days' stories that are in the same event or read alike are checked, and only real developments become new steps, marked new until I look. A story with no news for 30 days goes quiet.

The check is the part that needed care. Replayed over a week of prod stories, the first prompt filed Anthropic's IPO losses under its pledge of shares to a fund, and a recap of Musk's SpaceX share pledge as news. Asking Claude to name each followed story's matter narrowly first, then call every candidate a move, a repeat or other news, kept both out and still traced the Starlink story through four real steps: Musk's cap on Ukraine's drones, its effect, Trump's call, and the drones still failing. A week of checks for five followed stories cost 2.3 cents.

## Why

Both were in the redesign and waiting for their backends, and both answer from what I already receive: the source a newsletter links to, and the newsletters that come after. Checking the source is the first defence against a newsletter's spin; following is how a story I care about stops being something I have to remember to look up.

## Where we are now

Prod has both, checked through the API and in mock mode on both devices, not by me on a device. No story is followed on prod yet, so the check after each ingest has only run in tests and the probe.

## Decisions

- A quote from the source is shown only when the page holds it word for word; a verdict without one still shows.
- One page per check for now: the agent that follows a news page's links to the primary source is the next step for #23.
- A follow is the story's event, starting from its timeline if one was written; following costs nothing.
- New steps come only from the check after each ingest, and every story it reads is remembered, so nothing is asked about twice.
- The check names each followed story's matter and gives every candidate a kind before anything becomes a step.
- The API retries Bedrock twice before a reader sees an error.

## Direction changes

- The redesign's Follow and Source: were drawn and waiting, now built (Follow from my newsletters only).
- Library's Coming later: Following moved out of it.

## Needs revisit

- Whether the steps Following adds are ones I care about, once I follow live stories for a few days (`docs/features/follow.md`).
- An essay's follow gets the next data point on its question rather than a development; fine for now, worth a look.
- Following's and Backstory's web layers, and Takes', wait on a search provider account (#16).
- The primary-source hunt for #23.
