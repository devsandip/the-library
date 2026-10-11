# Search (#53)

Find any issue or story in the archive: what my newsletters said, by its words or by what it means.

## What it does

- **On the Mac,** a field at the top of the sidebar; `/` jumps to it. **On the phone,** a search button in Home's list bar, beside the view menu, opening a page with its own field.
- It searches as you type, after a 300 ms pause, across everything received: unread, read, saved and archived. Filtered mail, promos and muted newsletters stay out.
- First the issues that hold the words, with the words marked, and for a digest the story inside it that matched, on its own line. Then a "Close in meaning" group: issues with a story about the same thing in other words ("AI assistants that arrange vacations" finds "OpenAI ships agents that book travel").
- Best match first, or newest first. The query and the order live in the URL, so Back from an issue returns to the results, and Back from the results leaves search.
- On the Mac a click opens a result in the reading pane; on the phone a tap peeks inside and a double tap opens it.
- No Claude call: a Titan embedding of the query, well under a cent a search.

## Decisions

The issue's defaults held: filtered mail, promos and muted newsletters out, archived in; no full text (the stories already say what an issue holds); search as you type; no filters at first. Both layers shipped together. These were settled while building, most of them by running real queries against prod's 363 listed issues and 2,242 stories:

- **Words first, then meaning, not one merged list** (was: one list by reciprocal rank fusion). Fused together, a story just over the meaning cutoff ranked beside exact matches: "Size Limit measures bundle size" came second for "rate limiting". Now the issues that hold the words come first, still ordered by fusion so one also close in meaning ranks higher, and the rest follow under their own heading. A result without a marked word no longer looks like a bug.
- **The meaning cutoff is a cosine of 0.30.** Relevant stories scored 0.30 to 0.57; the best for queries with nothing relevant in the archive ("gardening tips" 0.19, "chocolate cake recipe" 0.18, "rate cut" 0.29) stayed under it. Where a relevant story scores lower ("burnout" at 0.22, "India" at 0.27), its words carry it.
- **Porter's stemmer.** Without it, "rate limiting" missed every "rate limits" and "product manager" missed "product management". A term of three letters or more also matches a longer word it starts, for a word still being typed ("kafk").
- **Three terms or more: all but one, if close in meaning.** Requiring every term found nothing for "how Discord stores messages". Allowing any one to be missing let in noise ("Pilot-on-Pilot Stabbing" for "product manager interviews", through "management" and "products"); requiring the rarest term pushed the best result down to the meaning group. So an issue missing one term counts only when it is at least loosely close in meaning (cosine 0.20): the right ones scored 0.21 to 0.27, the noise under 0.16.
- **Terms side by side score again.** Without it, two markets digests with "rate" and "limit" in different sentences outranked three walkthroughs of rate limiting.
- **A story carries its newsletter's name,** so "TLDR agents" finds TLDR's story about agents, not every issue with "agents" anywhere.
- **A digest's matching story is named only inside a digest.** A one-story issue's story is the issue itself.
- **The phone's button is in Home's list bar, not the header** (was: Home's header). A fourth control in the header wrapped "The Library" and the date onto two lines each at 375 px: the header's controls need 251 px and 210 px are free. Fitting it meant tap targets under 44 px or dropping the Summary label.
- **Search cards show the subject too.** Phone cards lead with Claude's line, and the words may be only in the subject.
- **Swiping a result rates it and leaves it there.** An archived issue is still a result.
- **The corpus is read once per 5 minutes** in the warm Lambda: every listed issue's words and every story's text and embedding, about 5 MB, read a week of stories at a time, eight weeks at once. The rows shown are read fresh. A new issue is searchable within 5 minutes of arriving. Dev reads it every time.
- **Up to 50 results.** For a personal archive, a query with more wants more words.
- **The API role may call Titan V2 and nothing else.** Ingest keeps the Claude permissions.
- **Built for #21.** `searchIssues` in `packages/core/src/search.ts` and the API's `Search` are the archive searches Ask the Library's agent will call.

## Calibration (prod, 2026-10-11)

| Query | First results |
|---|---|
| kafka | Diskless Kafka (TLDR Data), log processing pipelines (System Design Course), LinkedIn's Northguard |
| rate limiting | Design an API Gateway, API design: 33 concepts, Design a Web Crawler |
| product manager interviews | Three recruiters on how product management hiring is changing, then Inside Gemini, 90 minutes of product advice |
| layoffs | Oracle's new round of layoffs, Meta's looming layoff, Amazon lays off workers |
| how Discord stores messages | nothing holds all three words; with two and close in meaning, "Stop storing AI responses as event logs, use message appends"; close in meaning, Discord's revenue |
| gardening tips | nothing |

## Open

- The first search after a cold start, on 2026-10-11, read the corpus in 2.8 s (366 issues, 2,261 stories) and answered in 3.3 s; the searches after it took 40 to 210 ms. Worth rereading as the archive grows: the API logs `search corpus read` with the time it took.
- When the full read gets slow (about 5 MB now, growing about 55 MB a year), an S3 Vectors index written by the ingest run beside the story items, as the story index doc planned.
- An issue not yet split into stories is found by its subject, newsletter and Claude's line only.
- No sender or date filters yet; they can follow, the way Home has them.
- On a 375 px phone the results count wraps beside the order menu.
