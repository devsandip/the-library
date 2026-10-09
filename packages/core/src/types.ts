/**
 * Shared shapes for the API, ingest and web. Pure types only: the web app imports this file
 * directly (via "@library/core/types"), so nothing here may pull in Node modules.
 */

export type IssueState = "unread" | "read" | "archived" | "filtered";
/** States a reader can move an issue to. */
export type ReaderState = Exclude<IssueState, "filtered">;
export type Rating = 1 | -1;
export type View = "unread" | "all" | "archived";

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
  // Phase 2
  summary?: string;
  topics?: string[];
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
  up: number;
  down: number;
  issueCount: number;
  lastSeenAt: string;
  unsubscribeUrl?: string;
}

export interface SenderListResponse {
  items: SenderListItem[];
}

/** PATCH /senders/{id}: set either flag, or both. */
export interface SenderPatch {
  muted?: boolean;
  mustRead?: boolean;
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

export interface StatusResponse {
  stage: string;
  lastRunAt?: string;
  lastRunStats?: IngestStats;
  lastError?: string | null;
}

export interface ApiError {
  error: string;
}
