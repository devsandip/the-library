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

## Decisions

- **Rides along with ingest, not with the story split.** Asking the split call for predictions too would change the story index's prompt and need every issue split again. A separate call that only sees forward-looking passages costs pennies a month and leaves the index alone.
- **The screen is a regex, not a model.** It only has to throw away the sentences that cannot be predictions (most of every issue); Claude decides on the rest. #24's build note suggests a decision model like Jev for this screening (#27); a regex is enough until it misses things.
- **Claude names the period; the code ends it.** Claude is good at reading "by the holidays" against the date sent, and the code is good at calendars. Tests cover the code's half.
- **No quote, no prediction.** A prediction whose words are not in the issue is dropped whole, not kept without its quote.
- **A newsletter's own calls are marked** (`own`), so its track record counts only those, not the forecasts it reports.

## Probe (2026-10-28, prod, read-only: `scratch/predictions-probe.ts`)

Twenty recent issues, at most two per newsletter, screened and sent to Haiku from a laptop, nothing written.

- **The screen passed 6 of 20 issues to Claude.** The rest hold almost nothing forward-looking with a time: The Ken's 182 sentences on 25 October have three uses of "will", none dated; Lenny's 68 have none. News is mostly about what happened.
- **Claude offered 7 and 6 were kept**, among them Gartner's "by 2028, one in four job applicants will be fake", a DoorDash and Instacart deal "as soon as this week", and a defence company's gene-edited dogs "within two years". One was dropped because its quote did not match the issue word for word.
- **Cost:** 8,959 tokens in and 865 out, 1.3 cents for the six calls, about 0.2 cents each. At about 25 issues a day that is under 50 cents a month.
- One kept was a company's own rollout date (Microsoft finishing a rollout by late October), which the prompt asks to skip; worth watching once the archive is screened.
