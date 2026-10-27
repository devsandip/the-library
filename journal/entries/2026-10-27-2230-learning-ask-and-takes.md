# Learning lists stories, Ask, and Takes

2026-10-27 22:30. Previous: [2026-10-19-1135-thumbs-instead-of-relevant.md](2026-10-19-1135-thumbs-instead-of-relevant.md)

## What happened

I asked Claude to keep building through the night, a milestone at a time, and to make the calls itself. By 22:30 three milestones had shipped.

**Learning lists stories (#81).** Learning used to be a list of issues that Haiku called Learning. Now it is a list of stories, the ones Jev calls craft: a how-to inside a TLDR digest shows up in Learning while the digest stays in News. An issue counts as Learning only when every one of its stories is. On prod that moved 58 issues Haiku had called Learning back to News, and surfaced the Learning stories inside 93 News issues: 428 unread Learning stories in all. Reading one marks that story read and leaves its issue alone. The day in brief now takes News stories by their own shelf, so a craft essay inside a digest stays out of it, and Claude no longer guesses a shelf for each issue.

**Ask Nutgraf (#21).** A question box, on Library, in Search for anything that reads as a question, and in ⌘K on the Mac. Claude turns the question into up to three searches of my archive, reads the best 30 stories and answers in a few paragraphs, each linking to the stories it used, or says my newsletters have nothing on it. A question about the Fed "last week" found nothing and said the latest Fed story came on the 19th, which is true. About 12 seconds and under a cent.

**Takes (#17, the first half).** A story's Takes tab, beside Timeline: when several of my newsletters covered the same news, each one's angle in a sentence, grouped by where they land. An event six issues carried came back as four newsletters in two groups, in 8 seconds for a third of a cent. The other half, what people across the web say, needs a search tool.

Before any of that, CI had stopped: GitHub would not run Actions on the private repository any more. After checking that nothing secret was in its history, the repository went public, which keeps Actions free.

## Why

Learning was the reason for #81: the craft pieces I want to keep sit inside digests I treat as news, and a list of issues could not show them. The story was already the unit for the timeline and the day in brief, so the shelves followed.

Ask and Takes were designed in the redesign and waiting for their backends. Both answer from what I already receive, which is the archive's point: the web versions need a search provider, and that is a decision for me, not for a night's build.

## Where we are now

Prod has all three, checked through the API on prod and in mock mode on both devices, but not yet by me on a phone or the Mac. Work runs on GitHub milestones now: one milestone at a time, one issue per pull request, so the board shows what is built and what is left.

## Decisions

- Reading a Learning story marks the story, not its issue; Learning stories do not expire; Archive and the shelf move act on the story, and thumbs still rate the issue. Claude settled #81's three questions with its own proposals when I said to use judgement.
- No Save for stories: unread Learning stories stay listed anyway.
- An issue is Learning only when all its stories are; one with any News story stays in News.
- A newsletter's "always Learning" or "always News" setting now applies to its stories.
- Ask answers from the archive only, in two Claude calls, and keeps nothing: no stored questions.
- Takes answers from my newsletters only, one story standing for each newsletter.
- The repository is public, to keep GitHub Actions free; checked first for secrets and personal data.
- Work is tracked as GitHub milestones, one at a time, for every project (`~/AGENTS.md`).

## Direction changes

- Learning: was issues Haiku called Learning, now stories Jev calls craft.
- An issue's shelf: was Claude's call per issue, now follows its stories.
- The day in brief: was every story in News issues, now News stories wherever they are.
- Reading: was opening an issue marks it read, now opening a story from Learning marks only the story.
- The repository: was private, now public.
- Tracking: was a board of issues, now a board plus one GitHub milestone at a time.

## Needs revisit

- Learning, Ask and Takes on a real phone and Mac (#82, the iPhone pass, still open).
- Whether 428 unread Learning stories is a list I will work through, or a backlog I archive. Nothing expires, by design (`docs/features/story-shelves.md`).
- Ask is one round of searching; if answers come back thin, the next step is a second round (`docs/features/ask.md`).
- The web halves of Ask, Backstory and Takes wait on a search provider account (#16, #17).
- Haiku 5.5 is still not available on the account (#85).
