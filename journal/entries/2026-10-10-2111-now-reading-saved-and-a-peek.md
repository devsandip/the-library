# Now reading, Saved, and a peek inside

2026-10-10 21:11. Previous: [2026-10-10-1949-read-history.md](2026-10-10-1949-read-history.md)

## What happened

I started a fresh session, approved the journal as written, and asked for three of the evening's ideas in a row: Now reading, then Save for later, then a tap for a summary. Claude could merge and deploy each one on its own. All three reached prod the same evening, each with every hosting check passing.

- **Now reading (#44, PR #48).** A card under the phone's header and in the Mac's sidebar takes me back to the last issue I opened, at the place I stopped, and says how far in I am. The place is saved every few seconds while I read, so I can start on the Mac and carry on on the iPhone. The card goes away once I reach the end, archive the issue or rate it. The place is a share of the newsletter, not a pixel offset: the phone's narrower frame is taller, and a share lands near the same words.
- **Save for later (#43, PR #49).** A bookmark on every row, card and issue, and a Saved page, newest saved first. Saving takes an issue out of Unread, as I asked, and the archive rules leave it alone. Archiving a saved issue takes it off the list.
- **Tap for a summary (#41, PR #51).** One tap on a row shows what is inside the issue, under it: for a digest, its stories, each with a headline, a line and its source. A double tap opens it. The peek reads the story index, so there is no new Claude call. With the Mac's reading pane, a click still opens the issue there.

While the work went on, a Substack verification code showed up in my list as a ByteByteGo issue. It came from ByteByteGo's own address, so the sender allowlist let it in. I filed #50 to keep account mail out, perhaps with Jev from #27.

## Where we are now

The reader has three ways back to an issue: where I left off, what I saved, and a look inside before I open anything. None of it has been tried on a real iPhone yet.

## Decisions

- Claude merges and deploys on its own again for this stretch.
- Saved is its own queue: saving takes an issue out of Unread. Saved issues skip the 7-day rule, so they would pile up in Unread otherwise.
- Archiving a saved issue also takes it off Saved; Undo after a swipe saves it again.
- Rating an issue after opening it ends Now reading on it, as the issue asked.
- In the tap for a summary, a row is the story, and a digest shows its stories inside it.
- On the phone, Save sits at the top of the issue page: a sixth button in the bottom bar cut off the Relevant and Irrelevant labels.
- The Must Read row keeps one tap to open: a card that grew would stretch the whole row.

## Direction changes

- A single tap: was open the issue, now look inside it. A double tap opens it.
- Unread: was every unread issue, now every unread issue I have not saved.
- What comes next: was Save for later, Now reading and the tap for a summary, now keeping account mail out (#50), then related stories inside a digest (#20, second version) and how a story evolved (#19).

## Needs revisit

- Now reading from the Mac to the iPhone, the bookmarks, and the new single tap, on a real iPhone (`WORKLOG.md`, Next).
- Account mail in the list (#50).
- Only the last issue opened keeps its place (`docs/features/now-reading.md`, Open).
