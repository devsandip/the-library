# Subscription audit

2026-10-28 14:50. Previous: [2026-10-28-1050-who-called-it.md](2026-10-28-1050-who-called-it.md)

## What happened

Library has a Subscription audit: a card for every newsletter that sent something in the last month, saying how much it sent, how much of it I opened or peeked at, how I rated it, how many of its stories another newsletter carried first, and three headlines only it carried. Each ends in a suggestion with the numbers behind it: worth dropping, keep, or too few to tell. The ones worth dropping come first, with the newsletter's own unsubscribe link and a Mute button.

There is no model in it. The suggestion is a handful of rules on counts: Must Read is always kept, muted is worth dropping, under four issues is too few to judge, and otherwise a newsletter goes if I mark it down more than up, hardly open it, or mostly get its stories elsewhere first.

The month only starts on 9 October, when Nutgraf began logging what I open; before that, an unopened issue tells nothing. So today it covers 19 days, and from 8 November a full 30.

On my real archive it suggests dropping about 7 of 30, every one because I hardly open it: dailies and promo senders opened once or never. The repeats rule never fires: only 5% of stories run after another newsletter's, so what I thought of as overlap is mostly not there. The "too few" group turned out to be weeklies, so it is called that now. And two newsletters I starred as Must Read had no opens at all; the star keeps them, but their cards now say so.

## Why

I subscribe faster than I read. The archive already knows what I open and what repeats, so it can tell me which subscriptions earn their place without me keeping score.

## Where we are now

Milestone 8 is closed and on prod. The page has been checked in mock mode, not yet signed in on a device. Finding new newsletters for topics I am thin on, the other half of the idea, waits on a search provider.

## Decisions

- Rules on counts, worked out when the page opens: no model, nothing stored, nothing scheduled.
- The window starts at the first open logged.
- A story counts as a repeat only if another newsletter I still see carried it earlier.
- Must Read is never worth dropping; the card says when only the star keeps it.
- The thresholds stayed after the check against prod.

## Direction changes

- Subscription audit (#25): was a monthly agent run; now a page worked out whenever I look, with the agent half (finding newsletters) waiting on web search.

## Needs revisit

- Whether "hardly opened" is fair to a newsletter I read only as Today's cards; opens and thumbs are thin.
- The audit after 8 November, with a full month.
- Finding newsletters for thin topics, once there is a search provider (#25).
