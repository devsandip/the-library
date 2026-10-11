# A redesign, briefed without the old screens

2026-10-11 13:53. Previous: [2026-10-11-1337-related-stories-inside-a-digest.md](2026-10-11-1337-related-stories-inside-a-digest.md)

## What happened

I don't like the UX on the phone or the Mac. I'm handing the redesign to Claude Design, and today Claude wrote the brief.

The UI grew one feature at a time over two days, and the build had already recorded where it strained:

- The phone and the Mac have two unrelated looks: different type, accent colour, shapes and density.
- The phone ran out of room more than once. Search moved into the list bar, Save moved to the top of the issue page, and Saved ended up inside a dropdown.
- A peek waits 250 ms to rule out a double tap.
- The Must Read row scrolls sideways, so its cards can't be peeked at or swiped.

Claude built the brief from everything in the repo: the product brief, the feature docs, the journal, the worklog and every GitHub issue. It has three parts.

- **What the app is.** The problem, how it works, the vocabulary and the character: Relevant and Irrelevant, the yellow box, "No new numbers." It also covers what is built, what is planned, the hard constraints, real content sizes and the lessons from the first build.
- **185 user stories** in "As a ..., I want to ... so that ..." form, across 15 areas, each with its status and source. 144 are shipped, 40 planned and 1 parked. Below them are 26 business rules the design has to respect.
- **123 screenshots of the current UI:**
  - phone, Mac in light and dark, a 1024 px laptop, and the public pages;
  - every state Claude could reach: filters, peek, a swipe halfway, Undo, empty, loading and error;
  - all taken in mock mode with placeholder text, since Claude doesn't sign in for me.

Then I asked for a second pack with no screens at all. A designer shown today's UI will anchor on it. That pack describes needs and never describes layouts, colours or typefaces. Where a story names an interaction, it is one I asked for by name: swipe right for Relevant, tap to peek and double tap to open, one tap back to what I was reading. If something better does the same job, the designer should propose it as an alternative, not swap it in silently.

The peek fix (#56) and related stories (#20) shipped while the packs were being written, so their docs were brought up to date at the end. The zips were not rebuilt.

## Where we are now

There are two packs, one with screens and one without. They sit untracked under `design-handoff/` in the worktree `ux-redesign-handoff-9f9bf3`, next to the script that took the screenshots, so the same screens can be retaken after the redesign. None of it is in the repo.

The brief doesn't yet have my own critique. The READMEs say only that I don't like the UX on either device.

## Decisions

- Redesign the UX on both devices from first principles with Claude Design, rather than polish what is there.
- Two packs: one without screens, so the design doesn't anchor on today's UI, and one with screens for reference.
- The requirements describe needs. They name an interaction only where I asked for it, and a better pattern comes as a proposal.
- The screenshots come from mock mode, because Claude doesn't sign in for me.
- The screenshots were reduced to 256 colours so the pack fits under the 30 MB limit for sending to my phone.

## Direction changes

- The UI: it was built feature by feature on two looks (dark cards on the phone, two panes on the Mac). Now both are up for a redesign.

## Needs revisit

- Where the packs live: commit the stories as `docs/user-stories.md`, move the folders out of the repo, or both. Until then they are tracked only in the session resume.
- The zips predate the #56 and #20 updates; rebuild them before sending.
- My own critique, added to both READMEs before sending.
- Whether #19 and other new UI wait for the redesign.
- Turning what comes back from Claude Design into issues, a `docs/features/` decision log, and `docs/prd.md` changes if the information architecture moves.
