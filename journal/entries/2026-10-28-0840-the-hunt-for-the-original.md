# The hunt for the original

2026-10-28 08:40. Previous: [2026-10-27-2355-source-and-follow.md](2026-10-27-2355-source-and-follow.md)

## What happened

Check the source used to read only the page a story links to. Often that page is another news report, so the check was comparing my newsletter with someone else's retelling. Now it follows links from that page to the original: the paper or its abstract page, the company's own announcement, the filing, the repository, the dataset, the court document or the official statement. Then it checks the story against that.

It took three pull requests in one morning, each merged as its checks passed.

**The check moved into a background job (#127).** The hunt reads up to five pages with a Claude call between each, and the API stops at 28 seconds. So a check now runs in its own Lambda with two minutes. Tapping Run returns at once, and the phone and the Mac ask every two seconds until it is done. A story opened on the other device while its check runs shows it running.

**The hunt (#128).** Each page is read with its links numbered, and a small Haiku call says whether this is the original or which of its links lead there. Claude answers with numbers, never addresses, so a page cannot send the check anywhere it does not link, and every page goes through the same safety checks as before. It follows the best link to its end before trying a page's second best, and stops at the original, at five pages, or after 70 seconds. The check itself did not change; it just reads a better page.

**The Source tab shows it (#129).** While it runs, the pages so far list under Checking, with the one being read. Once kept, it says whether it checked the original or fell back to the story's own link, then the way there: what each page called the next, the original in green, and pages that would not open with why.

Nothing has hunted a real link yet. The only real page it has read is RFC 2606 on dev, which links nowhere. The probe on recent prod stories, which says how often the original is reached and what it costs, is the milestone's last step. It needs my AWS sign-in, which had expired, and a local run against prod data, which Claude Code's auto mode would not allow without me.

I also asked for a status report after every milestone, the way Codex reports on Peel: a percent built, a table of what is built and what remains, and the problems. The first two are in `docs/status/`.

## Why

A newsletter that says "the paper shows" is only as good as the paper. Checking against a report of the paper tells me whether two outlets agree, not whether either is right.

## Where we are now

Prod has the job, the hunt and the tab. Milestone 6 stays open until the probe (#133). The ~2¢ and "under a minute" on the tab are estimates from token counts until then. None of it has been tried by me on a device.

## Decisions

- The check runs as a job that the app polls, not a longer request: HTTP API waits at most 30 seconds, and a phone that sleeps mid-check finds the result when it wakes.
- A run is kept beside the check, not in it, so a failed run never rewrites a kept check; the latest run answers for the story.
- The hunt goes depth first, five pages, 70 seconds, so a run fits the job's two minutes with room for the check.
- Claude picks links by number, as the story index does, so addresses never come from the model.
- The check's prompt and quote matching stay as they were; only the page it reads changes.
- Milestone 6 closes on evidence from real links, not when its pull requests merge.
- A status report after every milestone, in chat and in `docs/status/`.

## Direction changes

- Check the source: was one page, now the page and up to four more on the way to the original.
- Source check timing: was one request inside 28 seconds, now a background job of up to two minutes.

## Needs revisit

- How often the hunt reaches the original, in what time and for what cost (#133, `docs/features/source.md`).
- PDFs are still refused, so a paper linked only as a PDF ends the hunt on the page before it (#23).
- An original that its report does not link to needs web search (#16's search provider).
