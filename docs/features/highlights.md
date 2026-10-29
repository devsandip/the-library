# Highlights (#71)

Select a passage while reading and keep it, with a note if I want one; see them all on a Highlights page; and have them in my Obsidian vault, one note per issue. From the newsletter-reader research (2026-10-11): highlighting and exporting to a notes app is core to Readwise Reader and Matter, and my research lives in Obsidian.

Milestone 10 builds it in four pieces: the API (#166), highlighting in the reader (#167), the Highlights page (#168) and the script that writes the vault's notes (#169). Highlights in ranking (#5, #69) and in Ask the Library (#21), and a Readwise-compatible CSV (if the app opens to other readers), are outside it.

## The API (#166)

- **Keep a passage** (`POST /nutgraf/api/issues/{id}/highlights`, `services/api/src/highlights.ts`): `{ exact, prefix?, suffix?, note? }`. The passage is kept as a text-quote anchor, as in W3C Web Annotation: the passage itself and up to 32 characters either side, whitespace collapsed, never offsets. The same passage with the same context again answers the one kept, so a second tap does not make two. 400 for a passage that is empty or over 2,000 characters, or a note over 2,000; 404 for an unknown or filtered issue.
- **On the issue:** `GET /nutgraf/api/issues/{id}` carries its `highlights`, oldest first, so the reader marks them without another request.
- **The list** (`GET /nutgraf/api/highlights?limit=&before=`): newest first, 50 at a time (up to 200), each with its issue as a row; `next` is the `before` for the next page. A highlight whose issue was filtered since is left out.
- **Notes** (`PATCH /nutgraf/api/highlights/{id}` `{ note }`): a note set, or cleared with `null` or blank text. **Delete** (`DELETE /nutgraf/api/highlights/{id}`), 204.
- **The Markdown** (`packages/core/src/highlights.ts`): a line naming the newsletter, the day it came and links to it online and in Nutgraf, then each passage as a quote with my note under it, in the order I made them. The Highlights page's export puts one such section per issue under the issue's title; the Obsidian script writes the same lines into a note per issue.
- No Claude call; each highlight is an item of under a kilobyte.

## Highlighting in the reader (#167)

- **Keep a passage:** select text in the issue; **Highlight** shows over the phone's action bar, or at the foot of the Mac's reader with **H**, which works while the selection is in the newsletter's page too. The selection is read in the sandboxed frame (`allow-same-origin` lets the reader do that; nothing in the email runs). A toast confirms it, with Undo.
- **Marked in the page:** each highlight is found again from its quote (`web/src/anchor.ts`) and marked in yellow with dark text, readable whatever the email's own colours and on the dimmed page at night.
- **A highlight's sheet:** tap or click a mark for its passage, a note (kept on Done) and Remove, which Undo puts back with its note. On the Mac the sheet is a card in the middle of the window.
- **Not found:** a highlight whose passage the page no longer holds is listed under the issue ("Highlights the page no longer shows"), and opens the same sheet.
- **Open at a highlight:** `/nutgraf/issue/<id>?hl=<highlight id>` (on the Mac, the console's URL with `?hl=`) scrolls the passage to the middle of the screen instead of putting the reader back at its place.
- **Mock mode:** the first issue starts with two highlights, one with a note and one its page no longer holds.


- **A quote, not offsets.** Offsets into the HTML break when the sanitizer or the frame's styles change, and the stored HTML expires after 365 days (raw mail after 30). The passage with its context is found again in whatever renders, and the passage itself outlives the HTML.
- **Under the issue, listed by date.** Highlights are `ISSUE#<id>` / `HL#<key>` items, so the issue's detail reads them with the issue; each sits in `gsi1` under `HIGHLIGHTS` too, by when it was made, for the page and the export. A highlight's id is `<issueId>.<key>`, the key 12 characters that sort by time (the milliseconds in base 36, then 4 random ones).
- **The issue's title and newsletter are read, not copied.** The list reads each page's issues as rows (one batch read), like read history, so a newsletter renamed by `pnpm rebuild-senders` shows its new name.
- **No export endpoint.** The page has the highlights already and knows the app's address, and the Obsidian script reads the table, so both build the Markdown with the same function in `packages/core` and the API serves JSON only.
- **The page's text, as read.** Text nodes in order, with a line break where a block starts or ends (a paragraph, a table cell: email is laid out in tables), so a passage across paragraphs keeps a space between them in the export. Styles, scripts and comments are left out. A selection's quote and the search for it read the same text, whitespace collapsed.
- **Repeats.** Of the places a passage appears, the one whose 32 characters either side match best is marked. Words that repeat with the same 32 characters around them too cannot be told apart, so Highlight asks for a few more words rather than keep a quote that would mark another copy.
- **Marks.** Wrapped around the text found, never around whitespace on its own (a mark between table cells would move them). Where two highlights overlap, the shared text opens the later one. A mark inside a link stays a link.
- **Markdown escaped for Obsidian.** Newsletter text is escaped wherever Markdown or Obsidian would read formatting: `$5 to $10` is not maths, `#1` is not a tag, `==` is not a highlight. My notes are left as I write them, so `[[links]]` work.
