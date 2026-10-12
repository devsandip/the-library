# The redesign: Today, Browse and the console

One identity on the phone and the Mac, from the Claude Design handoff (`docs/mockups/redesign/`, `README.md` there is the spec). It replaces the briefing cards on the phone and the two-pane look on the Mac (#12).

## What it does

- **Phone, four tabs:** Today, Browse, Saved, Library. The top of every screen is one title line (plus the filter sentence in Browse); the first story starts in the top quarter of the screen. Continue reading is a pill in every header.
- **Today** is the Summary as a deck: the day in brief first, then the 20 best, the day's five in the yellow box. Right is Relevant, left is Irrelevant and archived, Later saves, a tap opens. List view shows the same 20 ranked, the five in one frame.
- **Browse** is every unread issue of News or Learning. Its filter bar is a sentence: "23 unread in News, all topics, all senders." Each underlined word is a control.
- **Reading** keeps the newsletter's own page, white and never recoloured, with an action bar under it. A digest's stories open as a sheet with their source and related stories.
- **Library** holds Search, History, Newsletters, Status and Settings, and lists what is coming. New places go here; the tab bar never grows.
- **Mac, the console:** queue, reader and story index in three panes under a top bar, driven by the keyboard, with a status line for keys, messages and Continue. Library's pages open from ⌘K.
- **Theme:** dark by default, following the system; Library > Settings pins light or dark on that device.

## Decisions

- **Built on the API as it is, plus three fields.** The stories response carries each story's `names` (the story sheet's names line), the Summary carries `digestAt` (the console's "Fixed 07:52"), and History carries `via`, open or peek, so History says "Opened" or "Read" (#56).
- **Deep dives, Follow and Ask wait for their backends.** The handoff draws Timeline, Backstory, Takes and Source tabs, a job line, verdicts, and Follow and Ask buttons. None has an API yet (#19, #16, #17, #23, #22, #21), so none is shown: no dead controls. The story sheet and the story index show the source and related stories, which exist. Each piece goes in with its issue, in the place the design gives it.
- **One tap opens a card in the deck** (the handoff's proposed alternative, taken): the card already shows what is inside, so there is no 260 ms wait. Browse keeps tap to peek and double tap to open, and since 2026-10-12 a tap on a row's title opens it at once (`docs/features/tap-for-a-summary.md`).
- **Irrelevant always archives,** in the deck, on a row, in the reader and with X on the Mac, so the reader's bar has no separate Archive for a digest. A single-story issue gets Archive in place of Stories.
- **Undo puts back everything a change touched** (rating, archive state, saved state: rules 3 and 4), for every action, from the toast on the phone and with U on the Mac.
- **Rows keep their place** (RET-10). A list remembers the rows it showed; when a fresh copy drops one (read in the reader, saved), it stays where it was, faded, until the filters change or a pull to refresh. Back finds the list as it was, scrolled where it was.
- **Topics and senders are slugs in the URL** (`topic=ai-llms`, `sender=the-ken`). Older links with sender ids still work.
- **Old URLs redirect.** `/`, `/summary`, `/history`, `/search`, `/senders` and `/status` land on their new place, and a phone URL opened on the Mac (or the reverse) lands on that device's view of it. Bookmarks and the home-screen icon keep working.
- **The Mac's queue for News is the ranking.** Unread, best first, unfiltered: the Summary's 20 with the five in one frame, then any other unread News, newest first. Anything else (Learning, Saved, a topic, newest first) is the plain list.
- **Selections on the Mac replace the history entry,** as the reading pane did: J and K would otherwise fill Back with every issue passed.
- **On the Mac the window still scrolls the reader;** the queue and story index are sticky. The reading place (#44) works unchanged on both devices.
- **A wide newsletter is scaled to the column** with CSS `zoom` instead of squeezing its tables, so its layout survives and there is no sideways scroll.
- **Fonts are self-hosted:** Newsreader (variable, with optical sizes), IBM Plex Sans and Mono, Courier Prime for the L. The CSP is unchanged.
- **The app icon is the typewriter L in the yellow box,** drawn from Courier Prime's own outline.
- **The handoff is in the repo** (`docs/mockups/redesign/`): the spec, the HTML samples and the screenshots, without the old UI's screenshot.

## Open

- Nothing here has been tried on a real iPhone: safe areas, pull to refresh inside the home-screen app, the sheet's drag between heights, and VoiceOver.
- The deep dives and the job line (#19 first), then Follow and Ask.
- Pull to refresh waits a fixed 8 seconds for the Gmail check, as the old refresh button did.
- Retake the handoff's screens from mock mode for a before and after.
