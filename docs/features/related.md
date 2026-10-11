# Related stories (#20)

While reading, the closest stories from my newsletters before and since. The second version matches stories (#15) instead of whole issues, so a story inside a digest finds its own relatives.

## What it does

- **Under the newsletter,** on the issue page and in the Mac's reading pane, a Related section.
- **A digest** lists each of its stories that has relatives, in the digest's order: the story's headline under the accent bar search uses for a digest's story, then up to three relatives, closest first. Stories with none are left out.
- **An issue with one story** is the story: up to three relatives each side of its date, as the first version showed them.
- **Each relative** shows its newsletter, its date and, when it sits inside a digest, that story's headline; otherwise Claude's line for the issue. In the reading pane it opens in the pane.
- **Earlier and Since** headings appear only when something arrived after the open issue. Reading the latest issue, everything is earlier, and a heading on every story would be noise.
- **When nothing is close, nothing shows.**
- **No Claude call and nothing stored:** nearest neighbours on the embeddings the story index already keeps, worked out when the issue opens, in 3 to 11 ms.

## Decisions

- **Story embeddings, raw cosine, no centring** (was: the first version took each newsletter's mean out). Claude wrote every story's headline and summary, so house style barely shows: on prod's 2,264 stories (2026-10-11), cosines averaged 0.10 between stories of one newsletter and 0.07 across, against 0.34 and 0.19 for whole issues.
- **The cutoff is a cosine of 0.45.** Read from prod pairs that are not the same event: from 0.45 up they are about the same thing (Jev against OpenAI Decisions in TLDR IT and TLDR Data, gas prices and the Republicans' midterm worry). From 0.40 to 0.45 about 5 in 8 are, the rest the same field (two different agent papers). From 0.35 to 0.40 mostly not (AWS spending limits for agents against a bundle size tool). At 0.45 half of all stories have a relative.
- **A shared name does not lower it.** The event linker (#15) takes 0.55 with a shared name, but here pairs from 0.40 to 0.45 were related about as often with a shared name as without (6 in 8 and 5 in 8): the names that recur are the big ones (OpenAI, Nvidia, Meta).
- **The same newsletter's story at 0.80 or more is a rerun, left out.** 88% of pairs from 0.85 up are one newsletter twice, and they are the same piece sent again: The Ken repeats its stories days later, Fortune 500 Digest ran its Altman interview on losing control of AI about ten times in four weeks. The genuine follow-ups from one newsletter sat lower (TSMC's monthly sales, 28 days apart, at 0.71). Another newsletter's near copy stays: Shopify leaving React Native in TLDR Dev and, 18 days later, in The Pragmatic Engineer.
- **One relative per issue,** its closest story. A digest from yesterday can still appear under several of today's stories, each time with the story that matched.
- **Up to three per digest story; three each side for one story.** Most stories with any have one or two above the cutoff. A digest lists a median of 4 of its stories (90th percentile 8): long for a TLDR, but it sits under the newsletter, in the digest's own order.
- **The same event counts.** Coverage of the same news in another newsletter is a relative like any other; no separate "Also in" line. It can follow if Related fills with same-day copies.
- **Shares search's corpus.** Every story with its embedding is already in the warm API Lambda for search (`services/api/src/corpus.ts`); related reads the open issue's own stories fresh, since the corpus can be up to 5 minutes old. A corpus read is about 5 MB, some 640 DynamoDB read units, at most once per 5 minutes of reading: a few cents a month. The first version read every issue on every open.
- **The first version stays as the fallback** for an issue with no embedded stories: not split yet, a promo, a muted newsletter's, or one whose split failed.
- **The response keeps `earlier` and `since`** and adds `stories`, so a page still running the last web build shows nothing for a digest instead of breaking.

## Calibration (prod, 2026-10-11)

2,264 stories from 411 issues. Nearest neighbour from another issue: median 0.45, 90th percentile 0.87.

| Cutoff | Stories with a relative | Digests listing no story | One-story issues with any |
|---|---|---|---|
| 0.40 | 60% | | |
| 0.45 | 50% | 3% | 37% |
| 0.50 | 40% | 7% | 25% |

What it shows on the latest issues:

- **TLDR IT (2026-10-09), 3 of 6 stories.** Claude Haiku 5.5 finds TLDR Dev's (0.79); AWS's agent sandbox finds Docker's microVM sandboxes (0.56).
- **WSJ What's News (2026-10-09), 3 of 9.** The FlyDubai co-pilot finds the three earlier WSJ reports, 1 to 4 October; Anthropic's rogue model finds The Verge, Fortune and WSJ on Anthropic's earlier AI misuse stories; Delta's CEO on Starlink finds Pirate Wires on the same feud.
- **Lenny's Newsletter (2026-10-05), 3 of 3.** Jev's use cases find TLDR Dev, ByteByteGo and, since, TLDR Data; the DevDay recap finds TLDR Dev, Platformer and Installer.
- **The Ken's First Principles (2026-10-11):** nothing close, nothing shown.

## Open

- The first issue opened after a cold start waits for the corpus read (2.8 s for search on 2026-10-11) before Related shows; the newsletter does not wait for it.
- Whether digests want fewer stories listed, or folded, once I have read a few on the phone.
- "How this evolved" (#19) starts from the same matches: the FlyDubai thread above is one.
