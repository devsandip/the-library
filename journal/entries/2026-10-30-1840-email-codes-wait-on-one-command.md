# Email codes wait on one command

2026-10-30 18:40. Previous: [2026-10-29-1950-every-item-has-an-owner.md](2026-10-29-1950-every-item-has-an-owner.md)

## What happened

A reader can now take everything with them or leave. Settings has Download my data, one file with what Nutgraf keeps for them, and Delete my account, which removes their items, their stored mail and their sign-in. A new reader gets three onboarding steps before the library: time zone, interests, and a word that getting newsletters in is coming. None of this reaches another reader until sign-up opens, and delete refuses everyone on prod until my move.

Status split in two. Operators see how the mail runs went and can check Gmail now. Everyone else sees their own ranking and last check. I am the owner, so I am an operator without joining the new group, and nothing changed on my screen.

I had been told two steps were mine before Nutgraf could send mail: DNS records for sandip.dev, and asking AWS to let it mail anyone. Both turned out to be done already. The domain was verified in SES and the account was out of the sandbox. So Cognito now sends as Nutgraf from no-reply@sandip.dev. No code has gone through it to a real inbox yet.

Email-code sign-in is built and not merged. It was tried first on a throwaway pool, which was then deleted, and that test changed the plan twice. Making MFA optional and allowing email codes in one update fails and rolls back, so it takes two deploys. And an account that set up its authenticator while MFA was required has no preferred MFA, so once MFA is optional it signs in with a password alone. My account is in that state. The plan said I would keep my password and authenticator. Without one command first, I would have lost the authenticator and nothing would have told me.

The integration tests had been failing now and then in tests the change under deploy never touched. Lists read from an index that lags a write, and tests read straight after writing. When one failed before putting its fixture back, the tests after it failed too. It took three fixes, and one of my diagnoses was wrong and had to be corrected on the issue. The last three deploys passed first time. It closes at ten in a row.

## Why

The throwaway pool cost a few minutes. The same mistake on prod would have been a failed deploy at best, and at worst a weaker sign-in on my own account that looked fine. Sign-in is the one change here I cannot try on dev, because dev has no Cognito, so it needed its own place to fail.

## Where we are now

Stopped on purpose. Nothing is running. Two drafts wait on my one MFA command, and the switch to reader keys waits on my prod move; both are in Saturday's reminder. After those, what is left before anyone can sign up is my call on highlights and how sign-up opens, then mail in, Google sign-in and the launch. Nothing built since 27 October has been used on a real device.
