---
status: proposal
created: 2026-10-28
---

# Analytics for Nutgraf: a proposal

Nothing here is built or decided. This is a map of the analytics a consumer app runs, what Nutgraf would measure in each area, and three ways to set it up, from nearly free to big-company scale. It is written for someone who has run internal tools and is new to consumer analytics, so every idea is explained before it is used. The glossary at the end has every term.

The presentation version, with diagrams, is [analytics.html](analytics.html). Prices were checked on vendor pages on 2026-10-28 (sources at the end); they change often.

## In one minute

- **Recommendation:** start the **Notebook** tier now. It costs about $0 to $5 a month, is about six small pull requests, and covers all seven areas at a basic level. Move to **Newsroom** on the day you decide to let other people use Nutgraf. **Wire Service** is what a large consumer app runs; it is here so you can see the whole map, not because Nutgraf needs it.
- **Where Nutgraf stands:** it has one user. "Who is viewing" is always you. So three kinds of analytics pay off now: is the product working for you (the PRD's success measure), is anything broken or slow on your phone, and what does the AI cost and how good is it. Product and marketing analytics start paying when a second person signs up. The cheapest time to lay their foundation is before that.
- **Three rules for every tier:** no newsletter content in any analytics event (IDs and counts only); prompts and model answers never leave AWS; session recordings hide all text and never record the newsletter. These keep the PRD's privacy promise and Google's rules for Gmail data.
- **What your list was missing:** the data foundation (a tracking plan and identity), privacy and consent, ranking quality, cost per reader, trust and safety, money if Nutgraf ever charges, and the weekly habit of looking. See section 6.
- **Decisions for you:** section 9.

## Contents

1. Analytics in plain words
2. What Nutgraf already measures
3. Ground rules
4. The metric that matters most
5. The seven areas: ideas, metrics and tools
6. What your list was missing
7. The three tiers
8. Notebook as pull requests
9. Decisions for you
10. Glossary
11. Sources

## 1. Analytics in plain words

### Why consumer analytics feels different

With internal tools, the users are colleagues who have to use the tool, and you can walk over and ask them. Success is usually "the task got done faster, with fewer errors". With a consumer app, people choose every day whether to come back, nobody owes you a reason, and you will never meet most of them. Analytics is how you hear them.

| Internal tools | Consumer app |
|---|---|
| Did they finish the task? How long did it take? | Did they come back tomorrow? Next week? |
| Adoption is mandated | Adoption is earned every day |
| Feedback: ask the team | Feedback: behaviour data, surveys, recordings |
| Growth: headcount | Growth: channels, word of mouth, habit |
| Cost per user rarely matters | Cost per user (and AI cost per user) decides whether the product can exist |

### How a tap becomes a chart

Every analytics system, from a free tool to Netflix's, has the same five steps:

1. **Capture.** Code in the app (an SDK, a small library from the vendor) notices something happened: you opened an issue.
2. **Collect.** It sends a small message, an *event*, over the network to a collector.
3. **Store.** The collector writes it to a database built for billions of small rows.
4. **Model.** Raw events are cleaned and joined: which events belong to the same person, the same visit.
5. **Analyse and act.** Charts, funnels and retention curves; alerts; experiments; messages triggered by behaviour.

An event is a small record. For Nutgraf, opening an issue from Today's deck would look like this:

```json
{
  "event": "issue_opened",
  "distinct_id": "u_7f3a91c2",
  "timestamp": "2026-10-28T07:42:10+05:30",
  "properties": {
    "issue_id": "18f2c4d0a1b2",
    "source_screen": "today_deck",
    "rank": 2,
    "is_top5": true,
    "is_must_read": true,
    "topic": "AI & LLMs",
    "device": "phone",
    "app_version": "d741395"
  }
}
```

- **Event:** something that happened, named as a past-tense verb.
- **Properties:** details about it.
- **User** (`distinct_id`): who did it, as an opaque ID, never an email address.
- **Session:** one visit, usually ended by 30 minutes without activity.
- **Identify:** joining an anonymous visitor to a known account after sign-in, so your phone and your Mac count as one person.

Note what is *not* in the event: the newsletter's name, the subject, any text. Section 3 makes that a rule.

### Two places to capture: the app and the server

- **Client-side** (in the browser): sees what happens on screen, such as taps, scrolls, how long a page stayed open. But ad blockers and browser privacy settings block a share of it, and anything in a browser can be faked.
- **Server-side** (in the Lambdas): sees everything that reaches the API, such as a rating saved, an ingest run, a Claude call. It cannot be blocked and is the truth for anything that changes data. It cannot see taps that never reach the server.

Good setups use both: server-side for facts (ratings, saves, AI calls, ingest runs), client-side for behaviour (screens, scrolling, swipes). Nutgraf already does some of both (section 2).

### Autocapture or a tracking plan

- **Autocapture** records every tap and page view without any code. Good for exploring ("what do people click at all?"). Noisy, and its charts break when a button's text or layout changes.
- **A tracking plan** is a short list of events you name on purpose (`issue_rated`, `search_performed`), each with fixed properties. These are the events you trust in a decision.

Use both: autocapture on, plus about 25 planned events (section 5.1). The plan lives in the repo as typed code, so a misspelt event is a compile error rather than a quietly broken chart.

### Where the data ends up

Small teams look at the data inside the analytics tool. Bigger teams also copy every event into a **data warehouse**, one large SQL database (BigQuery, Snowflake, Redshift, or files in S3 queried with Athena), and treat that copy as the source of truth, because only there can usage be joined with money, support tickets and AI cost. Newsroom starts doing this. Wire Service is built around it.

## 2. What Nutgraf already measures

More than you might think. These arrived as features, but they are analytics:

| Already built | What it is in analytics terms | Area |
|---|---|---|
| The event log in DynamoDB (`EVT#`: rating, state, open, peek, saved), append-only | Server-side event tracking | Product |
| Read history (the `OPENS` index) | A daily activity log | Product |
| Now reading's place (0 to 1, the share of the newsletter scrolled past) | Read depth and completion | Product |
| The day's digest and `digestStats`: the share of each day's top 5 found useful over 14 days, aiming for 3 in 5 | The PRD's success measure, a North Star candidate | Product, AI |
| Subscription audit: opened, useful and repeats per newsletter | Content analytics | Product |
| The ingest alarms, the `IngestSucceeded` metric, Library > Status | Backend monitoring and data freshness | Technical |
| `ms`, `cents`, `model` and tokens kept with timelines, takes and source checks; Ask's receipt | AI cost and speed per call | AI |
| `pnpm jev:score` against labelled stories | An offline AI evaluation | AI |
| Your verdicts on predictions (`setBy: sandip`) and your moves of Jev's shelves | Human corrections: where the AI was wrong | AI |

**What is missing today:**

- Nothing tells you when the app throws an error on your iPhone. A JavaScript crash is silent.
- Nothing measures speed as you feel it: how long Today takes to appear, how smooth a swipe is.
- The events power features, but nothing charts them.
- AI cost is stored for some features only and never added up by feature or by day. The AWS Budget alert ([issue 6](https://github.com/devsandip/the-library/issues/6)) is not set.
- No feature flags, no experiments, no messages, no public page.
- Logs are kept 14 days, so you cannot look back further than two weeks.

## 3. Ground rules (every tier)

1. **No newsletter content in analytics events.** Events carry opaque IDs, counts, positions and categories (a topic name, a screen name). Never a subject, headline, summary, sender name, search text or Ask question. This keeps the PRD's promise that email content never leaves your AWS account except to Bedrock.
2. **Prompts and answers stay in AWS.** Every Claude prompt contains newsletter text. Full traces go to Bedrock's own logs in your account, or to a tracing tool you host in your account. Only metadata (feature, model, tokens, cost, time, outcome) may go to an outside tool.
3. **Recordings hide everything.** Session replay masks all text and inputs and never records the newsletter frame.
4. **First-party collection.** The vendor's SDK is installed from npm and bundled into the app, so there is no third-party script tag and the CSP keeps `script-src 'self'`. Events go to `sandip.dev/nutgraf/ingest/...`, which CloudFront forwards to the vendor, so `connect-src 'self'` stays too. Ad blockers drop far fewer events this way (PostHog says 10 to 30% more data arrives). The refresh token sits in `localStorage`, which any script on the page can read, so the SDK version is pinned and every upgrade is a reviewed pull request (the shared-origin invariant, architecture section 4).
5. **One tracking plan, in code.** Event names are `object_action`, past tense, snake case (`issue_opened`, `story_followed`). Each has typed properties in `packages/core`. A new event joins the plan in the same pull request that sends it.
6. **Dev is not prod.** Dev and integration-test traffic goes to a separate project, so it never mixes into real numbers.
7. **Ask before tracking others.** For you alone, no consent banner is needed. When others join: a privacy policy naming every analytics tool, consent for anything non-essential, and deletion of a person's analytics data when they delete their account (section 6).

Rule 1 matters twice. Gmail's `gmail.readonly` is a *restricted* scope under Google's API user data policy: data read through it may be used only to provide the app's user-facing features, may not be handed to third parties for anything else, and an app that opens to the public needs Google's verification and, because Nutgraf stores mail on its own servers, an independent security assessment that is renewed every year. Unverified apps are capped at 100 users. Keeping mail-derived data out of analytics tools keeps that review simple.

## 4. The metric that matters most

Consumer teams pick one **North Star metric**: the number that best captures the value users get, and that rises when the product is healthy. Under it sits a **metric tree**: input metrics a team can move directly, each of which pushes the North Star.

**Proposed North Star: useful reads per reader per week.** A useful read is an issue or story you opened and then either gave a thumbs up or read to the end. It grows only if you keep coming back (habit), the ranking puts good things first (quality), and the newsletters are worth reading (supply).

```
Useful reads per reader per week
├── Active days per week                 habit: do you come back?
├── Reads per active day                 depth: do you open things?
│   ├── Today: cards seen per visit
│   └── Saved items read within 7 days
├── Useful share of reads                quality: is it worth it?
│   ├── Top-5 useful rate (PRD measure, aim 60%)
│   └── Thumbs-down share
└── Newsletter supply                    inputs
    ├── Issues ingested per day
    └── Newsletters worth keeping (audit)
```

**Guardrails** are metrics that must not get worse while the North Star rises: AI cost per reader per month, the share of visits with no error, and how long Today takes to appear on a slow day (p95).

## 5. The seven areas: ideas, metrics and tools

Each part has the question the area answers, the ideas you need, the metrics for Nutgraf with the tier where each one starts, and the tools in each tier. The tiers are **Notebook** (nearly free, now), **Newsroom** (when Nutgraf opens up) and **Wire Service** (big consumer scale). Section 7 has the full stacks side by side.

### 5.1 Product and behavioural analytics

**The question:** who uses it, how often, which features, where people drop off, and whether they come back.

**Ideas to know:**

- **DAU, WAU, MAU:** distinct people active in a day, a week, 30 days. **Stickiness** is DAU ÷ MAU: 50% means the average user shows up on half the days of the month. Many consumer apps sit somewhere around 10 to 25%; a product meant to be a daily habit aims well above that.
- **Activation:** the moment a new user first gets the value, often called the "aha moment". For Nutgraf: mail connected, the first issues in, three opened and one rated, all within 7 days.
- **Funnel:** the share of people who get through each step of a sequence, in order. It shows exactly where people fall out.
- **Retention and cohorts:** of the people who started in a given week (a *cohort*), how many came back in week 2, 3, 4. A curve that flattens means you have found people who stay. A curve that slides to zero means you have not, whatever the sign-up numbers say.
- **Feature adoption:** the share of active users who used a feature at least once in the period.
- **Paths:** the order of screens people actually take.

**Metrics:**

| Metric | Definition | Why it matters | Starts in |
|---|---|---|---|
| Useful reads per week | The North Star (section 4) | Value delivered | Notebook |
| Active days per week | Days with at least one open, per reader | Habit; the PRD's "I open it most days" | Notebook |
| Top-5 useful rate | Share of each day's five given a thumbs up (built) | Ranking quality; the PRD's success measure | Notebook |
| Read depth and completion | Median place reached when an issue is closed; share that reach the end | Did the open turn into a read? | Notebook |
| Peek-to-open rate | Peeks followed by a full open | Are peeks enough, or a step in the way? | Notebook |
| Rating rate | Share of opened issues that get a thumb | Ranking learns from thumbs; too few and it starves | Notebook |
| Deck depth | Cards seen per Today visit; how often the brief card is read | Is the deck really the front door? | Notebook |
| Save-to-read | Saved items read within 7 days | Is Save a promise kept or a graveyard? | Notebook |
| Feature adoption | Weekly use of Search, Ask, Following, Predictions, Timeline, Takes, Source, Audit | What earns its place, what to cut | Notebook |
| Search success | Zero-result rate; searches followed by an open; "Ask Nutgraf instead" taps | Search quality | Notebook |
| Restored auto-archives | Issues moved back after a rule archived them | A rule is wrong | Notebook |
| Device split | Phone or Mac; home-screen app or browser tab | Where to design first | Notebook |
| DAU, WAU, MAU, stickiness | As above | Health, once there are several readers | Newsroom |
| Activation rate, time to value | Share of new readers activated in 7 days; time from sign-up to the first issue | Onboarding quality | Newsroom |
| D1, D7, D30 retention; cohort curves | Share of a cohort active again on day 1, 7, 30 | The best single sign of product-market fit | Newsroom |
| Onboarding funnel | Sign-up → mail connected → first issue → first read → first rating → back on day 7 | Where onboarding leaks | Newsroom |
| Resurrection rate | Readers dormant for a month who come back | Is re-engagement working? | Newsroom |
| Churn prediction | The chance a reader leaves next month, from behaviour | Act before they go | Wire Service |

**The tracking plan, first draft.** Events and properties only; no content.

| Event | Fires when | Key properties |
|---|---|---|
| `app_opened` | The app comes to the foreground | `device`, `standalone` (home-screen app), `app_version` |
| `screen_viewed` | A screen shows | `screen` (today, browse, saved, library, reader, ...) |
| `deck_card_viewed` | A Today card shows | `position`, `is_top5`, `card_type` (brief or issue) |
| `deck_swiped` | A swipe moves the deck | `direction`, `position` |
| `issue_peeked` | A peek stays open 2 seconds (already logged on the server) | `issue_id`, `source_screen`, `rank` |
| `issue_opened` | The reader opens (already logged on the server) | `issue_id`, `source_screen`, `rank`, `is_top5`, `is_must_read`, `topic`, `shelf` |
| `issue_read_progress` | The place passes 25, 50, 75 and 100% | `issue_id`, `percent` |
| `issue_closed` | The reader leaves an issue | `issue_id`, `place`, `seconds_visible` |
| `issue_rated` | Thumb up, down or cleared (server) | `issue_id`, `value`, `source_screen`, `reason` (section 5.3) |
| `issue_saved`, `issue_archived` | Save or archive | `issue_id`, `source_screen`, `by` (you or a rule) |
| `story_opened` | A story sheet opens | `issue_id`, `story_n`, `shelf` |
| `story_moved` | You move a story to News or Learning | `from`, `to`, `jev_probability` |
| `deep_dive_requested` | Timeline, Takes or Source is run | `kind`, `kept_already` |
| `story_followed`, `story_unfollowed` | Follow or unfollow | `event_id` |
| `search_performed` | A search returns | `query_length`, `result_count`, `by_meaning`, `sort` |
| `search_result_opened` | A hit is opened | `rank`, `match` |
| `ask_answered` | Ask Nutgraf answers | `paragraphs`, `none_reason`, `ms`, `cents` |
| `prediction_verdict_set` | You overrule or hand back | `verdict`, `previous_verdict` |
| `sender_changed` | Mute, star, always-shelf | `change` |
| `filter_changed` | The Browse sentence or a Mac queue filter | `filter`, `value_count` |
| `refresh_pulled` | Pull to refresh | `screen` |
| `shortcut_used` | A Mac key | `key` |
| `ingest_run_completed` | Server, every run | `issues_new`, `filtered`, `errors`, `seconds` |
| `llm_call_completed` | Server, every Claude or Titan call | `feature`, `model`, `tokens_in`, `tokens_out`, `cents`, `ms`, `outcome` |

**Tools:**

- **Notebook:** PostHog Cloud on its free allowance (1 million events a month) for charts, funnels, retention and paths, fed by the app's SDK and by server-side events from the Lambdas. The DynamoDB event log stays as it is, for the app's own features.
- **Newsroom:** PostHog on paid usage (5 cents per 1,000 events above the free million), or Amplitude (2 million events free) or Mixpanel (1 million free) if you prefer their interface. Every event is also exported to S3 as the warehouse, modelled with dbt and charted in Metabase over Athena.
- **Wire Service:** a customer data platform (Segment, RudderStack or mParticle) feeding a warehouse (Snowflake, Databricks, BigQuery or Redshift); Amplitude or Mixpanel reading from the warehouse; Avo or Segment Protocols to enforce the tracking plan; Monte Carlo to catch broken data; Looker or Hex for analysts.

### 5.2 Marketing, attribution and growth

**The question:** where new users come from, which channels bring people who stay, what a user costs to win, and whether word of mouth is working.

**Ideas to know:**

- **UTM parameters:** tags on a link that say where a visit came from, for example `?utm_source=linkedin&utm_medium=social&utm_campaign=launch`. Every link you share gets them.
- **Referrer:** the site the browser came from. Free, but often stripped.
- **Attribution:** giving a channel credit for a sign-up. *First touch* credits the first visit, *last touch* the last one, *multi-touch* splits the credit. None of them is the truth; they are different lenses.
- **Conversion rate:** the share of visitors who sign up, and of sign-ups who activate.
- **CAC** (customer acquisition cost): what it costs to win one customer, such as ad spend ÷ new customers. **LTV** (lifetime value): what a customer is worth over their whole time with you. A common rule of thumb wants LTV at least 3 × CAC.
- **K-factor:** invites per user × the share of invites that become users. Above 1, each user brings in more than one more. Rare.
- **Incrementality:** would they have come anyway? Tested with holdouts: show the campaign to some regions or people and not others, and compare.
- **The privacy shift:** Safari and Firefox block third-party cookies, and iPhone apps must ask before tracking people across other companies' apps (Apple's App Tracking Transparency). Attribution of individuals is less exact everywhere, which is why big apps now lean on mobile measurement partners and statistical models of their whole marketing mix.

Nutgraf has none of this today: it is private and hidden from search engines. It all starts with a public page (the `about.html` that Google requires is a seed) and a waitlist or invitations.

**Metrics:**

| Metric | Definition | Starts in |
|---|---|---|
| Visitors by source, medium, campaign | Visits to the public page by UTM and referrer | Newsroom (Notebook once a public page exists) |
| Visitor → sign-up, sign-up → activated | Conversion at each step, by channel | Newsroom |
| Activated readers by channel | Quality of each channel, not just volume | Newsroom |
| Waitlist → invited → activated | If you open by invitation | Newsroom |
| Referral share and k-factor | Sign-ups from invites; invites × acceptance | Newsroom |
| Organic search clicks, searches for "Nutgraf" | From Google Search Console | Newsroom |
| CAC by channel, blended CAC, payback months | Only once you pay for growth | Wire Service |
| LTV and LTV ÷ CAC | Only once Nutgraf earns money | Wire Service |
| Incremental lift per channel | From holdout or geo tests, or a marketing mix model | Wire Service |

**Tools:**

- **Notebook:** UTM-tagged links, PostHog web analytics on the public page, Google Search Console (free). No Google Analytics: PostHog covers it, and Google Analytics adds a Google script and a cookie banner.
- **Newsroom:** PostHog web analytics, with first- and last-touch channel kept on each person; Dub for tracked short links; Google Search Console; Google Analytics 4 only if you run Google Ads (to send conversions back to them); the ad platforms' server-side conversion APIs only if you buy ads; invitations and referral codes built into sign-up.
- **Wire Service:** a mobile measurement partner (AppsFlyer, Adjust or Branch) once there are native apps; marketing mix modelling with Google's Meridian or Meta's Robyn (both open source); holdout and geo tests for incrementality; attribution modelled in the warehouse; a growth team.

### 5.3 Qualitative and experience analytics

**The question:** *why* people do what the numbers show, and what frustrates them.

**Ideas to know:**

- **Session replay:** a reconstruction of a visit (not a video): taps, scrolls, screens. It shows where someone hesitated or got stuck.
- **Heatmaps:** where people tap and how far they scroll, summed over many visits.
- **Rage taps and dead taps:** repeated taps on one spot, or taps on things that do nothing. Automatic frustration signals.
- **In-app surveys:** one or two questions at the right moment.
  - **Product-market fit survey** (the Sean Ellis test): "How would you feel if you could no longer use Nutgraf?" When 40% or more answer "very disappointed", the product has found its fit.
  - **NPS:** "How likely are you to recommend Nutgraf to a friend?" from 0 to 10. The share of promoters (9 and 10) minus the share of detractors (0 to 6) gives a score from −100 to 100.
  - **CSAT:** "Was this helpful?" asked about one feature.
- **Interviews and usability tests:** watching five people try a task finds most of the big problems.
- **Voice of the customer:** support messages, feedback boards and reviews, tagged by theme and counted.

**Metrics:**

| Metric | Definition | Starts in |
|---|---|---|
| Thumbs-down reasons | An optional chip after a thumbs down: not my topic, knew it already, too long, a promo, poorly written | Notebook (new; also teaches the ranking) |
| Helpful? on AI answers | A thumb on Ask answers, timelines, takes and source checks | Notebook |
| Rage and dead taps per 100 visits | Frustration hot spots | Notebook |
| Replays watched per week | The habit of looking | Notebook |
| Product-market fit score | Share answering "very disappointed" | Newsroom (needs 40 or more answers to mean much) |
| NPS, CSAT by feature | As above | Newsroom |
| Survey response rate | Answers ÷ times shown | Newsroom |
| Feedback themes per month | Tagged themes from support and the feedback board | Newsroom |
| Support contacts per 100 active readers; first response time | Load and responsiveness | Newsroom |

**Tools:**

- **Notebook:** PostHog session replay (5,000 recordings a month free; text masked, newsletter frame blocked) and surveys (1,500 answers a month free). Thumbs-down reasons and thumbs on AI answers built into the app and kept in DynamoDB. For you alone, the best qualitative tool is a note to yourself: a "this felt wrong" button that saves the screen and a sentence.
- **Newsroom:** PostHog replay, heatmaps and surveys at scale; a feedback board (Canny or Featurebase); a support inbox (Plain, Crisp or Intercom) with tags; interviews booked with Calendly and kept in Notion or Dovetail; usability tests with Maze or Lyssna. Microsoft Clarity (free) on the public page only, never inside the app.
- **Wire Service:** experience platforms (FullStory, Contentsquare, which now owns Hotjar, or Quantum Metric); voice-of-customer programmes (Qualtrics, Medallia); Sprig for targeted research in the product; UserTesting panels; Dovetail as the research library; AI that mines tickets and app-store reviews for themes; a UX research team.

### 5.4 Technical, performance and crash analytics

**The question:** is it up, is it fast, and is it broken for someone right now.

**Ideas to know:**

- **Logs, metrics, traces:** logs are lines saying what happened; metrics are numbers over time (requests a minute); traces follow one request through every part it touches. Together they are called *observability*.
- **Real user monitoring (RUM):** speed and errors measured on real devices, not in a lab.
- **Core Web Vitals:** Google's three measures of how a page feels, judged on the 75th percentile of visits. **LCP** (the main content appears) is good at 2.5 seconds or less. **INP** (the page responds to a tap) is good at 200 milliseconds or less. **CLS** (the layout jumps around) is good at 0.1 or less.
- **Percentiles:** p50 is the typical visit, p95 the slow visit one in twenty sees, p99 the worst 1%. Averages hide pain.
- **Error-free (crash-free) sessions:** the share of visits with no error. Mobile teams usually hold this well above 99%.
- **Source maps:** turn the minified code in an error report back into your real file and line.
- **SLO and error budget:** a target you set yourself, such as 99.5% of API calls succeed over 30 days. The 0.5% that is allowed to fail is the budget you may spend on risky changes; when it runs out, you slow down.
- **Synthetic monitoring:** a robot that loads the site every few minutes, so you hear about an outage before a user does.
- **Cold start:** the extra time a Lambda takes when it has not run for a while.

**Metrics:**

| Metric | Definition | Starts in |
|---|---|---|
| Errors and error-free sessions | Uncaught errors and failed promises in the app, by screen and release | Notebook |
| Web vitals by screen | LCP, INP and CLS at p75 for Today, Browse and the reader | Notebook |
| Time to first list | From opening the app to the first rows shown | Notebook |
| Sign-in failures | Token refresh failures and sign-in loops | Notebook |
| API errors and latency by route | 4xx and 5xx counts; p50, p95, p99 | Notebook |
| Lambda cold starts, timeouts, throttles | By function; timeouts against the API's 28 seconds | Notebook |
| Ingest freshness | Minutes since the last clean run (alarmed today); issues waiting to be enriched or split | Notebook |
| Jobs outcomes | Source checks and settling: done, none, failed, stopped | Notebook |
| Uptime | A robot loads the app shell every 5 minutes | Notebook |
| DynamoDB throttles, S3 growth | Capacity and storage | Notebook |
| SLOs and error-budget burn | For example 99.5% API success over 30 days; Today p95 under 2.5 s; ingest never more than 3 hours stale between 06:00 and 22:00 IST | Newsroom |
| Release health | Errors per release; regressions after a deploy | Newsroom |
| Deploy frequency, change failure rate, time to restore | The four DORA measures, from GitHub Actions | Newsroom |
| Crash-free users, app-not-responding rate | Only with native apps | Wire Service |

**Tools:**

- **Notebook:** PostHog error tracking (100,000 errors a month free) and web vitals for the app; Powertools for AWS Lambda (TypeScript), a free library, for structured logs, metrics and traces in the Lambdas; a CloudWatch dashboard beside the alarms you have; a free uptime checker (UptimeRobot or Better Stack) on the app shell; log retention raised from 14 to 90 days.
- **Newsroom:** Sentry (Team plan, $26 a month on yearly billing, 50,000 errors) for errors with source maps, tracing from a tap to the Lambda, release health and replay of the moments before an error; CloudWatch Application Signals for the backend; Better Stack for uptime, a status page and on-call alerts.
- **Wire Service:** one observability platform (Datadog, or Grafana Cloud, New Relic, Honeycomb or Dynatrace) built on OpenTelemetry; Crashlytics, Embrace or Sentry for native apps; PagerDuty or incident.io; SLOs owned by a site reliability team.

### 5.5 Experimentation and feature flags

**The question:** did this change make things better, and can I release safely.

**Ideas to know:**

- **Feature flag:** a switch read while the app runs, so code can ship turned off and then be turned on for you, for 10% of users or for everyone, without a deploy. It doubles as a *kill switch* when something breaks.
- **A/B test:** half of users get A (the *control*), half get B (the *variant*). You compare a *primary metric* chosen in advance, while *guardrail metrics* must not get worse.
- **Sample size:** to notice a 10% relative improvement on a 20% conversion rate (20% becoming 22%) with the usual 95% confidence and 80% power, you need about 6,500 users in each group. Small products can rarely A/B test small changes.

  | To detect a lift on a 20% rate of | Users needed per group |
  |---|---|
  | 5% (to 21%) | about 25,600 |
  | 10% (to 22%) | about 6,500 |
  | 20% (to 24%) | about 1,700 |
  | 50% (to 30%) | about 300 |

- **Statistical significance:** how unlikely the difference would be if B were really no better than A. **Peeking** at a test every day and stopping when it looks good produces false wins; *sequential testing* corrects for it.
- **Sample ratio mismatch:** if a 50/50 split comes out 53/47, the experiment is broken; do not trust its result.
- **Novelty effect:** a new thing gets clicks because it is new. Let tests run long enough to wear off.
- **Holdout:** a group kept on the old experience for months, to measure the long-run effect of many changes together.
- **Interleaving:** for rankings. Mix the results of ranker A and ranker B into one list and see whose items get chosen. It needs far fewer people than an A/B test (Netflix reported about 100 times fewer), and it works with a single person, because every list is its own small contest.

**What this means for Nutgraf now:** you cannot A/B test with one user. Two things do work. Flags let you ship dark and turn a feature on for yourself, which you already do by hand. And interleaving can settle the open ranking questions, the LLM reranker ([issue 69](https://github.com/devsandip/the-library/issues/69)) and the model bake-off ([issue 27](https://github.com/devsandip/the-library/issues/27)), from your own opens and thumbs within a few weeks.

**Metrics:**

| Metric | Definition | Starts in |
|---|---|---|
| Interleaving preference | The share of your opens and thumbs up that land on ranker B's items, with a simple binomial test | Notebook |
| Flag exposure | Which flag value each person saw, attached to their events | Notebook |
| Experiment result | The primary metric's lift with a confidence interval, plus guardrails (errors, latency, AI cost per reader, unsubscribes) | Newsroom |
| Sample ratio check | The observed split against the planned one | Newsroom |
| Stale flags | Flags fully on or off for 90 days and still in the code | Newsroom |
| Experiment velocity, win rate, share of launches tested | How fast the team learns | Wire Service |

**Tools:**

- **Notebook:** PostHog feature flags (1 million requests a month free), or one config item in DynamoDB; interleaving written into the Summary endpoint, which logs which ranker contributed each item.
- **Newsroom:** PostHog experiments, or GrowthBook (open source; free to host yourself, $40 a seat a month on its cloud; reads the warehouse and has variance reduction and sequential tests built in). AWS's own experiment tool, CloudWatch Evidently, was shut down in October 2025; AWS AppConfig remains for flags only.
- **Wire Service:** Statsig (OpenAI announced its purchase in September 2025; still sold), Eppo (now part of Datadog), Optimizely or LaunchDarkly, or a platform built in-house; a long-running global holdout; variance reduction (CUPED); bandits for content; a review practice for experiment designs.

### 5.6 Engagement and lifecycle messaging

**The question:** which messages bring people back, and which annoy them into leaving.

**Ideas to know:**

- **Lifecycle stages:** new → activated → engaged → at risk → dormant → resurrected, or gone. Each stage gets different messages.
- **Triggered or scheduled:** a message caused by behaviour ("a story you follow moved") or sent at a fixed time ("your week in Nutgraf").
- **Channels:** email; web push (on an iPhone only for a home-screen app, iOS 16.4 and later); messages inside the app.
- **Open rates are unreliable.** Apple Mail loads every email's images on its own (Mail Privacy Protection), so opens look higher than they are. Count clicks and the visits that follow.
- **Holdout:** the honest measure. Keep, say, 10% of eligible people from getting a message. The difference in return visits between the two groups is what the message actually caused.
- **Deliverability:** SPF, DKIM and DMARC records prove the mail really comes from you. Google requires bulk senders to keep spam complaints below 0.3% and recommends below 0.1%, and to offer one-click unsubscribe.
- **Fatigue:** every message spends attention. Nutgraf exists because newsletters overwhelm you, so its own messages should be few and worth it.

**Metrics:**

| Metric | Definition | Starts in |
|---|---|---|
| Message → visit | Visits within 24 hours of a message, counted through a `ref` tag on every link | Notebook |
| Push opt-in rate | Granted ÷ asked | Notebook (if you add a morning push) |
| Click rate, click-to-open | Clicks ÷ delivered; clicks ÷ opens | Newsroom |
| Delivery, bounce, complaint and unsubscribe rates | Per kind of message | Newsroom |
| Incremental lift | Return rate of those messaged against the holdout | Newsroom |
| Push disable rate | Permission withdrawn after a message | Newsroom |
| Messages per reader per week | Fatigue | Newsroom |
| Reactivation rate | Dormant readers who come back after a message | Newsroom |

**Tools:**

- **Notebook:** Amazon SES (10 cents per 1,000 emails, already in AWS) for a weekly "your week in Nutgraf" email to yourself; web push from a Lambda through the browser's standard Push API (free) for "the day in brief is ready" or "a followed story moved"; a `ref` tag on every link.
- **Newsroom:** Customer.io (from $100 a month for 5,000 people; journeys triggered by events) or Loops (free to 1,000 contacts, then from $49 a month; simpler); OneSignal for web and mobile push (generous free tier); Knock if you want in-app and email from one place. Events flow to the messaging tool from PostHog or the warehouse.
- **Wire Service:** Braze, Iterable or Airship; send-time optimisation; frequency caps across channels; a global message holdout; a deliverability specialist watching inbox placement.

### 5.7 AI and LLM analytics

**The question:** what each AI feature costs, how fast it is, how often it fails, and whether its answers are right.

This is where Nutgraf has the most to gain today. Claude does about ten jobs: summaries and topics, the story split, Jev's shelves, the day in brief, spotting predictions, settling them, following stories, timelines, takes, the source check with its hunt, and Ask. Titan embeds every issue, story and search.

**Ideas to know:**

- **Tokens:** the units models are billed in, separately for input (what you send) and output (what comes back). Cost is tokens × price.
- **Trace and span:** a trace is one job from start to finish (an Ask: plan, three searches, answer); each step in it is a span. Traces show where the time and money go.
- **Latency:** time to the first token, and total time.
- **Evaluations (evals):** testing a prompt or model against examples with known good answers. *Offline* evals run before a change ships, like unit tests. *Online* evals score a sample of real traffic.
- **LLM-as-judge:** a second model grades the answers ("is every sentence supported by its sources?"). Cheap and fast; check it against your own judgement now and then.
- **Golden set:** a few dozen real examples with the right answers, kept in the repo. `jev:score`'s labelled stories are one already.
- **Groundedness (faithfulness):** whether an answer is supported by the sources it cites. Its opposite is hallucination.
- **Human override rate:** how often a person corrects the AI. Your prediction verdicts and shelf moves are exactly this.
- **Prompt injection:** text inside an input (a newsletter, or a web page the source check reads) that tries to give the model orders. Nutgraf reads untrusted text all day, so it should count suspected attempts.
- **Guardrails:** filters on what goes into and comes out of a model. Bedrock Guardrails is AWS's.

**Metrics:**

| Metric | Definition | Starts in |
|---|---|---|
| Cost by feature, per day and month | The sum of every call's cost, grouped by feature and model | Notebook |
| Cost per issue ingested | Summaries + story split + shelves + predictions, ÷ issues | Notebook |
| Cost against budget | Month to date against the $8 AWS Budget | Notebook |
| Calls, tokens in and out | Per feature | Notebook |
| Latency p50 and p95 by feature | Ask takes 3 to 17 s today; watch the API's 28 s ceiling | Notebook |
| Failures | Bedrock errors, throttles, retries, forced tool calls that did not validate, items given up after three tries | Notebook |
| Built-in check failures | Quotes not found word for word (source checks, predictions); unknown story ids (timelines, takes, Ask, the brief); answers of `none` | Notebook |
| Human override rate | Predictions you overrule ÷ settled; your shelf moves ÷ Jev's calls; summaries thumbed down | Notebook |
| Helpful rate | Thumbs up on Ask answers and deep dives | Notebook |
| Offline eval scores | `jev:score` accuracy; a golden set per feature, rerun on every prompt or model change | Notebook |
| Reuse rate | Timelines and takes opened free (kept for their event) ÷ written | Notebook |
| Ranking quality | Top-5 useful rate; precision at 5; how many newsletters the five come from | Notebook |
| Groundedness score | LLM-as-judge on a weekly sample of answers | Newsroom |
| Suspected injections, guardrail blocks | By source | Newsroom |
| AI cost per active reader per month | The number that decides whether Nutgraf can be free | Newsroom |
| Spend caps reached | Readers who hit the daily limit on Ask or deep dives | Newsroom |
| Drift | Week-on-week change in eval scores, refusals and answer length | Wire Service |

**Tools:**

- **Notebook:**
  - One shared wrapper around every Bedrock call that records feature, model, tokens, cents, milliseconds and outcome, as a CloudWatch metric (through Powertools) and as a server-side event without any text.
  - Bedrock's own CloudWatch metrics (invocations, latency, input and output tokens, time to first token, errors, throttles), published by model.
  - Bedrock model invocation logging to an S3 bucket in your account with a 30-day lifecycle, so full prompts stay in AWS and you pay only for the storage.
  - Bedrock application inference profiles, one per feature with a cost tag, so the AWS bill itself splits by feature.
  - AWS Budgets and Cost Anomaly Detection (both free).
  - Promptfoo (open source) to run the golden sets in CI.
- **Newsroom:** Langfuse self-hosted in your AWS account (it is open source under the MIT licence; ClickHouse bought the company in January 2026 and kept it so) for traces, prompt versions, scores and datasets, so prompts still never leave AWS; a weekly LLM-as-judge sample; Bedrock Guardrails on the pages the source check fetches; per-reader rate limits and spend caps; AI cost per reader on the warehouse dashboard.
- **Wire Service:** an LLM observability platform (Datadog LLM Observability, Arize, Braintrust or LangSmith); an AI gateway (LiteLLM or Portkey) for routing between models, caching, per-customer budgets and fallbacks; continuous online evals and red-teaming; human labelling queues; an AI quality team.

## 6. What your list was missing

Your seven cover the classic map well. Seven more things decide whether the analytics are trustworthy, legal and affordable:

1. **The data foundation.** A tracking plan (section 5.1), a naming convention, identity (one person across phone and Mac, anonymous before sign-in and known after), versioned events, tests that catch a broken event, and from Newsroom on, a warehouse as the single source of truth. Every other area stands on this.
2. **Privacy, consent and compliance.** India's Digital Personal Data Protection Act is the one that applies first: its Rules were notified in November 2025, consent-manager duties start on 13 November 2026, and the core duties (notice, consent, safeguards, breach reporting) on 13 May 2027. Europe's GDPR and California's CCPA follow if readers come from there. In practice: a privacy policy naming every tool, consent for non-essential tracking, collecting the minimum, retention limits, deletion on request, and a data processing agreement with each vendor. Plus Google's restricted-scope rules for Gmail data (section 3).
3. **Ranking and recommendation quality.** Nutgraf's core is a ranker, and recommendation teams measure it as its own discipline: precision at 5, coverage (how many newsletters ever reach the top), diversity, novelty, the share of exploration, and replays of past days with a new ranker before it ships. Section 5.7 starts it; it deserves its own page once the stored score ([issue 5](https://github.com/devsandip/the-library/issues/5)) lands.
4. **Cost and unit economics.** AWS plus Bedrock cost per reader per month, per issue, per feature. If Nutgraf opens up, this number decides free, freemium or paid. Today the budget alert is not even set.
5. **Trust, safety and abuse.** Fake sign-ups, password-guessing attacks, scraping, and above all AI cost abuse: one person scripting Ask a thousand times a day is a real bill. Measure sign-ups per hour, failed sign-ins, requests per reader and AI spend per reader, and enforce limits.
6. **Money.** If Nutgraf ever charges: trial-to-paid conversion, monthly recurring revenue, churn, revenue per reader, refunds and lifetime value. Stripe's dashboard first, then the warehouse.
7. **The weekly review.** A metric is only useful if someone looks at it. One page, every week: the North Star and its inputs, the guardrails, AI cost, open alarms, three replays watched, one decision. Without this habit, every tier is decoration.

Smaller ones, for later: app-store analytics (only with native apps), accessibility signals (text size, reduced motion), and search-engine visibility for a public site.

## 7. The three tiers

The names follow the product. A nut graf is the paragraph in a news story that says why the story matters, so the tiers grow the way news operations do: one reporter's notebook, a newsroom with a desk for each beat, a wire service that feeds the world.

| | **Notebook** | **Newsroom** | **Wire Service** |
|---|---|---|---|
| In one line | One free tool plus what AWS already gives you | The best tool for each job, plus a warehouse | A data platform and a data team |
| For | You alone, or a few friends | Nutgraf opened up: 1,000 to 50,000 readers a month | A million readers and more |
| Tools a month | $0 to $5 | about $300 to $1,500 | $25,000 to $250,000 and up |
| People | You, an hour a week | You, plus part of an engineer's time | 5 to 20 or more across data, growth, research and reliability |
| Set-up | About 6 small pull requests | One to two months | Quarters, and never finished |
| Source of truth | PostHog and CloudWatch | A warehouse in S3 | A governed lakehouse |
| Outside vendors | 1 (PostHog) | 5 to 8 | 15 or more |

| Area | Notebook | Newsroom | Wire Service |
|---|---|---|---|
| Product | PostHog (client + server events) | PostHog paid; S3 warehouse, dbt, Athena, Metabase | CDP, Snowflake or Databricks, Amplitude or Mixpanel, Looker or Hex, Avo, Monte Carlo |
| Marketing | UTM links, PostHog web analytics, Search Console | Attribution in PostHog, Dub, Search Console, GA4 only with Google Ads | AppsFlyer, Adjust or Branch; Meridian or Robyn; incrementality tests |
| Qualitative | PostHog replay (masked) and surveys; thumbs-down reasons | PostHog replay, heatmaps, surveys; Canny; Plain; Clarity on the public page | FullStory or Contentsquare; Qualtrics; Sprig; UserTesting; Dovetail |
| Technical | PostHog errors and web vitals; Powertools; CloudWatch; free uptime check | Sentry, Application Signals, Better Stack | Datadog on OpenTelemetry; Crashlytics; PagerDuty |
| Experiments | PostHog flags; interleaving | PostHog experiments or GrowthBook | Statsig, Eppo, Optimizely or in-house |
| Messaging | SES email, web push, `ref` tags | Customer.io or Loops, OneSignal | Braze or Iterable, fed by reverse ETL |
| AI | Bedrock wrapper metrics, invocation logs in S3, tagged profiles, Budgets, Promptfoo | Langfuse in AWS, Guardrails, spend caps | Datadog LLM Observability or Arize, an AI gateway |

### 7.1 Notebook: nearly free, start now

```
Phone and Mac app (posthog-js, bundled)
   │ events
   ▼
sandip.dev/nutgraf/ingest/*  ──CloudFront──▶  PostHog Cloud: charts, funnels, retention,
                                              replay, surveys, flags, errors, web vitals
API, ingest and jobs Lambdas                      ▲
   ├── server events, no content ─────────────────┘
   ├── Powertools logs, metrics, traces ──▶ CloudWatch: dashboard, alarms, 90 days of logs
   └── Bedrock calls ──▶ CloudWatch metrics; invocation logs in S3 (30 days);
                         tagged inference profiles ──▶ Cost Explorer, Budgets
A Monday Lambda ──▶ SES ──▶ your weekly numbers by email
```

**Cost:** you will produce perhaps 10,000 to 30,000 events a month, about 2% of PostHog's free million. A few CloudWatch custom metrics, a dashboard and some S3 storage add a few dollars at most.

**Good:** one tool to learn, and its ideas (events, funnels, retention, flags) are the industry's; nearly free; touches all seven areas.

**Watch:** PostHog is a vendor outside AWS, which is a PRD change (decision 2); the free allowance caps replays at 5,000 a month; one person's data is anecdote, not statistics.

**Move up when:** a second person signs up, or events pass the free million.

**The all-AWS alternative**, if you want nothing outside AWS: the app sends events to a new `POST /api/events` route; a Firehose stream writes them to S3 (about 3 cents per GB); Athena queries them ($5 per TB scanned, so fractions of a cent here); CloudWatch RUM gives errors and web vitals ($1 per 100,000 events); AppConfig gives flags. The same facts and no new vendor, but no replay, no surveys and no ready-made funnel or retention charts: each one is SQL you write. More building, less learning of the tools the industry uses.

### 7.2 Newsroom: when Nutgraf opens up

```
Apps ──▶ first-party proxy ──▶ PostHog: product, web, replay, surveys, flags, experiments
Lambdas ──▶ server events ──┘      │ batch export, hourly
                                   ▼
                     S3 warehouse (Parquet) ──▶ dbt ──▶ Athena ──▶ Metabase dashboards
                                   │
                                   └──▶ audiences ──▶ Customer.io or Loops ──▶ email, push
Apps and Lambdas ──▶ Sentry: errors, tracing, release health
Bedrock calls ──▶ Langfuse, self-hosted in AWS: traces with prompts, scores, datasets
Better Stack: uptime robot, status page, on-call
```

**Cost at about 10,000 readers a month:** PostHog a few hundred dollars, depending on events, replays and flag checks (5 cents per 1,000 events and half a cent per recording above the free allowances); Sentry from $26; Langfuse's servers in your AWS account roughly $100 to $250; Customer.io about $145 for 10,000 people, or Loops for less; Better Stack and the rest tens of dollars. About **$300 to $1,500 a month**, growing with readers. Bedrock is separate and probably bigger: AI cost per reader becomes the number to watch.

**Good:** the right tool for each job; the warehouse joins everything; prompts still never leave AWS.

**Watch:** five to eight vendors, each a bill, a contract and a data processing agreement; someone has to own the tracking plan; the privacy work in section 6 becomes real.

### 7.3 Wire Service: big consumer scale

```
Web, iOS, Android, servers ──▶ CDP (Segment, RudderStack or mParticle) ──▶ stream (Kinesis or Kafka)
                                                                              │
                                                                              ▼
                              Lakehouse: S3 with Iceberg tables, Snowflake, Databricks or Redshift
                              dbt models, a semantic layer, data contracts, Monte Carlo checks
                                                                              │
   ┌──────────────────┬──────────────────┬──────────────────┬─────────────────┴─────┐
   ▼                  ▼                  ▼                  ▼                       ▼
Amplitude or      Looker or Hex     Statsig or Eppo    reverse ETL ──▶ Braze     ML features,
Mixpanel                                                                         marketing mix model
Beside it: Datadog (APM, RUM, logs, robots) · Crashlytics · AppsFlyer · FullStory · Qualtrics ·
           LLM observability behind an AI gateway · OneTrust for consent · PagerDuty
```

**Cost:** tool contracts from about $25,000 to well over $250,000 a month, negotiated yearly. People cost more than the tools: analytics engineers, data scientists for experiments, data engineers, growth marketers, UX researchers, site reliability engineers, AI evaluators.

**Why anyone pays this:** at a million readers, a 1% gain in retention is worth more than the whole stack, and only this machinery can measure 1%.

## 8. Notebook as pull requests

If you approve Notebook, it becomes a milestone of about six pull requests, each useful on its own:

1. **Tracking plan in code.** `packages/core/src/analytics.ts`: typed events and properties from section 5.1, and a test that no property holds free text. Nothing is sent yet.
2. **PostHog in the app.** `posthog-js` bundled; a CloudFront behaviour sending `/nutgraf/ingest/*` to PostHog; the CSP unchanged; identify by a hash of the Cognito user ID; replay with all text masked and the newsletter frame blocked; separate dev and prod projects; screen, deck and reader events.
3. **Server events and Powertools.** Ratings, saves, opens and ingest runs as server events; a shared Bedrock wrapper sending `llm_call_completed`; Powertools logs and metrics; CloudWatch dashboards "Nutgraf health" and "AI cost by feature"; 90-day log retention.
4. **Cost guardrails.** The AWS Budget on the project tag (closes [issue 6](https://github.com/devsandip/the-library/issues/6)); Cost Anomaly Detection; Bedrock invocation logging to S3 with a 30-day lifecycle; an inference profile per feature.
5. **Your feedback, captured.** Thumbs-down reasons; thumbs on Ask answers, timelines, takes and source checks.
6. **The weekly review.** A Monday email through SES, or a Metrics page under Library > Status: the North Star and its inputs, the guardrails, AI cost by feature, the top-5 useful rate.

After those: interleaving in the Summary, when the reranker ([issue 69](https://github.com/devsandip/the-library/issues/69)) or the bake-off ([issue 27](https://github.com/devsandip/the-library/issues/27)) has a second ranker to compare.

## 9. Decisions for you

1. **Start Notebook now?** Recommended: yes.
2. **A vendor outside AWS?** The PRD says AWS only, and that email content never leaves the account except to Bedrock. Notebook keeps all content in AWS but sends usage metadata to PostHog, so it changes the PRD's "AWS only" line. Choose PostHog under the ground rules (recommended), or the all-AWS alternative.
3. **PostHog's US or EU cloud?** Either works for you alone. The EU cloud (Frankfurt) is simpler for European readers later; the US cloud is closer to your stack in us-east-1.
4. **The North Star:** useful reads per reader per week, or another?
5. **Messages to yourself:** the Monday email, a morning push when the day in brief is ready, both, or neither?

## 10. Glossary

| Term | Meaning |
|---|---|
| A/B test | Two versions shown to two random groups; compare a chosen metric |
| Activation | The moment a new user first gets the product's value |
| Attribution | Giving a marketing channel credit for a sign-up |
| Autocapture | Recording every tap and page view without writing code for each |
| CAC | Customer acquisition cost: spend ÷ customers won |
| CDP | Customer data platform: collects events once and sends them to every tool |
| Cohort | A group of users who started in the same period |
| Conversion rate | The share of people who complete a step |
| Core Web Vitals | Google's speed measures: LCP, INP, CLS |
| CSAT | Customer satisfaction: "was this helpful?" |
| CUPED | A statistical method that makes experiments need fewer users |
| DAU, WAU, MAU | People active in a day, week, month |
| dbt | A tool for turning raw warehouse tables into clean, tested ones with SQL |
| Distinct ID | The opaque ID that says who did an event |
| Error budget | The failures an SLO allows; spent on risky changes |
| Eval | A test of an AI prompt or model against known good answers |
| Event | One thing that happened, with its properties |
| Feature flag | A switch that turns code on or off without a deploy |
| Funnel | The share of people completing each step of a sequence |
| Golden set | A small set of examples with correct answers, for evals |
| Groundedness | Whether an AI answer is supported by its sources |
| Guardrail metric | A metric that must not get worse while you improve another |
| Holdout | A group kept from a change or message, to measure its true effect |
| Identify | Joining an anonymous visitor to a known account |
| Incrementality | What a campaign or message caused that would not have happened anyway |
| Interleaving | Mixing two rankers' results in one list to see which wins |
| K-factor | Invites per user × acceptance rate |
| LLM-as-judge | One model grading another's answers |
| LTV | Lifetime value: what a customer is worth over their time with you |
| MMM | Marketing mix modelling: statistics that estimate each channel's effect from totals |
| MMP | Mobile measurement partner: attributes app installs to ads |
| North Star metric | The one number that best captures the value users get |
| NPS | Net Promoter Score, from −100 to 100 |
| Observability | Logs, metrics and traces together |
| p50, p95, p99 | The typical, the slow one-in-twenty, and the worst-1% case |
| PMF survey | "How would you feel if you could no longer use it?"; 40% "very disappointed" is the bar |
| Property | A detail attached to an event |
| Retention | The share of a cohort that comes back after a given time |
| Reverse ETL | Sending warehouse data back into tools like email platforms |
| RUM | Real user monitoring: speed and errors from real devices |
| Sample ratio mismatch | A split that came out uneven, a sign of a broken experiment |
| SDK | A vendor's library inside your app that captures and sends events |
| Session | One visit, usually ended by 30 minutes of inactivity |
| Session replay | A reconstruction of a visit's taps, scrolls and screens |
| SLO | Service level objective: a reliability target you set |
| Source map | A file that maps minified code back to the original source |
| Stickiness | DAU ÷ MAU |
| Token | The unit AI models are billed in |
| Trace, span | One job end to end, and each step in it |
| Tracking plan | The designed list of events and their properties |
| UTM | Tags on a link that record where a visit came from |
| Warehouse | One large SQL database holding every event, as the source of truth |

## 11. Sources

Prices and limits read on 2026-10-28:

- PostHog pricing (free allowances, unit prices): https://posthog.com/pricing ; reverse proxy: https://posthog.com/docs/advanced/proxy
- Sentry pricing: https://sentry.io/pricing/
- Langfuse pricing: https://langfuse.com/pricing ; ClickHouse's purchase: https://clickhouse.com/blog/clickhouse-acquires-langfuse-open-source-llm-observability
- Mixpanel: https://mixpanel.com/pricing/ ; Amplitude: https://amplitude.com/pricing
- GrowthBook: https://www.growthbook.io/pricing ; Statsig: https://www.statsig.com/pricing and https://statsig.com/blog/openai-acquisition ; Eppo: https://www.datadoghq.com/about/latest-news/press-releases/datadog-acquires-eppo-to-expand-its-ai/
- CloudWatch Evidently ending: https://aws.amazon.com/blogs/mt/support-for-amazon-cloudwatch-evidently-ending-soon ; AppConfig: https://aws.amazon.com/systems-manager/pricing/
- CloudWatch (RUM, Application Signals): https://aws.amazon.com/cloudwatch/pricing/ ; SES: https://aws.amazon.com/ses/pricing/ ; Firehose: https://aws.amazon.com/firehose/pricing/ ; Athena: https://aws.amazon.com/athena/pricing/
- Bedrock invocation logging: https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html ; runtime metrics: https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-runtime-metrics.html
- Customer.io: https://customer.io/pricing ; Loops: https://loops.so/pricing ; OneSignal: https://onesignal.com/pricing
- Microsoft Clarity: https://learn.microsoft.com/en-us/clarity/setup-and-installation/about-clarity
- Google's sender guidelines: https://support.google.com/a/answer/81126
- India's DPDP Rules timeline: law-firm summaries of the November 2025 notification (the gazette itself was not read)

Sample sizes in section 5.5 use the standard two-proportion formula at 95% confidence and 80% power.
