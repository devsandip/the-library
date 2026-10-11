# Search, and one way to prod

2026-10-11 11:18. Previous: [2026-10-10-2111-now-reading-saved-and-a-peek.md](2026-10-10-2111-now-reading-saved-and-a-peek.md)

## What happened

Overnight Claude built the next two items in the queue, each on its own branch. Auto mode would not let Claude merge them, so they waited until this morning, when I told Claude to merge them itself. Both reached prod at about 10:40, with every hosting check passing.

- **Account mail (#50, PR #54).** Sign-in codes, email confirmations and password resets stay out of the list. Subject rules catch the usual phrasings, and Claude's promo question gained a fourth answer, "account", for the rest. Reprocessing the last 30 days filed exactly one issue: the Substack verification code that started it.
- **Search (#53, PR #55).** A field at the top of the Mac sidebar, a button in Home's list bar on the phone. It finds issues by their words first, with the words marked and the story inside a digest named, then issues close in meaning, from the story embeddings. "AI assistants that arrange vacations" finds stories about AI agents with no word in common. There is no Claude call; each search embeds the query with Titan.

Then two things about how the work gets done.

First, history missed what I read. Last night I read five digests through the new peek: none was in history, and all five were still unread. Read history counted only opening an issue, and the peek shipped a few hours later without logging anything. I filed #56. Claude fixed it in PR #57: a peek left open for two seconds now counts as reading the issue.

Second, I asked why we kept ending up with rebases, my checkout behind, and prod not matching main. The answer was plain. Prod was deployed by hand from whatever folder Claude was working in. Nothing ran CI, so two branches cut from the same main were stitched together on a laptop to be tested, and rebase merges rewrote their commits. My own checkout was never part of the flow. So Claude built a pipeline (PR #58): CI on every pull request, and every push to main deploys dev, runs the integration tests there, then deploys prod and runs the hosting checks. Only GitHub deploys prod now, as a role that trusts only this repository's dev and prod environments, which only main may use. Merges are squash merges, merged branches are deleted, and `pnpm sync-main` keeps my checkout on main.

Auto mode then refused to let Claude merge #57, as self-approval, even though I had said Claude should merge its own pull requests. So for now I merge.

## Where we are now

Search, account mail and everything before them are live. The peek fix and the pipeline wait for my merge; once the pipeline is on main, merging is deploying.

## Decisions

- Claude merged #54 and #55 on my word.
- Account mail: subject rules plus a fourth answer to Claude's promo question; reprocess files what a new rule catches, never an issue I rated or saved.
- Search: words first, then a "Close in meaning" group, not one merged list. Meaning counts from a cosine of 0.30. With three words or more, an issue missing one counts only if it is at least loosely close in meaning.
- A peek left open two seconds is a read: history lists it and the issue is marked read. Now reading still follows the issues I open.
- Prod deploys only from main, through GitHub Actions, with dev and the integration tests first. A merge takes about 10 minutes to reach prod instead of 2. `pnpm run deploy` is the fallback for when GitHub is down.
- Squash merges, one commit per pull request; merged branches are deleted.
- The repository stays private. It already was.

## Direction changes

- Shipping: was Claude deploying prod by hand from its worktree, now merging to main deploys, through CI, dev and the integration tests.
- Merges: was rebase, now squash.
- What counts as read: was opening an issue, now opening it or a peek left open two seconds.
- Who merges: was Claude on my word, now me, until auto mode allows it.
- What comes next: was account mail (#50) and search (#53), now related stories inside a digest (#20, second version) and how a story evolved (#19).

## Needs revisit

- Merge #57 and #58, then turn on main's branch protection and put the five peeks from 2026-10-10 into history (`WORKLOG.md`, Next).
- The first Deploy run from main, the first use of the role and the environments (`docs/features/pipeline.md`).
- How Claude merges: auto mode's self-approval rule against my say-so (`docs/features/pipeline.md`, Open).
- The first search after a cold start, and search at 375 px (`docs/features/search.md`, Open).
- Now reading, Saved, the peek and search on a real iPhone.
