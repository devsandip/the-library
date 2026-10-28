# The hunt on real links

2026-10-28 09:05. Previous: [2026-10-28-0840-the-hunt-for-the-original.md](2026-10-28-0840-the-hunt-for-the-original.md)

## What happened

Once I signed in to AWS again, the hunt ran on real links from my newsletters, read-only. The first run showed it going in circles. On four of the five links it could read, it followed links to the same site's other pages: Pragmatic Engineer's other posts, Fortune's other articles, four pages of Apple's documentation. The prompt told it not to, but Claude only ever saw "[3]", never where the link went.

Now the code decides. A link to a site the hunt has already read gets no number, so it cannot be picked, and every numbered link shows its host. Social networks, help desks and app stores get no number either. Run again on digest items, the case it is built for, it went from an x.com post to Anthropic's own announcement, and from a Betanews report to Microsoft's notice.

Across the runs, when the first page could be read, the hunt reached an original four times in eight, three of them by following links, in 12 to 27 seconds for 1 to 3 cents. The bigger number is the other one: 14 of 22 links could not be read at all. The Ken, WSJ, Pirate Wires, The Juggernaut and Business Insider link to their own paywalled pages, and some sites turn away an honest reader.

## Why

The probe was the milestone's exit test, and it earned its place: without it the hunt would have shipped as a costlier way of checking a newsletter against its own website.

## Where we are now

Milestone 6 is closed and on prod. #23 waits on web search for originals a page does not link to, and PDFs are still refused. No milestone is open.

## Decisions

- Links are withheld in code, not avoided by prompt, because Claude cannot avoid what it cannot see.
- A short fixed list of sites that are never sources, and no longer one.
- The Source tab's line is now measured: about 2 cents, under half a minute.

## Direction changes

- The hunt: was free to follow any link the page numbered, now one page per site.

## Needs revisit

- Paywalled first pages, 14 of 22 links probed; no hunt passes them (`docs/features/source.md`).
- Fortune-style pages that cite nothing still cost one wasted page (`docs/features/source.md`).
- Web search for originals a page does not link to (#23, #16).
