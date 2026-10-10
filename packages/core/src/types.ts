/**
 * Shared shapes for the API, ingest and web. Pure types only: the web app imports this file
 * directly (via "@library/core/types"), so nothing here may pull in Node modules.
 */

export type IssueState = "unread" | "read" | "archived" | "filtered";
/** States a reader can move an issue to. */
export type ReaderState = Exclude<IssueState, "filtered">;
export type Rating = 1 | -1;
export type View = "unread" | "all" | "archived";
/** Home's two tabs: what's happening now, or worth reading in three months. */
export type Shelf = "news" | "learning";
/** Who decided an issue's shelf: Claude, the sender's "always" setting, or Sandip moving it. */
export type ShelfSetBy = "claude" | "sender" | "sandip";

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
}

/** An issue shown as related to the open one (#20). */
export interface RelatedItem extends IssueListItem {
  /** Cosine between the two embeddings once newsletter style is taken out, to 3 decimals. */
  similarity: number;
}

/** GET /issues/{id}/related: the closest issues from before and since, above a cutoff. */
export interface RelatedResponse {
  earlier: RelatedItem[];
  since: RelatedItem[];
}

/** How the Summary's daily top 5 fared over the last 14 days: the PRD's success measure (#5). */
export interface DigestStats {
  /** Days with a digest logged. */
  days: number;
  /** Issues those digests held, each counted once. */
  shown: number;
  /** Of those, rated Relevant and Irrelevant by now. */
  relevant: number;
  irrelevant: number;
}

/** GET /summary: the most relevant unread News, best first, each with a `scoreReason`. */
export interface SummaryResponse {
  items: IssueListItem[];
  /** Unread News issues from the last two weeks that were scored. */
  candidates: number;
  /** Today's digest: the top 5 as first shown today. They carry the yellow box. */
  digest?: string[];
  digestStats?: DigestStats;
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

export interface StatusResponse {
  stage: string;
  lastRunAt?: string;
  lastRunStats?: IngestStats;
  lastError?: string | null;
  lastEnrich?: EnrichStats;
  digestStats?: DigestStats;
}

export interface ApiError {
  error: string;
}
