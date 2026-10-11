# Today, Browse and the console

2026-10-11 14:44. Previous: [2026-10-11-1353-ux-redesign-brief.md](2026-10-11-1353-ux-redesign-brief.md)

## What happened

The brief went to Claude Design an hour ago and the handoff came back: three explorations, my picks from them, and one combined spec with six phone screens, one Mac screen and a system board. Claude built it today in one pull request (#66), and I merged it.

The phone has four tabs now: Today, Browse, Saved and Library. The five rows of controls above the first story are gone. The top of every screen is one title line, and the first story starts in the top fifth of the screen.

- **Today** is the Summary as a deck. The day in brief is the first card until I fold it for the day, the five carry the yellow box, and a card follows my thumb. Right is Relevant and it stays unread, left is Irrelevant and archived, Later saves it, a tap opens it.
- **Browse** is everything else unread. Its filter bar is a sentence: "23 unread in News, all topics, all senders." Each underlined word is a control.
- **Saved** is the read-later queue.
- **Library** holds Search, History, Newsletters, Status and Settings, and lists the places still to come, so the tab bar never grows.
- **Continue** is a pill in every header.

Reading keeps the newsletter's own page, scaled to fit, with Relevant, Irrelevant, Save and the stories in a bar under it. A digest's stories open as a sheet, each with its source, the names it mentions, the other newsletters that ran it, and its related stories.

The Mac is a console: the queue, the reader and the issue's stories in three panes, driven by the keyboard. J and K move, R and X rate, U undoes, and ⌘K goes anywhere.

Both devices have one look now. Newsreader is for reading, IBM Plex for everything else, and yellow is only ever the Machine's box. It is dark by default and follows the system.

The API gained three small fields so the screens have their data: each story's names, when the five were fixed, and whether a read in History was an open or a peek.

The deep dives in the design (timeline, backstory, takes, the source check) are not built. Neither are Follow and Ask. They have no backend yet, so the app shows none of them rather than dead buttons. Each arrives with its own issue, in the place the design gives it, starting with #19.

## Where we are now

The redesign is merged and on prod. It was tested in mock mode only, at phone and Mac sizes, in light and dark. Nobody has used it on a real iPhone yet.

## Decisions

- One identity on both devices, from the handoff, built on the API as it is plus three fields.
- No controls for features without a backend: deep dives, Follow and Ask wait for their issues.
- A single tap opens a card in the deck (the design's proposed alternative); Browse keeps tap to peek and double tap to open.
- Irrelevant always archives, from every place it appears.
- Rows I read or save stay in place, faded, until the view changes.
- Old URLs redirect, so bookmarks and the home-screen icon still land.
- The handoff lives in the repo, under `docs/mockups/redesign/`.
- Claude merged #66 on my word.

## Direction changes

- The phone: was a dark briefing-card Home with five rows of controls above the first story, now four tabs whose screens open on one title line.
- The Mac: was a sidebar, a list and a reading pane in its own look, now a keyboard console in the phone's look.
- The Summary: was its own page, now Today on the phone and the top of the News queue on the Mac.
- Filters: were tabs, chips, a senders sheet and a view menu, now one sentence.

## Needs revisit

- The redesign on a real iPhone: safe areas, pull to refresh in the home-screen app, the story sheet's drag, VoiceOver (`docs/features/redesign.md`, Open).
- The deep dives and the job line, starting with #19's timeline (`docs/features/redesign.md`, Open).
- The weekly summary for 2026-W41, due Monday 2026-10-12.
