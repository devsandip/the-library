# Story shelves (#81)

News or Learning for each story instead of each issue, where Learning means craft, decided by Jev (#27). The plan and the findings that led here are in #81.

## What exists so far

- **A Jev client** (`services/ingest/src/jev.ts`): one call carries the story and the questions, and comes back with a probability per option. Not wired into ingest yet.
- **The question**, in two phrasings scored side by side: a choice between Learning (`CRAFT`) and News (`NOT_CRAFT`), and a yes or no on "does this story build the reader's craft?". Jev reads the reader line enrichment uses, the newsletter's name, and the story's headline and summary from the story index (#15).
- **A scoring script**: `AWS_PROFILE=admin pnpm jev:score <labels.json>` runs Jev on labelled stories and prints agreement and calibration beside two baselines: Claude's guesses and the shelf Haiku gave the whole issue. It stores nothing in the table.

## Decisions

- **Learning means craft** (Sandip, 2026-10-12): product management, system design, engineering, building with AI, startup strategy; how-tos, case studies, frameworks, interviews about the work. Essays on culture or life are News, however long they stay worth reading.
- **The unit is the story** (Sandip, 2026-10-12), so a craft essay inside a TLDR digest can reach Learning while the digest stays in News.
- **Jev makes the call** (Sandip, 2026-10-12). It runs on TypeSafe's API, not Bedrock. The key is in SSM at `/thelibrary/prod/jev/api-key`, stored by Sandip; code reads it when it runs and never prints it.
- **The choice phrasing leads.** On the first run it agreed more often, and the yes or no phrasing leans low: a ByteByteGo piece on cache failures, plainly craft, got 0.6.

## Jev's API (learned 2026-10-17)

- `POST https://api.typesafe.ai/v1/systemone` with a bearer key. The body is `model` (`jev-latest`, which answers as `jev-1.13.0`), `state` (the text to judge) and `questions`, an object keyed by name.
- A `noul` question has `question` and `criteria: { true, false }` and answers `{ noul: p }`. A `choice` question has `question` and `criteria: { option: description }` and answers `{ choice, confidence, probabilities }`.
- `usage.input_tokens` per call. With both phrasings a story costs about 620 input tokens: the 59-story run used 36,579, well under a cent at TypeSafe's $0.042 per million.

## Scoring

- **2026-10-17, 59 prod stories, against Claude's guesses** (Sandip's labels pending). Agreement: the choice phrasing 57 of 59, the yes or no phrasing 53, Haiku's issue shelf 50. The choice phrasing put 38 stories below 0.2, one of them Learning, and 15 above 0.8, all Learning.

## Open

- Sandip's labels on the 59, then a cutoff below which a call counts as unsure and is listed for him.
- #81 steps 3 to 5: Jev in ingest and the backfill, Learning listing stories, and the brief and archive rule following stories.
