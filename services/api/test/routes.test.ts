import { describe, expect, it, vi } from "vitest";
import type { IssueListItem, SenderListItem } from "@library/core/types";
import { conflict, notFound } from "../src/errors.js";
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
    getIssue: vi.fn(async () => ({ ...issue, fromAddr: "a@b.c", html: "<p>x</p>" })),
    setState: vi.fn(async (_id, state) => ({ ...issue, state })),
    setShelf: vi.fn(async (_id, shelf) => ({ ...issue, shelf })),
    listTopics: vi.fn(async () => [{ name: "AI", description: "Models and tools" }]),
    setRating: vi.fn(async (_id, value) => ({ ...issue, rating: value === 0 ? undefined : value })),
    logOpen: vi.fn(async () => undefined),
    listSenders: vi.fn(async () => [sender]),
    getSender: vi.fn(async () => ({ ...sender, addresses: [], issues: [issue] })),
    updateSender: vi.fn(async (_id, patch) => ({ ...sender, ...patch })),
    status: vi.fn(async () => ({ stage: "test", lastError: null })),
    ...overrides,
  };
  const svc: Services = { repo, startIngest: vi.fn(async () => undefined) };
  const handler = createHandler(svc);
  const call = async (
    method: string,
    path: string,
    opts: { query?: Record<string, string>; body?: unknown } = {},
  ) => {
    const res = (await handler({
      rawPath: `/thelibrary/api${path}`,
      queryStringParameters: opts.query,
      body:
        opts.body === undefined
          ? undefined
          : typeof opts.body === "string"
            ? opts.body
            : JSON.stringify(opts.body),
      isBase64Encoded: false,
      requestContext: { http: { method } },
    } as never)) as { statusCode: number; body: string; headers: Record<string, string> };
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : undefined,
      headers: res.headers,
    };
  };
  return { repo, svc, call };
}

describe("routing and validation", () => {
  it("lists unread by default with a 30-item page", async () => {
    const { repo, call } = setup();
    const res = await call("GET", "/issues");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(repo.listIssues).toHaveBeenCalledWith("unread", {
      limit: 30,
      cursor: undefined,
      senderId: undefined,
      shelf: undefined,
      topic: undefined,
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
      senderId: "s0123456789ab",
      shelf: "learning",
      topic: "AI",
    });
  });

  it.each([
    [{ view: "starred" }, "view must be"],
    [{ limit: "0" }, "limit must be"],
    [{ limit: "101" }, "limit must be"],
    [{ limit: "2.5" }, "limit must be"],
    [{ sender: "bytebytego@substack.com" }, "sender is not"],
    [{ shelf: "opinion" }, "shelf must be"],
    [{ topic: "x".repeat(61) }, "topic must be"],
  ])("rejects bad list query %o", async (query, msg) => {
    const res = await setup().call("GET", "/issues", { query });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(msg);
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

  it("events: open only, 204", async () => {
    const { call } = setup();
    expect((await call("POST", "/issues/abc123/events", { body: { type: "open" } })).status).toBe(
      204,
    );
    expect((await call("POST", "/issues/abc123/events", { body: { type: "dwell" } })).status).toBe(
      400,
    );
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
