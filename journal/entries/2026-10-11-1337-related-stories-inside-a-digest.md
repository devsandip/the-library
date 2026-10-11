# Related stories inside a digest

2026-10-11 13:37. Previous: [2026-10-11-1118-search-and-one-way-to-prod.md](2026-10-11-1118-search-and-one-way-to-prod.md)

## What happened

The first version of Related matched whole issues. That works for an essay and blurs for a digest: a TLDR with twelve stories has one embedding, and its neighbours were other digests. The story index (#15) was built partly to fix this, and today Claude used it (#20, PR #62).

Under a digest's newsletter, Related now lists each of its stories that has relatives, in the digest's order, the headline under the same accent bar search uses, with up to three relatives under it. An issue with one story gets up to three each side of its date, as before. Each relative shows its newsletter, its date and, inside a digest, the story that matched. There is still no Claude call and nothing stored: the open issue's stories against every story search already keeps in memory.

Claude calibrated it on prod's 2,264 stories before writing the code. Three things came out of that.

- **No style correction.** The first version took each newsletter's average out, because whole issues of one newsletter looked alike. Stories do not: Claude wrote every headline and summary, and stories of one newsletter average 0.10 against 0.07 across.
- **A cutoff of 0.45.** From 0.45 up, the pairs are about the same thing. From 0.40 to 0.45 about 5 in 8 are, and a shared name does not help, since the names that recur are OpenAI, Nvidia and Meta. Half of all stories have a relative at 0.45, and a digest lists a median of 4 of its stories.
- **Reruns are left out.** Most near-identical pairs were one newsletter sending a piece again. The Ken repeats its stories days later, and Fortune 500 Digest ran its Altman interview on losing control of AI about ten times in four weeks. The same newsletter's story at 0.80 or more no longer counts. Another newsletter's near copy still does.

On prod it reads well. Friday's WSJ What's News lists its FlyDubai co-pilot story with the three earlier WSJ reports on it, 1 to 4 October, which is #19's "how this evolved" without a Claude call. Its Anthropic story finds The Verge, Fortune and WSJ on Anthropic's earlier trouble. Lenny's Jev use cases find TLDR Dev, ByteByteGo and TLDR Data.

I said ship, Claude merged, and the pipeline had it on prod in five and a half minutes. Auto mode was off, so the merge went through.

## Where we are now

Related stories are live. The first issue opened after the API has been idle waits about 3 seconds for Related while the archive is read; after that it answers in about 160 ms. The newsletter itself never waits.

## Decisions

- Related matches stories, not issues, at a raw cosine of 0.45. Whole issues only for an issue not split into stories.
- The same newsletter's story at 0.80 or more is a rerun and is left out.
- A digest lists each story with relatives, up to three each; a one-story issue gets three each side.
- Earlier and Since headings only once something arrived after the open issue.
- Related shares search's copy of the archive in the API, so one read serves both.
- Coverage of the same event elsewhere is a relative like any other; no separate "Also in" line for now.
- Claude merged #62 on my word.

## Direction changes

- Related: was whole issues with each newsletter's style taken out, now stories, so a digest's stories each find their own relatives.
- What comes next: was related stories inside a digest (#20, second version) and how a story evolved (#19), now #19.

## Needs revisit

- How a long digest's Related reads on the phone: fewer stories, or folded (`docs/features/related.md`, Open).
- The 3 second wait for Related after a cold start (`docs/features/related.md`, Open).
- The weekly summary for 2026-W41, due Monday 2026-10-12.
- Now reading, Saved, the peek, search and Related on a real iPhone.
