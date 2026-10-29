import { describe, expect, it, vi } from "vitest";
import type { HighlightQuote, IssueListItem, SenderListItem } from "@library/core/types";
import { conflict, notFound } from "../src/errors.js";
import type { Reader } from "@library/core/reader";
import { DEFAULT_SETTINGS, type ReaderSettings } from "@library/core/settings";
import { createHandler } from "../src/handler.js";
import type { RepoPort, Services } from "../src/port.js";

const issue: IssueListItem = {
  id: "abc123",
  senderId: "s0123456789ab",
  publication: "ByteByteGo",
  subject: "Hello",
  snippet: "",
  receivedAt: "2026-10-01T00:00:00.000Z",
  readMinutes: 3,
  state: "unread",
};
const sender: SenderListItem = {
  senderId: "s0123456789ab",
  senderKey: "bytebytego@substack.com",
  publication: "ByteByteGo",
  muted: false,
  mustRead: true,
  up: 0,
  down: 0,
  issueCount: 1,
  lastSeenAt: "2026-10-01T00:00:00.000Z",
};

function setup(overrides: Partial<RepoPort> = {}) {
  const repo: RepoPort = {
    listIssues: vi.fn(async () => ({ items: [issue] })),
    getIssue: vi.fn(async () => ({
      ...issue,
      fromAddr: "a@b.c",
      html: "<p>x</p>",
      highlights: [],
    })),
    setState: vi.fn(async (_id, state) => ({ ...issue, state })),
    setShelf: vi.fn(async (_id, shelf) => ({ ...issue, shelf })),
    setSaved: vi.fn(async (_id, saved) => ({
      ...issue,
      savedAt: saved ? "2026-10-10T10:00:00.000Z" : undefined,
    })),
    listTopics: vi.fn(async () => [{ name: "AI", description: "Models and tools" }]),
    settings: vi.fn(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn(async (patch: Partial<ReaderSettings>) => ({
      ...DEFAULT_SETTINGS,
      ...patch,
    })),
    setRating: vi.fn(async (_id, value) => ({ ...issue, rating: value === 0 ? undefined : value })),
    logOpen: vi.fn(async () => undefined),
    logPeek: vi.fn(async () => undefined),
    nowReading: vi.fn(async () => ({
      nowReading: { issue, position: 0.4, at: "2026-10-10T03:00:00.000Z" },
    })),
    savePosition: vi.fn(async () => undefined),
    stories: vi.fn(async () => ({
      stories: [
        { n: 1, headline: "A model ships", summary: "It is small.", link: "https://x.test" },
      ],
    })),
    listSenders: vi.fn(async () => [sender]),
    getSender: vi.fn(async () => ({ ...sender, addresses: [], issues: [issue] })),
    updateSender: vi.fn(async (_id, patch) => ({ ...sender, ...patch })),
    unreadCounts: vi.fn(async () => ({
      counts: [{ senderId: sender.senderId, shelf: "news" as const, topic: "AI", n: 2 }],
      saved: 1,
      learning: [{ senderId: sender.senderId, shelf: "learning" as const, topic: "AI", n: 3 }],
    })),
    listLearning: vi.fn(async () => ({
      items: [{ issue, story: { n: 2, headline: "How caches fail", summary: "A how-to." } }],
    })),
    setStory: vi.fn(async (_id, n, patch) => ({
      n,
      headline: "How caches fail",
      summary: "A how-to.",
      shelf: patch.shelf ?? ("learning" as const),
      ...(patch.state && patch.state !== "unread" ? { state: patch.state } : {}),
    })),
    summary: vi.fn(async () => ({
      items: [{ ...issue, scoreReason: "From a Must Read newsletter", mustRead: true }],
      candidates: 1,
    })),
    history: vi.fn(async (day: string) => ({
      day,
      items: [{ ...issue, openedAt: "2026-10-10T03:00:00.000Z", via: "open" as const }],
      previousDay: "2026-10-08",
    })),
    status: vi.fn(async () => ({ stage: "test", lastError: null })),
    ...overrides,
  };
  const svc: Services = {
    repo,
    search: {
      search: vi.fn(async (q: string) => ({
        q,
        terms: [q.toLowerCase()],
        items: [{ ...issue, match: "words" as const }],
        byMeaning: true,
      })),
    },
    related: {
      related: vi.fn(async () => ({ earlier: [{ ...issue, similarity: 0.41 }], since: [] })),
    },
    timelines: {
      get: vi.fn(async () => ({})),
      run: vi.fn(async () => ({ none: "Nothing close." })),
    },
    takes: {
      get: vi.fn(async () => ({})),
      run: vi.fn(async () => ({ none: "Only ByteByteGo carried this in your newsletters." })),
    },
    sources: {
      get: vi.fn(async () => ({})),
      run: vi.fn(async () => ({ none: "This story has no source link to check." })),
    },
    ask: {
      ask: vi.fn(async (q: string) => ({
        q,
        paragraphs: [{ text: "An answer.", sources: [{ issueId: "abc123", publication: "X" }] }],
        searches: ["agent evals"],
        stories: 4,
        ms: 900,
        cents: 0.4,
      })),
    },
    following: {
      list: vi.fn(async () => ({ items: [], unseen: 0 })),
      follow: vi.fn(async (issueId: string, n: number) => ({
        eventId: `${issueId}#0${n}`,
        issueId,
        n,
        headline: "A story",
        publication: "X",
        followedAt: "2026-10-27T10:00:00.000Z",
        points: [],
        unseen: 0,
        quiet: false,
        stories: [`${issueId}#0${n}`],
      })),
      unfollow: vi.fn(async () => undefined),
      seen: vi.fn(async () => undefined),
    },
    highlights: {
      list: vi.fn(async () => ({ items: [] })),
      add: vi.fn(async (issueId: string, quote: HighlightQuote, note?: string) => ({
        id: `${issueId}.mh0abcd1wxyz`,
        issueId,
        ...quote,
        ...(note ? { note } : {}),
        createdAt: "2026-10-29T05:00:00.000Z",
      })),
      note: vi.fn(async (id: string, note?: string) => ({
        id,
        issueId: id.split(".")[0]!,
        exact: "A passage.",
        prefix: "",
        suffix: "",
        ...(note ? { note } : {}),
        createdAt: "2026-10-29T05:00:00.000Z",
      })),
      remove: vi.fn(async () => undefined),
    },
    predictions: {
      list: vi.fn(async () => ({ items: [], due: 0 })),
      set: vi.fn(async (id: string, verdict: unknown) => ({
        id,
        issueId: id.split(".")[0]!,
        senderId: "s0123456789ab",
        publication: "X",
        saidAt: "2026-09-01T08:00:00.000Z",
        text: "It will happen by March.",
        who: "Someone",
        own: false,
        quote: "it will happen by March",
        by: "2027-03",
        due: "2027-03-31",
        status: (verdict ?? "open") as "open",
      })),
    },
    audit: {
      audit: vi.fn(async () => ({
        from: "2026-10-09T00:00:00.000Z",
        to: "2026-10-28T00:00:00.000Z",
        days: 19,
        cards: [],
      })),
    },
    tuneup: {
      tuneup: vi.fn(async () => tuneupBody),
      dismiss: vi.fn(async () => ({ ...tuneupBody, dismissed: 1 })),
    },
    settings: {
      get: vi.fn(async () => DEFAULT_SETTINGS),
      save: vi.fn(async (patch: Partial<ReaderSettings>) => ({ ...DEFAULT_SETTINGS, ...patch })),
    },
    startIngest: vi.fn(async () => undefined),
  };
  const servicesFor = vi.fn((_reader: Reader) => svc);
  const handler = createHandler(servicesFor);
  const call = async (
    method: string,
    path: string,
    opts: { query?: Record<string, string>; body?: unknown; sub?: unknown } = {},
  ) => {
    const res = (await handler({
      rawPath: `/nutgraf/api${path}`,
      queryStringParameters: opts.query,
      body:
        opts.body === undefined
          ? undefined
          : typeof opts.body === "string"
            ? opts.body
            : JSON.stringify(opts.body),
      isBase64Encoded: false,
      requestContext: {
        http: { method },
        authorizer: { jwt: { claims: "sub" in opts ? { sub: opts.sub } : { sub: "reader-1" } } },
      },
    } as never)) as { statusCode: number; body: string; headers: Record<string, string> };
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : undefined,
      headers: res.headers,
    };
  };
  return { repo, svc, servicesFor, call };
}

const tuneupBody = {
  proposals: [],
  dismissed: 0,
  newsletters: [],
  totals: { stories: 0, moved: 0, toLearning: 0, toNews: 0, unsure: 0, promos: 0, pulledBack: 0 },
};

describe("the reader (#179)", () => {
  it("runs each request with the services of the reader its token names", async () => {
    const { servicesFor, call } = setup();
    await call("GET", "/issues", { sub: "0f6c2b1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f" });
    expect(servicesFor).toHaveBeenLastCalledWith({ id: "0f6c2b1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f" });
  });

  it("refuses a request whose token names no reader, before any route runs", async () => {
    const { repo, servicesFor, call } = setup();
    for (const sub of [undefined, "", "a b", 42, "x".repeat(65)]) {
      const res = await call("GET", "/issues", { sub });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "no reader" });
    }
    expect(servicesFor).not.toHaveBeenCalled();
    expect(repo.listIssues).not.toHaveBeenCalled();
  });
});

describe("settings (#184)", () => {
  it("answers the reader's settings", async () => {
    const { call } = setup();
    const res = await call("GET", "/settings");
    expect(res.status).toBe(200);
    expect(res.body.timeZone).toBe("Asia/Kolkata");
    expect(res.body.interests).toHaveLength(5);
  });

  it("saves a time zone, interests and the reader line, cleaned", async () => {
    const { svc, call } = setup();
    const res = await call("PATCH", "/settings", {
      body: {
        timeZone: "America/New_York",
        interests: [{ name: " climate ", text: "Climate:  energy and policy." }],
        about: "The reader follows climate and energy.",
      },
    });
    expect(res.status).toBe(200);
    expect(svc.settings.save).toHaveBeenCalledWith({
      timeZone: "America/New_York",
      interests: [{ name: "climate", text: "Climate: energy and policy." }],
      about: "The reader follows climate and energy.",
    });
    expect(res.body.timeZone).toBe("America/New_York");
  });

  it("refuses an unknown zone, empty or too many interests, unknown fields and nothing", async () => {
    const { svc, call } = setup();
    const bad = [
      { timeZone: "Mars/Olympus" },
      { timeZone: "+05:30" },
      { interests: [] },
      { interests: Array.from({ length: 11 }, () => ({ name: "a", text: "b" })) },
      { interests: [{ name: "a" }] },
      { about: "" },
      { theme: "dark" },
      {},
      [],
    ];
    for (const body of bad) expect((await call("PATCH", "/settings", { body })).status).toBe(400);
    expect(svc.settings.save).not.toHaveBeenCalled();
  });
});

describe("routing and validation", () => {
  it("lists unread by default with a 30-item page", async () => {
    const { repo, call } = setup();
    const res = await call("GET", "/issues");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(repo.listIssues).toHaveBeenCalledWith("unread", {
      limit: 30,
      cursor: undefined,
      senderIds: undefined,
      shelf: undefined,
      topics: undefined,
    });
  });

  it("passes view, limit, cursor, sender, shelf and topic through", async () => {
    const { repo, call } = setup();
    await call("GET", "/issues", {
      query: {
        view: "all",
        limit: "5",
        cursor: "c",
        sender: "s0123456789ab",
        shelf: "learning",
        topic: "AI",
      },
    });
    expect(repo.listIssues).toHaveBeenCalledWith("all", {
      limit: 5,
      cursor: "c",
      senderIds: ["s0123456789ab"],
      shelf: "learning",
      topics: ["AI"],
    });
  });

  it("takes several senders and topics, comma-separated", async () => {
    const { repo, call } = setup();
    await call("GET", "/issues", {
      query: { sender: "s0123456789ab,s00000000000f", topic: "AI & LLMs,System Design" },
    });
    expect(repo.listIssues).toHaveBeenCalledWith(
      "unread",
      expect.objectContaining({
        senderIds: ["s0123456789ab", "s00000000000f"],
        topics: ["AI & LLMs", "System Design"],
      }),
    );
  });

  it("serves unread counts and the summary", async () => {
    const { call } = setup();
    const counts = await call("GET", "/unread-counts");
    expect(counts.status).toBe(200);
    expect(counts.body.counts[0]).toMatchObject({ topic: "AI", n: 2 });
    const summary = await call("GET", "/summary");
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      candidates: 1,
      items: [{ id: "abc123", scoreReason: "From a Must Read newsletter", mustRead: true }],
    });
    expect((await call("POST", "/summary")).status).toBe(405);
  });

  it("serves read history for a day, today by default", async () => {
    const { call, repo } = setup();
    const res = await call("GET", "/history", { query: { day: "2026-10-09" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ day: "2026-10-09", previousDay: "2026-10-08" });
    expect(repo.history).toHaveBeenCalledWith("2026-10-09");
    await call("GET", "/history");
    expect(repo.history).toHaveBeenLastCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    for (const day of ["2026-02-30", "yesterday", "2026-1-5"]) {
      expect((await call("GET", "/history", { query: { day } })).status).toBe(400);
    }
  });

  it("serves related issues", async () => {
    const { call, svc } = setup();
    const r = await call("GET", "/issues/abc123/related");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ earlier: [{ ...issue, similarity: 0.41 }], since: [] });
    expect(svc.related.related).toHaveBeenCalledWith("abc123");
    expect((await call("GET", "/issues/a.b/related")).status).toBe(404);
  });

  it.each([
    [{ view: "starred" }, "view must be"],
    [{ limit: "0" }, "limit must be"],
    [{ limit: "101" }, "limit must be"],
    [{ limit: "2.5" }, "limit must be"],
    [{ sender: "bytebytego@substack.com" }, "sender must be"],
    [{ sender: "s0123456789ab,nope" }, "sender must be"],
    [{ sender: "" }, "sender must be"],
    [{ shelf: "opinion" }, "shelf must be"],
    [{ topic: "x".repeat(61) }, "topic must be"],
    [{ topic: "AI,,Data" }, "topic must be"],
    [{ topic: "" }, "topic must be"],
  ])("rejects bad list query %o", async (query, msg) => {
    const res = await setup().call("GET", "/issues", { query });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(msg);
  });

  it("reads a story's kept timeline, and writes one only on POST (#19)", async () => {
    const { call, svc } = setup();
    const kept = await call("GET", "/issues/abc123/stories/2/timeline");
    expect(kept).toMatchObject({ status: 200, body: {} });
    expect(svc.timelines.get).toHaveBeenCalledWith("abc123", 2);
    expect(svc.timelines.run).not.toHaveBeenCalled();
    const ran = await call("POST", "/issues/abc123/stories/12/timeline");
    expect(ran).toMatchObject({ status: 200, body: { none: "Nothing close." } });
    expect(svc.timelines.run).toHaveBeenCalledWith("abc123", 12);
    for (const n of ["0", "100", "x"]) {
      expect((await call("GET", `/issues/abc123/stories/${n}/timeline`)).status).toBe(404);
    }
    expect((await call("DELETE", "/issues/abc123/stories/2/timeline")).status).toBe(405);
  });

  it("reads a story's kept source check, and runs one only on POST (#23)", async () => {
    const { call, svc } = setup();
    expect((await call("GET", "/issues/abc123/stories/2/source")).body).toEqual({});
    expect(svc.sources.get).toHaveBeenCalledWith("abc123", 2);
    expect(svc.sources.run).not.toHaveBeenCalled();
    const ran = await call("POST", "/issues/abc123/stories/2/source");
    expect(ran.status).toBe(200);
    expect(ran.body).toEqual({ none: "This story has no source link to check." });
    expect(svc.sources.run).toHaveBeenCalledWith("abc123", 2);
    expect((await call("DELETE", "/issues/abc123/stories/2/source")).status).toBe(405);
  });

  it("answers 202 while a source check runs in the background (#23)", async () => {
    const { call, svc } = setup();
    const since = "2026-10-28T03:00:00.000Z";
    vi.mocked(svc.sources.run).mockResolvedValueOnce({ running: { since } });
    const ran = await call("POST", "/issues/abc123/stories/2/source");
    expect(ran.status).toBe(202);
    expect(ran.body).toEqual({ running: { since } });
  });

  it("serves the subscription audit (#150)", async () => {
    const { call, svc } = setup();
    const r = await call("GET", "/audit");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ days: 19, cards: [] });
    expect(svc.audit.audit).toHaveBeenCalledOnce();
    expect((await call("POST", "/audit")).status).toBe(405);
  });

  it("serves the tune-up and takes Not now on a proposal (#158)", async () => {
    const { call, svc } = setup();
    const r = await call("GET", "/tuneup");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ proposals: [], dismissed: 0 });
    const put = await call("POST", "/tuneup/dismissed", { body: { id: "s0123456789ab.learning" } });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ dismissed: 1 });
    expect(svc.tuneup.dismiss).toHaveBeenCalledWith("s0123456789ab.learning");
    for (const id of [undefined, "s0123456789ab", "s0123456789ab.promo", "x.news"]) {
      expect((await call("POST", "/tuneup/dismissed", { body: { id } })).status).toBe(400);
    }
    expect((await call("POST", "/tuneup")).status).toBe(405);
  });

  it("keeps a passage cleaned, with a note, and rejects what is not one (#166)", async () => {
    const { svc, call } = setup();
    const r = await call("POST", "/issues/abc123/highlights", {
      body: {
        exact: "  The   model\nships. ",
        prefix: "said: ",
        suffix: " It is",
        note: " Check. ",
      },
    });
    expect(r.status).toBe(200);
    expect(svc.highlights.add).toHaveBeenCalledWith(
      "abc123",
      { exact: "The model ships.", prefix: "said: ", suffix: " It is" },
      "Check.",
    );
    await call("POST", "/issues/abc123/highlights", { body: { exact: "Only this" } });
    expect(svc.highlights.add).toHaveBeenLastCalledWith(
      "abc123",
      { exact: "Only this", prefix: "", suffix: "" },
      undefined,
    );
    const long = "x".repeat(2001);
    for (const body of [
      {},
      { exact: "   " },
      { exact: long },
      { exact: 1 },
      { exact: "a", prefix: 2 },
    ]) {
      expect((await call("POST", "/issues/abc123/highlights", { body })).status).toBe(400);
    }
    const tooLong = { exact: "a", note: "n".repeat(2001) };
    expect((await call("POST", "/issues/abc123/highlights", { body: tooLong })).status).toBe(400);
    expect((await call("POST", "/issues/a.b/highlights", { body: { exact: "a" } })).status).toBe(
      404,
    );
  });

  it("lists highlights a page at a time, sets and clears notes, and deletes (#166)", async () => {
    const { svc, call } = setup();
    expect((await call("GET", "/highlights")).body).toEqual({ items: [] });
    expect(svc.highlights.list).toHaveBeenCalledWith(50, undefined);
    const next = "2026-10-29T05:00:00.000Z#abc123#mh0abcd1wxyz";
    await call("GET", "/highlights", { query: { limit: "20", before: next } });
    expect(svc.highlights.list).toHaveBeenLastCalledWith(20, next);
    const bad: Record<string, string>[] = [{ limit: "0" }, { limit: "201" }, { before: "nope" }];
    for (const query of bad) {
      expect((await call("GET", "/highlights", { query })).status).toBe(400);
    }

    const id = "abc123.mh0abcd1wxyz";
    const set = await call("PATCH", `/highlights/${id}`, { body: { note: "Worth a post." } });
    expect(set.body.note).toBe("Worth a post.");
    expect(svc.highlights.note).toHaveBeenCalledWith(id, "Worth a post.");
    await call("PATCH", `/highlights/${id}`, { body: { note: null } });
    expect(svc.highlights.note).toHaveBeenLastCalledWith(id, undefined);
    await call("PATCH", `/highlights/${id}`, { body: { note: "  " } });
    expect(svc.highlights.note).toHaveBeenLastCalledWith(id, undefined);
    expect((await call("PATCH", `/highlights/${id}`, { body: {} })).status).toBe(400);
    expect((await call("PATCH", `/highlights/${id}`, { body: { note: 3 } })).status).toBe(400);
    expect((await call("PATCH", "/highlights/abc123.2", { body: { note: "x" } })).status).toBe(404);

    expect((await call("DELETE", `/highlights/${id}`)).status).toBe(204);
    expect(svc.highlights.remove).toHaveBeenCalledWith(id);
    expect((await call("POST", `/highlights/${id}`)).status).toBe(405);
  });

  it("lists predictions by view and takes Sandip's verdict, or null (#140)", async () => {
    const { call, svc } = setup();
    expect((await call("GET", "/predictions")).body).toEqual({ items: [], due: 0 });
    expect(svc.predictions.list).toHaveBeenCalledWith("open");
    await call("GET", "/predictions", { query: { view: "settled" } });
    expect(svc.predictions.list).toHaveBeenLastCalledWith("settled");
    expect((await call("GET", "/predictions", { query: { view: "all" } })).status).toBe(400);

    const set = await call("PATCH", "/predictions/abc123.2", { body: { verdict: "wrong" } });
    expect(set.status).toBe(200);
    expect(svc.predictions.set).toHaveBeenCalledWith("abc123.2", "wrong");
    await call("PATCH", "/predictions/abc123.2", { body: { verdict: null } });
    expect(svc.predictions.set).toHaveBeenLastCalledWith("abc123.2", null);
    expect(
      (await call("PATCH", "/predictions/abc123.2", { body: { verdict: "open" } })).status,
    ).toBe(400);
    expect(
      (await call("PATCH", "/predictions/abc123", { body: { verdict: "right" } })).status,
    ).toBe(404);
  });

  it("follows and unfollows a story, lists what is followed, marks it seen (#22)", async () => {
    const { call, svc } = setup();
    const followed = await call("POST", "/issues/abc123/stories/2/follow");
    expect(followed).toMatchObject({ status: 200, body: { eventId: "abc123#02", n: 2 } });
    expect(svc.following.follow).toHaveBeenCalledWith("abc123", 2);
    expect(await call("GET", "/following")).toMatchObject({
      status: 200,
      body: { items: [], unseen: 0 },
    });
    expect((await call("POST", "/following/seen")).status).toBe(204);
    expect(svc.following.seen).toHaveBeenCalled();
    expect((await call("DELETE", "/issues/abc123/stories/2/follow")).status).toBe(204);
    expect(svc.following.unfollow).toHaveBeenCalledWith("abc123", 2);
    expect((await call("GET", "/issues/abc123/stories/2/follow")).status).toBe(405);
    expect((await call("DELETE", "/following")).status).toBe(405);
  });

  it("reads a story's kept takes, and writes them only on POST (#17)", async () => {
    const { call, svc } = setup();
    expect(await call("GET", "/issues/abc123/stories/2/takes")).toMatchObject({
      status: 200,
      body: {},
    });
    expect(svc.takes.get).toHaveBeenCalledWith("abc123", 2);
    expect(svc.takes.run).not.toHaveBeenCalled();
    const ran = await call("POST", "/issues/abc123/stories/3/takes");
    expect(ran.body).toEqual({ none: "Only ByteByteGo carried this in your newsletters." });
    expect(svc.takes.run).toHaveBeenCalledWith("abc123", 3);
    expect((await call("GET", "/issues/abc123/stories/0/takes")).status).toBe(404);
    expect((await call("PUT", "/issues/abc123/stories/2/takes")).status).toBe(405);
  });

  it("lists Learning stories: unread by default, the shared filters, no Saved view (#81)", async () => {
    const { repo, call } = setup();
    const res = await call("GET", "/learning");
    expect(res.status).toBe(200);
    expect(res.body.items[0].story).toMatchObject({ n: 2, headline: "How caches fail" });
    expect(repo.listLearning).toHaveBeenCalledWith("unread", {
      limit: 30,
      cursor: undefined,
      senderIds: undefined,
      topics: undefined,
    });
    await call("GET", "/learning", {
      query: { view: "all", limit: "10", cursor: "c", sender: sender.senderId, topic: "AI,Data" },
    });
    expect(repo.listLearning).toHaveBeenLastCalledWith("all", {
      limit: 10,
      cursor: "c",
      senderIds: [sender.senderId],
      topics: ["AI", "Data"],
    });
    expect((await call("GET", "/learning", { query: { view: "saved" } })).status).toBe(400);
    expect((await call("GET", "/learning", { query: { limit: "0" } })).status).toBe(400);
    expect((await call("GET", "/learning", { query: { sender: "nope" } })).status).toBe(400);
  });

  it("PATCH a story: its state or a move, validated (#81)", async () => {
    const { repo, call } = setup();
    const read = await call("PATCH", "/issues/abc123/stories/2", { body: { state: "read" } });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ n: 2, state: "read" });
    expect(repo.setStory).toHaveBeenCalledWith("abc123", 2, { state: "read", shelf: undefined });
    await call("PATCH", "/issues/abc123/stories/2", { body: { shelf: "news" } });
    expect(repo.setStory).toHaveBeenLastCalledWith("abc123", 2, {
      state: undefined,
      shelf: "news",
    });
    for (const body of [{}, { state: "saved" }, { shelf: "later" }]) {
      expect((await call("PATCH", "/issues/abc123/stories/2", { body })).status).toBe(400);
    }
    expect(
      (await call("PATCH", "/issues/abc123/stories/0", { body: { state: "read" } })).status,
    ).toBe(404);
  });

  it("asks a question, trimmed, and turns away one too short or too long (#21)", async () => {
    const { svc, call } = setup();
    const res = await call("POST", "/ask", { body: { q: "  agent   evals this month? " } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ q: "agent evals this month?", stories: 4 });
    expect(svc.ask.ask).toHaveBeenCalledWith("agent evals this month?");
    for (const body of [{}, { q: "hi" }, { q: "x".repeat(301) }, { q: 42 }]) {
      expect((await call("POST", "/ask", { body })).status).toBe(400);
    }
    expect((await call("GET", "/ask")).status).toBe(405);
  });

  it("serves an issue's stories", async () => {
    const { call, repo } = setup();
    const r = await call("GET", "/issues/abc123/stories");
    expect(r.status).toBe(200);
    expect(r.body.stories[0]).toMatchObject({ n: 1, headline: "A model ships" });
    expect(repo.stories).toHaveBeenCalledWith("abc123");
    expect((await call("POST", "/issues/abc123/stories")).status).toBe(405);
  });

  it("searches, best match first unless newest is asked for (#53)", async () => {
    const { call, svc } = setup();
    const r = await call("GET", "/search", { query: { q: "  Kafka " } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ q: "Kafka", items: [{ id: "abc123", match: "words" }] });
    expect(svc.search.search).toHaveBeenCalledWith("Kafka", "best");
    await call("GET", "/search", { query: { q: "kafka", sort: "newest" } });
    expect(svc.search.search).toHaveBeenLastCalledWith("kafka", "newest");
  });

  it.each([
    [{}, "q must be"],
    [{ q: "   " }, "q must be"],
    [{ q: "x".repeat(201) }, "q must be"],
    [{ q: "kafka", sort: "oldest" }, "sort must be"],
  ])("rejects a bad search %o", async (query, msg) => {
    const { call } = setup();
    const r = await call("GET", "/search", { query: query as Record<string, string> });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain(msg);
  });

  it("PATCH state validates the body", async () => {
    const { call, repo } = setup();
    expect((await call("PATCH", "/issues/abc123", { body: { state: "read" } })).body.state).toBe(
      "read",
    );
    expect(repo.setState).toHaveBeenCalledWith("abc123", "read");
    expect((await call("PATCH", "/issues/abc123", { body: { state: "filtered" } })).status).toBe(
      400,
    );
    expect((await call("PATCH", "/issues/abc123", { body: "{not json" })).status).toBe(400);
    expect((await call("PATCH", "/issues/abc123")).status).toBe(400);
    expect((await call("PATCH", "/issues/abc123", { body: {} })).status).toBe(400);
  });

  it("PATCH shelf moves an issue; a bad shelf is a 400", async () => {
    const { call, repo } = setup();
    const moved = await call("PATCH", "/issues/abc123", { body: { shelf: "learning" } });
    expect(moved.body.shelf).toBe("learning");
    expect(repo.setShelf).toHaveBeenCalledWith("abc123", "learning");
    expect(repo.setState).not.toHaveBeenCalled();
    expect((await call("PATCH", "/issues/abc123", { body: { shelf: "later" } })).status).toBe(400);
  });

  it("PATCH saved saves or unsaves an issue; anything but a boolean is a 400", async () => {
    const { call, repo } = setup();
    const saved = await call("PATCH", "/issues/abc123", { body: { saved: true } });
    expect(saved.status).toBe(200);
    expect(saved.body.savedAt).toBe("2026-10-10T10:00:00.000Z");
    expect(repo.setSaved).toHaveBeenCalledWith("abc123", true);
    await call("PATCH", "/issues/abc123", { body: { saved: false } });
    expect(repo.setSaved).toHaveBeenLastCalledWith("abc123", false);
    expect(repo.setState).not.toHaveBeenCalled();
    expect((await call("PATCH", "/issues/abc123", { body: { saved: "yes" } })).status).toBe(400);
  });

  it("lists the Saved view", async () => {
    const { call, repo } = setup();
    expect((await call("GET", "/issues", { query: { view: "saved" } })).status).toBe(200);
    expect(repo.listIssues).toHaveBeenCalledWith("saved", expect.objectContaining({ limit: 30 }));
    expect((await call("GET", "/issues", { query: { view: "later" } })).status).toBe(400);
  });

  it("serves the topic list", async () => {
    const res = await setup().call("GET", "/topics");
    expect(res.status).toBe(200);
    expect(res.body.topics).toEqual([{ name: "AI", description: "Models and tools" }]);
  });

  it("rating accepts 1, -1 and 0 only", async () => {
    const { call, repo } = setup();
    for (const value of [1, -1, 0]) {
      expect((await call("POST", "/issues/abc123/rating", { body: { value } })).status).toBe(200);
    }
    expect(repo.setRating).toHaveBeenCalledTimes(3);
    expect((await call("POST", "/issues/abc123/rating", { body: { value: 2 } })).status).toBe(400);
    expect((await call("POST", "/issues/abc123/rating", { body: { value: "1" } })).status).toBe(
      400,
    );
  });

  it("events: an open or a peek, 204", async () => {
    const { call, repo } = setup();
    expect((await call("POST", "/issues/abc123/events", { body: { type: "open" } })).status).toBe(
      204,
    );
    expect((await call("POST", "/issues/abc123/events", { body: { type: "peek" } })).status).toBe(
      204,
    );
    expect(repo.logOpen).toHaveBeenCalledTimes(1);
    expect(repo.logPeek).toHaveBeenCalledWith("abc123");
    expect((await call("POST", "/issues/abc123/events", { body: { type: "dwell" } })).status).toBe(
      400,
    );
  });

  it("now reading: serves the issue to come back to and saves the place", async () => {
    const { call, repo } = setup();
    const r = await call("GET", "/now-reading");
    expect(r.status).toBe(200);
    expect(r.body.nowReading).toMatchObject({ issue: { id: "abc123" }, position: 0.4 });

    const put = (body: unknown) => call("PUT", "/now-reading", { body });
    expect((await put({ id: "abc123", position: 0.25 })).status).toBe(204);
    expect(repo.savePosition).toHaveBeenCalledWith("abc123", 0.25);
    expect((await put({ id: "abc123", position: 1 })).status).toBe(204);
    expect((await put({ id: "abc123", position: 0 })).status).toBe(204);
    for (const bad of [
      { id: "abc123", position: 1.5 },
      { id: "abc123", position: -0.1 },
      { id: "abc123", position: "0.5" },
      { id: "abc123" },
      { id: "../etc", position: 0.5 },
      { position: 0.5 },
    ]) {
      expect((await put(bad)).status).toBe(400);
    }
    expect((await call("POST", "/now-reading", { body: { id: "abc123" } })).status).toBe(405);
  });

  it("senders: list, detail, mute, star", async () => {
    const { call, repo } = setup();
    expect((await call("GET", "/senders")).body.items).toHaveLength(1);
    expect((await call("GET", "/senders/s0123456789ab")).body.issues).toHaveLength(1);
    expect(
      (await call("PATCH", "/senders/s0123456789ab", { body: { muted: true } })).body.muted,
    ).toBe(true);
    expect(repo.updateSender).toHaveBeenCalledWith("s0123456789ab", { muted: true });
    const starred = await call("PATCH", "/senders/s0123456789ab", { body: { mustRead: false } });
    expect(starred.body.mustRead).toBe(false);
    expect(repo.updateSender).toHaveBeenLastCalledWith("s0123456789ab", { mustRead: false });
  });

  it("PATCH sender validates the body", async () => {
    const { call, repo } = setup();
    const patch = (body: unknown) => call("PATCH", "/senders/s0123456789ab", { body });
    expect((await patch({ muted: "yes" })).status).toBe(400);
    expect((await patch({ mustRead: 1 })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ other: true })).status).toBe(400);
    expect((await patch({ shelf: "later" })).status).toBe(400);
    expect(repo.updateSender).not.toHaveBeenCalled();
  });

  it("PATCH sender sets or clears its shelf", async () => {
    const { call, repo } = setup();
    const patch = (body: unknown) => call("PATCH", "/senders/s0123456789ab", { body });
    expect((await patch({ shelf: "learning" })).status).toBe(200);
    expect(repo.updateSender).toHaveBeenLastCalledWith("s0123456789ab", { shelf: "learning" });
    expect((await patch({ shelf: null })).status).toBe(200);
    expect(repo.updateSender).toHaveBeenLastCalledWith("s0123456789ab", { shelf: null });
  });

  it("ingest starts a run and returns 202; status returns 200", async () => {
    const { call, svc } = setup();
    expect((await call("POST", "/ingest")).status).toBe(202);
    expect(svc.startIngest).toHaveBeenCalledOnce();
    expect((await call("GET", "/status")).body.stage).toBe("test");
  });

  it("unknown paths 404, wrong methods 405, malformed ids 404", async () => {
    const { call } = setup();
    expect((await call("GET", "/nope")).status).toBe(404);
    expect((await call("DELETE", "/issues/abc123")).status).toBe(405);
    expect((await call("GET", "/issues/has.dot")).status).toBe(404);
    expect((await call("GET", "/senders/bytebytego@substack.com")).status).toBe(404);
  });
});

describe("error mapping", () => {
  it("maps not found and conflicts from the repo", async () => {
    const { call } = setup({
      getIssue: async () => {
        throw notFound("issue not found");
      },
      setRating: async () => {
        throw conflict();
      },
    });
    expect((await call("GET", "/issues/abc123")).status).toBe(404);
    expect((await call("POST", "/issues/abc123/rating", { body: { value: 1 } })).status).toBe(409);
  });

  it("hides unexpected errors behind a 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { call } = setup({
      status: async () => {
        throw new Error("secret detail");
      },
    });
    const res = await call("GET", "/status");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret");
    spy.mockRestore();
  });
});
