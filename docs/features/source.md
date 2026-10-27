# Check the source (#23)

A story against the page it links to: what the newsletter claimed, what the page says, a quote, and a verdict. The redesign's Source deep dive (SOURCE, "~10¢ · under a minute"), built as one page and one call.

## What it does

- **`GET` and `POST /nutgraf/api/issues/{id}/stories/{n}/source`** (`services/api/src/source.ts`), like the timeline's: the GET answers the check kept for the story; the POST runs it now and keeps it under `SOURCE#<issueId>#<nn>`, per story, since the link is the story's own.
- **Read the page safely** (`services/api/src/page.ts`). The link comes from a newsletter and the API Lambda can reach the internet, so:
  - http or https only, on ports 80 and 443, with no user name or password in the link;
  - every address the host resolves to must be public: not private, loopback, link-local (which includes the cloud metadata service), shared (CGNAT), multicast, documentation or reserved, in IPv4 or IPv6, including IPv4 written inside IPv6, 6to4 and NAT64. The check runs in the request's own DNS lookup, at connect time, so the answer cannot change after it; an address written as a number is checked before the request;
  - at most 3 redirects, each checked the same way; at most 2 MB (after decompression) and 8 seconds in all; only HTML, XHTML or plain text, so a PDF or a file says so.
- **Check.** The page becomes text with the converter newsletters use (`htmlToCleanText`). One Claude call (Haiku 4.5, `check_source`) gets the story (headline, summary, names), the newsletter's passage about it (for a digest, the paragraph that shares the most words with the story, and its neighbours), and up to 12,000 characters of the page. It answers whether the page is an article at all, then up to five of the story's claims, each with what the page says, a quote of at most 30 words and a verdict: holds, goes further (a bigger number, a stronger word, something the page only suggests) or missing; an overall verdict; and a note when it matters, such as the page reporting another site's story.
- **Quotes checked.** A quote is kept only when the page holds it word for word, case, spacing and curly quotes aside. So a quote shown is always the page's own words; a claim whose quote did not match keeps its sentence without one.
- **No check when there is nothing to check.** No link: "This story has no source link to check." A page that cannot be read says why ("The source could not be read: the address is not a public one."). A page with almost no text, or one Claude says is not the article (a paywall, a sign-in, a home page): "The source could not be read as an article". Nothing is kept then.

## The tab (#116)

- **Phone:** the story sheet's Source tab, after Timeline and Takes (`/issue/:id/story/:n/source`). Idle, what it reads and costs (`The page it links to · ~1¢ · under half a minute`) with Run; "Checking · 0:02" while it runs; ✓ once kept. Kept: the overall verdict (Holds up in green, Goes further than the source in yellow, Not in the source in red, or Mixed), the page's host as a link, the note, then each claim with its verdict, what the page says, and the quote in italics. The receipt says it is kept for this story.
- **Mac:** the story index's key grid has a C row ("Check source", as the design draws it), C runs it, and the check shows compactly under the selected story.
- Built on the shared deep-dive store and frame (`web/src/timeline.ts`, `DeepPanel`), which now take what the status line says while running and whether a result is kept for the event or the story.
- **Mock mode** checks against a stand-in page: one claim that holds, one the newsletter took further.

## Decisions

- **One page, not an agent.** #23 has Claude follow links until it reaches the primary source. This version reads the page the story links to and says when that page itself reports another source (the note). The hunt is the next step, if notes keep pointing elsewhere.
- **Haiku, about half a cent.** The design costed Source at about 10¢ for an agent; one call over one page costs far less.
- **The safety lives in the connection,** not in a check before it: a check-then-fetch can be beaten by a DNS answer that changes between the two, so the address is checked as the socket connects.
- **Kept per story,** not per event like the timeline and takes: two newsletters on one event link to different pages.

## Probe (2026-10-27, prod, eight recent stories from eight newsletters, through the API Lambda)

Only the outcome of each was printed, not the stories or pages.

- **Five checked,** in 3.2 to 6.3 seconds for 0.4 to 0.7 cents: three hold up, two go further than their source; two to five claims each, and zero to three quotes per check survived the word-for-word match.
- **Three not read:** a 403 and a 429 (sites that turn away automated readers) and a paywall, each answered with the reason.
- So about five links in eight can be checked as they are. The reader announces itself honestly ("Nutgraf source check") rather than passing as a browser; sites that refuse it stay refused.

