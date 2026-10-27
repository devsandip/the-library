# Ask the Library (#21)

A question answered from my own newsletters, with a link to every story it draws on, or a plain "nothing in your newsletters" when there is nothing. The archive only: the web layer needs #16's search tool, which needs a search provider account.

## What it does

- **`POST /nutgraf/api/ask`** with `{ q }`, 3 to 300 characters (`services/api/src/ask.ts`).
- **Plan.** One Claude call (Haiku 4.5, `plan_searches`) turns the question into one to three archive searches: the words a matching story would hold, and days (YYYY-MM-DD) when the question names a time. The code drops a day that is not a real day or is after today, swaps days the wrong way round, and falls back to the question itself when nothing usable comes back.
- **Search.** Each search runs over the corpus search already keeps in the warm Lambda (#53), by words and by meaning, but story by story: every document and embedding is keyed `<issueId>#<n>`, so a digest's stories rank on their own. Promos and muted newsletters are left out, and a search with days keeps to them. The searches share 30 stories (one search up to 30, three up to 10 each), taken in turn, best first, without repeats.
- **Answer.** A second call (`answer`) reads them oldest first, numbered, with the question. It answers in one to five short paragraphs, each listing the stories it draws on, from what the stories say only; or, when nothing answers the question, no paragraphs and one sentence on what the newsletters do not cover.
- **Checked by the code.** Every story id must be one it sent; a paragraph with none is dropped. A paragraph's sources are its stories' issues, oldest first, with the story inside a digest (the same shape as a timeline point's). With no paragraph left, the answer is Claude's `none` or "Nothing in your newsletters matches this." No story found means no second call; when the question's days ruled out every match, the answer says when the latest arrived ("Nothing in your newsletters from 2026-10-20 to 2026-10-27. The latest on this arrived 2026-10-19.").
- **The answer carries** the searches it ran (with their days), how many stories it read, the time and the cost. Nothing is kept.

## The page (#104)

- **One page on both devices**, `/library/ask?q=` (`web/src/pages/ask.tsx`): a question box (Enter asks, Shift+Enter is a new line), what it reads and costs (`Your newsletters · about 1¢ · 5 to 20 seconds`), then "Asking · 0:07" with the seconds so far, then the paragraphs with their sources as chips: the newsletter, and the story's headline inside a digest. A chip opens the issue at its story: the reader on the phone, the console on the Mac. Under the answer, a receipt: what it looked for, stories read, time and cost. "Nothing in your newsletters" comes with "Search for these words".
- **Ways in.** Library lists Ask Nutgraf (it was under "Coming later"). Search shows "A question? Ask Nutgraf instead" when the query reads as a question (ends in ?, or starts with what, how, why, who and the like). On the Mac, ⌘K offers "Ask Nutgraf “…”" beside Search, first when the text reads as a question.
- **Kept for the page's life, not refetched.** The question is in the URL so Back and a link work, and the answer is held per question while the page is open, so coming back costs nothing. The app's usual cached view refreshes in the background, which here would ask and pay again; asking the same question again on purpose does ask again.
- **Mock mode** answers from the mock stories that hold the question's words, after a pause.

## Decisions

- **Two calls, not an agent loop.** #21 describes an agent that searches, reads and decides whether to search again. Planning the searches up front covers the question's parts and its dates, and the answer call reads every story found, so one round answers most questions. It keeps the request to 3 to 17 seconds on the probe below, inside the API's 28, with no background job or polling. A second round is the next step if answers come back thin.
- **Story by story.** Search ranks issues by their best story. For an answer the stories are the unit: a TLDR digest can hold three stories on the question, and each should be read.
- **Only what the stories say.** No outside knowledge, no guesses, no advice; disagreements say who says what. The stories are the story index's headlines and summaries, so an answer is as deep as they are.
- **Nothing kept.** Questions are not stored and the log line has counts only, since the question is mine.
- **Haiku, the shared model.** `CLAUDE_MODEL`, like timelines (#19), so the switch to Haiku 5.5 (#85) moves it too.

## Probe (2026-10-27, prod's archive, from a laptop, nothing stored)

562 issues and 3,485 stories. Five questions; only timings, counts and cost were printed.

| Question | Time | Cost | Stories read | Answer |
|---|---|---|---|---|
| AI coding agents this month | 17.4 s | 0.8¢ | 30 | 5 paragraphs, 16 sources |
| How companies evaluate LLMs in production | 11.6 s | 0.8¢ | 30 | 5 paragraphs, 11 sources |
| The Fed and interest rates last week | 3.2 s | 0.1¢ | 0 | none: the latest Fed story arrived 2026-10-19 |
| The Fed and interest rates in September | 7.8 s | 0.5¢ | 9 | 4 paragraphs, 9 sources |
| Knitting patterns for winter scarves | 2.9 s | 0.1¢ | 0 | none |

- Claude planned one search for each. The first version gave each search 12 stories; with one search that left 18 unused, so the searches now share 30.
- The "last week" question first came back with a bare "nothing", which read like a failure; the archive's best Fed matches ran from 2026-09-11 to 2026-10-19. Hence the latest-day line.
- Times are from a laptop in India to us-east-1. The Lambda adds a corpus read when cold (about 3 seconds there; 8 to 17 from the laptop) and saves the long round trips; the longest answer, 17 seconds, is inside the 28.

