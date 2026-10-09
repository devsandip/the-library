import type {
  IssueDetailResponse,
  IssueListItem,
  IssueListResponse,
  Rating,
  ReaderState,
  SenderDetailResponse,
  SenderListItem,
  SenderListResponse,
  SenderPatch,
  Shelf,
  StatusResponse,
  TopicListResponse,
  View,
} from "@library/core/types";
import type { Auth } from "./auth.js";
import type { AppConfig } from "./config.js";

export interface ListIssuesOptions {
  view: View;
  shelf?: Shelf;
  topic?: string;
  sender?: string;
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
  rate(id: string, value: Rating | 0): Promise<IssueListItem>;
  logOpen(id: string): Promise<void>;
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
    if (opts.topic) q.set("topic", opts.topic);
    if (opts.sender) q.set("sender", opts.sender);
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
  rate(id: string, value: Rating | 0) {
    return this.request<IssueListItem>("POST", `/issues/${encodeURIComponent(id)}/rating`, {
      value,
    });
  }
  logOpen(id: string) {
    return this.request<void>("POST", `/issues/${encodeURIComponent(id)}/events`, { type: "open" });
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
