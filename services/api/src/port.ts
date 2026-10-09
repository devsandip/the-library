import type {
  IssueDetailResponse,
  IssueListItem,
  IssueListResponse,
  Rating,
  ReaderState,
  SenderDetailResponse,
  SenderListItem,
  SenderPatch,
  StatusResponse,
  View,
} from "@library/core/types";

export interface ListOptions {
  limit: number;
  cursor?: string;
  senderId?: string;
}

/** Everything the routes need from storage. DynamoRepo implements it; tests use a fake. */
export interface RepoPort {
  listIssues(view: View, opts: ListOptions): Promise<IssueListResponse>;
  getIssue(id: string): Promise<IssueDetailResponse>;
  setState(id: string, state: ReaderState): Promise<IssueListItem>;
  setRating(id: string, value: Rating | 0): Promise<IssueListItem>;
  logOpen(id: string): Promise<void>;
  listSenders(): Promise<SenderListItem[]>;
  getSender(senderId: string): Promise<SenderDetailResponse>;
  updateSender(senderId: string, patch: SenderPatch): Promise<SenderListItem>;
  status(): Promise<StatusResponse>;
}

export interface Services {
  repo: RepoPort;
  /** Fire-and-forget ingest run ("refresh now"). */
  startIngest(): Promise<void>;
}
