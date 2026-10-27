# Story shelves (#81)

News or Learning for each story instead of each issue, where Learning means craft, decided by Jev (#27). The plan and the findings that led here are in #81.

## What exists so far

- **A Jev client** (`services/ingest/src/jev.ts`): one call carries the story and the questions, and comes back with a probability per option.
- **Jev in ingest** (`services/ingest/src/shelves.ts`): after the story index, every ingest run sends the stories of the last 14 days that Jev has not read to Jev, four at a time, and stores `learning` (the probability), `shelfModel` and `shelvedAt` on each story, with its effective `shelf` and `shelfSetBy`. Its own pass, so a Jev outage never holds up stories; failures are counted on Status and retried next run. It never writes over a story Sandip moved or read meanwhile.
- **The effective shelf** (#94, `packages/core/src/shelves.ts`): Sandip's move, then the newsletter's "always" setting, then Jev. A story on Learning and unread is also in `gsi2` under `LEARNING`, so Learning can list and count those without reading every story.
- **The issue follows its stories** (#94): Learning when every story is Learning, News otherwise, written after each Jev pass and each move (`shelfSetBy: "stories"`). An issue with no stories keeps its own shelf; a new one starts on its newsletter's setting, else News. Claude is no longer asked for a shelf (#97). Moving an issue moves all its stories, as Sandip's moves.
- **The API** (#95): `GET /learning` lists Learning stories with their issue, each with its own state (unread, read, archived); `PATCH /issues/{id}/stories/{n}` sets a story's state or moves it; `GET /unread-counts` counts unread Learning stories; `GET /issues/{id}/stories` carries each story's shelf and state.
- **The screens** (#96): Browse's Learning (phone) and the console's Learning queue (Mac) list Learning stories. A story opens in its issue: the phone's story sheet, the console's reader and story index. A visit that starts on a story marks only that story read; the issue keeps its state. The story sheet and the Mac's E and M keys archive or move the story itself, with Undo. The Learning tab and the pickers count unread Learning stories.
- **The day in brief** (#97) takes News stories by each story's own shelf, so a craft essay inside a digest stays out of it. The old-news rule archives issues and leaves their Learning stories listed.
- **The backfill**: `AWS_PROFILE=admin pnpm shelves --days N` runs the same pass in the ingest Lambda, eight at a time, for up to 9 minutes a run; `--force` asks again about every story but Sandip's moves. `--derive` asks Jev nothing: it brings every story's shelf, state and index attributes in line and derives every issue's shelf; run again, it writes nothing.
- **The question**, a yes or no: "does this story build the reader's craft?", with `CRAFT` and `NOT_CRAFT` as the two sides. Jev reads the reader line enrichment uses, the newsletter's name, and the story's headline and summary from the story index (#15). Answers from 0.4 up to 0.6 are unsure (`UNSURE`).
- **A scoring script**: `AWS_PROFILE=admin pnpm jev:score <labels.json>` runs Jev on labelled stories and prints agreement and calibration beside two baselines: Claude's guesses and the shelf Haiku gave the whole issue. It stores nothing in the table.

## What Learning means

Sandip's rules (2026-10-17), the reference for labels and for any change to Jev's question. The test behind all of them: Learning is something you could still use in two to three years; News is information about the moment.

**Learning**

1. Teaches how to do the work in product management, system design, software engineering, building with AI, or startup and business strategy.
2. Shows how to use a tool or technique: use cases, walkthroughs, recipes, "how we use X".
3. Explains how a system, model or technique works inside: architecture, internals, trade-offs.
4. Gives a framework or mental model you can apply elsewhere (what makes a moat, how to run discovery).
5. Shows how a team built or decided something, when the story carries the how and the why, not only the result.
6. States a lesson about doing the work, even when it is framed as one person's finding, opinion or anecdote ("tests take as long as code", "say the business impact, not the incident count"). Opinions about the craft are Learning.
7. Interviews and essays about the craft itself: career, judgment, working with AI, leading a team.

**News**

8. That something launched, shipped or was updated, even a new kind of tool. The launch of a new product or tool is News; how to use that product is Learning.
9. Who adopted, bought, funded, hired or laid off; markets, deals, company results.
10. Results and benchmarks: X beats Y, X runs N times faster, X fixed N bugs. Numbers without the how.
11. Security holes, outages and incidents, unless the story is a post-mortem on how to avoid them.
12. Politics, policy, regulation, and commentary on the industry and its people.
13. Culture, society and life, and consumer tech, however lasting or well written.
14. A newsletter's own programs: courses, book clubs, events, anniversaries, sales, even when the subject is craft.

**When a story is both**

15. Judge by what you take away. If it is a technique or lesson you could reuse, Learning; if it is a fact about the moment, News.
16. A digest item is judged on its own, not by the newsletter it came in.

- **A forced re-split keeps what Sandip did** (#98): before `pnpm stories --force` replaces an issue's stories, each new story takes the move and read state of the old story with the same link, or else the same headline (`carriedOver` in `services/ingest/src/stories.ts`). Jev reads every new story again; a carried move still beats it.

## Decisions

- **Learning means craft** (Sandip, 2026-10-12): product management, system design, engineering, building with AI, startup strategy; how-tos, case studies, frameworks, interviews about the work. Essays on culture or life are News, however long they stay worth reading.
- **The unit is the story** (Sandip, 2026-10-12), so a craft essay inside a TLDR digest can reach Learning while the digest stays in News.
- **Jev makes the call** (Sandip, 2026-10-12). It runs on TypeSafe's API, not Bedrock. The key is in SSM at `/thelibrary/prod/jev/api-key`, stored by Sandip; code reads it when it runs and never prints it.
- **Launch is News, how to use it is Learning** (Sandip, 2026-10-17). "OpenAI launched a Jev rival" is News, and so is the story of Jev's own launch; how to use Jev, or how it works, is Learning. In his words, Learning stays relevant for two to three years and News is purely informational. The original wording already makes this split (below), so it stays.
- **Good enough** (Sandip, 2026-10-17): "with jev we are pretty much there. this level of accuracy is fine for a newsletter reading app." No more tuning of the question. Of the five stories Jev and Sandip differ on, four are lessons framed as findings or opinions (rule 6) and one is a newsletter's own program (rule 14); one of the five, the Jev evaluation-baselines lesson, Sandip calls borderline either way.
- **One question, no second round** (2026-10-17). Sandip suggested more questions for the unsure band; two rewordings and a second round scored no better (Ruled out). The unsure band goes to Sandip instead.
- **The yes or no phrasing leads** (2026-10-17, against Sandip's labels). It agreed on 56 of 59 to the choice phrasing's 54, and its uncertain middle holds the hard calls. The choice phrasing was confidently wrong once: a book-club announcement from Product Talk at 0.85. Against Claude's guesses the order was the other way round, which is why the labels came first.

- **The story's field is `shelf`, like the issue's** (2026-10-17), with `learning` beside it. #81 said `kind`; `shelf` matches the issue's field and its `Shelf` type, so step 4 can treat both alike.
- **Jev reads every story, whatever the newsletter's "always" setting** (2026-10-17), so its probability is there for every story.
- **The setting is stamped on the stories** (2026-10-27, #94), not applied where they are read as planned on 2026-10-17: listing and counting Learning needs the effective shelf in an index. Changing it rewrites the newsletter's stories; clearing it goes back to Jev's call from the stored probability. No newsletter had one.
- **Reading a Learning story marks the story, not its issue** (2026-10-27, Sandip's go-ahead to use judgement on #81's questions). Learning stories do not expire. Archive and the shelf move act on the story; thumbs rate the issue. No Save on stories for now: unread ones stay in Learning anyway.
- **Where existing stories start** (2026-10-27): read when their issue was read or archived by Sandip, unread otherwise, including inside news the old-news rule archived unseen. On prod that is 15 read and 427 unread of 442 Learning stories.
- **Each environment has its own key** (`/thelibrary/<stage>/jev/api-key`). Dev has none, so shelving shows an error on dev's Status; dev's tests use a fake Jev.

## Jev's API (learned 2026-10-17)

- `POST https://api.typesafe.ai/v1/systemone` with a bearer key. The body is `model` (`jev-latest`, which answers as `jev-1.13.0`), `state` (the text to judge) and `questions`, an object keyed by name.
- A `noul` question has `question` and `criteria: { true, false }` and answers `{ noul: p }`. A `choice` question has `question` and `criteria: { option: description }` and answers `{ choice, confidence, probabilities }`.
- `usage.input_tokens` per call. With both phrasings a story costs about 620 input tokens: the 59-story run used 36,579, well under a cent at TypeSafe's $0.042 per million.

## Scoring

- **2026-10-17, 59 prod stories, against Claude's guesses** (before Sandip's labels). Agreement: the choice phrasing 57 of 59, the yes or no phrasing 53, Haiku's issue shelf 50.
- **2026-10-17, the same 59 against Sandip's labels** (18 Learning, 41 News). He checked the ten Claude marked unsure and moved three to News: a benchmark of Jev's retrieval, Checkly's rewrite in Go, and Product Talk's book club. Agreement: the yes or no phrasing 56 of 59, the choice phrasing 54, Claude's guesses 56, Haiku's issue shelf 51.
- **The yes or no phrasing's bands:** below 0.4, 38 stories, one Learning; 0.4 to 0.6, 8 stories, half Learning, six of them ones Claude had marked unsure; 0.6 and up, 13 stories, all Learning. Outside the middle band it was right on 50 of 51.
- **2026-10-17, every stored story (2,713), the yes or no phrasing, no labels.** 84% below 0.4, 7% between 0.4 and 0.6, 9% from 0.6. Since 1 October about 70 stories a day arrive: about 9 or 10 would be Learning (0.5 and up) and about 5 would land in the 0.4 to 0.6 band (under 3 in 0.45 to 0.55). Most Learning comes from inside digests: TLDR Dev 130 of 382 stories, TLDR Data 52 of 136, TLDR IT 30 of 315, beside ByteByteGo 52 of 62 and the System Design newsletters nearly all. The Ken, The Juggernaut, Pirate Wires, WSJ and Fortune have none or one. TLDR Dev also holds half the uncertain band (91 of 187). 1.3 million input tokens, about 5 cents; a run took about 12 minutes at six calls at a time.
- **2026-10-17, a rerun of the kept question:** 55 of 59 and 28 of 29. Stories within a few hundredths of 0.5 move between runs.
- **2026-10-17, 29 stories about Jev and its rivals**, labelled by Sandip's split (11 Learning: use cases, how it works; 18 News: launches, adoption, benchmarks). The original question got all 29 right, several only just (0.50 to 0.52). Haiku's issue shelf got 17.
- **Caveats.** 59 stories is a small sample, weighted toward mixed newsletters. Sandip corrected Claude's guesses rather than labelling blind, so the labels lean Claude's way, which flatters Claude's 56. Jev's answers move a little between runs (up to 0.03 on the same story).

## Ruled out

- **A second round for the unsure band** (2026-10-17): "still useful in two to three years?" and "does it explain how or why, rather than report that something happened?", averaged with round one. On the 59 and the 29 together it scored 83 of 88, to the original's 85. The extra answers move with the first: where round one is unsure, so are they.
- **Writing the two-to-three-year test into the question** (2026-10-17): 58 of 59 but 26 of 29, 84 of 88 in all. It pulled the how-to-use-Jev stories down ("Jev verifies 10-K extraction" from 0.52 to 0.37).
- **The choice phrasing** (2026-10-17): 54 of 59, and confidently wrong once.

## Open

- The unsure band. Since the accuracy is fine as it is, the proposal is now simpler: shelve every story by 0.5, store Jev's probability, and leave a list of unsure calls for later. Sandip's moves become labels (#26).
- If the unsure band needs to shrink, the next thing to try is more text per story, not more questions: Jev sees a 45-word summary, and for an essay that is thin.

