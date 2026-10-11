# The Library: UX redesign brief (no screens)

Prepared 2026-10-11 by Claude Code for Sandip, for a design handoff.

## Read this first

The Library is a private newsletter reader for one person, on an iPhone and a Mac. It is built and in daily use. Sandip doesn't like its UX on either the phone or the desktop, so this is a **redesign from first principles**, not a polish pass.

**This folder has no screenshots on purpose.** Sandip doesn't want the new design to anchor on the current one. The documents describe what the product does and what the reader needs. They never describe current layouts, placements, colors or typefaces. Don't ask for the current UI, and don't infer it from the requirements: where a story names an interaction, it is because Sandip asked for that interaction, not because a screen already has it.

## What is in this folder

| File | What it gives you |
|---|---|
| `1-PRODUCT-OVERVIEW.md` | What the app is, who it is for, how it works, the vocabulary, the character and tone, what is built, what is planned, hard constraints, real content sizes and volumes, and lessons from the first build. |
| `2-PRODUCT-REQUIREMENTS.md` | 185 user stories in the form "As a ..., I want to ... so that ...", grouped into 15 areas, each marked Shipped, Planned, Fix or Parked with its source, plus the business rules a design must respect. |

## The ask

Suggested scope; Sandip may edit it before sending.

1. **Information architecture and navigation** for the phone (from 375 px wide) and the Mac (half-width window to a wide display). It must hold everything shipped and leave room for the planned destinations (Following, Predictions, Ask the Library, a Watch page) without crowding the phone.
2. **Key screens**, phone and Mac, light and dark:
   - what you see when you open the app;
   - the unread list with its filters (News and Learning, topics, newsletters, views);
   - the Summary with the day in brief and the yellow-boxed top 5;
   - reading an issue, and acting on one story inside a digest;
   - the quick look inside an issue (peek) and fast rating;
   - Saved, History and the way back to the last read;
   - Search, and Ask the Library;
   - a newsletter's page and the list of newsletters;
   - the owner's status page;
   - a deep-dive result that takes 30 to 90 seconds to arrive (timeline, background, grouped takes, source check);
   - empty, loading, error and "nothing found" states.
3. **Key flows:**
   - morning triage on the phone in three minutes: see the day, rate or dismiss, save one long read;
   - an evening session on the Mac: work through a list and read two long issues;
   - find something half-remembered from two weeks ago;
   - pick up on the phone what was started on the Mac;
   - go deep on one story from a digest;
   - star, mute or set a newsletter to always Learning.
4. **A small design system** buildable with Preact and plain CSS (no component library): type, color, spacing, components and states, in light and dark, for phone and Mac, including how the *Person of Interest* touches appear.

## Must keep

- One user, private, responsive web (home-screen web app on iPhone, a browser on the Mac). No native app.
- Newsletters render as their own uncontrolled HTML in a sandboxed frame, effectively always light. Frame them well; you cannot restyle them.
- The character: **Relevant** and **Irrelevant** as the rating labels, the Machine's **yellow box** (a thin yellow corner-bracket frame) on the day's top items, **"No new numbers."** for an empty list. A garnish, not a costume. Typography first, dark-friendly.
- Interactions Sandip asked for by name: swipe one way for Relevant and the other for Irrelevant on the phone (right is Relevant); one tap to see what is inside an issue and a double tap to open it; one tap back to what he was reading. If a better pattern achieves the same outcome, propose it as an alternative, not a silent replacement.
- No third-party requests (self-hosted fonts), every view a URL, 44 px tap targets, keyboard use on the Mac, reduced motion respected.

Full list: section 11 of the overview, and the business rules at the end of the requirements.

## Open questions for the designer

1. One visual identity across phone and Mac, or deliberately different ones?
2. What should the app open on: the ranked Summary, the day in brief, or the full unread list?
3. Is News versus Learning a top-level split, a filter, or something else?
4. How does a story inside a digest become something you can act on (open, follow, ask about, check) without making digests feel heavy?
5. Where do the planned destinations live on a 375 px phone?
6. How should slow AI results (30 to 90 seconds, a few cents each) be asked for, waited on and revisited?
7. How should ranking reasons and the yellow box read, so the ranking feels explainable rather than noisy?

## Facts in one breath

About 30 newsletters, about 25 issues a day, about 90 news stories on a weekday. Claude writes a line per issue (up to 25 words), sorts News or Learning, tags one of nine topics, and splits each issue into stories (a digest holds 7 to 17). One reader, in India, on an iPhone and a Mac. Spend is about $5.50 a month.
