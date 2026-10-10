import type {
  HistoryResponse,
  IssueDetailResponse,
  IssueListItem,
  IssueListResponse,
  NowReadingResponse,
  Rating,
  ReaderState,
  RelatedResponse,
  SenderDetailResponse,
  SenderListItem,
  SenderPatch,
  Shelf,
  StatusResponse,
  SummaryResponse,
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
  /** The issue to come back to (#44), if there is one. */
  nowReading(): Promise<NowReadingResponse>;
  /** Saves how far down an issue the reader is, 0 to 1, where 1 means finished (#44). */
  savePosition(id: string, position: number): Promise<void>;
  /** Issues close to this one, from before and since (#20). */
  related(id: string): Promise<RelatedResponse>;
  listSenders(): Promise<SenderListItem[]>;
  getSender(senderId: string): Promise<SenderDetailResponse>;
  updateSender(senderId: string, patch: SenderPatch): Promise<SenderListItem>;
  listTopics(): Promise<Topic[]>;
  unreadCounts(): Promise<UnreadCountsResponse>;
  /** The most relevant unread News, best first. */
  summary(): Promise<SummaryResponse>;
  /** Issues opened on a reader's day (#42), latest first, and the nearest days with reads. */
  history(day: string): Promise<HistoryResponse>;
  status(): Promise<StatusResponse>;
}

export interface Services {
  repo: RepoPort;
  /** Fire-and-forget ingest run ("refresh now"). */
  startIngest(): Promise<void>;
}
