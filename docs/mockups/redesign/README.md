# Handoff: Nutgraf — combined redesign, Apple theme (phone + Mac)

## Read this first
This package replaces the earlier "The Library" handoff. **Layouts, components, gestures, keyboard map, routes and copy are unchanged** from that package. Three things are new:

1. **Name.** The app is now **Nutgraf** (see *Brand & rename*).
2. **Logo.** The folded-page mark (see *Brand & rename*, and `screenshots/L-logo-folded-page.png`).
3. **Theme.** Apple-style type and colour: SF Pro (system font) instead of Newsreader / IBM Plex, and Apple system greys instead of the warm palette. **Yellow stays the only highlight colour. There is no blue anywhere.**

**The single most important rule for this build:** every background colour is listed in *Backgrounds (exact)*. Use only those values, through the tokens. Do not pick, tint, lighten, darken, blend or "improve" any background. If a surface is not in that table, its background is `--bg`.

## Overview
A from-first-principles redesign of **Nutgraf** (formerly The Library), Sandip's private newsletter reader (Preact + plain CSS, home-screen web app on iPhone, browser on Mac). It combines the parts he picked from three explorations:

| Picked | Becomes |
|---|---|
| 1c-1 Deck | **Today** on the phone: the day's 20 ranked News issues as a swipeable deck; the brief is the first card |
| 1a-2 List, peek, swipe | **Browse** on the phone: every unread issue, tap to peek, double-tap to open, swipe to rate |
| 2b The sentence | The filter bar at the top of Browse: one sentence whose underlined words are the controls |
| 1a-3 Story sheet | Reading a digest: a sheet per story with its actions and the deep dives |
| 1b-3 Dossier + job line | How deep-dive results look (verdict, quotes, timelines) and how running jobs follow you |
| 1b Console | **The Mac**: queue / reader / story index in three panes, driven by the keyboard |

The main problem this solves: on the phone today, five rows of controls sit above the first story, which starts halfway down the screen. In this design the top of every phone screen is **one title line** (plus the filter sentence in Browse). Everything else moves to a fixed place.

## About the design files
The files in `design/` are **design references made in HTML**. They show the intended look; they are not production code to copy. Rebuild them in the existing Preact + plain CSS codebase, using its patterns: no component library, no third-party requests, every view a URL.

- `design/Nutgraf.dc.html` is **the spec to build**: 6 phone screens, 1 Mac screen and a System board (palette, type, app icon, the yellow box, components).
- `design/Nutgraf Logos.dc.html` shows the five logo options; **1e The Folded Page is the chosen one.** The other four are context only.
- To view them, open the `.dc.html` files in Chrome **on a Mac** (so SF Pro renders). They load `support.js` and the two frame `.jsx` files next to them. No web fonts are used.
- The phone/Mac frames (status bar, browser chrome) are presentation only. Don't build them.

## Fidelity
**High fidelity.** Colours, backgrounds, type, spacing, radii and copy are final. Recreate them exactly. Layouts are drawn at 375 × 812 (smallest iPhone) and 1240 × 800 (Mac window); scale them as described under "Responsive behavior".

---

## Brand & rename

### Name
- Product name: **Nutgraf**. Use it in `<title>`, the web manifest (`name` and `short_name`: `Nutgraf`), `apple-mobile-web-app-title`, the Mac top bar and any prose.
- The **wordmark** is always lowercase: `nutgraf`. Prose and titles use `Nutgraf`.
- The **Library tab keeps its name** ("Library" is a place in the app, not the app's name).
- Copy changes: `Ask the Library` → `Ask Nutgraf` · `Back to the Library` → `Back to Nutgraf` · `…or ask the Library.` → `…or ask Nutgraf.` · Chrome tab title → `Nutgraf`.
- Routes move from `/thelibrary/…` to `/nutgraf/…`. Keep every old `/thelibrary/*` URL working as a 301 redirect to the same path under `/nutgraf/` (bookmarks and the installed home-screen app must not break).

### Logo — the folded page (option 1e)
A black page with its top-right corner folded down in yellow, and a bold lowercase `n`. It stands for saving your place (Continue reading, Saved).

**App icon (measured on a 120 px icon; scale proportionally):**
| Part | Value |
|---|---|
| Shape | Square, `#000000`. Corner radius 27 px (22.5 %) in the app; iOS applies its own mask to the home-screen icon, so export the PNG square with no rounding. |
| Fold | Top-right square, 46 × 46 px (38 % of the icon). Split on the diagonal: the upper-right triangle is `#000000`, the lower-left triangle is `#FFD60A`. Its bottom-left corner is rounded 8 px. CSS: `linear-gradient(225deg, #000 50%, #FFD60A 50%)`. |
| Letter | `n`, SF Pro Display 700, 64 px (53 %), letter-spacing −0.03em, `#FFFFFF`. Anchored bottom-left: 22 px from the left, 18 px from the bottom. |
| Colours | Only `#000000`, `#FFFFFF`, `#FFD60A`. The fold is always yellow, in both themes. |

**In-app tile (Mac top bar, 24 px):** radius 6, background `#1C1C1E` (dark) / `#000000` (light), fold 10 × 10 with 2 px rounding, `n` 14 px SF Pro Display 700 white, padding 0 0 3 5. The fold's upper-right triangle uses the colour of the surface behind the tile (`#000000` on the dark top bar, `#F2F2F7` on the light one), so the corner reads as cut.

**Lockup:** tile + `nutgraf` in SF Pro Display 600, −0.02em, colour `--ink`, 9–12 px gap. Mac top bar: 19 px. Never set the wordmark in yellow; never recolour the fold.

**Icon files to produce** (in `public/icons/`): `apple-touch-icon.png` 180 × 180, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (the mark scaled to fit the inner 80 % safe zone on `#000000`), `favicon-32.png`. Render them on macOS (so SF Pro is present), e.g. headless Chrome on a page that draws the icon exactly as specified above. Reference: `screenshots/L-logo-folded-page.png` and card 1e in `design/Nutgraf Logos.dc.html`. Set `<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">` and `content="#F2F2F7"` for light.

---

## Backgrounds (exact)
Claude Code: **do not choose background colours.** Each surface below has one value per theme. Use the token, never a literal, and never add gradients, blur/vibrancy/translucent "materials", noise, tints or shadows-as-background. Opaque only. Anything not listed = `--bg`.

| Surface | Token | Dark | Light |
|---|---|---|---|
| `html`, `body`, every screen behind its content, the area under the status bar / safe areas, the overscroll/bounce area | `--bg` | `#000000` | `#F2F2F7` |
| Screen headers (Today/Library title row, Browse date row + sentence, reader top bar) | none — transparent over `--bg` | `#000000` | `#F2F2F7` |
| Bottom tab bar (opaque; 1 px top border `--line`) | `--bg` | `#000000` | `#F2F2F7` |
| Browse rows, Saved rows, History rows | `--bg` | `#000000` | `#F2F2F7` |
| Row while pressed (pointer-down) | `--panel` | `#1C1C1E` | `#FFFFFF` |
| Expanded (peek) row | `--peek` | `#0E0E0F` | `#FAFAFC` |
| Peek's inner story panel | `--panel` | `#1C1C1E` | `#FFFFFF` |
| Deck top card | `--card` | `#1C1C1E` | `#FFFFFF` |
| Deck back card 1 (middle) | `--deck-1` | `#151516` | `#FAFAFC` |
| Deck back card 2 (rear) | `--deck-2` | `#0E0E0F` | `#F5F5F8` |
| Sheets: topic / senders / show sheet, story sheet | `--panel` | `#1C1C1E` | `#FFFFFF` |
| Area above a full-height sheet (P5, behind the status bar) | `--bg` | `#000000` | `#F2F2F7` |
| Scrim behind a sheet | `--scrim` | `rgba(0,0,0,.45)` | `rgba(0,0,0,.30)` (story sheet over the reader: `.20`) |
| Continue pill, search field, job line, toast, sender search | `--raised` | `#2C2C2E` | `#FFFFFF` (+ 1 px `--line-2`) |
| Library grouped list | `--panel` | `#1C1C1E` | `#FFFFFF` |
| "Coming later" group | none — transparent, dashed 1 px `--line-2` | — | — |
| Topic chip, off | `--bg` in light, `--raised` in dark | `#2C2C2E` | `#F2F2F7` (+ 1 px `--line`) |
| Topic chip, on; primary button (`Open`, `Open issue`, `Run · ~20¢`); active Mac tab | `--ink` | `#FFFFFF` (text `#000000`) | `#000000` (text `#FFFFFF`) |
| Outline button (`Later`, story actions, Mac action buttons) | none — transparent, 1 px `--line-2` | — | — |
| Swipe underlay, Relevant | `--rel-bg` | `#0D3317` | `#E3F5E7` |
| Swipe underlay, Irrelevant | `--irr-bg` | `#3A1412` | `#FDE4E4` |
| Swipe label pill (`✓ RELEVANT` / `IRRELEVANT`) | `--rel` / `--irr` | `#30D158` / `#FF453A` | `#248A3D` / `#D70015` |
| Verdict box | `--verdict-bg` | `rgba(255,159,10,.10)` | `#FFF1E6` |
| The newsletter's own page | fixed | `#FFFFFF` + `filter: brightness(.94)` | `#FFFFFF` |
| Skeleton bars | `--line` | `#38383A` | `#E5E5EA` |
| **Mac:** window, top bar, all three panes, status line | `--bg` | `#000000` | `#F2F2F7` |
| **Mac:** ⌘K field, summary panel, expanded story in the index | `--panel` | `#1C1C1E` | `#FFFFFF` |
| **Mac:** selected queue row (with the ink box) | `--raised` | `#2C2C2E` | `#FFFFFF` |

Checks before you call a screen done: in dark mode the page background reads `rgb(0, 0, 0)` (not `#121212`, `#0C0D0E`, `#1C1C1E` or any other near-black); in light mode it reads `rgb(242, 242, 247)` (not white). Cards and sheets are the only raised surfaces.

---

## Information architecture

### Phone (≤ 760 px wide)
Bottom tab bar, four tabs, always visible except while reading:

| Tab | Holds |
|---|---|
| **Today** | The Summary as a deck: brief card → the five (yellow box) → ranks 6–20. "List view" shows the same 20 as a ranked list. |
| **Browse** | All unread issues (News or Learning), filter sentence on top. Replaces the News/Learning toggle, topic chips, Senders button and Unread menu. |
| **Saved** | Read-later queue, newest saved first. |
| **Library** | Search (and Ask Nutgraf later), History, Newsletters, Status, Settings, then a "Coming later" group: Following, Ask Nutgraf, Predictions, Watch. New destinations go here; the tab bar never grows. |

- **Continue reading** (Now reading) is a pill at the right of every tab header: `↩ Linear 42%` on Today and `↩ 42%` elsewhere. One tap returns to the last issue at its stored percentage. Hide it when there is nothing to continue (business rule 19).
- **Refresh** is pull-to-refresh on Today and Browse. "Checked 12:30" always shows in the Browse date line.
- **Theme** follows the system. A manual override lives in Library › Settings.
- **Must Read** gets no section and no carousel. Must Read issues sort first in Browse and carry `★` before the newsletter name.

### Mac (> 760 px)
The 1b console: three panes under a 48 px top bar.

| Pane | Width at 1240 | Holds |
|---|---|---|
| Queue | 392 px | Sentence-style filter line; the five inside one yellow frame; then the rest |
| Reader | flexible | Issue header, Claude's summary, action buttons with keys, the newsletter page |
| Story index | 312 px | The issue's stories. The selected one expands with action keys and its filed deep-dive results |

The top bar has the tabs NEWS · LEARNING · SAVED with counts, plus a ⌘K command field. History, Newsletters, Status, Settings and the planned places are reached from ⌘K ("go to …"). A 30 px status line at the bottom shows the key legend, running jobs and the Continue item.

### Routes (every view a URL; Back must restore exactly)
```
/nutgraf/today                       deck
/nutgraf/today/list                  same 20 as a list
/nutgraf/browse?kind=news&show=unread&topic=ai-llms,startups-business&sender=the-ken
/nutgraf/saved
/nutgraf/library                     + /search?q=  /history?day=2026-10-11  /newsletters  /newsletters/:slug  /status  /settings
/nutgraf/issue/:issueId              reader (phone)
/nutgraf/issue/:issueId/story/:n                     story sheet open
/nutgraf/issue/:issueId/story/:n/:deep               deep = timeline | backstory | takes | source
Mac: /nutgraf/news/:issueId/story/:n[/:deep]   (and /learning/…, /saved/…)
```

---

## Screens

All measurements in CSS px. Safe-area top on the phone is 54 px (content starts there). The tab bar is 83 px: 49 px of tabs plus 34 px of home-indicator padding.

### P1 · Today (deck) — opens here
- **Header row** (h 44, side padding 16): `Today` in SF Pro Display 700 32/1, letter-spacing −0.02em. On the right is the Continue pill: h 40, padding 0 14, radius 20, background `--raised`, 1 px `--line-2` border, label 500 12, `↩ Linear` plus `42%` in `--ink-3`.
- **Progress row** (h 36): label 500 11, +0.04em, `--ink-3`: `CARD 3 OF 20 · ~2 MIN LEFT`. On the right, `LIST VIEW` in `--ink`, weight 600.
- **Ticks:** 20 bars, flex 1, h 3, gap 3, radius 2. Done = `--ink`, current = `--ink-3`, rest = `--line-2`.
- **Deck area:** margin-top 16, h 486, relative.
  - Back card 2: left/right 20, top 18, h 452, radius 16, background `--deck-2` (`#0E0E0F` / light `#F5F5F8`), 1 px `--line`.
  - Back card 1: left/right 10, top 9, h 462, background `--deck-1` (`#151516` / light `#FAFAFC`).
  - **Top card:** full width, h 472, radius 16, background `--card`, 1 px `--line-2`, shadow `0 14px 34px rgba(0,0,0,.35)` (light `.12`), padding 20 20 18, flex column.
    - If the issue is one of the day's five, the yellow box sits outside the card (inset −9, arm 22, stroke 2.5).
    - Label: label 600 11, +0.03em. Use `02 OF TODAY'S FIVE` in `--box-text` for the five; otherwise `07 · BEST FIRST` in `--ink-3`.
    - Meta (mt 12): label 500 11, +0.03em, `--ink-3`: `TLDR AI · 3H · 5 MIN · 12 STORIES`.
    - Title (mt 8): SF Pro Display 700 24/1.15, −0.01em, text-wrap pretty.
    - Claude's line (mt 8): SF Pro Text 400 14.5/1.45, `--ink-2`.
    - **Inside** (digests only; mt 14, pt 12, top border `--line`): label `INSIDE`, then the first 2 stories (number in label 600 11.5 `--ink-3`, headline in SF Pro Text 600 15/1.3, row padding 7 0), then `+ 10 MORE` in label 10.5 `--ink-2`.
    - **Footer** (margin-top auto): `WHY` (label) plus the reason in SF Pro Text 14/1.35. Below it, two buttons at h 44 with an 8 gap: `Later` (outline, 1 px `--line-2`, radius 6) and `Open` (filled `--ink`, text `--on-ink`, radius 6). SF Pro Text 600 14.
    - Swipe labels at top-right 16/16: `✓ RELEVANT` (background `--rel`, text `--on-ink`) or `IRRELEVANT` (background `--irr`). Padding 7 10, radius 4, label 600 11, +0.05em, opacity bound to drag distance.
- **Hint row** (mt 12): label 500 11, +0.03em: `← IRRELEVANT` (`--irr`), `TAP TO OPEN` (`--ink-3`), `RELEVANT →` (`--rel`).
- **Brief card** (always first, until folded): label `IN BRIEF · 5 THREADS · 07:40` in `--box-text`; title `The day, before you start`; one line `41 stories from 14 newsletters, written up as five threads.`; the 5 thread titles (SF Pro Text 600 16/1.25) each with their sources in label 11; buttons `Fold` and `Read the brief`. A swipe either way = fold (label `FOLD`); a fold is remembered for the day (SUM-12).
- **Empty:** centred `No new numbers.` (New York italic 30), then `You are through today's picks. Browse holds the rest.` and an `Open Browse` button.

### P2 · Browse
- **Date row** (h 44, padding 0 8 0 20): `SUN 11 OCT · CHECKED 12:30` in label 500 11, +0.04em, `--ink-3`. On the right: the Continue pill (h 34, `↩ 42%`) and a 44 × 44 search button (opens Library › Search).
- **The sentence** (padding 2 20 18, bottom border `--line`): SF Pro Display 700 28/1.26, −0.01em, connecting words in `--ink-3`. The count and each control word are in `--ink`, underlined: 2 px `--box` (yellow), offset 6 px. Not blue, not bold-only. Grammar is under Interactions.
- **Row** (padding 15 20, bottom border `--line`):
  - Meta line: label 500 11, +0.03em. Left is `★ THE KEN` (Must Read in `--box-text`, others `--ink-2`); right is `5H · 11 MIN` in `--ink-3`.
  - Title (mt 6): SF Pro Text 600 18/1.28.
  - Claude's line (mt 4): SF Pro Text 400 14/1.42, `--ink-2`.
  - Tags line (optional, mt 8): label 10: topic · `✓ RELEVANT` (`--rel`) · `SAVED` · `READ`.
  - Read-this-session rows stay in place at 60 % opacity until the view changes (nothing jumps under the finger).
- **Peek (expanded row):** background `--peek` (`#0E0E0F` / light `#FAFAFC`). Inside is a panel: radius 8, 1 px `--line`, background `--panel`.
  - Header (padding 10 12): `INSIDE · 10 STORIES` / `DOUBLE TAP OPENS` in label 11, +0.05em.
  - Three story rows: number (label 11), headline (SF Pro Text 600 15/1.25), one-line summary (SF Pro Text 13, single line with ellipsis), and a 44 × 44 `↗` button that opens the story's own link.
  - Footer: `7 MORE` plus an `Open issue` button (h 38, radius 6, filled `--ink`).
  - Single-story issues show their summary (and later the fuller summary of PEK-07) instead of a story list.
- **Swipe state:** the row slides with the finger. The underlay is `--rel-bg` with `✓ RELEVANT` at left (dragging right) or `--irr-bg` with `IRRELEVANT · ARCHIVE` at right (dragging left), both label 600 11, +0.05em.

### P3 · Browse with the topic sheet (light shown)
- Scrim: `--scrim`.
- Sheet: h 420, radius 16 16 0 0, background `--panel`, padding 8 20, grabber 36 × 5.
- Header row (h 44): `Clear` (`--ink-2`, 400) · `Topics` (SF Pro Text 600 17) · `Done` (`--ink`, 600). Neither is blue.
- Sub-label: `PICK ANY · COUNTS ARE UNREAD NEWS` (label 11).
- Chips wrap with gap 8: h 40, padding 0 14, radius 20, SF Pro Text 600 13.5, count in weight 500. On = filled `--ink`, text `--on-ink`. Off = `--bg` fill with 1 px `--line`.
- The sentence above rewrites live (`10 unread in News, about AI and Startups, all senders.`).
- The senders sheet uses the same shell: a search field, Must Read first with `★`, a count, and a checkbox per row. The Show sheet holds three options: Unread · All · Archived.

### P4 · Reading a digest (light shown)
- Top bar (h 44): `‹ Today` (SF Pro Text 600 15; the label is wherever you came from) and `ORIGINAL ↗` (label 11).
- Header (padding 4 20 12): meta `TLDR AI · 06:14 · 5 MIN · NEWS · AI & LLMS` (label 11) and title SF Pro Display 700 23/1.18. Digests add a `12 STORIES INSIDE ›` button (h 40, label 11); single stories get `GO DEEPER ON THIS STORY ›`.
- **The newsletter page:** the email's own HTML in a sandboxed iframe (no scripts). It sits on a white page with a 12 px side margin, radius 3, shadow `0 1px 2px rgba(0,0,0,.1), 0 0 0 1px rgba(0,0,0,.07)`. In dark mode the page gets `filter: brightness(.94)`. It is never recoloured, and it scales to the column width so there is no sideways scroll.
- **Reader action bar** (fixed bottom, padding 8 12 34, top border `--line`): four 44 px buttons, radius 6, label 600 11: `✓ RELEVANT` · `✕ IRRELEVANT` · `SAVE` · `STORIES 12` (`ARCHIVE` for single-story issues). If a job is running, a job line sits above them.
- **Story sheet** (top 236, radius 16, background `--panel`, padding 6 18 34):
  - `STORY 1 OF 12` (label 11) with ‹ › steppers (44 × 40, disabled = `--line-2`).
  - Headline SF Pro Display 700 21/1.2; summary SF Pro Text 14.5/1.45 `--ink-2`.
  - Names line in label 11: `OPENAI · INDIGO · MARRIOTT · ALSO IN PLATFORMER, THE KEN`.
  - Four action buttons (h 40, label 600 11): `SOURCE ↗` · `RELATED 2` · `FOLLOW` · `ASK`.
  - Deep-dive tabs (h 40, label 600 11, active = `--ink` with inset 2 px bottom bar): `TIMELINE · BACKSTORY · TAKES · SOURCE`, each with a state mark: `●` running (`--box-text`), `✓` filed (`--rel`).
  - **Running state:** title (SF Pro Text 600 17); status at right with a pulsing dot (`RESEARCHING · 0:34`); scope and cost line (`YOUR ARCHIVE AND THE WEB · ~20¢ · UP TO 90 S`); dated points so far; dashed skeleton rows for the points still coming; footnote `Keep reading; it fills in here and stays on this story. A second look is free.`
  - **Dated point:** 1 px left rule `--line-2` with a 7 px dot, meta (label 11, `2025 · WEB`) and text (SF Pro Text 600 15/1.3).

### P5 · Story sheet at full height, source check filed (dark shown)
- The sheet rises to top 54. Shown: story 2 with the `SOURCE ✓` tab.
- **Verdict box:** padding 12 14, 1 px `--verdict-line`, background `--verdict-bg`, radius 6. It holds `VERDICT` (label 11), the verdict (label 600 13, `--verdict`) and one plain sentence (SF Pro Text 14). Verdicts: `HOLDS UP` (`--rel` styling), `GOES FURTHER THAN THE SOURCE` (verdict colours), `NOT IN THE SOURCE` (`--irr` styling), `SOURCE IS PAYWALLED` (neutral; say so plainly, never guess).
- `TLDR AI SAID` and `THE SOURCE SAYS`: New York italic 16/1.45 quotes. The newsletter's quote has a 2 px `--line-2` rule; the source's has a 2 px `--ink` rule. A source link follows (label 11, underlined).
- Receipt: `CHECKED 07:58 · 52 S · 14¢ · KEPT FOR THIS EVENT, FREE TO REOPEN`.
- **Job line** (pinned at the sheet bottom, and above the reader action bar when the sheet is closed): h 44, radius 6, `--raised`, 1 px `--line-2`, pulsing 7 px `--box` dot, `BACKSTORY · STORY 1 · 0:41 OF ~1:30` (label 11), and a `VIEW` button.

### P6 · Library
- Header: `Library` plus the Continue pill.
- Search field: h 46, radius 8, `--raised`, `Search everything you received`.
- Grouped list (radius 10, `--panel`, 1 px `--line`), rows min-h 56: History `4 TODAY` · Newsletters `32 · 11 ★` · Status `● HEALTHY · 12:30` · Settings `THEME: SYSTEM`.
- `COMING LATER` group (dashed border): Following · Ask Nutgraf `5–20¢ A QUESTION` · Predictions · Watch. Remove the dashed treatment as each ships.

### M1 · Mac console
- **Top bar** (h 48, bottom border):
  - Logo: the 24 px folded-page tile and the `nutgraf` wordmark (see *Brand & rename*).
  - Tabs (h 30, radius 4, label 600 11, +0.04em): active = filled `--ink`. `NEWS 23 · LEARNING 9 · SAVED 6`.
  - Command field: w 380, h 32, `⌘K Search, ask, or go to History, Newsletters, Status…`.
  - Health dot and the check time.
- **Queue:**
  - Filter line (h 40): SF Pro Text 600 15, the same sentence grammar in short form: `23 unread in News, best first, all topics`.
  - The five sit in **one** yellow frame (arm 14, stroke 1.5) with the header `TODAY'S FIVE` / `FIXED 07:52 · 64% HIT / 14D`.
  - Rows: 30 px rank column (label 600 13; yellow for the five), meta (label 11), title (SF Pro Text 600 16, one line), reason code `↳ INTEREST · AI` (label 11).
  - The selected issue gets the **ink box** (the same corner rule in `--ink`, arm 8, stroke 1.5) on a `--raised` background.
- **Reader:**
  - Meta (label 11): `02 OF TODAY'S FIVE · TLDR AI · SUN 11 OCT 06:14 · 5 MIN · NEWS · AI & LLMS`.
  - Title: SF Pro Display 700 27/1.2.
  - Summary panel (`--panel`, radius 6): `SUMMARY · WHY: …` and the text. The Mac always shows Claude's summary (RD-05).
  - Action buttons (h 30, radius 4, label 600 11, key letter at 70 % opacity): `R RELEVANT` · `X IRRELEVANT` · `S SAVE` · `E ARCHIVE` · `M TO LEARNING` · `O ORIGINAL ↗`.
  - Label `THE NEWSLETTER'S OWN PAGE · SANDBOXED`, then the page.
- **Story index:**
  - Header: `IN THIS ISSUE · 12` / `[ / ]`.
  - The selected story is expanded in an ink box: headline (SF Pro Text 600 15), `Also in … · 2 related`, then a key grid: key cap (label 11, 1 px `--line-2`, radius 3) · action · status or cost. Rows: `O SOURCE ↗`, `F FOLLOW`, `A ASK 5–20¢`, `L TIMELINE ✓ FILED`, `B BACKSTORY ● 0:41`, `T TAKES 20¢–$1`, `C CHECK SOURCE ~10¢`.
  - Filed results render under the selected story in compact form; the timeline is a 44 px date column plus text.
  - Other stories are single lines (SF Pro Text 13, ellipsis), with a verdict tag where one is filed (`GOES FURTHER`, label 11, verdict colours).
- **Status line** (h 30, label 11): key legend `J/K ISSUES · [ ] STORIES · SPACE PEEK · R · X · S · E · U UNDO · L B T C GO DEEPER · / SEARCH`, then running jobs in `--box-text` and `↩ HOW LINEAR BUILDS PRODUCT · 42%`.

---

## Interactions & behavior

### Deck (Today, phone)
- The card follows the finger: `translateX(dx) rotate(dx/22 deg)`, transform-origin `50% 100%`, no transition while dragging. Labels fade in with `min(1, |dx|/100)`.
- **Release** at `|dx| ≥ 100 px` (or flick velocity > 0.5 px/ms) flies the card out: `translateX(±520px) rotate(±18deg)` over 250 ms ease-in. Then apply the action and show the next card with **no** transition, so it doesn't fly back in. Under the threshold, the card springs back over 250 ms `cubic-bezier(.2,.8,.2,1)`.
- **Actions:**
  - Right = Relevant. The issue stays unread, leaves the deck and stays in Browse with `✓ RELEVANT`.
  - Left = Irrelevant **and** archive. Show the Undo toast for 5 s.
  - `Later` = save, which takes the issue out of Unread and the deck.
  - Tap (movement < 6 px) or `Open` = open the reader.
- **Proposed alternative (flagged to Sandip):** the card already shows what is inside, so one tap opens with no 250 ms single/double-tap wait. Browse keeps his requested tap-to-peek, double-tap-to-open.
- Gestures must start ≥ 20 px from the screen edges; iOS owns edge-swipe Back. A second swipe the same way does nothing.

### Browse rows
- **Direction lock:** after 8 px of movement, horizontal if `|dx| > |dy|`, otherwise let the list scroll.
- Threshold 90 px. Right → Relevant: the row springs back and shows the tag. Left → archive: the row collapses (height to 0 over 200 ms) and the toast `Irrelevant · archived` + `UNDO` shows for 5 s. Undo restores the rating, the archive state and the saved state (business rule 4).
- **Tap vs double tap:** on pointer-down, show the pressed state at once (row background `--panel`); this hides the wait. A second tap within 260 ms opens the reader with no peek flash. Otherwise the peek toggles at 260 ms.
- **Peek counts as reading (fix #56):** a peek held open ≥ 2 s marks the issue read and logs `Read 9:31 PM` in History (as opposed to `Opened`).
- Saving or reading from the list leaves the row where it is until the view changes (RET-10).

### The sentence (Browse filter)
- **Grammar:** `{count} {show} in {kind}, {topics}, {senders}.`
  - show: `unread` | `issues` (All) | `archived`. Tap → Show sheet.
  - kind: `News` | `Learning`. Tap toggles directly; this **clears topics and keeps senders** (BRW-09).
  - topics: `all topics` | `about AI & LLMs` | `about AI & LLMs and Startups & Business` | `about AI & LLMs and 2 more`. Tap → Topics sheet.
  - senders: `all senders` | `from The Ken` | `from The Ken and 1 more`. Tap → Senders sheet.
- Sheets apply changes live, and the URL updates with them. `Clear` resets that part; `Done` closes.
- Counts always reflect the current state and update as you read, rate, save and archive (BRW-16).

### Reader & story sheet
- Opening an issue marks it read and makes it the Continue item. The reading place is stored as a **percentage** of the issue. It ends when the bottom of the screen reaches the end of the issue, or when the issue is rated or archived after opening (rules 18–19).
- The sheet has two detents: medium (top ≈ 236 px) and full (top 54 px). Drag the grabber, or tap the scrim to close. ‹ › steps through the stories.

### Deep dives (all four kinds)
| Kind | Tab | Scope | Cost shown | Typical time |
|---|---|---|---|---|
| How this evolved | TIMELINE | your newsletters, last weeks | ~1¢ | a few seconds |
| How we got here | BACKSTORY | archive + web, 5–8 points ending today | 10–30¢ | up to 90 s |
| What experts say | TAKES | your newsletters by stance, then the web by role, quotes checked | 20¢–$1 | up to 90 s |
| Go to the source | SOURCE | newsletter claim vs. the original, with a verdict | ~10¢ | under a minute |

- **Never auto-run.** An idle tab shows the title, a one-line description, the cost/time line and a `Run · ~20¢` button (full width, h 46, filled `--ink`). The footnote reads: "Runs only when you ask. Kept for this story afterwards, so a second look is free."
- Running jobs live on the server (the API answers within 15 s, so jobs are async). The client polls; points stream in as they arrive.
- A job keeps running when you leave. A **job line** follows you inside the reader; on the Mac it shows in the status line. When a job finishes and you are not looking at it, show the toast `How we got here is ready` + `VIEW`.
- Results are **cached per event**, so the same event reached from another newsletter's story opens instantly with `KEPT · FREE TO REOPEN`.

### Mac keyboard
| Key | Action |
|---|---|
| J / K, ↓ / ↑ | next / previous issue (opens it in the reader, marks read) |
| [ / ] | previous / next story in the index |
| Space | peek: expand the selected queue row's stories inline |
| R / X | Relevant / Irrelevant + archive |
| S / E / M | save toggle / archive / move News ↔ Learning |
| U | undo the last action |
| O / F / A | story source / follow / ask |
| L / B / T / C | timeline / backstory / takes / check source for the selected story |
| / and ⌘K | search; command palette (go to History, Newsletters, Status, Settings…) |
| 1 / 2 / 3 | NEWS / LEARNING / SAVED |
| Esc | close the dossier or palette |

Focus is always visible as the ink corner box. Undo and other messages appear for 4 s in the status line in `--box-text`.

### Loading, empty, error
- **Empty list or deck:** `No new numbers.` in New York italic 30, `--ink`, on `--bg`. It should read as being done, not as an error.
- **Nothing found (search):** `Nothing matches "…". Try other words, or ask Nutgraf.`
- **Loading:** skeleton rows with the same row metrics, `--line` bars, and no shimmer under reduced motion.
- **App cannot start / broken link:** a plain message and one button (`Try again` / `Back to Nutgraf`).

### Motion
Durations are 120–250 ms. Use ease-out for things that come in and ease-in for things that leave. Under `prefers-reduced-motion`: no rotation or fly-out; cards and rows cross-fade over 120 ms; pulsing dots are static.

### Responsive behavior
- Phone layout up to 760 px wide (the tab bar stays 4 tabs at every width).
- At 760–1100 px, the Mac console drops the story index into a slide-over opened with `[`.
- From 1100 px on, all three panes show; the reader takes the extra width, up to a 760 px column.

---

## State management
- **Issue:** `state` (unread | read | archived), `saved` (bool), `rating` (relevant | irrelevant | null), `kind` (news | learning, with the reader's override winning), `topic`, `mustRead` (from newsletter), `stories[]`.
- **UI (in the URL):** tab, browse `kind/show/topics/senders`, open `issueId`, `story` n, `deep` tab. On the Mac: the selected issue and story.
- **Session-only:** `seenThisSession` (keeps rows in place), pressed row, peek row, drag offsets, the toast with its undo payload.
- **Synced across devices:** ratings, saved, read/archived, Must Read, mutes, Continue (`issueId`, `pct`), deep-dive jobs and results (per event). Refetch on focus (DEV-03).
- **Jobs:** `{eventId, kind, status: running|done|failed, startedAt, points[], result}`.

## Design tokens
```css
:root {
  --font-text: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  --font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  --font-quote: ui-serif, "New York", Georgia, serif;   /* quoted source text only */
}
:root, [data-theme="dark"] {   /* dark, default */
  color-scheme: dark;
  --bg:#000000; --panel:#1C1C1E; --raised:#2C2C2E; --card:#1C1C1E; --peek:#0E0E0F;
  --deck-1:#151516; --deck-2:#0E0E0F;
  --line:#38383A; --line-2:#48484A;
  --ink:#FFFFFF; --ink-2:#AEAEB2; --ink-3:#8E8E93; --ink-body:#D1D1D6; --on-ink:#000000;
  --box:#FFD60A; --box-text:#FFD60A;
  --rel:#30D158; --rel-bg:#0D3317; --rel-line:#1F5C2E;
  --irr:#FF453A; --irr-bg:#3A1412; --irr-line:#6E2522;
  --verdict:#FF9F0A; --verdict-line:#6A4300; --verdict-bg:rgba(255,159,10,.10);
  --scrim:rgba(0,0,0,.45); --page-filter:brightness(.94);
}
[data-theme="light"] {
  color-scheme: light;
  --bg:#F2F2F7; --panel:#FFFFFF; --raised:#FFFFFF; --card:#FFFFFF; --peek:#FAFAFC;
  --deck-1:#FAFAFC; --deck-2:#F5F5F8;
  --line:#E5E5EA; --line-2:#D1D1D6;
  --ink:#000000; --ink-2:#3C3C43; --ink-3:#6E6E73; --ink-body:#3C3C43; --on-ink:#FFFFFF;
  --box:#FFCC00; --box-text:#946800;
  --rel:#248A3D; --rel-bg:#E3F5E7; --rel-line:#A8DDB5;
  --irr:#D70015; --irr-bg:#FDE4E4; --irr-line:#F3B1B5;
  --verdict:#C93400; --verdict-line:#F2C9A6; --verdict-bg:#FFF1E6;
  --scrim:rgba(0,0,0,.30); --page-filter:none;
}
@media (prefers-color-scheme: light) { :root:not([data-theme]) { /* same values as [data-theme="light"] */ } }
html, body { background: var(--bg); color: var(--ink); font-family: var(--font-text); -webkit-font-smoothing: antialiased; }
/* The Machine's yellow box — one rule. Set --arm and --w per use. */
.ybox { position:absolute; inset:var(--inset,0); pointer-events:none;
  --c:var(--box); --g:linear-gradient(var(--c),var(--c));
  background:
    var(--g) left top/var(--arm) var(--w) no-repeat, var(--g) left top/var(--w) var(--arm) no-repeat,
    var(--g) right top/var(--arm) var(--w) no-repeat, var(--g) right top/var(--w) var(--arm) no-repeat,
    var(--g) left bottom/var(--arm) var(--w) no-repeat, var(--g) left bottom/var(--w) var(--arm) no-repeat,
    var(--g) right bottom/var(--arm) var(--w) no-repeat, var(--g) right bottom/var(--w) var(--arm) no-repeat; }
/* deck card: --arm:22px --w:2.5px --inset:-9px · Mac five frame: 14px 1.5px · focus box: --c:var(--ink) 8px 1.5px */
```
- **Colour rules:**
  - Yellow (`--box`) is the **only** accent. It marks the Machine's picks (the yellow box, the day's five ranks), the tappable words in the filter sentence (2 px underline), running-job dots and the `UNDO` action. In light mode yellow text uses `--box-text`.
  - **No blue.** Not for links, buttons, selected tabs, focus rings or toggles. Links are `--ink-2` and underlined. Selected tab = `--ink`; unselected = `--ink-3`. Primary buttons are filled `--ink`.
  - Green and red are only for Relevant / Irrelevant; orange only for the source-check verdict.
  - Disable the iOS tap highlight (`-webkit-tap-highlight-color: transparent`) and use the pressed state instead.
- **Type:** system fonts only. **No web fonts, no `@font-face`, no Google Fonts** (Newsreader, IBM Plex and Courier Prime are gone). Use the three stacks above. Turn on tabular figures (`font-variant-numeric: tabular-nums`) for every label, rank, count, time and cost.

  | Use | Font | Weight | Size / line-height | Tracking |
  |---|---|---|---|---|
  | Screen title (`Today`, `Library`) | SF Pro Display | 700 | 32 / 1 | −0.02em |
  | Filter sentence | SF Pro Display | 700 | 28 / 1.26 (Mac short form: SF Pro Text 600 15) | −0.01em |
  | Card title | SF Pro Display | 700 | 24 / 1.15 | −0.01em |
  | Issue title | SF Pro Display | 700 | 23 phone, 27 Mac | −0.01em |
  | Story headline (sheet) | SF Pro Display | 700 | 21 / 1.2 | −0.01em |
  | Row title | SF Pro Text | 600 | 18 / 1.28 | |
  | Story in a list, Mac queue title | SF Pro Text | 600 | 15–16 / 1.3 | |
  | Section title in a sheet (`How we got here`, `Topics`) | SF Pro Text | 600 | 17 | |
  | Quote (`TLDR AI SAID` / `THE SOURCE SAYS`), empty state `No new numbers.` | New York italic | 400 | 16 / 1.45 (empty state 30) | |
  | Body | SF Pro Text | 400 | 14.5 / 1.45 (14 / 1.42 in rows) | |
  | Control | SF Pro Text | 600 | 14 | |
  | Label (meta lines, tabs, statuses) | SF Pro Text | 500–600 | 11 (never smaller) | +0.03 to +0.05em, caps, tabular |
  | Rank / key cap | SF Pro Text | 600 | 11–15 | tabular |
  | Wordmark | SF Pro Display | 600 | 19 (Mac bar) | −0.02em |

  Everywhere below that says "label" or "mono", read **SF Pro Text caps at 11 px, tabular figures**.
- **Spacing:** 4 px base. Phone side padding is 16 (Today, Library) or 20 (lists, reader); rows are 15 / 20; common gaps are 6 · 8 · 10 · 12 · 16 · 20 · 24.
- **Radii:** 3 (email page, key caps) · 4 (tags, Mac buttons) · 6 (buttons, job line) · 8 (peek panel, inputs, toast) · 10 (grouped lists) · 16 (cards, sheets) · pill (chips, Continue) · 22.5 % (app icon).
- **Shadows:** deck card `0 14px 34px rgba(0,0,0,.35)` (light `.12`) · sheet `0 -10px 30px rgba(0,0,0,.35)` (light `.14`) · email page `0 1px 2px rgba(0,0,0,.1), 0 0 0 1px rgba(0,0,0,.07)`.
- **Targets:** ≥ 44 × 44 px on the phone (chips are 36–40 high with a 44 hit area).

## Copy (exact)
- Ratings: `Relevant` / `Irrelevant`. On swipe labels, label caps: `✓ RELEVANT` / `IRRELEVANT`.
- Empty: `No new numbers.`
- Toasts: `Relevant · it stays unread` · `Irrelevant · archived` + `UNDO` · `Saved for later` + `UNDO` · `Brief folded for today` + `UNDO` · `How we got here is ready` + `VIEW`.
- Ranking reasons (one per item, plain words): `From a Must Read newsletter` · `Close to your interest in AI` · `You rated The Ken Relevant 4 times` · `Trying a newsletter you haven't rated yet`. Mac codes: `MUST READ · AI`, `INTEREST · SYSTEM DESIGN`, `4× RELEVANT`, `EXPLORING · NOT RATED YET`.
- The yellow box appears **only** on the day's five (fixed at first view each IST day). The deck shows it per card; the Mac shows one frame around the group.

## Accessibility
- Every swipe has a button equivalent: the reader action bar, `Later`/`Open` on cards, and VoiceOver custom actions on rows (Relevant, Irrelevant, Save, Peek).
- Sentence words are real buttons with labels, e.g. `aria-label="Topics: all topics. Change"`.
- Contrast: `--ink-3` on `--bg` is ≥ 4.5 : 1 in both themes (`#8E8E93` on `#000000`, `#6E6E73` on `#F2F2F7`); keep it that way, don't lighten it. Yellow is never used for body text in light mode (use `--box-text`).
- Full keyboard on the Mac, with the visible ink focus box. Reduced motion as above.

## Business rules to keep visible in the build
Saved leaves Unread; archiving unsaves; Undo restores both (rules 3–4). Only explicit ratings train the ranking (RAT-09). Only unread News from the last 14 days is ranked. The order is stable within a day. The top 5 are fixed at first view (rules 10–14). Muted newsletters are out of lists, counts and the Summary (rule 5). Deep dives run only on request and are cached per event (rule 26). Full list: `reference/2-PRODUCT-REQUIREMENTS.md`.

## Assets
- **Icons:** inline SVG, 24 px, stroke 1.8, round joins.
  - Today: `rect x4.5 y7.5 w15 h13 rx2.5` + `M7 4.5h10`
  - Browse: `rect x4 y5 w16 h14 rx2` + `M8 9h8M8 12.5h8M8 16h5`
  - Saved: `M7 4h10v16l-5-3.6L7 20z`
  - Library: corner brackets `M4 8.5V4h4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5` + `M10 8v8h5`
  - Search: `circle r6 at 11,11` + `M20 20l-4.5-4.5`
- **App icon:** the folded page (see *Brand & rename*). The old typewriter-L icon and Courier Prime are retired.
- No raster images in the UI. Newsletter content brings its own.

## Files
```
design/Nutgraf.dc.html        ← build this (P1–P6, M1, System board)
design/Nutgraf Logos.dc.html  ← logo options; 1e The Folded Page is chosen
design/support.js, ios-frame.jsx, browser-window.jsx   ← only to open the samples
reference/brief.md, 1-PRODUCT-OVERVIEW.md, 2-PRODUCT-REQUIREMENTS.md, current-ui.png
screenshots/   ← 2x PNGs, for quick visual reference
  P1-today-deck-dark.png · P2-browse-peek-swipe-dark.png · P3-browse-topics-sheet-light.png
  P4-reader-story-sheet-light.png · P5-source-check-job-line-dark.png · P6-library-dark.png
  M1-mac-console-dark.png · S-system-board.png · L-logo-folded-page.png
```
`reference/` documents still say "The Library"; read them as Nutgraf. When a screenshot and this README disagree, this README wins, then the `.dc.html` source.

## Suggested build order for Claude Code
1. Tokens exactly as in *Design tokens* (including every background in *Backgrounds (exact)*), the system font stacks (remove the old self-hosted Newsreader / Plex / Courier Prime files and their `@font-face` rules), the `.ybox` rule, the rename (title, manifest, routes + `/thelibrary` redirects) and the icon files, and the base components: button, chip, row, sheet, toast, job line, verdict box.
2. Phone shell: the 4-tab bar, the Continue pill, routing (every view a URL), pull-to-refresh.
3. Browse: the sentence with its three sheets, rows, peek and double tap, swipe and undo, read-by-peek (#56).
4. Today deck: brief card, the five, swipe physics, Later/Open, empty state, List view.
5. Reader and story sheet: sandboxed page framing, action bar, steppers, Related.
6. Deep dives: the job API (async plus polling), the four result formats, the job line, the ready toast, per-event caching.
7. Mac console: three panes, keyboard map, ⌘K palette, status line.
8. Library: Search, History (read-by-peek vs opened), Newsletters, Status, Settings (theme override).

**Done when:** every background matches *Backgrounds (exact)* in both themes; there is no blue and no web font anywhere; the first story on every phone screen starts above 25 % of the screen height; every action works without gestures; Back restores every view exactly; no third-party requests; reduced motion respected.
