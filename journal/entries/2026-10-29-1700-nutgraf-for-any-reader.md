# Nutgraf for any reader

2026-10-29 17:00. Previous: [2026-10-28-1905-weekly-tune-up.md](2026-10-28-1905-weekly-tune-up.md)

## What happened

Halfway through building highlights into my Obsidian vault, I stopped it: Nutgraf is an app anyone should be able to use, and my vault is just my setup. Highlights came out of the live app the same hour, and the vault script was parked.

Then an audit of everything built for one reader. It was not a few stray choices: the PRD itself said "a private, single-user web reader", and the code followed it, from one account and no sign-up to India's day in every date and my job title in every Claude prompt. The plan to open it up is about 38 pull requests in steps, each leaving my own app working: the reader on every request, settings per reader, an owner on every stored item, daily work per reader with limits, sign-up by an email code, and later mail in, Google sign-in and the launch. Nutgraf stays at sandip.dev for now.

Two of those steps are done. Every request now knows who is asking. Each reader has settings: a time zone (with daylight saving, which India never needed), interests that seed the ranking, the line that tells Claude who they are, and what Learning means to them. Settings has a page for the time zone and interests. With no settings of my own stored, everything still runs on my old values.

## Why

A reader built around one person cannot just add a sign-up button. Doing the settings first turns my choices into defaults before the data model changes, so the riskiest step, giving every stored item an owner, only has to move data, not taste.

## Where we are now

Milestones 11 and 12 are closed and on prod. Next is milestone 13, every item has an owner, which ends with a data move I run myself. No one else can sign in yet.
