/**
 * Shared shapes for the API, ingest and web. Pure types only: the web app imports this file
 * directly (via "@library/core/types"), so nothing here may pull in Node modules.
 */

export type IssueState = "unread" | "read" | "archived" | "filtered";
/** States a reader can move an issue to. */
export type ReaderState = Exclude<IssueState, "filtered">;
/** Thumbs up (it was useful) or thumbs down (it was not). */
export type Rating = 1 | -1;
/** Saved (#43) is its own queue: saved issues leave Unread, whatever their state. */
export type View = "unread" | "all" | "archived" | "saved";
/** Home's two tabs: what's happening now, or worth reading in three months. */
export type Shelf = "news" | "learning";
/**
 * Who decided an issue's shelf. `stories`: it follows its stories (#81), Learning when every one
 * is. An issue with no stories: the sender's "always" setting, Sandip moving it, or, before #81,
 * Claude.
 */
export type ShelfSetBy = "stories" | "claude" | "sender" | "sandip";

export interface Topic {
  name: string;
  description: string;
}

export interface IssueListItem {
  id: string;
  senderId: string;
  publication: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  readMinutes: number;
  state: ReaderState;
  rating?: Rating;
  viewOnlineUrl?: string;
  /** From a Must Read newsletter. In Unread these come first. */
  mustRead?: boolean;
  // Set by Claude (see services/ingest/src/enrich.ts); absent until the issue is enriched.
  summary?: string;
  shelf?: Shelf;
  topic?: string;
  promo?: boolean;
  /** Archived by a rule rather than by Sandip: a promo, or news left unread for a week. */
  autoArchived?: "promo" | "old-news";
  /** Saved for later (#43): when. Saved issues are out of Unread and safe from the rules. */
  savedAt?: string;
  // Phase 2
  scoreReason?: string;
}

export interface IssueListResponse {
  items: IssueListItem[];
  cursor?: string;
}

export interface IssueDetailResponse extends IssueListItem {
  fromAddr: string;
  unsubscribeUrl?: string;
  /** Sanitized newsletter HTML, rendered in a script-less sandboxed iframe. */
  html: string;
  /** Where reading stopped (#44), when this is the issue Now reading points at, unfinished. */
  position?: number;
}

export interface SenderListItem {
  senderId: string;
  /** Readable identity, e.g. "pragmaticengineer@substack.com". */
  senderKey: string;
  publication: string;
  muted: boolean;
  /** Starred by Sandip: its unread issues are listed first. */
  mustRead: boolean;
  /** Always on this shelf (Sandip's choice); unset means Claude decides per issue. */
  shelf?: Shelf;
  up: number;
  down: number;
  issueCount: number;
  lastSeenAt: string;
  unsubscribeUrl?: string;
}

export interface SenderListResponse {
  items: SenderListItem[];
}

/** PATCH /senders/{id}: any of these; `shelf: null` hands the shelf back to Claude. */
export interface SenderPatch {
  muted?: boolean;
  mustRead?: boolean;
  shelf?: Shelf | null;
}

export interface TopicListResponse {
  topics: Topic[];
}

/** Unread issues for one sender, shelf and topic. Muted senders are included; the web skips them. */
export interface UnreadCount {
  senderId: string;
  /** Absent until Claude sorts the issue; it then shows under News. */
  shelf?: Shelf;
  topic?: string;
  n: number;
}

/** GET /unread-counts: the numbers on the tabs, the topic chips and the sender picker. */
export interface UnreadCountsResponse {
  counts: UnreadCount[];
  /** Issues saved for later (#43), read or not. */
  saved: number;
  /** Unread Learning stories (#81) by newsletter and their issue's topic; `shelf` is Learning. */
  learning: UnreadCount[];
}

/** One story of an issue, from the story index (#15), as a tap on its row shows it (#41). */
export interface IssueStory {
  n: number;
  headline: string;
  summary: string;
  /** The story's own source: one of the issue's links. */
  link?: string;
  /** The people, companies and places it names, as the story index found them; absent when none. */
  names?: string[];
  /** Its shelf (#81): Sandip's move, then the newsletter's setting, then Jev. Absent until shelved. */
  shelf?: Shelf;
  /** Its own state (#81), apart from its issue's; absent means unread. */
  state?: Exclude<StoryState, "unread">;
}

/** GET /issues/{id}/stories: in the order they appear; empty until the issue is split. */
export interface IssueStoriesResponse {
  stories: IssueStory[];
}

/** One row of Learning (#81): a Learning story, and its issue as a row. */
export interface LearningItem {
  issue: IssueListItem;
  story: IssueStory;
}

/** GET /learning: Learning stories for a view, newest first. */
export interface LearningListResponse {
  items: LearningItem[];
  cursor?: string;
}

/** PATCH /issues/{id}/stories/{n}: a story's own state, or Sandip moving it (#81). */
export interface StoryPatch {
  state?: StoryState;
  shelf?: Shelf;
}

/** An issue shown as related to the open one (#20). */
export interface RelatedItem extends IssueListItem {
  /**
   * Cosine between the two stories' embeddings, or for an issue not split into stories, between
   * the two issues' once newsletter style is taken out; to 3 decimals.
   */
  similarity: number;
  /** The story inside a digest that matched, shown on its row. */
  story?: { n: number; headline: string };
}

/** One of a digest's stories, and the closest stories to it from other issues (#20). */
export interface RelatedStory {
  n: number;
  headline: string;
  earlier: RelatedItem[];
  since: RelatedItem[];
}

/**
 * GET /issues/{id}/related: the closest stories from before and since, above a cutoff. An issue
 * with one story, or not split yet, has them in `earlier` and `since`; a digest has them for
 * each of its stories, in `stories`.
 */
export interface RelatedResponse {
  earlier: RelatedItem[];
  since: RelatedItem[];
  /** A digest's stories that have relatives, in the order they appear. */
  stories?: RelatedStory[];
}

/** A story one point of a timeline draws on (#19). */
export interface TimelineSource {
  issueId: string;
  publication: string;
  /** The story inside a digest, which the point opens at; absent for an issue that is one story. */
  story?: { n: number; headline: string };
}

/** One paragraph of an answer from the newsletters (#21), with the stories it draws on. */
export interface AskParagraph {
  text: string;
  sources: TimelineSource[];
}

/** POST /ask (#21): a question answered from Sandip's own newsletters. Nothing is kept. */
export interface AskResponse {
  q: string;
  /** The answer, empty when the newsletters have nothing on it (then `none` says so). */
  paragraphs: AskParagraph[];
  none?: string;
  /** What it looked for: each search's words, and its dates when the question named some. */
  searches: string[];
  /** Stories read for the answer. */
  stories: number;
  ms: number;
  cents: number;
}

/** How a claim stands against its source (#23). */
export type SourceVerdict = "holds" | "further" | "missing";

/** One of the story's claims, checked against the page it links to. */
export interface SourceClaim {
  /** What the newsletter says. */
  claim: string;
  /** What the page says about it. */
  source: string;
  /** The page's own words, checked against the page; absent when Claude's did not match. */
  quote?: string;
  verdict: SourceVerdict;
}

/** A page the source check read on its way to the original (#128). */
export interface SourceHop {
  /** Where it ended up, after redirects. */
  url: string;
  /** What the page before called it, for a page the hunt followed ("the paper"). */
  why?: string;
  /** What it is, for the original ("the paper on arXiv"). */
  what?: string;
  /** Why it could not be read. */
  failed?: string;
}

/** A story checked against its source (#23), kept per story. */
export interface SourceCheck {
  /** The page checked, after redirects: the original when the hunt found it. */
  url: string;
  /** Whether the page checked is the original (#128); absent on checks before the hunt. */
  original?: boolean;
  /** Every page tried, in order, the story's own link first (#128). */
  path?: SourceHop[];
  verdict: SourceVerdict | "mixed";
  claims: SourceClaim[];
  /** Anything worth knowing about the page, in one sentence ("It reports another site's story"). */
  note?: string;
  at: string;
  ms: number;
  cents: number;
}

/** A source check running in the background (#23): since when, and the pages read so far. */
export interface SourceRun {
  since: string;
  /** The pages tried so far (#128). */
  pages?: SourceHop[];
  /** The page being read now. */
  reading?: string;
}

/**
 * GET and POST /issues/{id}/stories/{n}/source: the kept check, or why there is none, or the
 * check running now (GET again until it is kept or says why not).
 */
export interface SourceResponse {
  check?: SourceCheck;
  none?: string;
  running?: SourceRun;
}

/** One newsletter's take on an event (#17): what it says or stresses, and its story. */
export interface Take {
  text: string;
  source: TimelineSource;
  /** The story that is open. */
  current?: true;
}

/** Newsletters that land in the same place, under a short label ("Skeptical"). */
export interface TakeGroup {
  label: string;
  takes: Take[];
}

/** How each of Sandip's newsletters covered one event (#17, the first layer), kept per event. */
export interface Takes {
  /** Where the newsletters agree and differ, in one sentence. */
  gist: string;
  groups: TakeGroup[];
  at: string;
  /** Newsletters compared, the open story's included. */
  newsletters: number;
  ms: number;
  cents: number;
}

/** GET and POST /issues/{id}/stories/{n}/takes: the kept takes, or why there are none. */
export interface TakesResponse {
  takes?: Takes;
  none?: string;
}

/** One step in how a story evolved (#19). */
export interface TimelinePoint {
  /** When the newsletters first carried it: the earliest of its stories. */
  at: string;
  /** What happened, in one sentence. */
  text: string;
  /** The stories it draws on, oldest first. */
  sources: TimelineSource[];
  /** The story the timeline was written from is one of them. */
  current?: true;
}

/**
 * How a story evolved (#19): Claude's account of the story's closest stories in the reader's
 * newsletters over the last weeks, in date order. Kept for the story's event.
 */
export interface Timeline {
  /** How the story moved, in one sentence. */
  gist: string;
  /** Oldest first. */
  points: TimelinePoint[];
  /** When it was written. */
  at: string;
  /** How many stories Claude read for it, the story itself included. */
  stories: number;
  /** How long the call took, and what it cost. */
  ms: number;
  cents: number;
}

/**
 * GET /issues/{id}/stories/{n}/timeline: the timeline kept for the story's event, if one was
 * written. POST writes it, or writes it again, and answers the same way; when nothing in the
 * newsletters is close enough to tell, there is no timeline and `none` says so.
 */
export interface TimelineResponse {
  timeline?: Timeline;
  none?: string;
}

/** A step of a followed story (#22): one it was followed with, or a move added since. */
export interface FollowPoint extends TimelinePoint {
  /** When the check after an ingest added it; absent for the points it was followed with. */
  added?: string;
}

/**
 * A followed story (#22): its event's dated points, from its kept timeline or the story itself,
 * then each real move the check after an ingest found in the newsletters.
 */
export interface Follow {
  eventId: string;
  /** The story followed, which Following opens. */
  issueId: string;
  n: number;
  headline: string;
  publication: string;
  followedAt: string;
  /** When the newest move came: its story's date. Absent before the first move. */
  movedAt?: string;
  /** Oldest first. */
  points: FollowPoint[];
  /** Points added since Sandip last looked at Following. */
  unseen: number;
  /** No movement for 30 days: listed apart and no longer checked. */
  quiet: boolean;
  /** Every story its points draw on, and the story followed ("<issueId>#<nn>"). */
  stories: string[];
}

/** GET /following: followed stories, moving ones first, latest movement first. */
export interface FollowingResponse {
  items: Follow[];
  /** New points across them all. */
  unseen: number;
}

/** Search's order (#53): best match first, or newest first. */
export type SearchSort = "best" | "newest";

/** An issue search found (#53). */
export interface SearchHit extends IssueListItem {
  /** It holds the query's words, it is close in meaning, or both. */
  match: "words" | "meaning" | "both";
  /** The story inside a digest that matched, shown on its row. */
  story?: { n: number; headline: string };
}

/**
 * GET /search: issues that hold the query's words, then those only close in meaning, each group
 * in the order asked for. Filtered mail, promos and muted newsletters are left out.
 */
export interface SearchResponse {
  q: string;
  /** The query's words as search matched them, for highlighting. */
  terms: string[];
  items: SearchHit[];
  /** False when search by meaning was unavailable: the results are by words alone. */
  byMeaning: boolean;
}

/** How the Summary's daily top 5 fared over the last 14 days: the PRD's success measure (#5). */
export interface DigestStats {
  /** Days with a digest logged. */
  days: number;
  /** Issues those digests held, each counted once. */
  shown: number;
  /** Of those, given a thumbs up (useful) and a thumbs down (not useful) by now. */
  useful: number;
  notUseful: number;
}

/** One thread of today's narrative (#18): connected stories told as one paragraph. */
export interface NarrativeThread {
  title: string;
  text: string;
  /** The issues its stories came from, in the order the thread uses them. */
  sources: { issueId: string; publication: string }[];
}

/** Today's news as a few threads (#18), written by Claude from the last day's News stories. */
export interface Narrative {
  /** When it was written. */
  at: string;
  threads: NarrativeThread[];
  /** How many stories, from how many newsletters, it was written from. */
  stories: number;
  newsletters: number;
}

/** GET /summary: the most relevant unread News, best first, each with a `scoreReason`. */
export interface SummaryResponse {
  items: IssueListItem[];
  /** Unread News issues from the last two weeks that were scored. */
  candidates: number;
  /** Today's digest: the top 5 as first shown today. They carry the yellow box. */
  digest?: string[];
  /** When today's digest was fixed: the first time the Summary was shown today. */
  digestAt?: string;
  digestStats?: DigestStats;
  /** The latest narrative, if it was written in the last 24 hours. */
  narrative?: Narrative;
}

/** An issue in read history (#42): when it was last read that day, opened or peeked at (#56). */
export interface HistoryItem extends IssueListItem {
  openedAt: string;
  /** How that latest read happened: the issue opened, or a peek left open (#56). */
  via: "open" | "peek";
}

export interface HistoryResponse {
  /** The reader's day, YYYY-MM-DD (India). */
  day: string;
  /** Issues read that day (opened, or peeked at), each once at its latest read, latest first. */
  items: HistoryItem[];
  /** The nearest days before and after it with anything read. */
  previousDay?: string;
  nextDay?: string;
}

/** The issue to come back to (#44): the last one opened, and how far down it was read. */
export interface NowReading {
  issue: IssueListItem;
  /** The share of the newsletter above the top of the screen, from 0 up to (not including) 1. */
  position: number;
  /** When the place was last saved. */
  at: string;
}

/** GET /now-reading. Empty once the issue is finished, archived, or rated after it was opened. */
export interface NowReadingResponse {
  nowReading?: NowReading;
}

export interface SenderDetailResponse extends SenderListItem {
  addresses: string[];
  issues: IssueListItem[];
}

export interface IngestStats {
  query: string;
  listed: number;
  alreadyStored: number;
  newsletters: number;
  filtered: number;
  errors: number;
  errorSamples: string[];
  durationMs: number;
}

export interface EnrichStats {
  checked: number;
  classified: number;
  embedded: number;
  /** Promos archived as Claude flagged them. */
  promosArchived: number;
  /** Account mail Claude found (a sign-in code, an email confirmation), filed as filtered (#50). */
  accountFiltered: number;
  /** Unread news over a week old, archived (Must Read newsletters are exempt). */
  oldNewsArchived: number;
  /** Issues waiting because there is no topic list yet (`pnpm topics --apply` creates it). */
  waitingForTopics: number;
  /** Not started before the run's time budget ran out; picked up by the next run. */
  deferred: number;
  errors: number;
  errorSamples: string[];
  inputTokens: number;
  outputTokens: number;
  embedTokens: number;
  durationMs: number;
}

/** One run of the story index (#15). */
/** Where a prediction stands (#24): open until settled right, wrong or unclear. */
export type PredictionStatus = "open" | "right" | "wrong" | "unclear";

/** A dated, checkable prediction from a newsletter (#24). */
export interface Prediction {
  /** `<issueId>.<k>`, unique and safe in a path. */
  id: string;
  issueId: string;
  /** The story it belongs to, when Claude named one. */
  n?: number;
  senderId: string;
  publication: string;
  /** When the newsletter said it: the issue's arrival. */
  saidAt: string;
  /** What is predicted, in one sentence. */
  text: string;
  /** Who made it: a person or organisation, or the newsletter's writer. */
  who: string;
  /** The newsletter's own call, rather than one it reports. */
  own: boolean;
  /** The newsletter's words, found in the issue word for word. */
  quote: string;
  /** Its period as given (2027-03, 2027-Q3, 2027), and the day that period ends. */
  by: string;
  due: string;
  status: PredictionStatus;
  /** Once settled (#139): when, what the later stories show in a sentence, and those stories. */
  settledAt?: string;
  why?: string;
  evidence?: PredictionEvidence[];
  /** Sandip's own verdict (#140), which is never settled again. */
  setBy?: "sandip";
}

/** A later story that settles a prediction (#139). */
export interface PredictionEvidence {
  issueId: string;
  n: number;
  publication: string;
  headline: string;
  receivedAt: string;
}

/** What a day's settling did (#139). */
export interface SettleStats {
  /** Predictions due and not settled, or unclear and due to be tried again. */
  due: number;
  right: number;
  wrong: number;
  unclear: number;
  /** Settled unclear with no call: nothing in the newsletters since mentioned them. */
  nothingFound: number;
  /** Left for the next day: over the day's limit. */
  later: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

/** What spotting predictions did in a run (#24). */
export interface PredictionStats {
  /** Issues not screened yet (promos and muted newsletters are left out). */
  checked: number;
  /** Issues screened, with or without predictions. */
  screened: number;
  /** Screened issues with passages that looked forward, each one Claude call. */
  called: number;
  predictions: number;
  /** Not started before the run's time budget ran out; picked up by the next run. */
  deferred: number;
  errors: number;
  errorSamples: string[];
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface StoryStats {
  /** Issues without stories yet (promos and muted newsletters are left out). */
  checked: number;
  /** Issues split into stories. */
  storied: number;
  stories: number;
  /** Stories that joined an event started by another issue. */
  linked: number;
  /** Not started before the run's time budget ran out; picked up by the next run. */
  deferred: number;
  errors: number;
  errorSamples: string[];
  inputTokens: number;
  outputTokens: number;
  embedTokens: number;
  durationMs: number;
}

/** Who decided a story's shelf (#81): Jev, the newsletter's "always" setting, or Sandip moving it. */
export type StoryShelfSetBy = "jev" | "sender" | "sandip";
/** A Learning story's own state (#81), apart from its issue's. Absent means unread. */
export type StoryState = "unread" | "read" | "archived";

/** One run of story shelving (#81): Jev reads each new story and picks News or Learning. */
export interface ShelfStats {
  /** Stories without a shelf yet (or all of Jev's, when forced). */
  checked: number;
  shelved: number;
  /** Of those shelved, how many went to Learning (Jev at 0.5 or more). */
  learning: number;
  /** Of those shelved, how many Jev answered between 0.4 and 0.6. */
  unsure: number;
  /** Not started before the run's time budget ran out; picked up by the next run. */
  deferred: number;
  errors: number;
  errorSamples: string[];
  inputTokens: number;
  durationMs: number;
}

/** What `pnpm shelves --derive` changed (#81). */
export interface ShelfDeriveStats {
  stories: number;
  /** Stories whose shelf, state or `gsi2` attributes were rewritten. */
  storiesChanged: number;
  /** Unread Learning stories afterwards. */
  unreadLearning: number;
  issues: number;
  issuesChanged: number;
  /** Stories Sandip moved or read while this ran; run it again. */
  skipped: number;
  durationMs: number;
}

/** One narrative check (#18): whether a new version was written, and if not, why. */
export interface NarrativeStats {
  written: boolean;
  skipped?: string;
  /** News stories from the last day. */
  stories: number;
  threads: number;
  /** The new version's thread titles. */
  titles?: string[];
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface StatusResponse {
  stage: string;
  lastRunAt?: string;
  lastRunStats?: IngestStats;
  lastError?: string | null;
  lastEnrich?: EnrichStats;
  lastStories?: StoryStats;
  lastShelves?: ShelfStats;
  digestStats?: DigestStats;
}

export interface ApiError {
  error: string;
}
