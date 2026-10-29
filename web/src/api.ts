import type {
  AskResponse,
  AuditResponse,
  TuneupResponse,
  Follow,
  FollowingResponse,
  Prediction,
  PredictionStatus,
  PredictionsResponse,
  PredictionView,
  HistoryResponse,
  Highlight,
  HighlightQuote,
  HighlightsResponse,
  IssueDetailResponse,
  IssueListItem,
  IssueListResponse,
  IssueStoriesResponse,
  IssueStory,
  LearningListResponse,
  NowReadingResponse,
  Rating,
  ReaderState,
  RelatedResponse,
  SearchResponse,
  SearchSort,
  SenderDetailResponse,
  SenderListItem,
  SenderListResponse,
  SenderPatch,
  Shelf,
  SourceResponse,
  StatusResponse,
  StoryPatch,
  SummaryResponse,
  TakesResponse,
  TimelineResponse,
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

/** Learning's list (#81): stories, so no Saved view and no shelf. */
export interface ListLearningOptions {
  view: Exclude<View, "saved">;
  topics?: string[];
  senders?: string[];
  cursor?: string;
  limit?: number;
}

/** What the UI needs from the backend. The HTTP client and the dev mock both implement it. */
export interface LibraryApi {
  listIssues(opts: ListIssuesOptions): Promise<IssueListResponse>;
  /** Learning stories (#81), newest issue first, each with its issue as a row. */
  listLearning(opts: ListLearningOptions): Promise<LearningListResponse>;
  /** A story's own state, or moving it to the other shelf (#81). */
  setStory(id: string, n: number, patch: StoryPatch): Promise<IssueStory>;
  getIssue(id: string): Promise<IssueDetailResponse>;
  setState(id: string, state: ReaderState): Promise<IssueListItem>;
  /** Move an issue to the other shelf; Claude never moves it back. */
  setShelf(id: string, shelf: Shelf): Promise<IssueListItem>;
  /** Save an issue for later, or take it off the Saved list (#43). */
  setSaved(id: string, saved: boolean): Promise<IssueListItem>;
  listTopics(): Promise<TopicListResponse>;
  unreadCounts(): Promise<UnreadCountsResponse>;
  /** The most relevant unread News, best first. */
  summary(): Promise<SummaryResponse>;
  /** A question answered from the newsletters (#21). */
  ask(q: string): Promise<AskResponse>;
  history(day?: string): Promise<HistoryResponse>;
  rate(id: string, value: Rating | 0): Promise<IssueListItem>;
  logOpen(id: string): Promise<void>;
  /** A peek left open (#56): read history lists the issue. */
  logPeek(id: string): Promise<void>;
  /** The issue to come back to (#44), if there is one. */
  nowReading(): Promise<NowReadingResponse>;
  /**
   * Save how far down an issue the reader is (#44), 0 to 1, where 1 means finished. With
   * `keepalive`, the request outlives the page (sent as the page goes away).
   */
  savePosition(id: string, position: number, keepalive?: boolean): Promise<void>;
  /** Issues close to this one, from before and since (#20). */
  related(id: string): Promise<RelatedResponse>;
  /** The issue's stories from the story index, for a tap on its row (#41). */
  stories(id: string): Promise<IssueStoriesResponse>;
  /** How a story evolved (#19): the timeline kept for its event, if one was written. */
  timeline(id: string, n: number): Promise<TimelineResponse>;
  /** Writes the story's timeline now: one Claude call, about half a cent. Only when asked. */
  writeTimeline(id: string, n: number): Promise<TimelineResponse>;
  /** How each newsletter covered the story's event (#17): the takes kept for it, if any. */
  takes(id: string, n: number): Promise<TakesResponse>;
  /** Writes the takes now: one Claude call, about a cent. Only when asked. */
  writeTakes(id: string, n: number): Promise<TakesResponse>;
  /** The story checked against its source (#23), if it was checked. */
  source(id: string, n: number): Promise<SourceResponse>;
  /** Checks the story against its source now: a page read and one Claude call. Only when asked. */
  checkSource(id: string, n: number): Promise<SourceResponse>;
  /** Followed stories (#22), moving ones first, with how many points are new. */
  following(): Promise<FollowingResponse>;
  /** Follows the story's event: free, no Claude call. */
  follow(id: string, n: number): Promise<Follow>;
  unfollow(id: string, n: number): Promise<void>;
  /** Marks every new point of every followed story seen. */
  seenFollowing(): Promise<void>;
  /** Who called it (#24): open predictions by due date, or settled ones latest first. */
  predictions(view: PredictionView): Promise<PredictionsResponse>;
  /** Subscription audit (#25): a report card per newsletter over the last 30 days. */
  audit(): Promise<AuditResponse>;
  /** Weekly tune-up (#26): newsletter rules proposed from Sandip's corrections. */
  tuneup(): Promise<TuneupResponse>;
  /** Not now on a proposed rule, until more of its newsletter's stories are moved that way. */
  dismissTuneup(id: string): Promise<TuneupResponse>;
  /** Sandip's verdict on a prediction, or null to hand it back to settling. */
  setVerdict(id: string, verdict: Exclude<PredictionStatus, "open"> | null): Promise<Prediction>;
  /** Highlights (#168), newest first, a page at a time; `next` is the following page's `before`. */
  highlights(opts?: { limit?: number; before?: string }): Promise<HighlightsResponse>;
  /**
   * Keeps a passage of the issue (#167), with a note if given. The same passage in the same place
   * again answers the one kept.
   */
  addHighlight(issueId: string, quote: HighlightQuote, note?: string): Promise<Highlight>;
  /** A highlight's note, or none with null. */
  setHighlightNote(id: string, note: string | null): Promise<Highlight>;
  deleteHighlight(id: string): Promise<void>;
  /** What the newsletters said (#53): by words, then by meaning. */
  search(q: string, sort: SearchSort): Promise<SearchResponse>;
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
    keepalive = false,
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
      keepalive,
    });
    // An expired or revoked token: refresh once, then fall back to signing in.
    if (res.status === 401) {
      if (!retried) return this.request<T>(method, path, body, true, keepalive);
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
  listLearning(opts: ListLearningOptions) {
    const q = new URLSearchParams({ view: opts.view });
    if (opts.topics?.length) q.set("topic", opts.topics.join(","));
    if (opts.senders?.length) q.set("sender", opts.senders.join(","));
    if (opts.cursor) q.set("cursor", opts.cursor);
    if (opts.limit) q.set("limit", String(opts.limit));
    return this.request<LearningListResponse>("GET", `/learning?${q}`);
  }
  setStory(id: string, n: number, patch: StoryPatch) {
    return this.request<IssueStory>(
      "PATCH",
      `/issues/${encodeURIComponent(id)}/stories/${n}`,
      patch,
    );
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
  setSaved(id: string, saved: boolean) {
    return this.request<IssueListItem>("PATCH", `/issues/${encodeURIComponent(id)}`, { saved });
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
  ask(q: string) {
    return this.request<AskResponse>("POST", "/ask", { q });
  }
  history(day?: string) {
    return this.request<HistoryResponse>("GET", day ? `/history?day=${day}` : "/history");
  }
  rate(id: string, value: Rating | 0) {
    return this.request<IssueListItem>("POST", `/issues/${encodeURIComponent(id)}/rating`, {
      value,
    });
  }
  logOpen(id: string) {
    return this.request<void>("POST", `/issues/${encodeURIComponent(id)}/events`, { type: "open" });
  }
  logPeek(id: string) {
    return this.request<void>("POST", `/issues/${encodeURIComponent(id)}/events`, { type: "peek" });
  }
  nowReading() {
    return this.request<NowReadingResponse>("GET", "/now-reading");
  }
  savePosition(id: string, position: number, keepalive = false) {
    return this.request<void>("PUT", "/now-reading", { id, position }, false, keepalive);
  }
  related(id: string) {
    return this.request<RelatedResponse>("GET", `/issues/${encodeURIComponent(id)}/related`);
  }
  stories(id: string) {
    return this.request<IssueStoriesResponse>("GET", `/issues/${encodeURIComponent(id)}/stories`);
  }
  timeline(id: string, n: number) {
    return this.request<TimelineResponse>(
      "GET",
      `/issues/${encodeURIComponent(id)}/stories/${n}/timeline`,
    );
  }
  writeTimeline(id: string, n: number) {
    return this.request<TimelineResponse>(
      "POST",
      `/issues/${encodeURIComponent(id)}/stories/${n}/timeline`,
    );
  }
  takes(id: string, n: number) {
    return this.request<TakesResponse>(
      "GET",
      `/issues/${encodeURIComponent(id)}/stories/${n}/takes`,
    );
  }
  writeTakes(id: string, n: number) {
    return this.request<TakesResponse>(
      "POST",
      `/issues/${encodeURIComponent(id)}/stories/${n}/takes`,
    );
  }
  source(id: string, n: number) {
    return this.request<SourceResponse>(
      "GET",
      `/issues/${encodeURIComponent(id)}/stories/${n}/source`,
    );
  }
  checkSource(id: string, n: number) {
    return this.request<SourceResponse>(
      "POST",
      `/issues/${encodeURIComponent(id)}/stories/${n}/source`,
    );
  }
  following() {
    return this.request<FollowingResponse>("GET", "/following");
  }
  follow(id: string, n: number) {
    return this.request<Follow>("POST", `/issues/${encodeURIComponent(id)}/stories/${n}/follow`);
  }
  unfollow(id: string, n: number) {
    return this.request<void>("DELETE", `/issues/${encodeURIComponent(id)}/stories/${n}/follow`);
  }
  seenFollowing() {
    return this.request<void>("POST", "/following/seen");
  }
  audit() {
    return this.request<AuditResponse>("GET", "/audit");
  }
  tuneup() {
    return this.request<TuneupResponse>("GET", "/tuneup");
  }
  dismissTuneup(id: string) {
    return this.request<TuneupResponse>("POST", "/tuneup/dismissed", { id });
  }
  predictions(view: PredictionView) {
    return this.request<PredictionsResponse>("GET", `/predictions?view=${view}`);
  }
  setVerdict(id: string, verdict: Exclude<PredictionStatus, "open"> | null) {
    return this.request<Prediction>("PATCH", `/predictions/${encodeURIComponent(id)}`, {
      verdict,
    });
  }
  highlights(opts: { limit?: number; before?: string } = {}) {
    const q = new URLSearchParams();
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.before) q.set("before", opts.before);
    const query = q.toString();
    return this.request<HighlightsResponse>("GET", `/highlights${query ? `?${query}` : ""}`);
  }
  addHighlight(issueId: string, quote: HighlightQuote, note?: string) {
    return this.request<Highlight>("POST", `/issues/${encodeURIComponent(issueId)}/highlights`, {
      ...quote,
      ...(note ? { note } : {}),
    });
  }
  setHighlightNote(id: string, note: string | null) {
    return this.request<Highlight>("PATCH", `/highlights/${encodeURIComponent(id)}`, { note });
  }
  deleteHighlight(id: string) {
    return this.request<void>("DELETE", `/highlights/${encodeURIComponent(id)}`);
  }
  search(q: string, sort: SearchSort) {
    const query = new URLSearchParams({ q });
    if (sort !== "best") query.set("sort", sort);
    return this.request<SearchResponse>("GET", `/search?${query}`);
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
