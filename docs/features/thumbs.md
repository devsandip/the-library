# Thumbs: was it useful? (2026-10-19)

The Relevant and Irrelevant idea is gone. Sandip: "Its not working." A thumbs up says an issue was useful, a thumbs down says it was not. On the phone, swiping left and right only moves through Today's cards.

## What it does

- **Today's deck.** Left is the next card, right the one before. From the first card, right goes back to the day's brief; from the brief, left goes on to the card the deck was on. At the last card, and at the first with no brief, the card springs back. The progress line counts from the card on top ("Card 3 of 20"), and the hints under the deck name the ways that go somewhere.
- **The card's buttons:** thumbs up, thumbs down, Later, Open. A thumb fills green or red and the card stays where it is; the same thumb again clears it. Later saves the issue and moves to the next card.
- **The reader on the phone:** thumbs up, thumbs down, Save, Archive, and Stories for a digest.
- **The Mac:** Y is useful and N is not useful, on the keys and on the reader's key buttons. The queue marks a rated issue with a small thumb.
- **Rows** show "Useful" or "Not useful" with a thumb as a tag. Rows no longer swipe.
- **Words:** the ranking's reasons say "You found this newsletter useful 4 times" and "Like ..., which you found useful"; the Mac's code is "4× Useful". The success measure reads "7 of 20 useful (35%), 3 not useful". A newsletter's page says "12 useful · 3 not useful".

## Decisions

- **The stored rating is the same field.** `rating` stays `1` or `-1`, so every rating so far counts as a thumb and the ranking keeps learning from them. Only the words changed, plus `DigestStats`, whose fields are now `useful` and `notUseful`.
- **A thumb changes nothing else.** Irrelevant used to archive the issue. A thumbs down does not: it is a signal for the ranking, not a way to clear the inbox. Unread News still archives itself after a week.
- **The reader gets Archive for every issue.** Irrelevant was the only way to archive a digest from the phone's reader, so Archive now sits next to Stories. The bar is five buttons for a digest; the thumbs are icons only, so it fits a 375 px iPhone.
- **A thumb does not move the deck.** Rating and moving on are separate: the thumb shows it took, and a swipe moves on. Later does move on, since it means "not now".
- **The deck opens on the first card not dealt with yet** (rated, saved or read), as before, and stays on the card it is on while it is rated or saved.
- **Rows do not swipe.** A swipe on a row was a rating, and on the phone a swipe now only moves through cards. Rows are not cards, so they lost the swipe, the VoiceOver buttons that stood in for it, and the list code that collapsed a row swiped away. Rating from a list is in the reader.
- **Y and N on the Mac.** R and X named Relevant and Irrelevant; U is Undo, so the thumbs are Y (yes, useful) and N (no).
- **The swipe labels are neutral.** The flag that shows as a card leans is ink, not green or red, since neither way rates anything.

## Open

- #81's third question (do swipes act on the story or its issue?) becomes: do thumbs rate the story or its issue?
- No thumbs in the peek or on a row: rating from a list means opening the issue. Worth adding if that turns out to be a step too many.
