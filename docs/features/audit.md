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
| Too few to tell | `few` | Fewer than 4 issues in the window. |
| Worth dropping | `notUseful` | Rated not useful at least twice, and more often than useful. |
| Worth dropping | `unopened` | Opened under 10% of its issues, and never rated useful. |
| Worth dropping | `repeats` | At least 8 linked stories, 60% or more of them carried first by another newsletter, and never rated useful. |
| Keep | `useful` or `opened` | Otherwise: rated useful at least once, or opened. |

The cards come worth dropping first, then kept, then too few to tell, each group with the most issues first. The thresholds are constants in `packages/core/src/audit.ts`, checked against prod below (#152).

## The page (#151)

- **Phone:** Subscription audit in Library, after Newsletters, with how many are worth dropping ("3 worth dropping") or "Nothing to drop". **Mac:** the same page from ⌘K. The ⌘K hint shows the count only once the page has been opened, so starting the console never reads a month of the archive.
- **`/library/audit`:** the window ("Last 19 days", with "Counting from 9 Oct" while it is under 30 days), then three groups: Worth dropping, Keep, Too few to tell. Each card has the newsletter's name, opening its page; why, in numbers ("Opened 1 of 14 issues, and never rated useful."); what it sent and what I did with it ("14 issues · 3 promos · 1 opened"); its stories ("20 stories · 9 ran first elsewhere, 5 in Business Insider · 2 only here"); and up to three headlines only it carried, each opening its issue at the story.
- **Worth dropping** cards have Unsubscribe ↗, the newsletter's own link opened in a new tab only on a tap, and Mute. Muting moves the card at once by the same rules the API uses (`suggest` in `@library/core/audit`), then the audit is read again, since a muted newsletter no longer counts as having carried a story first.
- **Mock mode** has seven newsletters: one worth dropping for each of unopened, mostly repeats and rated not useful; kept for Must Read (one of them never opened), useful and opened; and one too few to tell.

## Checked against prod (#152)

Prod's archive on 28 October, by a read-only probe from the laptop (30 days of counts; issues scaled to the 19 days since the first open, which all opens fall inside):

- **30 newsletters sent something; about 7 come out worth dropping, 16 kept and 7 too few to tell.** Every one worth dropping is so for `unopened`: dailies and promo senders opened at most once in about two weeks of issues.
- **Opens are sparse.** 53 issues were opened or peeked at, about a fifth of what arrived in the window, and 13 issues were rated in the month (8 useful, 5 not useful). A thumb is on the issue only: since #89 (19 October) a swipe in Today rates nothing. So `unopened` does nearly all the work, and the thumbs mostly keep things.
- **Hardly any story ran first elsewhere.** 106 of 2,225 stories came after another newsletter's story about the same event (5%), and no newsletter is above 9%. The repeats rule (8 stories, 60%) does not fire, and no threshold that still means "mostly repeats" would. Nearly every story is "only here", so that count says little; the headlines under it are what show what a newsletter covers.
- **"Too few" is weeklies.** Six of the seven have 3 issues in 19 days. From 8 November the window is a full 30 days and they have 4 or 5, enough to judge.
- **Two Must Read newsletters had no opens.** The star keeps them; the card now says so ("Must Read: starred to keep, though otherwise worth dropping. Opened 0 of 11 issues, and never rated useful.").
- **What moving each threshold would do** (worth dropping / kept / too few): opened share 5% 5/18/7, **10% 7/16/7**, 20% 9/14/7, 30% 10/13/7; at least 3 issues 11/18/1, **4** 7/16/7, 6 the same; not useful at least once or **twice**, no change; repeats at 10%, 30% or **60%**, no change.
- **The read** is a month of issues, stories and opens from `gsi1`. A story item is about 3 KB (its 512-number embedding is 2 KB) and the index projects everything, so the stories are about 8 MB: nine or so 1 MB pages, around a second in the API and a fraction of a cent a time. Not measured on prod.

So the thresholds stay as they are. 10% picks out the newsletters never or once opened without catching the ones opened now and then; 4 issues waits for a weekly's month; the repeats and not-useful rules cost nothing and would catch a newsletter that rewrites others or one I keep marking down. The group is now "Too few to tell", and a Must Read card says when only the star keeps it. Per-newsletter numbers stay out of this public repo; the page shows them.

## Decisions

- **Rules in code, not a model.** Every number is a count from the table, and the suggestion is a few comparisons on them. A model would add cost and a reason to doubt the verdict without knowing anything the counts do not.
- **Worked out when asked.** About a month of issues, stories and opens is a few small queries; nothing goes stale, and there is no schedule to run. "Monthly" in #25 becomes "whenever I look".
- **Opens, not read states.** Opened or peeked at is what I did; a read state can come from a swipe or Mark all read.
- **Carried first, not seen first.** A repeat is a story another newsletter carried earlier, whether or not I opened that one. It says the newsletter is redundant to my inbox, which is what dropping it fixes.
- **Must Read is never worth dropping.** Starring is the way to tell the audit to leave a newsletter alone, so there is no separate Keep button.
- **Mute on the card, not unsubscribe.** Nutgraf cannot unsubscribe for me: the link is the newsletter's own and may ask questions. Mute is the step Nutgraf can take at once, and undo.
- **The thresholds stayed after prod (#152).** See above: moving them would trade one or two newsletters opened once for another, and the window is still filling.
- **Thumbs up overrides opens and repeats.** A newsletter I rated useful is kept even if I rarely open it or it mostly repeats others; only more thumbs down than up outweighs that.
