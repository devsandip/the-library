# Thumbs instead of Relevant

2026-10-19 11:35. Previous: [2026-10-12-0951-nutgraf.md](2026-10-12-0951-nutgraf.md)

## What happened

I dropped Relevant and Irrelevant. A thumbs up now says an issue was useful, and a thumbs down says it was not. On the phone, a swipe on Today's deck only moves through the cards: left to the next one, right to the one before, and from the first card back to the day in brief (#89).

## Why

I dropped it because it was not working, and the numbers say the same. In ten days I rated 12 issues, 7 Relevant and 5 Irrelevant. Eleven of those came in the first three days. Then I rated nothing for six days, though I opened the ranked list on three of them. Of the 29 issues in the day's five so far, 6 were rated Relevant and 23 were never rated at all. The success measure, 3 in 5 rated Relevant, had almost nothing to measure, and the ranking was learning from a dozen ratings.

How it was built explains some of that.

- **Relevant asked the wrong question.** Whether an issue matches my interests is what the ranking already guesses before I see it. What it cannot guess is whether reading the issue paid off. Useful asks that.
- **A swipe did two jobs.** On Today's deck a swipe was the way past a card, and each way was a verdict: right was Relevant, left was Irrelevant and archived the issue. Moving on meant passing judgment, and a no also threw the issue away.

So the new version keeps the two apart. Swipes move, thumbs judge, and a thumb changes nothing else.

## What changed

- Each card on Today has thumbs up, thumbs down, Later and Open. A thumb fills green or red and the card stays put; the same thumb again takes it back. Later saves the issue and moves on.
- The reader on the phone has thumbs, Save, Archive, and Stories for a digest. Archive is there for digests now, because Irrelevant used to be their only way out.
- Rows in lists no longer swipe. On the Mac, Y is useful and N is not useful.
- The words follow: the card's reason says "You found The Ken useful 4 times", and Status reads "6 of 29 useful".

## Where we are now

Thumbs are live on the phone and the Mac since this morning's deploy. Every past rating carries over as a thumb, so the ranking keeps what it learned. The other thread this week is story shelves: Jev, TypeSafe's decision model, is to sort each story into News or Learning. Its scoring script shipped (#87), and the step that runs it after every ingest waits to merge (#88).

## Decisions

- Thumbs up means useful, thumbs down means not useful, for the reasons above.
- Swipes only move through Today's deck.
- The stored rating stays the same field, 1 or -1, so the 12 ratings so far count as thumbs and the ranking keeps them.
- A thumb changes only the rating. Thumbs down does not archive: it is a signal for the ranking, not a way to clear the list.
- Archive is in the phone's reader for every issue, digests included, since thumbs down no longer archives.
- A thumb leaves the deck where it is, and Later moves on. Rating and moving on are separate.
- Rows lose their swipe, because rows are not cards. Rating from a list means opening the issue.
- Y and N are the Mac's keys, since U is Undo.
- Claude merged #89 on my word.

## Direction changes

- Rating: was Relevant or Irrelevant (does this match my interests?), now useful or not useful (did it pay off?).
- Today's swipes: were right for Relevant and left for Irrelevant and archive; now left for the next card and right for the one before.
- Thumbs down: was also an archive; now it changes only the rating.
- Rows: were swiped to rate; now they do not swipe.
- Mac keys: were R and X; now Y and N.
- Success measure: was the share of the five rated Relevant; now the share given a thumbs up. The aim is still 3 in 5.

## Needs revisit

- Whether I use the thumbs more than I used Relevant. Check the Status line around 2026-10-26 (#5).
- #81's third question changes from "do swipes act on the story or its issue?" to "do thumbs rate the story or its issue?" (`docs/features/thumbs.md`, Open).
- No thumbs on rows or in the peek, so rating from a list means opening the issue (`docs/features/thumbs.md`, Open).
