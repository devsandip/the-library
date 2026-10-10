# The reader is live on the phone and the Mac

2026-10-10 19:29. Previous: [2026-10-10-1928-bootstrap.md](2026-10-10-1928-bootstrap.md)

## What happened

I told Claude to open pull requests for everything not yet merged, merge them and keep building. I also said it could deploy on its own while I was busy, and that it had my permission to do anything within the project. Seven pull requests went to prod over the afternoon, each with every hosting check passing.

- **The new look (#30).** I picked a combination: briefing cards on the phone, always dark, with one yellow accent; two panes on the Mac, with a sidebar, a list and a reading pane. It replaced the cleaner list look from the morning.
- **An honest Summary (#31).** The first prod Summary had 15 of its 20 issues from The Ken, and its reason lines did not match the issues. Now there are at most three per newsletter, my five interests are stored, and each reason names what really lifts the issue.
- **Swipe to rate on the phone (#32).** Right for Relevant, left for Irrelevant and archive, with Undo.
- **Related issues while reading (#33).** Each issue shows what came before and since on the same subject. Raw similarity mostly matched a newsletter with its own other issues, so each newsletter's house style is taken out first. About half of my issues have a match.
- **The success measure (#34).** The first Summary of each day saves its top 5. They carry the yellow box all day, and a line under the list says how many of the boxed issues I rated Relevant over the last 14 days. The aim is 60%.
- **An icon (#35).** Claude drew six options inspired by the show. I picked the first: a typewriter L inside the Machine's yellow box.
- **Folding sidebar sections on the Mac (#36).** Topics and Senders fold shut, and the browser remembers.

## Where we are now

The reader I described in the brief exists on both devices: ranked, rated with a thumb or a swipe, with the yellow box on the day's top 5. I have not tried it on a real iPhone yet.

## Decisions

- Claude merges and deploys on its own for this stretch: I was busy and checking in every few hours.
- The phone and Mac looks differ on purpose: briefing cards on the phone, two panes on the Mac.
- At most three issues per newsletter in the Summary: one newsletter took 15 of 20 places.
- The yellow box frames the top 5 as one group, not each row: per-row boxes piled up brackets at every boundary.
- The day's top 5 is saved when the Summary is first opened, so the measure counts what I was shown.
- Icon option 1, the L in the yellow box.

## Direction changes

- The look: was the cleaner list, now briefing cards on the phone and two panes on the Mac.
- Summary reasons: were raw similarity to a rated issue, now the part that lifts an issue most above the rest of the list.
- Shipping: was Claude preparing changes for me to deploy, now Claude merging and deploying with my permission.

## Needs revisit

- Swipe, the icon on the home screen and the yellow box on a real iPhone (`WORKLOG.md`, State now).
- "Best first" inside the tabs, once ratings exist (#5).
