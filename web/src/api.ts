import type {
  IssueDetailResponse,
  IssueListItem,
  IssueListResponse,
  Rating,
  ReaderState,
  RelatedResponse,
  SenderDetailResponse,
  SenderListItem,
  SenderListResponse,
  SenderPatch,
  Shelf,
  StatusResponse,
  SummaryResponse,
  TopicListResponse,
  UnreadCountsResponse,
  View,
} from "@library/core/types";
import type { Auth } from "./auth.js";
import type { AppConfig } from "./config.js";

export interface ListIssuesOptions {
  view: View;
  shelf?: Shelf;
  /** Any of these topics. */
  topics?: string[];
  /** Any of these senders; picked senders show even when muted. */
  senders?: string[];
  cursor?: string;
  limit?: number;
}

/** What the UI needs from the backend. The HTTP client and the dev mock both implement it. */
export interface LibraryApi {
  listIssues(opts: ListIssuesOptions): Promise<IssueListResponse>;
  getIssue(id: string): Promise<IssueDetailResponse>;
  setState(id: string, state: ReaderState): Promise<IssueListItem>;
  /** Move an issue to the other shelf; Claude never moves it back. */
  setShelf(id: string, shelf: Shelf): Promise<IssueListItem>;
  listTopics(): Promise<TopicListResponse>;
  unreadCounts(): Promise<UnreadCountsResponse>;
  /** The most relevant unread News, best first. */
  summary(): Promise<SummaryResponse>;
  rate(id: string, value: Rating | 0): Promise<IssueListItem>;
  logOpen(id: string): Promise<void>;
  /** Issues close to this one, from before and since (#20). */
  related(id: string): Promise<RelatedResponse>;
  listSenders(): Promise<SenderListResponse>;
  getSender(senderId: string): Promise<SenderDetailResponse>;
  updateSender(senderId: string, patch: SenderPatch): Promise<SenderListItem>;
  refreshNow(): Promise<void>;
  status(): Promise<StatusResponse>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class HttpLibraryApi implements LibraryApi {
  constructor(
    private readonly cfg: AppConfig,
    private readonly auth: Auth,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retried = false,
  ): Promise<T> {
    const token = await this.auth.accessToken(retried);
    if (!token) return this.auth.signIn();
    const res = await fetch(`${this.cfg.apiBase}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    // An expired or revoked token: refresh once, then fall back to signing in.
    if (res.status === 401) {
      if (!retried) return this.request<T>(method, path, body, true);
      return this.auth.signIn();
    }
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new ApiError(res.status, json.error ?? `request failed (${res.status})`);
    return json;
  }

  listIssues(opts: ListIssuesOptions) {
    const q = new URLSearchParams({ view: opts.view });
    if (opts.shelf) q.set("shelf", opts.shelf);
    if (opts.topics?.length) q.set("topic", opts.topics.join(","));
    if (opts.senders?.length) q.set("sender", opts.senders.join(","));
    if (opts.cursor) q.set("cursor", opts.cursor);
    if (opts.limit) q.set("limit", String(opts.limit));
    return this.request<IssueListResponse>("GET", `/issues?${q}`);
  }
  getIssue(id: string) {
    return this.request<IssueDetailResponse>("GET", `/issues/${encodeURIComponent(id)}`);
  }
  setState(id: string, state: ReaderState) {
    return this.request<IssueListItem>("PATCH", `/issues/${encodeURIComponent(id)}`, { state });
  }
  setShelf(id: string, shelf: Shelf) {
    return this.request<IssueListItem>("PATCH", `/issues/${encodeURIComponent(id)}`, { shelf });
  }
  listTopics() {
    return this.request<TopicListResponse>("GET", "/topics");
  }
  unreadCounts() {
    return this.request<UnreadCountsResponse>("GET", "/unread-counts");
  }
  summary() {
    return this.request<SummaryResponse>("GET", "/summary");
  }
  rate(id: string, value: Rating | 0) {
    return this.request<IssueListItem>("POST", `/issues/${encodeURIComponent(id)}/rating`, {
      value,
    });
  }
  logOpen(id: string) {
    return this.request<void>("POST", `/issues/${encodeURIComponent(id)}/events`, { type: "open" });
  }
  related(id: string) {
    return this.request<RelatedResponse>("GET", `/issues/${encodeURIComponent(id)}/related`);
  }
  listSenders() {
    return this.request<SenderListResponse>("GET", "/senders");
  }
  getSender(senderId: string) {
    return this.request<SenderDetailResponse>("GET", `/senders/${encodeURIComponent(senderId)}`);
  }
  updateSender(senderId: string, patch: SenderPatch) {
    return this.request<SenderListItem>("PATCH", `/senders/${encodeURIComponent(senderId)}`, patch);
  }
  async refreshNow() {
    await this.request<unknown>("POST", "/ingest");
  }
  status() {
    return this.request<StatusResponse>("GET", "/status");
  }
}
