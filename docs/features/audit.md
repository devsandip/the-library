# Subscription audit (#25, the archive layer)

A report card per newsletter: how much it sends, how much of it I open and find useful, how much of it another newsletter told me first, and what only it covers. Each card ends in a suggestion, keep it or worth dropping, with the numbers behind it. Unsubscribing is always my tap on the newsletter's own link. The agent half of #25, finding well-regarded newsletters for topics I am thin on, needs a web search provider (#16) and waits for one.

Milestone 8 builds it in three pieces: the API (#150), the page on the phone and the Mac (#151), and the thresholds checked against prod's archive (#152).

## The report card (#150)

`GET /nutgraf/api/audit` (`services/api/src/audit.ts`, the rules in `packages/core/src/audit.ts`). Worked out when asked from what is stored: no Claude call, nothing kept.

- **The window:** the last 30 days, starting no earlier than the first open ever logged. Nutgraf only knows what I opened since I started reading in it; an issue from before that would look ignored. The reader went live on 9 October (`docs/features/read-history.md`), so on 28 October the window is 19 days; from 8 November it is a full 30.
- **A card for every newsletter with issues in the window**, muted ones included. Newsletters that sent nothing in it are left out.
- **On each card:**
  - `issues`, and `promos` among them;
  - `opened`: issues opened or peeked at (#56). A swipe in Today rates and opens nothing, so it does not count;
  - `useful` and `notUseful`: its issues' thumbs;
  - `stories`: its stories in the story index (#15) that are linked to an event;
  - `repeats`: stories whose event another newsletter carried earlier, and `firstBy`, the newsletter that most often did. Muted newsletters do not count as having carried anything first, since I never see them;
  - `only`: stories whose event no other newsletter carried, with the latest three headlines (`onlyHeadlines`), so "what only it covers" is concrete;
  - its `unsubscribeUrl`, the link stored from its own mail.
- **Stories are read from a week before the window**, so a story early in it still finds the newsletter that carried its event first (events join within 3 days of each other, and can chain). A story's newsletter is its issue's, since rebuilding senders re-keys issues and not stories.

## The suggestion

In order, the first that applies:

| Verdict | Reason | When |
|---|---|---|
| Keep | `mustRead` | It is Must Read: my own word that it stays. |
| Worth dropping | `muted` | It is muted: I already do not see it. |
| Too new to tell | `few` | Fewer than 4 issues in the window. |
| Worth dropping | `notUseful` | Rated not useful at least twice, and more often than useful. |
| Worth dropping | `unopened` | Opened under 10% of its issues, and never rated useful. |
| Worth dropping | `repeats` | At least 8 linked stories, 60% or more of them carried first by another newsletter, and never rated useful. |
| Keep | `useful` or `opened` | Otherwise: rated useful at least once, or opened. |

The cards come worth dropping first, then kept, then too new, each group with the most issues first. The thresholds are constants in `packages/core/src/audit.ts`; #152 checks them against prod.

## Decisions

- **Rules in code, not a model.** Every number is a count from the table, and the suggestion is a few comparisons on them. A model would add cost and a reason to doubt the verdict without knowing anything the counts do not.
- **Worked out when asked.** About a month of issues, stories and opens is a few small queries; nothing goes stale, and there is no schedule to run. "Monthly" in #25 becomes "whenever I look".
- **Opens, not read states.** Opened or peeked at is what I did; a read state can come from a swipe or Mark all read.
- **Carried first, not seen first.** A repeat is a story another newsletter carried earlier, whether or not I opened that one. It says the newsletter is redundant to my inbox, which is what dropping it fixes.
- **Must Read is never worth dropping.** Starring is the way to tell the audit to leave a newsletter alone, so there is no separate Keep button.
- **Thumbs up overrides opens and repeats.** A newsletter I rated useful is kept even if I rarely open it or it mostly repeats others; only more thumbs down than up outweighs that.
