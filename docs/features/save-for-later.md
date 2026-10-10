# Save for later (#43)

A bookmark on every issue, and a Saved list to come back to.

## What it does

- A bookmark on every row and card (Home, the Summary, Saved, History, a sender's page) and on the issue page. Filled means saved.
- The Saved page lists every saved issue, read or not, newest saved first. On the Mac it has the reading pane; on the phone the cards swipe like everywhere else. The sidebar links to it with a count; on the phone it is Saved in Home's view menu.
- Saving takes an issue out of Unread and its counts, and out of the Summary, and the archive rules never touch it.
- The bookmark again, or archiving the issue, takes it off the list.

## Decisions

- **Saved is its own queue** (Sandip's call, 2026-10-10): saving takes the issue out of Unread, as read-later apps do. Saved issues skip the 7-day News rule, so if they stayed in Unread they would pile up there.
- **The `SAVED` partition of `gsi2`.** `gsi2` held only `UNREAD`; a saved issue moves to `SAVED`, sorted by when it was saved, whatever its state. So Unread, the unread counts, the Summary's candidates and the 7-day rule's query leave saved issues out with no change to any of them, and no new index (CloudFormation adds only one GSI per update, and none is needed).
- **`savedAt` on the issue**, recomputed with the other index keys in every write that changes the state, the rating or the save, so a saved issue keeps its partition when it is read, marked unread or rated.
- **Saved is separate from read.** Opening a saved issue marks it read and leaves it saved.
- **Archiving ends it.** Archiving a saved issue unsaves it in the same write, and an archived issue cannot be saved (400): the two lists never overlap. A swipe's Undo saves it again after the issue is out of the archive. "Move back to the inbox" from the reader does not.
- **The rules skip saved issues** in `autoArchive` itself (`attribute_not_exists(savedAt)`), so the promo rule and the 7-day rule are both covered, whatever query finds their candidates.
- **The row stays put.** Saving from a list fills the bookmark and leaves the row where it is until the list loads again, so nothing moves under the pointer and a slip is one more click.
- **A bookmark, not a swipe.** Swipe keeps right for Relevant and left for Irrelevant (Sandip's call).
- **On the phone, Save sits at the top of the issue page**, right of the way back: in the bar at the bottom, a sixth control clipped the Relevant and Irrelevant labels on a 375 to 402 pixel iPhone.

## Open

- Saved issues are listed one way only, newest saved first. Sorting by newsletter or topic waits until the list is long enough to need it.
