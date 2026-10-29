import type { ReaderExport } from "@library/core/export";
import type { ReaderSettings } from "@library/core/settings";
import type { Limited, UsageResponse } from "@library/core/usage";
import type { AccountPort } from "./account.js";
import type { SettingsPort } from "./settings.js";
import type {
  AskResponse,
  AuditResponse,
  TuneupResponse,
  Follow,
  FollowingResponse,
  Highlight,
  HighlightQuote,
  HighlightsResponse,
  HistoryResponse,
  IssueDetailResponse,
  IssueListItem,
  IssueListResponse,
  IssueStoriesResponse,
  IssueStory,
  LearningListResponse,
  NowReadingResponse,
  Prediction,
  PredictionStatus,
  PredictionsResponse,
  PredictionView,
  Rating,
  ReaderState,
  RelatedResponse,
  SearchResponse,
  SearchSort,
  SenderDetailResponse,
  SenderListItem,
  SenderPatch,
  Shelf,
  SourceResponse,
  StatusResponse,
  StoryPatch,
  SummaryResponse,
  TakesResponse,
  TimelineResponse,
  Topic,
  UnreadCountsResponse,
  View,
} from "@library/core/types";

export interface ListOptions {
  limit: number;
  cursor?: string;
  /** One or more senders (any of them). */
  senderIds?: string[];
  shelf?: Shelf;
  /** One or more topics (any of them). */
  topics?: string[];
}

/** Everything the routes need from storage. DynamoRepo implements it; tests use a fake. */
export interface RepoPort {
  listIssues(view: View, opts: ListOptions): Promise<IssueListResponse>;
  getIssue(id: string): Promise<IssueDetailResponse>;
  setState(id: string, state: ReaderState): Promise<IssueListItem>;
  /** Sandip moves an issue to a shelf; Claude never moves it back. */
  setShelf(id: string, shelf: Shelf): Promise<IssueListItem>;
  /** Save an issue for later, or take it off the Saved list (#43). */
  setSaved(id: string, saved: boolean): Promise<IssueListItem>;
  setRating(id: string, value: Rating | 0): Promise<IssueListItem>;
  /** Logs the open (read history, #42) and points Now reading at the issue (#44). */
  logOpen(id: string): Promise<void>;
  /** Logs a peek left open (#56): read history lists the issue; Now reading stays put. */
  logPeek(id: string): Promise<void>;
  /** The issue to come back to (#44), if there is one. */
  nowReading(): Promise<NowReadingResponse>;
  /** Saves how far down an issue the reader is, 0 to 1, where 1 means finished (#44). */
  savePosition(id: string, position: number): Promise<void>;
  /** The issue's stories from the story index (#15), in order (#41). */
  stories(id: string): Promise<IssueStoriesResponse>;
  /** Learning stories for a view (#81), newest first, each with its issue as a row. */
  listLearning(
    view: Exclude<View, "saved">,
    opts: Omit<ListOptions, "shelf">,
  ): Promise<LearningListResponse>;
  /** A story's own state, or Sandip moving it (#81); the issue's shelf follows a move. */
  setStory(id: string, n: number, patch: StoryPatch): Promise<IssueStory>;
  listSenders(): Promise<SenderListItem[]>;
  getSender(senderId: string): Promise<SenderDetailResponse>;
  updateSender(senderId: string, patch: SenderPatch): Promise<SenderListItem>;
  listTopics(): Promise<Topic[]>;
  /** The reader's settings (#184), today's values when they have none. */
  settings(): Promise<ReaderSettings>;
  /** Changes the reader's settings and answers them whole. */
  saveSettings(patch: Partial<ReaderSettings>): Promise<ReaderSettings>;
  /** The reader's model use for their last days, newest first (#208). */
  usage(): Promise<UsageResponse>;
  /** Everything Nutgraf keeps for the reader (#219). */
  exportData(): Promise<ReaderExport>;
  /** Counts a use of a limited feature unless the day's are used (#209). */
  takeUse(feature: Limited): Promise<{ ok: boolean; limit: number }>;
  unreadCounts(): Promise<UnreadCountsResponse>;
  /** The most relevant unread News, best first. */
  summary(): Promise<SummaryResponse>;
  /** Issues read on a reader's day (#42, #56), latest first, and the nearest days with reads. */
  history(day: string): Promise<HistoryResponse>;
  status(): Promise<StatusResponse>;
}

/** Search over what the newsletters said (#53). */
export interface SearchPort {
  search(q: string, sort: SearchSort): Promise<SearchResponse>;
}

/** Stories close to this issue's, from before and since (#20). */
export interface RelatedPort {
  related(id: string): Promise<RelatedResponse>;
}

/** How a story evolved (#19): the timeline kept for its event, or a new one written now. */
export interface TimelinePort {
  get(id: string, n: number): Promise<TimelineResponse>;
  run(id: string, n: number): Promise<TimelineResponse>;
}

/** How each newsletter covered a story's event (#17): kept takes, or new ones written now. */
export interface TakesPort {
  get(id: string, n: number): Promise<TakesResponse>;
  run(id: string, n: number): Promise<TakesResponse>;
}

/**
 * A story checked against its source (#23): the kept check, or one started now. The check runs in
 * the jobs Lambda, so `run` answers `running` and `get` follows it.
 */
export interface SourcePort {
  get(id: string, n: number): Promise<SourceResponse>;
  run(id: string, n: number): Promise<SourceResponse>;
}

/**
 * Work for the jobs Lambda (`./jobs.ts`), which may take longer than the API's 28 s: a source
 * check the API starts, or the day's settling of predictions (#139), on a schedule or by hand.
 */
/**
 * A job for the jobs Lambda. A source check carries the reader who asked for it (#179); settling
 * runs for the owner (`pnpm settle`) or, in the hourly round, for each reader at their 07:00.
 */
export type Job =
  | { kind: "source"; id: string; n: number; reader?: string }
  | { kind: "settle"; limit?: number }
  /** The hourly round (#211): each reader whose clock reads 07:xx at `at` (now by default). */
  | { kind: "daily"; at?: string }
  /** Everything a reader has, deleted, then their sign-in (#220). */
  | { kind: "delete-account"; reader: string };

/** A question answered from the newsletters (#21). */
export interface AskPort {
  ask(q: string): Promise<AskResponse>;
}

/** Predictions (#24, #140): listed by view, and Sandip's verdicts. */
export interface PredictionsPort {
  list(view: PredictionView): Promise<PredictionsResponse>;
  /** Sandip's verdict, or null to hand it back to settling. */
  set(id: string, verdict: Exclude<PredictionStatus, "open"> | null): Promise<Prediction>;
}

/** Subscription audit (#25, #150): a report card per newsletter, worked out when asked. */
export interface AuditPort {
  audit(): Promise<AuditResponse>;
}

/** Weekly tune-up (#26, #158): newsletter rules proposed from Sandip's corrections. */
export interface TuneupPort {
  tuneup(): Promise<TuneupResponse>;
  /** Not now: hidden until his moves toward it grow. */
  dismiss(id: string): Promise<TuneupResponse>;
}

/** Highlights (#166): passages kept from issues, with notes, listed newest first. */
export interface HighlightsPort {
  list(limit: number, before?: string): Promise<HighlightsResponse>;
  add(issueId: string, quote: HighlightQuote, note?: string): Promise<Highlight>;
  /** Sets the note, or clears it with undefined. */
  note(id: string, note: string | undefined): Promise<Highlight>;
  remove(id: string): Promise<void>;
}

/** Followed stories (#22): follow a story's event, list them, unfollow, mark them seen. */
export interface FollowPort {
  list(): Promise<FollowingResponse>;
  follow(id: string, n: number): Promise<Follow>;
  unfollow(id: string, n: number): Promise<void>;
  seen(): Promise<void>;
}

export interface Services {
  repo: RepoPort;
  search: SearchPort;
  related: RelatedPort;
  timelines: TimelinePort;
  takes: TakesPort;
  sources: SourcePort;
  ask: AskPort;
  following: FollowPort;
  highlights: HighlightsPort;
  predictions: PredictionsPort;
  audit: AuditPort;
  tuneup: TuneupPort;
  /** The reader's settings (#184); saving interests embeds them (#187). */
  settings: SettingsPort;
  /** Deleting the reader's account (#220). */
  account: AccountPort;
  /** Fire-and-forget ingest run ("refresh now"). */
  startIngest(): Promise<void>;
}
