# Who called it (#24)

Dated, checkable predictions from the newsletters, with who made them and when they come due, so they can be settled later from what the newsletters report. The archive layer: everything here reads Sandip's own newsletters; settling by web search waits on a search provider (#16).

## Spotting predictions (#138)

- **When:** after the shelves on every ingest run (`services/ingest/src/predictions.ts`), each issue not screened yet, oldest first, inside the run's time budget. Promos and muted newsletters are skipped, as they are from stories. It never fails the run; a screening that fails three times is left alone.
- **A cheap screen first** (`forwardPassages`, `packages/core/src/predictions.ts`): the issue's clean text cut into sentences, keeping those that look forward (will, expects, forecasts, plans to, on track, likely to) and name a time (a year from 2020, a quarter, a month, "next year", "within two years", "by the end of the year"), each with the sentences either side, up to 8,000 characters. An issue with none is marked screened with no Claude call.
- **One Haiku call** (`record_predictions`) with the date sent, the issue's story headlines and the passages. It returns up to five predictions that say something specific will or will not happen, with a time frame, that could be checked from later news. It skips vague views, conditions without a time, dates fixed by whoever runs them (a scheduled launch event, an election) and things already done. Each comes with:
  - `text`: the prediction in one sentence that stands on its own;
  - `who`: the person or organisation quoted, or the newsletter's writer;
  - `own`: whether it is the newsletter's own call;
  - `quote`: the newsletter's exact words, at most 40;
  - `by`: the period, as a day, a month, a quarter or a year, which Claude works out from words like "next year" given the date sent;
  - the story it belongs to.
- **Checked:**
  - a prediction is kept only when its quote is in the issue word for word (case, spacing and curly quotes aside), so a made-up one never gets in;
  - its period must end after the day the issue was sent and within 20 years;
  - due is the period's last day: "2027-03" is 31 March, "2027-Q3" is 30 September, "2027" is 31 December;
  - a quote counts once per issue.
- **Kept** in the `PREDICTIONS` partition, `open` until settled (#139). The issue is marked `predictedAt` with its count.
- **The archive:** `AWS_PROFILE=admin pnpm predictions --days 120`, once, after deploy.

## Settling them (#139)

- **When:** every morning at 07:30 IST, after the first ingest run, a schedule (prod only) starts the jobs Lambda with `{ kind: "settle" }`; `AWS_PROFILE=admin pnpm settle` does the same by hand. It takes the predictions that are due (by their due day in India) and either open, or unclear with tries left and their retry day come; never one Sandip has set. At most 20 a day, oldest due first, four at once.
- **Search:** the archive story by story, as Ask searches it (`searchStories`, by words and by meaning), for the prediction's sentence, from the day after it was made to today; never its own issue, promos or muted newsletters. The best 12, oldest first.
- **Nothing found:** unclear, "Nothing in your newsletters since has mentioned it.", with no call.
- **One Haiku call** (`settle`) with the prediction (what, who, the quote, when said, when due) and the stories: right only when a story shows this same thing happened on or before the due date; wrong only when a story shows it did not by then (delayed, cancelled, a different outcome, or later than the due date); unclear otherwise. A story about something else, even about the same company, is not evidence; silence is unclear, not wrong; dates are compared exactly. A one-sentence why, and the stories that show it.
- **Checked:** right or wrong needs at least one of the stories sent, or it becomes unclear. The stories become the evidence (issue, story, newsletter, headline, date).
- **Unclear is tried again** 14 days later, three tries in all, then stays unclear.
- **Written** onto the prediction (`status`, `why`, `evidence`, `settledAt`, `tries`, `nextTry`), with a condition that Sandip has not set a verdict meanwhile (#140).

## Decisions

- **Rides along with ingest, not with the story split.** Asking the split call for predictions too would change the story index's prompt and need every issue split again. A separate call that only sees forward-looking passages costs pennies a month and leaves the index alone.
- **The screen is a regex, not a model.** It only has to throw away the sentences that cannot be predictions (most of every issue); Claude decides on the rest. #24's build note suggests a decision model like Jev for this screening (#27); a regex is enough until it misses things.
- **Claude names the period; the code ends it.** Claude is good at reading "by the holidays" against the date sent, and the code is good at calendars. Tests cover the code's half.
- **No quote, no prediction.** A prediction whose words are not in the issue is dropped whole, not kept without its quote.
- **A newsletter's own calls are marked** (`own`), so its track record counts only those, not the forecasts it reports.
- **Settled in the jobs Lambda, on a schedule.** Settling needs the archive search and its corpus, which live with the API; the jobs Lambda has them and two minutes. A separate schedule, not a step in ingest, keeps a slow settle from crowding an ingest run.
- **From the archive only.** Later newsletters report what happened; settling by web search waits on #16's provider.
- **Strict about wrong.** Haiku's first prompt called a prediction wrong from a story about something else (OpenAI's models coming to Google Cloud, against OpenAI retiring old ones) and was loose with dates. The prompt now asks for a story about the same thing and exact dates; most of what it still gets wrong are companies' own announced dates, which spotting should not have kept (#143).

## The archive (2026-10-28, prod)

`pnpm predictions --days 120`: 566 issues screened, 160 with forward-looking passages, 172 predictions kept, no errors, in 3 minutes, for 37 cents (241,341 tokens in, 26,143 out). 32 are the newsletters' own calls. 16 were already due; 34 more come due in December 2026 and 28 at the end of 2027; the furthest is 2036.

## Settling probe (2026-10-28, prod, read-only: `scratch/settle-probe.ts`)

The 16 due predictions settled from the archive with writes kept in memory, after the prompt was made strict: 6 right, 2 wrong, 8 unclear (5 with nothing since), in 56 seconds for 2.2 cents.

- Right and well shown: the Fed's quarter-point rise on 17 September (four stories), the Treasury enrolling 60 million children in Trump Accounts, Bumble agreeing to go private with Ithaca on 19 October.
- Weak: OpenAI retiring GPT-4 and o1 on 23 October called wrong from a story about OpenAI's models coming to Google Cloud; Starship's "no earlier than 22 September" and Google's satellite launch dated 1 October called right. All three are companies' own announced dates, not forecasts; spotting should have skipped them (#143). Sandip can overrule any verdict (#140).

## Spotting probe (2026-10-28, prod, read-only: `scratch/predictions-probe.ts`)

Twenty recent issues, at most two per newsletter, screened and sent to Haiku from a laptop, nothing written.

- **The screen passed 6 of 20 issues to Claude.** The rest hold almost nothing forward-looking with a time: The Ken's 182 sentences on 25 October have three uses of "will", none dated; Lenny's 68 have none. News is mostly about what happened.
- **Claude offered 7 and 6 were kept**, among them Gartner's "by 2028, one in four job applicants will be fake", a DoorDash and Instacart deal "as soon as this week", and a defence company's gene-edited dogs "within two years". One was dropped because its quote did not match the issue word for word.
- **Cost:** 8,959 tokens in and 865 out, 1.3 cents for the six calls, about 0.2 cents each. At about 25 issues a day that is under 50 cents a month.
- One kept was a company's own rollout date (Microsoft finishing a rollout by late October), which the prompt asks to skip; worth watching once the archive is screened.
