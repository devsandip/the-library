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
- **The yes or no phrasing leads** (2026-10-17, against Sandip's labels). It agreed on 56 of 59 to the choice phrasing's 54, and its uncertain middle holds the hard calls. The choice phrasing was confidently wrong once: a book-club announcement from Product Talk at 0.85. Against Claude's guesses the order was the other way round, which is why the labels came first.

## Jev's API (learned 2026-10-17)

- `POST https://api.typesafe.ai/v1/systemone` with a bearer key. The body is `model` (`jev-latest`, which answers as `jev-1.13.0`), `state` (the text to judge) and `questions`, an object keyed by name.
- A `noul` question has `question` and `criteria: { true, false }` and answers `{ noul: p }`. A `choice` question has `question` and `criteria: { option: description }` and answers `{ choice, confidence, probabilities }`.
- `usage.input_tokens` per call. With both phrasings a story costs about 620 input tokens: the 59-story run used 36,579, well under a cent at TypeSafe's $0.042 per million.

## Scoring

- **2026-10-17, 59 prod stories, against Claude's guesses** (before Sandip's labels). Agreement: the choice phrasing 57 of 59, the yes or no phrasing 53, Haiku's issue shelf 50.
- **2026-10-17, the same 59 against Sandip's labels** (18 Learning, 41 News). He checked the ten Claude marked unsure and moved three to News: a benchmark of Jev's retrieval, Checkly's rewrite in Go, and Product Talk's book club. Agreement: the yes or no phrasing 56 of 59, the choice phrasing 54, Claude's guesses 56, Haiku's issue shelf 51.
- **The yes or no phrasing's bands:** below 0.4, 38 stories, one Learning; 0.4 to 0.6, 8 stories, half Learning, six of them ones Claude had marked unsure; 0.6 and up, 13 stories, all Learning. Outside the middle band it was right on 50 of 51.
- **2026-10-17, every stored story (2,713), the yes or no phrasing, no labels.** 84% below 0.4, 7% between 0.4 and 0.6, 9% from 0.6. Since 1 October about 70 stories a day arrive: about 9 or 10 would be Learning (0.5 and up) and about 5 would land in the 0.4 to 0.6 band (under 3 in 0.45 to 0.55). Most Learning comes from inside digests: TLDR Dev 130 of 382 stories, TLDR Data 52 of 136, TLDR IT 30 of 315, beside ByteByteGo 52 of 62 and the System Design newsletters nearly all. The Ken, The Juggernaut, Pirate Wires, WSJ and Fortune have none or one. TLDR Dev also holds half the uncertain band (91 of 187). 1.3 million input tokens, about 5 cents; a run took about 12 minutes at six calls at a time.
- **Caveats.** 59 stories is a small sample, weighted toward mixed newsletters. Sandip corrected Claude's guesses rather than labelling blind, so the labels lean Claude's way, which flatters Claude's 56. Jev's answers move a little between runs (up to 0.03 on the same story).

## Open

- The cutoffs. Proposed: Learning from 0.6, News below 0.4, and the middle band shelved by 0.5 but listed for Sandip to settle, each settled call becoming a label (#26).
- #81 steps 3 to 5: Jev in ingest and the backfill, Learning listing stories, and the brief and archive rule following stories.
