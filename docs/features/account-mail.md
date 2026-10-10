# Keep account mail out (#50)

Verification codes, sign-in links, email confirmations and password resets are not issues, so they stay out of the library.

## What it does

- **At ingest, a noise rule.** Mail whose subject reads like account mail is stored as a filtered marker and never listed, like receipts: "643423 is your Substack verification code", "Your sign-in link", "Sign in to Substack", "Confirm your email", "Please confirm your subscription", "Complete your sign up", "You're subscribed", "Reset your password".
- **At enrichment, Claude.** What the rule misses, Claude catches: its promo question (none, ad-supported, promo) has a fourth answer, account, which files the issue as filtered. No extra call.
- **After a rule change, `pnpm reprocess`** files as filtered any stored issue from the last 30 days that a noise rule now catches, and lists the first few.
- `/status` counts the account mail Claude filtered on the last run.

## Decisions

- **Phrases addressed to the account holder, never bare words.** The account mail that started this came from ByteByteGo's own address, which the allowlist lets in, so only the subject tells it apart. Issues write about codes and logins all the time: prod's subjects include "You're Probably Using Claude Code Wrong", "Historic UN Security Council Briefing on AI" and "The Saturday Read: Magical thinking". So the rule wants "your verification code", "is your code", "confirm your email" and the like, and a code or link phrase must end the subject or be followed by punctuation, "is" and the digits, "for", "from" or "to" ("Your security code review..." stays an issue). Checked against all 568 stored subjects on 2026-10-11: only the verification code matches.
- **No length signal.** "No view-online link and under about 100 words" fits only the verification code in prod today, but 193 of the 567 items stored on 2026-10-10 were under 120 words, so it is too loose to filter on, and Claude already covers what the subject rule misses.
- **A fourth answer, not a new question.** Account mail is decided in the same call that asks whether an issue is selling something, so it costs nothing. Claude answers "account" only when the mail plainly is one. On dev, a sign-up confirmation worded to miss the rule ("One more step") came back account; an issue about how one-time passwords work did not.
- **Filtered, not archived.** Account mail is not an issue, so it leaves every list, as what the rules filter at ingest does: out of every index, its stories deleted, its sender's count one lower, a state event saying who filed it (`claude:account` or `rule:account`). Archiving would have kept it in the archive, the sender's page and search (#53).
- **Never an issue Sandip rated or saved.** Both are signs it mattered, so a misfire cannot take one. An opened one can be filed: opening is how you find out what a mail is. Read history leaves it out afterwards.
- **Reprocess files, where it used to only report.** It still leaves an issue whose sender is no longer a source (`not-a-source`): dropping a sender from the allowlist stops new mail, it does not erase the past.
- **The decision model waits for #27.** "Is this a newsletter issue?" stays a candidate for the bake-off once Jev or OpenAI Decisions is chosen.

## Open

- The verification code that started this (prod item `1a1261e7cc130a34`, now read) is filed by `pnpm reprocess` once this is deployed.
- There is no list of filtered mail in the app. A misfire shows in `/status`'s count, the ingest log (`account mail filtered`, with the id and Claude's summary) and reprocess's output; undoing one is a manual fix for now (the state event keeps the state it had).
- Welcome mail is left to Claude: the rule does not touch "Welcome to ...", since some welcomes carry a first lesson.
