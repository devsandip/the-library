/**
 * Integration: the deployed dev API Lambda, invoked directly with a crafted HTTP API event
 * (the JWT authorizer only exists in prod; its 401 is checked by scripts/check-hosting.sh).
 * Run with `pnpm test:int`.
 */
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import {
  embeddingKey,
  eventKey,
  followKey,
  INTERESTS_KEY,
  issueIndexAttributes,
  issueKey,
  NARRATIVE_KEY,
  openIndexAttributes,
  readerDay,
  senderIdentity,
  shelfFor,
  storyIndexAttributes,
  storyKey,
  sourceKey,
  sourceRunKey,
  predictionKey,
  senderIndexAttributes,
  senderItemKey,
  storyRef,
  takesKey,
  timelineKey,
  TOPICS_KEY,
  TUNEUP_KEY,
  vectorBytes,
} from "@library/core";
import type {
  AuditResponse,
  Prediction,
  PredictionsResponse,
  AskResponse,
  Follow,
  FollowingResponse,
  SourceResponse,
  TakesResponse,
  LearningListResponse,
  HistoryResponse,
  IssueDetailResponse,
  IssueListItem,
  IssueListResponse,
  IssueStoriesResponse,
  NowReadingResponse,
  RelatedResponse,
  SearchResponse,
  SenderDetailResponse,
  SenderListResponse,
  StatusResponse,
  SummaryResponse,
  TimelineResponse,
  TopicListResponse,
  TuneupResponse,
  UnreadCountsResponse,
} from "@library/core/types";
import {
  docClient,
  devStack,
  seedDev,
  wipeDevTable,
  FIXTURE_NEWSLETTER_IDS,
  type DevStack,
} from "../../../scripts/dev-stack.js";
import { TitanEmbedder } from "../src/embed.js";

let stack: DevStack;
const lambda = new LambdaClient({ region: "us-east-1" });
const BBG = senderIdentity("bytebytego@substack.com", "").senderId;

async function call<T = unknown>(
  method: string,
  path: string,
  opts: { query?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const event = {
    version: "2.0",
    rawPath: `/nutgraf/api${path}`,
    rawQueryString: new URLSearchParams(opts.query).toString(),
    queryStringParameters: opts.query,
    headers: { "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: {
      http: { method, path: `/nutgraf/api${path}` },
      authorizer: { jwt: { claims: { sub: "int-test" }, scopes: [] } },
    },
  };
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: stack.apiFunction,
      Payload: Buffer.from(JSON.stringify(event)),
    }),
  );
  if (res.FunctionError) throw new Error(`Lambda error: ${Buffer.from(res.Payload!).toString()}`);
  const out = JSON.parse(Buffer.from(res.Payload!).toString()) as {
    statusCode: number;
    body: string;
  };
  return { status: out.statusCode, body: (out.body ? JSON.parse(out.body) : undefined) as T };
}

/** GSIs are eventually consistent: retry a read until it matches. */
async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i < 20; i++) {
    last = await read();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  return last as T;
}

/** A source check runs in the jobs Lambda (#23): read it until it is no longer running. */
async function sourceSettled(path: string): Promise<SourceResponse> {
  for (let i = 0; i < 45; i++) {
    const res = await call<SourceResponse>("GET", path);
    if (!res.body.running) return res.body;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${path} still running after 90 seconds`);
}

const ids = (r: { body: IssueListResponse }) => r.body.items.map((i) => i.id);
const ddb = docClient();
const getItem = (id: string) =>
  ddb
    .send(new GetCommand({ TableName: stack.tableName, Key: issueKey(id), ConsistentRead: true }))
    .then((r) => r.Item);

/** Claude's call on an issue, written the way enrichment writes it. */
const setSorted = (id: string, shelf: string, topic: string) =>
  ddb.send(
    new UpdateCommand({
      TableName: stack.tableName,
      Key: issueKey(id),
      UpdateExpression: "SET shelf = :s, shelfAuto = :s, shelfSetBy = :by, topic = :t",
      ExpressionAttributeValues: { ":s": shelf, ":by": "claude", ":t": topic },
    }),
  );

beforeAll(async () => {
  stack = await devStack();
  if (!stack.apiFunction) throw new Error("dev stack has no ApiFunction output; deploy it");
  await wipeDevTable(stack);
  await seedDev(stack);
  await eventually(
    () => call<IssueListResponse>("GET", "/issues"),
    (r) => r.body.items.length === 6,
  );
});

describe("API on dev", () => {
  it("lists unread newest first", async () => {
    const r = await call<IssueListResponse>("GET", "/issues");
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual(FIXTURE_NEWSLETTER_IDS);
    expect(r.body.cursor).toBeUndefined();
  });

  it("pages with cursors, no gaps or repeats; rejects a forged cursor", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const r = await call<IssueListResponse>("GET", "/issues", {
        query: { view: "all", limit: "4", ...(cursor ? { cursor } : {}) },
      });
      seen.push(...ids(r));
      cursor = r.body.cursor;
      pages++;
    } while (cursor && pages < 10);
    expect(seen).toEqual(FIXTURE_NEWSLETTER_IDS);
    expect(pages).toBe(2);

    const forged = Buffer.from(
      JSON.stringify({ pk: "x", sk: "y", gsi1pk: "ARCHIVE", gsi1sk: "z" }),
    ).toString("base64url");
    expect((await call("GET", "/issues", { query: { view: "all", cursor: forged } })).status).toBe(
      400,
    );
    expect((await call("GET", "/issues", { query: { cursor: "not-base64-json" } })).status).toBe(
      400,
    );
  });

  it("moves issues between views on state changes", async () => {
    expect((await call("PATCH", "/issues/fx-tldr", { body: { state: "read" } })).status).toBe(200);
    expect((await call("PATCH", "/issues/fx-lenny", { body: { state: "archived" } })).status).toBe(
      200,
    );

    const unread = await eventually(
      () => call<IssueListResponse>("GET", "/issues"),
      (r) => r.body.items.length === 4,
    );
    expect(ids(unread)).not.toContain("fx-tldr");
    const all = await eventually(
      () => call<IssueListResponse>("GET", "/issues", { query: { view: "all" } }),
      (r) => r.body.items.length === 5,
    );
    expect(ids(all)).toContain("fx-tldr");
    expect(ids(all)).not.toContain("fx-lenny");
    const archived = await eventually(
      () => call<IssueListResponse>("GET", "/issues", { query: { view: "archived" } }),
      (r) => r.body.items.length === 1,
    );
    expect(ids(archived)).toEqual(["fx-lenny"]);

    await call("PATCH", "/issues/fx-tldr", { body: { state: "unread" } });
    await call("PATCH", "/issues/fx-lenny", { body: { state: "unread" } });
    await eventually(
      () => call<IssueListResponse>("GET", "/issues"),
      (r) => r.body.items.length === 6,
    );
  });

  it("ratings move sender counts by the delta and can be cleared", async () => {
    const sender = () => call<SenderDetailResponse>("GET", `/senders/${BBG}`);
    expect(
      (await call("POST", "/issues/fx-bytebytego/rating", { body: { value: 1 } })).body,
    ).toMatchObject({ rating: 1 });
    expect((await sender()).body).toMatchObject({ up: 1, down: 0 });
    await call("POST", "/issues/fx-bytebytego/rating", { body: { value: -1 } });
    expect((await sender()).body).toMatchObject({ up: 0, down: 1 });
    const cleared = await call<{ rating?: number }>("POST", "/issues/fx-bytebytego/rating", {
      body: { value: 0 },
    });
    expect(cleared.body.rating).toBeUndefined();
    expect((await sender()).body).toMatchObject({ up: 0, down: 0 });
  });

  it("muting hides a sender from home views but not from its own page", async () => {
    expect((await call("PATCH", `/senders/${BBG}`, { body: { muted: true } })).body).toMatchObject({
      muted: true,
    });
    const unread = await call<IssueListResponse>("GET", "/issues");
    expect(ids(unread)).not.toContain("fx-bytebytego");
    expect(unread.body.items).toHaveLength(5);
    const own = await call<IssueListResponse>("GET", "/issues", { query: { sender: BBG } });
    expect(ids(own)).toEqual(["fx-bytebytego"]);
    await call("PATCH", `/senders/${BBG}`, { body: { muted: false } });
    expect((await call<IssueListResponse>("GET", "/issues")).body.items).toHaveLength(6);
  });

  it("Must Read: starred newsletters' unread issues come first, marked, across pages", async () => {
    const PRAG = senderIdentity("pragmaticengineer@substack.com", "").senderId;
    const CASEY = senderIdentity("casey@platformer.news", "").senderId;
    const star = (id: string, mustRead: boolean) =>
      call<SenderListResponse["items"][number]>("PATCH", `/senders/${id}`, { body: { mustRead } });
    expect((await star(PRAG, true)).body).toMatchObject({ mustRead: true });
    await star(CASEY, true);

    const expected = [
      "fx-platformer",
      "fx-pragmatic",
      "fx-bytebytego",
      "fx-tldr",
      "fx-lenny",
      "fx-example",
    ];
    const unread = await call<IssueListResponse>("GET", "/issues");
    expect(ids(unread)).toEqual(expected);
    expect(unread.body.items.filter((i) => i.mustRead).map((i) => i.id)).toEqual([
      "fx-platformer",
      "fx-pragmatic",
    ]);

    // Paging crosses from Must Read into everything else with no gaps or repeats.
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const r = await call<IssueListResponse>("GET", "/issues", {
        query: { limit: "2", ...(cursor ? { cursor } : {}) },
      });
      seen.push(...ids(r));
      cursor = r.body.cursor;
      pages++;
    } while (cursor && pages < 10);
    expect(seen).toEqual(expected);
    expect(pages).toBe(3);

    // Other views mark starred issues but keep their order.
    const all = await call<IssueListResponse>("GET", "/issues", { query: { view: "all" } });
    expect(ids(all)).toEqual(FIXTURE_NEWSLETTER_IDS);
    expect(all.body.items.find((i) => i.id === "fx-pragmatic")?.mustRead).toBe(true);

    // Muting wins over the star.
    await call("PATCH", `/senders/${PRAG}`, { body: { muted: true } });
    expect(ids(await call<IssueListResponse>("GET", "/issues"))).toEqual(
      expected.filter((id) => id !== "fx-pragmatic"),
    );

    await call("PATCH", `/senders/${PRAG}`, { body: { muted: false, mustRead: false } });
    await star(CASEY, false);
    expect(ids(await call<IssueListResponse>("GET", "/issues"))).toEqual(FIXTURE_NEWSLETTER_IDS);
  });

  it("shelves: News holds news and unsorted issues, Learning only learning; topics narrow", async () => {
    await setSorted("fx-bytebytego", "learning", "Engineering");
    await setSorted("fx-pragmatic", "learning", "Engineering");
    await setSorted("fx-tldr", "news", "AI");
    // The lists read GSIs, which lag the writes above: wait for each to show them.
    const shelf = async (q: Record<string, string>, want: string[]) =>
      expect(
        ids(
          await eventually(
            () => call<IssueListResponse>("GET", "/issues", { query: q }),
            (r) => ids(r).join() === want.join(),
          ),
        ),
      ).toEqual(want);
    await shelf({ shelf: "learning" }, ["fx-bytebytego", "fx-pragmatic"]);
    await shelf({ shelf: "news" }, ["fx-platformer", "fx-tldr", "fx-lenny", "fx-example"]);
    await shelf({ shelf: "news", topic: "AI" }, ["fx-tldr"]);
    await shelf({ shelf: "learning", view: "all", topic: "Engineering" }, [
      "fx-bytebytego",
      "fx-pragmatic",
    ]);
  });

  it("a moved issue keeps its shelf; a sender's 'always' shelf moves the rest", async () => {
    const LENNY = senderIdentity("lenny@substack.com", "").senderId;
    const PRAG = senderIdentity("pragmaticengineer@substack.com", "").senderId;
    const learning = () =>
      call<IssueListResponse>("GET", "/issues", { query: { shelf: "learning" } }).then(ids);

    const moved = await call("PATCH", "/issues/fx-pragmatic", { body: { shelf: "news" } });
    expect(moved.body).toMatchObject({ shelf: "news" });
    expect(await getItem("fx-pragmatic")).toMatchObject({ shelfSetBy: "sandip" });

    expect(
      (await call("PATCH", `/senders/${LENNY}`, { body: { shelf: "learning" } })).body,
    ).toMatchObject({ shelf: "learning" });
    expect(await learning()).toEqual(["fx-bytebytego", "fx-lenny"]);

    // Sandip's own move beats the sender setting.
    await call("PATCH", `/senders/${PRAG}`, { body: { shelf: "learning" } });
    expect((await getItem("fx-pragmatic"))?.shelf).toBe("news");

    // Clearing the setting hands issues back to Claude: unsorted here, so back under News.
    await call("PATCH", `/senders/${LENNY}`, { body: { shelf: null } });
    expect((await getItem("fx-lenny"))?.shelf).toBeUndefined();
    expect(
      (await call<SenderDetailResponse>("GET", `/senders/${LENNY}`)).body.shelf,
    ).toBeUndefined();
    await call("PATCH", `/senders/${PRAG}`, { body: { shelf: null } });
  });

  it("serves the topic list Claude proposed", async () => {
    const topics = [{ name: "AI", description: "Models and tools" }];
    await ddb.send(new PutCommand({ TableName: stack.tableName, Item: { ...TOPICS_KEY, topics } }));
    expect((await call<TopicListResponse>("GET", "/topics")).body.topics).toEqual(topics);
  });

  it("serves issue detail with sanitized HTML; filtered and unknown ids are 404", async () => {
    const r = await call<IssueDetailResponse>("GET", "/issues/fx-bytebytego");
    expect(r.status).toBe(200);
    expect(r.body.html).toContain("diagram.png");
    expect(r.body.html).not.toContain("<script");
    expect(r.body.unsubscribeUrl).toContain("bytebytego.substack.com");
    expect((await call("GET", "/issues/fx-github")).status).toBe(404);
    expect((await call("GET", "/issues/does-not-exist")).status).toBe(404);
  });

  it("lists senders and logs opens", async () => {
    const senders = await call<SenderListResponse>("GET", "/senders");
    expect(senders.body.items).toHaveLength(6);
    expect(
      (await call("POST", "/issues/fx-platformer/events", { body: { type: "open" } })).status,
    ).toBe(204);
  });

  it("reports status and accepts a refresh request", async () => {
    expect((await call<StatusResponse>("GET", "/status")).body.stage).toBe("dev");
    expect((await call("POST", "/ingest")).status).toBe(202);
  });

  it("several senders or topics mean any of them; a picked sender shows even when muted", async () => {
    const LENNY = senderIdentity("lenny@substack.com", "").senderId;
    for (const id of FIXTURE_NEWSLETTER_IDS) {
      await call("PATCH", `/issues/${id}`, { body: { state: "unread" } });
    }
    const list = (q: Record<string, string>) =>
      call<IssueListResponse>("GET", "/issues", { query: q }).then(ids);
    expect(
      await eventually(
        () => list({ sender: `${BBG},${LENNY}` }),
        (r) => r.length === 2,
      ),
    ).toEqual(["fx-bytebytego", "fx-lenny"]);

    await call("PATCH", `/senders/${LENNY}`, { body: { muted: true } });
    expect(await list({ sender: `${BBG},${LENNY}`, view: "all" })).toEqual([
      "fx-bytebytego",
      "fx-lenny",
    ]);
    expect(await list({})).not.toContain("fx-lenny");
    await call("PATCH", `/senders/${LENNY}`, { body: { muted: false } });

    await setSorted("fx-platformer", "news", "Business");
    await setSorted("fx-tldr", "news", "AI");
    expect(await list({ shelf: "news", topic: "AI,Business" })).toEqual([
      "fx-platformer",
      "fx-tldr",
    ]);
  });

  it("counts unread issues by sender, shelf and topic", async () => {
    const r = await eventually(
      () => call<UnreadCountsResponse>("GET", "/unread-counts"),
      (x) => x.body.counts.reduce((n, c) => n + c.n, 0) === 6,
    );
    expect(r.status).toBe(200);
    const tldr = (await getItem("fx-tldr"))!.senderId as string;
    expect(r.body.counts).toContainEqual({ senderId: tldr, shelf: "news", topic: "AI", n: 1 });
  });

  it("summary: unread News from the last two weeks, a reason on each, Must Read marked", async () => {
    const CASEY = senderIdentity("casey@platformer.news", "").senderId;
    // Fixture dates are fixed (2026-10-01), so set the ages this test depends on.
    const age = async (id: string, hours: number) => {
      const item = (await getItem(id))!;
      const receivedAt = new Date(Date.now() - hours * 3_600_000).toISOString();
      const idx = issueIndexAttributes({
        id,
        senderId: item.senderId as string,
        receivedAt,
        state: "unread",
      });
      const set: Record<string, string> = { receivedAt, ...idx.set };
      const keys = Object.keys(set);
      await ddb.send(
        new UpdateCommand({
          TableName: stack.tableName,
          Key: issueKey(id),
          UpdateExpression: `SET ${keys.map((_, i) => `#a${i} = :a${i}`).join(", ")}`,
          ExpressionAttributeNames: Object.fromEntries(keys.map((k, i) => [`#a${i}`, k])),
          ExpressionAttributeValues: Object.fromEntries(keys.map((k, i) => [`:a${i}`, set[k]])),
        }),
      );
    };
    await age("fx-platformer", 2);
    await age("fx-tldr", 5);
    await age("fx-lenny", 30);
    await age("fx-pragmatic", 50);
    await age("fx-example", 20 * 24); // outside the window
    // Interests and two embeddings, so the vector path runs end to end.
    const axis = (i: number) => {
      const v = new Float32Array(512);
      v[i] = 1;
      return new Uint8Array(v.buffer);
    };
    await ddb.send(
      new PutCommand({
        TableName: stack.tableName,
        Item: {
          ...INTERESTS_KEY,
          interests: ["tech", "startups", "AI", "product", "systems"].map((name, i) => ({
            name,
            text: name,
            vector: axis(i),
          })),
        },
      }),
    );
    for (const [id, i] of [
      ["fx-tldr", 2],
      ["fx-lenny", 3],
    ] as const) {
      await ddb.send(
        new PutCommand({
          TableName: stack.tableName,
          Item: { ...embeddingKey(id), vector: axis(i) },
        }),
      );
    }
    await call("PATCH", `/senders/${CASEY}`, { body: { mustRead: true } });

    const r = await eventually(
      () => call<SummaryResponse>("GET", "/summary"),
      (x) => x.body.candidates === 4,
    );
    expect(r.status).toBe(200);
    expect(r.body.items.map((i) => i.id).sort()).toEqual(
      ["fx-lenny", "fx-platformer", "fx-pragmatic", "fx-tldr"].sort(),
    );
    for (const i of r.body.items) expect(i.scoreReason?.length).toBeGreaterThan(0);
    expect(r.body.items.find((i) => i.id === "fx-platformer")?.mustRead).toBe(true);
    await call("PATCH", `/senders/${CASEY}`, { body: { mustRead: false } });

    // Today's digest is the top 5 as first shown, the same on every later call (#5).
    const digest = r.body.digest ?? [];
    expect(digest.length).toBeGreaterThan(0);
    expect(digest.length).toBeLessThanOrEqual(5);
    expect(r.body.digestAt).toMatch(/^\d{4}-/);
    const again = (await call<SummaryResponse>("GET", "/summary")).body;
    expect(again.digest).toEqual(digest);
    expect(again.digestAt).toBe(r.body.digestAt);
    await call("POST", `/issues/${digest[0]}/rating`, { body: { value: 1 } });
    const status = await call<StatusResponse>("GET", "/status");
    expect(status.body.digestStats).toEqual({
      days: 1,
      shown: digest.length,
      useful: 1,
      notUseful: 0,
    });
    await call("POST", `/issues/${digest[0]}/rating`, { body: { value: 0 } });

    // The day in brief (#18) comes along while it is less than a day old.
    expect(r.body.narrative).toBeUndefined();
    const thread = {
      title: "One thread",
      text: "What happened.",
      sources: [{ issueId: "fx-tldr", publication: "TLDR" }],
    };
    const putNarrative = (at: string) =>
      ddb.send(
        new PutCommand({
          TableName: stack.tableName,
          Item: {
            ...NARRATIVE_KEY,
            at,
            threads: [thread],
            stories: 9,
            newsletters: 3,
            storyKeys: ["fx-tldr#01"],
            model: "m",
          },
        }),
      );
    await putNarrative(new Date().toISOString());
    expect((await call<SummaryResponse>("GET", "/summary")).body.narrative).toMatchObject({
      threads: [thread],
      stories: 9,
      newsletters: 3,
    });
    await putNarrative(new Date(Date.now() - 25 * 3_600_000).toISOString());
    expect((await call<SummaryResponse>("GET", "/summary")).body.narrative).toBeUndefined();
  });

  it("related: the closest issue by topic, muted newsletters left out", async () => {
    const vector = (...pairs: [number, number][]) => {
      const v = new Float32Array(512);
      for (const [i, x] of pairs) v[i] = x;
      return new Uint8Array(v.buffer);
    };
    // fx-tldr and fx-lenny share axis 7; fx-pragmatic is elsewhere.
    for (const [id, v] of [
      ["fx-tldr", vector([7, 1], [1, 0.2])],
      ["fx-lenny", vector([7, 1], [2, 0.2])],
      ["fx-pragmatic", vector([9, 1])],
    ] as const) {
      await ddb.send(
        new PutCommand({ TableName: stack.tableName, Item: { ...embeddingKey(id), vector: v } }),
      );
    }
    const r = await call<RelatedResponse>("GET", "/issues/fx-tldr/related");
    expect(r.status).toBe(200);
    const found = [...r.body.earlier, ...r.body.since];
    expect(found.map((i) => i.id)).toEqual(["fx-lenny"]);
    expect(found[0]!.similarity).toBeGreaterThan(0.27);
    expect(found[0]!.publication.length).toBeGreaterThan(0);

    const LENNY = (await getItem("fx-lenny"))!.senderId as string;
    await call("PATCH", `/senders/${LENNY}`, { body: { muted: true } });
    const muted = await call<RelatedResponse>("GET", "/issues/fx-tldr/related");
    expect([...muted.body.earlier, ...muted.body.since]).toEqual([]);
    await call("PATCH", `/senders/${LENNY}`, { body: { muted: false } });
  });
  it("history: issues read on a day, latest first and once each, with the days around it", async () => {
    for (const id of ["fx-lenny", "fx-tldr", "fx-lenny"]) {
      expect((await call("POST", `/issues/${id}/events`, { body: { type: "open" } })).status).toBe(
        204,
      );
    }
    const today = readerDay(Date.now());
    const r = await eventually(
      () => call<HistoryResponse>("GET", "/history"),
      (x) => x.body.items[0]?.id === "fx-lenny",
    );
    expect(r.status).toBe(200);
    expect(r.body.day).toBe(today);
    const ids = r.body.items.map((i) => i.id);
    expect(ids.slice(0, 2)).toEqual(["fx-lenny", "fx-tldr"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.body.items[0]?.openedAt).toMatch(/^\d{4}-/);
    expect(r.body.items[0]?.via).toBe("open");
    expect(r.body.nextDay).toBeUndefined();

    // A peek left open is a read too (#56): the issue joins the day, and Now reading stays put.
    const reading = (await call<NowReadingResponse>("GET", "/now-reading")).body;
    const peek = (id: string) => call("POST", `/issues/${id}/events`, { body: { type: "peek" } });
    expect((await peek("fx-bytebytego")).status).toBe(204);
    const peeked = await eventually(
      () => call<HistoryResponse>("GET", "/history"),
      (x) => x.body.items[0]?.id === "fx-bytebytego",
    );
    expect(peeked.body.items.map((i) => i.id).slice(0, 3)).toEqual([
      "fx-bytebytego",
      "fx-lenny",
      "fx-tldr",
    ]);
    // History tells a peek from an open (the redesign's "Read" and "Opened").
    expect(peeked.body.items[0]?.via).toBe("peek");
    expect((await call<NowReadingResponse>("GET", "/now-reading")).body).toEqual(reading);
    expect((await peek("does-not-exist")).status).toBe(404);

    // An open two days ago, stored the way the API stores one, makes that day the previous one.
    const at = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await ddb.send(
      new PutCommand({
        TableName: stack.tableName,
        Item: {
          ...eventKey("fx-pragmatic", at, "inttest1"),
          type: "open",
          ...openIndexAttributes("fx-pragmatic", at),
        },
      }),
    );
    const earlierDay = readerDay(Date.parse(at));
    const again = await eventually(
      () => call<HistoryResponse>("GET", "/history"),
      (x) => x.body.previousDay === earlierDay,
    );
    expect(again.body.previousDay).toBe(earlierDay);
    const earlier = await call<HistoryResponse>("GET", "/history", { query: { day: earlierDay } });
    expect(earlier.body.items.map((i) => i.id)).toEqual(["fx-pragmatic"]);
    expect(earlier.body.nextDay).toBe(today);
    expect((await call("GET", "/history", { query: { day: "2026-02-30" } })).status).toBe(400);

    // Opened, then found to be account mail and filtered (#50): no longer in the history.
    const setState = (state: string) =>
      ddb.send(
        new UpdateCommand({
          TableName: stack.tableName,
          Key: issueKey("fx-pragmatic"),
          UpdateExpression: "SET #st = :s",
          ExpressionAttributeNames: { "#st": "state" },
          ExpressionAttributeValues: { ":s": state },
        }),
      );
    await setState("filtered");
    const gone = await call<HistoryResponse>("GET", "/history", { query: { day: earlierDay } });
    expect(gone.body.items).toEqual([]);
    await setState("unread");
  });

  it("search: by words, by meaning, and the story inside a digest (#53)", async () => {
    // Two stories in the TLDR fixture, embedded by Titan the way ingest embeds them.
    const titan = new TitanEmbedder();
    const tldr = (await getItem("fx-tldr"))!;
    const putStory = async (n: number, headline: string, summary: string, names: string[]) => {
      const vector = await titan.embed([headline, summary, names.join(", ")].join("\n\n"));
      await ddb.send(
        new PutCommand({
          TableName: stack.tableName,
          Item: {
            ...storyKey("fx-tldr", n),
            id: "fx-tldr",
            n,
            senderId: tldr.senderId,
            receivedAt: tldr.receivedAt,
            headline,
            summary,
            names,
            vector: vectorBytes(vector),
            dims: vector.length,
            gsi1pk: "STORIES",
            gsi1sk: `${tldr.receivedAt as string}#${storyRef("fx-tldr", n)}`,
          },
        }),
      );
    };
    await putStory(
      1,
      "OpenAI ships agents that book travel",
      "The new agents plan a trip, compare fares and book flights and hotels on their own.",
      ["OpenAI"],
    );
    await putStory(
      2,
      "Anthropic publishes interpretability research",
      "A paper traces how a model represents concepts inside its layers.",
      ["Anthropic"],
    );

    const words = await call<SearchResponse>("GET", "/search", {
      query: { q: "Discord messages" },
    });
    expect(words.status).toBe(200);
    expect(words.body.terms).toEqual(["discord", "messag"]);
    expect(words.body.items[0]).toMatchObject({ id: "fx-bytebytego" });
    expect(words.body.items[0]!.match).not.toBe("meaning");

    // No word in common with the story: found by meaning alone, and named on the row.
    const meaning = await call<SearchResponse>("GET", "/search", {
      query: { q: "AI assistants that arrange vacations" },
    });
    expect(meaning.body.byMeaning).toBe(true);
    expect(meaning.body.items).toContainEqual(
      expect.objectContaining({
        id: "fx-tldr",
        match: "meaning",
        story: { n: 1, headline: "OpenAI ships agents that book travel" },
      }),
    );

    const digest = await call<SearchResponse>("GET", "/search", {
      query: { q: "interpretability", sort: "newest" },
    });
    expect(digest.body.items[0]).toMatchObject({ id: "fx-tldr", story: { n: 2 } });
    expect((await call("GET", "/search")).status).toBe(400);
  });

  it("related: a digest's story finds its own relative, and the relative finds it (#20)", async () => {
    // fx-tldr holds the two stories the search test wrote; Lenny's issue gets one close to the first.
    const titan = new TitanEmbedder();
    const lenny = (await getItem("fx-lenny"))!;
    const headline = "OpenAI's new agents book flights and hotels for travellers";
    const vector = await titan.embed(
      [
        headline,
        "The agents plan trips, compare fares and make bookings on their own.",
        "OpenAI",
      ].join("\n\n"),
    );
    await ddb.send(
      new PutCommand({
        TableName: stack.tableName,
        Item: {
          ...storyKey("fx-lenny", 1),
          id: "fx-lenny",
          n: 1,
          senderId: lenny.senderId,
          receivedAt: lenny.receivedAt,
          headline,
          summary: "",
          names: ["OpenAI"],
          vector: vectorBytes(vector),
          dims: vector.length,
          gsi1pk: "STORIES",
          gsi1sk: `${lenny.receivedAt as string}#${storyRef("fx-lenny", 1)}`,
        },
      }),
    );
    try {
      const digest = await call<RelatedResponse>("GET", "/issues/fx-tldr/related");
      expect(digest.status).toBe(200);
      expect(digest.body.earlier).toEqual([]);
      expect(digest.body.since).toEqual([]);
      expect(digest.body.stories).toHaveLength(1);
      const [travel] = digest.body.stories!;
      expect(travel).toMatchObject({ n: 1, headline: "OpenAI ships agents that book travel" });
      const found = [...travel!.earlier, ...travel!.since];
      expect(found.map((i) => i.id)).toEqual(["fx-lenny"]);
      expect(found[0]!.similarity).toBeGreaterThanOrEqual(0.45);
      // Lenny's issue is one story: the issue itself, so its row names no story.
      expect(found[0]!.story).toBeUndefined();

      const single = await call<RelatedResponse>("GET", "/issues/fx-lenny/related");
      expect(single.body.stories).toBeUndefined();
      expect([...single.body.earlier, ...single.body.since]).toMatchObject([
        { id: "fx-tldr", story: { n: 1, headline: "OpenAI ships agents that book travel" } },
      ]);

      const TLDR = (await getItem("fx-tldr"))!.senderId as string;
      await call("PATCH", `/senders/${TLDR}`, { body: { muted: true } });
      const muted = await call<RelatedResponse>("GET", "/issues/fx-lenny/related");
      expect([...muted.body.earlier, ...muted.body.since]).toEqual([]);
      await call("PATCH", `/senders/${TLDR}`, { body: { muted: false } });
    } finally {
      await ddb.send(
        new DeleteCommand({ TableName: stack.tableName, Key: storyKey("fx-lenny", 1) }),
      );
    }
  });

  it("how this evolved: written only when asked, by Claude, and kept for the event (#19)", async () => {
    // fx-tldr's first story (the search test's) is the one being read. Three other newsletters
    // carry the steps around it, an hour apart: a preview, the launch, and the airlines' answer.
    const titan = new TitanEmbedder();
    const steps: [string, string, string, string?][] = [
      [
        "fx-pragmatic",
        "OpenAI previews a travel agent to a small group of testers",
        "Testers can ask the agent to plan a trip, but booking flights and hotels is not switched on yet.",
      ],
      [
        "fx-lenny",
        "OpenAI's new agents book flights and hotels for travellers",
        "The agents plan trips, compare fares and make bookings on their own.",
        storyRef("fx-tldr", 1),
      ],
      [
        "fx-platformer",
        "Airlines cut off OpenAI's booking agents over fare scraping",
        "Two airlines say the travel agents scrape their fares and have blocked them from booking.",
      ],
    ];
    for (const [id, headline, summary, eventId] of steps) {
      const issue = (await getItem(id))!;
      const vector = await titan.embed([headline, summary, "OpenAI"].join("\n\n"));
      await ddb.send(
        new PutCommand({
          TableName: stack.tableName,
          Item: {
            ...storyKey(id, 1),
            id,
            n: 1,
            senderId: issue.senderId,
            receivedAt: issue.receivedAt,
            headline,
            summary,
            names: ["OpenAI"],
            eventId: eventId ?? storyRef(id, 1),
            vector: vectorBytes(vector),
            dims: vector.length,
            gsi1pk: "STORIES",
            gsi1sk: `${issue.receivedAt as string}#${storyRef(id, 1)}`,
          },
        }),
      );
    }
    const path = "/issues/fx-tldr/stories/1/timeline";
    try {
      expect(await call("GET", path)).toEqual({ status: 200, body: {} });
      expect((await call("GET", "/issues/fx-tldr/stories/9/timeline")).status).toBe(404);

      const written = await call<TimelineResponse>("POST", path);
      expect(written.status).toBe(200);
      const t = written.body.timeline!;
      expect(t.points.length).toBeGreaterThanOrEqual(2);
      expect(t.points.map((p) => p.at)).toEqual(t.points.map((p) => p.at).sort());
      const sources = t.points.flatMap((p) => p.sources.map((s) => s.issueId));
      expect(new Set(sources)).toContain("fx-pragmatic");
      for (const id of sources) {
        expect(["fx-pragmatic", "fx-lenny", "fx-tldr", "fx-platformer"]).toContain(id);
      }
      const here = t.points.filter((p) => p.current);
      expect(here).toHaveLength(1);
      expect(here[0]!.sources.map((s) => s.issueId)).toContain("fx-tldr");
      expect(t.cents).toBeGreaterThan(0);

      // Kept: read back free, and from another story of the same event too.
      expect((await call<TimelineResponse>("GET", path)).body).toEqual({ timeline: t });
      const other = await call<TimelineResponse>("GET", "/issues/fx-lenny/stories/1/timeline");
      expect(other.body).toEqual({ timeline: t });
    } finally {
      await Promise.all([
        ...steps.map(([id]) =>
          ddb.send(new DeleteCommand({ TableName: stack.tableName, Key: storyKey(id, 1) })),
        ),
        ddb.send(
          new DeleteCommand({
            TableName: stack.tableName,
            Key: timelineKey(storyRef("fx-tldr", 1)),
          }),
        ),
      ]);
    }
  });

  it("now reading: the last issue opened, its place, and when it hides", async () => {
    const open = (id: string) => call("POST", `/issues/${id}/events`, { body: { type: "open" } });
    const save = (id: string, position: number) =>
      call("PUT", "/now-reading", { body: { id, position } });
    const current = async () => (await call<NowReadingResponse>("GET", "/now-reading")).body;
    const placeIn = async (id: string) =>
      (await call<IssueDetailResponse>("GET", `/issues/${id}`)).body.position;
    for (const id of ["fx-pragmatic", "fx-tldr"]) {
      await call("POST", `/issues/${id}/rating`, { body: { value: 0 } });
    }

    expect((await open("fx-pragmatic")).status).toBe(204);
    expect((await current()).nowReading).toMatchObject({
      issue: { id: "fx-pragmatic" },
      position: 0,
    });
    expect((await save("fx-pragmatic", 0.4)).status).toBe(204);
    expect((await current()).nowReading?.position).toBe(0.4);
    // The reader gets the place with the issue, and reopening keeps it.
    expect(await placeIn("fx-pragmatic")).toBe(0.4);
    await open("fx-pragmatic");
    expect((await current()).nowReading?.position).toBe(0.4);

    // Opening another issue moves Now reading there, from the top.
    await open("fx-lenny");
    expect((await current()).nowReading).toMatchObject({ issue: { id: "fx-lenny" }, position: 0 });
    expect(await placeIn("fx-pragmatic")).toBeUndefined();

    // A place saved in the first issue (an older window still open on it) moves it back.
    await save("fx-pragmatic", 0.5);
    expect((await current()).nowReading).toMatchObject({
      issue: { id: "fx-pragmatic" },
      position: 0.5,
    });
    // Finishing an issue Now reading does not point at leaves it alone.
    await save("fx-lenny", 1);
    expect((await current()).nowReading?.issue.id).toBe("fx-pragmatic");

    // Finished: nothing to come back to. Reopening starts from the top.
    await save("fx-pragmatic", 1);
    expect((await current()).nowReading).toBeUndefined();
    expect(await placeIn("fx-pragmatic")).toBeUndefined();
    await open("fx-pragmatic");
    expect((await current()).nowReading?.position).toBe(0);

    // Rated after it was opened, or archived: hidden.
    await call("POST", "/issues/fx-pragmatic/rating", { body: { value: 1 } });
    expect((await current()).nowReading).toBeUndefined();
    await open("fx-tldr");
    expect((await current()).nowReading?.issue.id).toBe("fx-tldr");
    await call("PATCH", "/issues/fx-tldr", { body: { state: "archived" } });
    expect((await current()).nowReading).toBeUndefined();

    expect((await save("does-not-exist", 0.5)).status).toBe(404);
    expect((await save("fx-tldr", 2)).status).toBe(400);
    await call("PATCH", "/issues/fx-tldr", { body: { state: "read" } });
    await call("POST", "/issues/fx-pragmatic/rating", { body: { value: 0 } });
  });

  it("saved: out of Unread and its counts, newest saved first; archiving takes it off", async () => {
    const patch = (id: string, body: unknown) =>
      call<IssueListItem>("PATCH", `/issues/${id}`, { body });
    const unread = async () =>
      ids(await call<IssueListResponse>("GET", "/issues", { query: { limit: "100" } }));
    const saved = () => call<IssueListResponse>("GET", "/issues", { query: { view: "saved" } });
    const counts = async () => (await call<UnreadCountsResponse>("GET", "/unread-counts")).body;
    const unreadTotal = (c: UnreadCountsResponse) => c.counts.reduce((n, x) => n + x.n, 0);

    const [a, b] = (await unread()).slice(0, 2);
    if (!a || !b) throw new Error("needs two unread issues");
    const before = await counts();
    expect(before.saved).toBe(0);

    expect((await patch(a, { saved: true })).body.savedAt).toMatch(/^\d{4}-/);
    await patch(b, { saved: true });
    // Newest saved first, out of Unread and its counts, and still in All.
    const list = await eventually(saved, (r) => r.body.items.length === 2);
    expect(ids(list)).toEqual([b, a]);
    expect(list.body.items[0]?.savedAt).toMatch(/^\d{4}-/);
    const left = await eventually(unread, (x) => !x.includes(a) && !x.includes(b));
    expect(left).not.toContain(a);
    const after = await eventually(counts, (c) => c.saved === 2);
    expect(unreadTotal(after)).toBe(unreadTotal(before) - 2);
    const all = await call<IssueListResponse>("GET", "/issues", {
      query: { view: "all", limit: "100" },
    });
    expect(ids(all)).toContain(a);

    // Reading keeps it saved; archiving takes it off the list, and an archived issue cannot be saved.
    expect((await patch(a, { state: "read" })).body.savedAt).toBeDefined();
    expect((await patch(b, { state: "archived" })).body.savedAt).toBeUndefined();
    expect(ids(await eventually(saved, (r) => r.body.items.length === 1))).toEqual([a]);
    expect((await patch(b, { saved: true })).status).toBe(400);

    // Unsaving a read issue takes it off the list without putting it back in Unread.
    await patch(a, { saved: false });
    expect((await eventually(saved, (r) => r.body.items.length === 0)).body.items).toEqual([]);
    expect(await unread()).not.toContain(a);

    await patch(a, { state: "unread" });
    await patch(b, { state: "unread" });
  });

  it("stories: an issue's stories in order, without their embeddings; none before a split", async () => {
    const put = (n: number, headline: string, link?: string, names: string[] = []) =>
      ddb.send(
        new PutCommand({
          TableName: stack.tableName,
          Item: {
            ...storyKey("fx-tldr", n),
            n,
            headline,
            summary: `What story ${n} says.`,
            names,
            ...(link ? { link } : {}),
            vector: new Uint8Array(8),
            eventId: `int${n}`,
          },
        }),
      );
    await put(2, "Second", "https://example.test/two", ["OpenAI", "IndiGo"]);
    await put(1, "First");
    const r = await call<IssueStoriesResponse>("GET", "/issues/fx-tldr/stories");
    expect(r.status).toBe(200);
    // Names come along when the story has any (the story sheet's names line).
    expect(r.body.stories).toEqual([
      { n: 1, headline: "First", summary: "What story 1 says." },
      {
        n: 2,
        headline: "Second",
        summary: "What story 2 says.",
        link: "https://example.test/two",
        names: ["OpenAI", "IndiGo"],
      },
    ]);
    expect((await call<IssueStoriesResponse>("GET", "/issues/fx-lenny/stories")).body).toEqual({
      stories: [],
    });
    expect((await call("GET", "/issues/does-not-exist/stories")).status).toBe(404);
  });

  it("moving a split issue moves its stories; a newsletter's setting re-shelves them (#81)", async () => {
    const BBG = senderIdentity("bytebytego@substack.com", "").senderId;
    const id = "fx-bytebytego";
    const receivedAt = (await getItem(id))!.receivedAt as string;
    const jevStory = (n: number, learning: number) => {
      const shelf = shelfFor(learning);
      return ddb.send(
        new PutCommand({
          TableName: stack.tableName,
          Item: {
            ...storyKey(id, n),
            id,
            n,
            receivedAt,
            headline: `Story ${n}`,
            summary: "What it says.",
            names: [],
            vector: new Uint8Array(8),
            eventId: `shelf${n}`,
            shelf,
            shelfSetBy: "jev",
            learning,
            ...storyIndexAttributes({ issueId: id, n, receivedAt, shelf }).set,
          },
        }),
      );
    };
    const story = (n: number) =>
      ddb
        .send(
          new GetCommand({
            TableName: stack.tableName,
            Key: storyKey(id, n),
            ConsistentRead: true,
          }),
        )
        .then((r) => r.Item!);
    const shelves = async () => {
      const [a, b, issue] = await Promise.all([story(1), story(2), getItem(id)]);
      return {
        stories: [a, b].map((s) => [s.shelf, s.shelfSetBy, s.gsi2pk ?? "-"]),
        issue: [issue!.shelf, issue!.shelfSetBy],
      };
    };
    await jevStory(1, 0.9);
    await jevStory(2, 0.2);

    // Moving the issue moves both stories, as Sandip's, and the issue follows them.
    await call("PATCH", `/issues/${id}`, { body: { shelf: "learning" } });
    expect(await shelves()).toEqual({
      stories: [
        ["learning", "sandip", "LEARNING"],
        ["learning", "sandip", "LEARNING"],
      ],
      issue: ["learning", "stories"],
    });
    const back = await call("PATCH", `/issues/${id}`, { body: { shelf: "news" } });
    expect(back.body).toMatchObject({ shelf: "news" });
    expect(await shelves()).toEqual({
      stories: [
        ["news", "sandip", "-"],
        ["news", "sandip", "-"],
      ],
      issue: ["news", "stories"],
    });

    // A newsletter's setting re-shelves Jev's stories; clearing it hands them back to Jev.
    await jevStory(1, 0.9);
    await jevStory(2, 0.7);
    await call("PATCH", `/senders/${BBG}`, { body: { shelf: "news" } });
    expect(await shelves()).toEqual({
      stories: [
        ["news", "sender", "-"],
        ["news", "sender", "-"],
      ],
      issue: ["news", "stories"],
    });
    await call("PATCH", `/senders/${BBG}`, { body: { shelf: null } });
    expect(await shelves()).toEqual({
      stories: [
        ["learning", "jev", "LEARNING"],
        ["learning", "jev", "LEARNING"],
      ],
      issue: ["learning", "stories"],
    });

    await Promise.all(
      [1, 2].map((n) =>
        ddb.send(new DeleteCommand({ TableName: stack.tableName, Key: storyKey(id, n) })),
      ),
    );
  });

  it("Learning lists Learning stories with their own state; counts them; a move re-derives (#81)", async () => {
    const BBG = senderIdentity("bytebytego@substack.com", "").senderId;
    const put = async (id: string, n: number, shelf: "news" | "learning", state?: string) => {
      const receivedAt = (await getItem(id))!.receivedAt as string;
      await ddb.send(
        new PutCommand({
          TableName: stack.tableName,
          Item: {
            ...storyKey(id, n),
            id,
            n,
            senderId: (await getItem(id))!.senderId,
            receivedAt,
            headline: `${id} ${n}`,
            summary: "What it says.",
            names: [],
            vector: new Uint8Array(8),
            eventId: `learn-${id}-${n}`,
            shelf,
            shelfSetBy: "jev",
            learning: shelf === "learning" ? 0.8 : 0.2,
            gsi1pk: "STORIES",
            gsi1sk: `${receivedAt}#${storyRef(id, n)}`,
            ...(state ? { state } : {}),
            ...storyIndexAttributes({ issueId: id, n, receivedAt, shelf, state: state as never })
              .set,
          },
        }),
      );
    };
    // The stories test left two unshelved stories on fx-tldr.
    await Promise.all(
      [1, 2].map((n) =>
        ddb.send(new DeleteCommand({ TableName: stack.tableName, Key: storyKey("fx-tldr", n) })),
      ),
    );
    // fx-tldr (AI) holds one craft story among news; fx-bytebytego (Engineering) is all craft.
    await put("fx-tldr", 11, "learning");
    await put("fx-tldr", 12, "news");
    await put("fx-bytebytego", 11, "learning");
    await put("fx-bytebytego", 12, "learning", "read");
    const learning = (query: Record<string, string> = {}) =>
      call<LearningListResponse>("GET", "/learning", { query }).then((r) =>
        r.body.items.map(
          (i) => `${i.issue.id} ${i.story.n}${i.story.state ? ` ${i.story.state}` : ""}`,
        ),
      );

    // Newest issue first (fx-tldr's own date is the later one), each issue's stories in order.
    expect(await learning()).toEqual(["fx-tldr 11", "fx-bytebytego 11"]);
    expect(await learning({ view: "all" })).toEqual([
      "fx-tldr 11",
      "fx-bytebytego 11",
      "fx-bytebytego 12 read",
    ]);
    expect(await learning({ topic: "AI" })).toEqual(["fx-tldr 11"]);
    expect(await learning({ sender: BBG })).toEqual(["fx-bytebytego 11"]);
    const page = await call<LearningListResponse>("GET", "/learning", { query: { limit: "1" } });
    expect(page.body.items).toHaveLength(1);
    const rest = await call<LearningListResponse>("GET", "/learning", {
      query: { limit: "1", cursor: page.body.cursor! },
    });
    expect(rest.body.items.map((i) => i.issue.id)).toEqual(["fx-bytebytego"]);

    // Counted by newsletter and the issue's topic.
    const counts = (await call<UnreadCountsResponse>("GET", "/unread-counts")).body.learning;
    expect(counts).toContainEqual({ senderId: BBG, shelf: "learning", topic: "Engineering", n: 1 });
    expect(counts.reduce((n, c) => n + c.n, 0)).toBe(2);

    // Reading a story takes it out of Unread, not its issue; archiving the issue leaves it listed.
    const issueState = (await getItem("fx-tldr"))?.state;
    const read = await call("PATCH", "/issues/fx-tldr/stories/11", { body: { state: "read" } });
    expect(read.body).toMatchObject({ n: 11, shelf: "learning", state: "read" });
    expect(await learning()).toEqual(["fx-bytebytego 11"]);
    expect((await getItem("fx-tldr"))?.state).toBe(issueState);
    await call("PATCH", "/issues/fx-bytebytego", { body: { state: "archived" } });
    expect(await learning()).toEqual(["fx-bytebytego 11"]);
    await call("PATCH", "/issues/fx-bytebytego/stories/11", { body: { state: "archived" } });
    expect(await learning({ view: "archived" })).toEqual(["fx-bytebytego 11 archived"]);
    await call("PATCH", "/issues/fx-tldr/stories/11", { body: { state: "unread" } });
    expect(await learning()).toEqual(["fx-tldr 11"]);

    // Moving the craft story to News takes it off Learning; the issue was News and stays so.
    const moved = await call("PATCH", "/issues/fx-tldr/stories/11", { body: { shelf: "news" } });
    expect(moved.body).toMatchObject({ shelf: "news" });
    expect(await learning()).toEqual([]);
    // Moving fx-tldr's news story to Learning, with the craft one back, makes the issue Learning.
    await call("PATCH", "/issues/fx-tldr/stories/11", { body: { shelf: "learning" } });
    await call("PATCH", "/issues/fx-tldr/stories/12", { body: { shelf: "learning" } });
    expect(await getItem("fx-tldr")).toMatchObject({ shelf: "learning", shelfSetBy: "stories" });
    const stories = (await call<IssueStoriesResponse>("GET", "/issues/fx-tldr/stories")).body
      .stories;
    expect(stories.filter((st) => st.n > 10)).toEqual([
      expect.objectContaining({ n: 11, shelf: "learning" }),
      expect.objectContaining({ n: 12, shelf: "learning" }),
    ]);
    expect(
      (await call("PATCH", "/issues/fx-tldr/stories/42", { body: { state: "read" } })).status,
    ).toBe(404);

    await call("PATCH", "/issues/fx-bytebytego", { body: { state: "unread" } });
    await Promise.all(
      [
        ["fx-tldr", 11],
        ["fx-tldr", 12],
        ["fx-bytebytego", 11],
        ["fx-bytebytego", 12],
      ].map(([id, n]) =>
        ddb.send(
          new DeleteCommand({
            TableName: stack.tableName,
            Key: storyKey(id as string, n as number),
          }),
        ),
      ),
    );
  });

  it("ask: answers from the newsletters, citing the story, or says there is nothing (#21)", async () => {
    // Two stories in the TLDR fixture, embedded by Titan the way ingest embeds them.
    const titan = new TitanEmbedder();
    const tldr = (await getItem("fx-tldr"))!;
    const put = async (n: number, headline: string, summary: string, names: string[]) => {
      const vector = await titan.embed([headline, summary, names.join(", ")].join("\n\n"));
      await ddb.send(
        new PutCommand({
          TableName: stack.tableName,
          Item: {
            ...storyKey("fx-tldr", n),
            id: "fx-tldr",
            n,
            senderId: tldr.senderId,
            receivedAt: tldr.receivedAt,
            headline,
            summary,
            names,
            vector: vectorBytes(vector),
            dims: vector.length,
            gsi1pk: "STORIES",
            gsi1sk: `${tldr.receivedAt as string}#${storyRef("fx-tldr", n)}`,
          },
        }),
      );
    };
    await put(
      31,
      "OpenAI ships agents that book travel",
      "The new agents plan a trip, compare fares and book flights and hotels on their own.",
      ["OpenAI"],
    );
    await put(
      32,
      "Anthropic publishes interpretability research",
      "A paper traces how a model represents concepts inside its layers.",
      ["Anthropic"],
    );

    const found = await call<AskResponse>("POST", "/ask", {
      body: { q: "What have my newsletters said about AI agents that book travel?" },
    });
    expect(found.status).toBe(200);
    expect(found.body.paragraphs.length).toBeGreaterThan(0);
    expect(found.body.paragraphs.flatMap((p) => p.sources)).toContainEqual(
      expect.objectContaining({
        issueId: "fx-tldr",
        story: { n: 31, headline: "OpenAI ships agents that book travel" },
      }),
    );
    expect(found.body.searches.length).toBeGreaterThan(0);
    expect(found.body.cents).toBeGreaterThan(0);

    const nothing = await call<AskResponse>("POST", "/ask", {
      body: { q: "What do my newsletters say about knitting patterns for winter scarves?" },
    });
    expect(nothing.status).toBe(200);
    expect(nothing.body.paragraphs).toEqual([]);
    expect(nothing.body.none).toMatch(/\S/);
    expect((await call("POST", "/ask", { body: { q: "x" } })).status).toBe(400);

    await Promise.all(
      [31, 32].map((n) =>
        ddb.send(new DeleteCommand({ TableName: stack.tableName, Key: storyKey("fx-tldr", n) })),
      ),
    );
  });

  it("takes: how two newsletters covered one event, kept for it; one newsletter is none (#17)", async () => {
    const titan = new TitanEmbedder();
    const put = async (
      id: string,
      n: number,
      headline: string,
      summary: string,
      eventId: string,
    ) => {
      const issue = (await getItem(id))!;
      const names = ["Anthropic"];
      const vector = await titan.embed([headline, summary, names.join(", ")].join("\n\n"));
      await ddb.send(
        new PutCommand({
          TableName: stack.tableName,
          Item: {
            ...storyKey(id, n),
            id,
            n,
            senderId: issue.senderId,
            receivedAt: issue.receivedAt,
            headline,
            summary,
            names,
            eventId,
            vector: vectorBytes(vector),
            dims: vector.length,
            gsi1pk: "STORIES",
            gsi1sk: `${issue.receivedAt as string}#${storyRef(id, n)}`,
          },
        }),
      );
    };
    await put(
      "fx-tldr",
      41,
      "Anthropic files for an IPO",
      "The filing shows revenue tripled in a year, and the company plans to list next spring.",
      "int-ipo",
    );
    await put(
      "fx-platformer",
      41,
      "Anthropic's IPO raises safety questions",
      "Going public could pressure Anthropic to ship faster than its safety research allows.",
      "int-ipo",
    );
    await put(
      "fx-lenny",
      41,
      "How to run discovery interviews",
      "A step-by-step guide to customer interviews that find real problems.",
      "int-lenny",
    );

    const before = await call<TakesResponse>("GET", "/issues/fx-tldr/stories/41/takes");
    expect(before.body).toEqual({});
    const ran = await call<TakesResponse>("POST", "/issues/fx-tldr/stories/41/takes");
    expect(ran.status).toBe(200);
    const takes = ran.body.takes!;
    expect(takes.newsletters).toBe(2);
    const all = takes.groups.flatMap((g) => g.takes);
    expect(all.map((t) => t.source.issueId).sort()).toEqual(["fx-platformer", "fx-tldr"]);
    expect(all.find((t) => t.current)?.source.issueId).toBe("fx-tldr");
    // Kept for the event: Platformer's story of it opens the same takes.
    const other = await call<TakesResponse>("GET", "/issues/fx-platformer/stories/41/takes");
    expect(other.body.takes?.gist).toBe(takes.gist);

    const alone = await call<TakesResponse>("POST", "/issues/fx-lenny/stories/41/takes");
    expect(alone.body.none).toMatch(/^Only .+ carried this in your newsletters\.$/);
    expect((await call("GET", "/issues/fx-lenny/stories/99/takes")).status).toBe(404);

    await Promise.all([
      ...["fx-tldr", "fx-platformer", "fx-lenny"].map((id) =>
        ddb.send(new DeleteCommand({ TableName: stack.tableName, Key: storyKey(id, 41) })),
      ),
      ddb.send(new DeleteCommand({ TableName: stack.tableName, Key: takesKey("int-ipo") })),
    ]);
  });

  it("source: a story checked in the jobs Lambda against the page it links to; a private address refused (#23)", async () => {
    const tldr = (await getItem("fx-tldr"))!;
    const put = (n: number, headline: string, summary: string, link: string) =>
      ddb.send(
        new PutCommand({
          TableName: stack.tableName,
          Item: {
            ...storyKey("fx-tldr", n),
            id: "fx-tldr",
            n,
            senderId: tldr.senderId,
            receivedAt: tldr.receivedAt,
            headline,
            summary,
            names: ["IETF"],
            link,
          },
        }),
      );
    // RFC 2606, as plain text: it has not changed since 1999.
    await put(
      51,
      "The IETF reserves .test, .example, .invalid and .localhost",
      "Four top-level names are kept out of the DNS for testing, documentation and examples, and example.com, .net and .org are reserved too.",
      "https://www.rfc-editor.org/rfc/rfc2606.txt",
    );
    await put(
      52,
      "Cloud secrets",
      "A link to the metadata service.",
      "http://169.254.169.254/latest/meta-data/",
    );

    // Nothing left from an earlier run that failed before cleaning up.
    await Promise.all(
      [sourceKey("fx-tldr", 51), sourceRunKey("fx-tldr", 51), sourceRunKey("fx-tldr", 52)].map(
        (Key) => ddb.send(new DeleteCommand({ TableName: stack.tableName, Key })),
      ),
    );
    expect((await call<SourceResponse>("GET", "/issues/fx-tldr/stories/51/source")).body).toEqual(
      {},
    );
    const ran = await call<SourceResponse>("POST", "/issues/fx-tldr/stories/51/source");
    expect(ran.status).toBe(202);
    expect(ran.body.running?.since).toBeDefined();
    const check = (await sourceSettled("/issues/fx-tldr/stories/51/source")).check!;
    expect(check.url).toBe("https://www.rfc-editor.org/rfc/rfc2606.txt");
    // The hunt (#128) starts at the story's own link; the RFC links nowhere, so it ends there.
    expect(check.path?.[0]?.url).toBe("https://www.rfc-editor.org/rfc/rfc2606.txt");
    expect(typeof check.original).toBe("boolean");
    expect(check.claims.length).toBeGreaterThan(0);
    expect(["holds", "further", "mixed"]).toContain(check.verdict);
    // Every quote shown is on the page.
    for (const c of check.claims) if (c.quote) expect(c.quote.length).toBeGreaterThan(7);
    expect(
      (await call<SourceResponse>("GET", "/issues/fx-tldr/stories/51/source")).body.check?.url,
    ).toBe(check.url);

    expect((await call<SourceResponse>("POST", "/issues/fx-tldr/stories/52/source")).status).toBe(
      202,
    );
    expect(await sourceSettled("/issues/fx-tldr/stories/52/source")).toEqual({
      none: "The source could not be read: the address is not a public one.",
    });

    await Promise.all([
      ...[51, 52].map((n) =>
        ddb.send(new DeleteCommand({ TableName: stack.tableName, Key: storyKey("fx-tldr", n) })),
      ),
      ddb.send(new DeleteCommand({ TableName: stack.tableName, Key: sourceKey("fx-tldr", 51) })),
      ...[51, 52].map((n) =>
        ddb.send(
          new DeleteCommand({ TableName: stack.tableName, Key: sourceRunKey("fx-tldr", n) }),
        ),
      ),
    ]);
  });

  it("predictions: listed open, settled, overruled, a newsletter's record, handed back (#140)", async () => {
    const tldr = (await getItem("fx-tldr"))!;
    const key = predictionKey("fx-tldr", 1);
    await ddb.send(
      new PutCommand({
        TableName: stack.tableName,
        Item: {
          ...key,
          id: "fx-tldr.1",
          issueId: "fx-tldr",
          senderId: tldr.senderId,
          publication: tldr.publication,
          saidAt: tldr.receivedAt,
          text: "Acme will ship its robot by March 2027.",
          who: "the newsletter",
          own: true,
          kind: "forecast",
          quote: "Acme will ship its robot by March 2027",
          by: "2027-03",
          due: "2027-03-31",
          status: "open",
        },
      }),
    );
    const open = await call<PredictionsResponse>("GET", "/predictions");
    expect(open.body.items.map((p) => p.id)).toContain("fx-tldr.1");
    expect(open.body.items.find((p) => p.id === "fx-tldr.1")).toMatchObject({
      own: true,
      due: "2027-03-31",
    });

    // Settled as the jobs Lambda settles it (#139).
    await ddb.send(
      new UpdateCommand({
        TableName: stack.tableName,
        Key: key,
        UpdateExpression: "SET #st = :r, why = :w, evidence = :e, settledAt = :at, tries = :t",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":r": "right",
          ":w": "It shipped.",
          ":e": [],
          ":at": "2026-10-28T02:00:00.000Z",
          ":t": 1,
        },
      }),
    );
    const settled = await call<PredictionsResponse>("GET", "/predictions", {
      query: { view: "settled" },
    });
    const kept = settled.body.items.find((p) => p.id === "fx-tldr.1")!;
    expect(kept).toMatchObject({ status: "right", why: "It shipped." });
    expect(kept).not.toHaveProperty("tries");

    const overruled = await call<Prediction>("PATCH", "/predictions/fx-tldr.1", {
      body: { verdict: "wrong" },
    });
    expect(overruled.body).toMatchObject({ status: "wrong", setBy: "sandip" });
    const sender = await call<SenderDetailResponse>("GET", `/senders/${tldr.senderId}`);
    expect(sender.body.record).toEqual({ right: 0, wrong: 1, unclear: 0, open: 0 });

    const back = await call<Prediction>("PATCH", "/predictions/fx-tldr.1", {
      body: { verdict: null },
    });
    expect(back.body.status).toBe("open");
    expect(back.body).not.toHaveProperty("setBy");
    expect(back.body).not.toHaveProperty("why");
    expect(
      (await call("PATCH", "/predictions/fx-tldr.9", { body: { verdict: "right" } })).status,
    ).toBe(404);

    await ddb.send(new DeleteCommand({ TableName: stack.tableName, Key: key }));
  });

  it("follow: a story's event, listed with its point, new moves until seen, unfollowed (#22)", async () => {
    const platformer = (await getItem("fx-platformer"))!;
    const summary = "A chipmaker's new accelerator ships to three cloud providers this quarter.";
    await ddb.send(
      new PutCommand({
        TableName: stack.tableName,
        Item: {
          ...storyKey("fx-platformer", 1),
          id: "fx-platformer",
          n: 1,
          senderId: platformer.senderId,
          receivedAt: platformer.receivedAt,
          headline: "A new accelerator ships",
          summary,
          names: ["Chipmaker"],
          eventId: storyRef("fx-platformer", 1),
        },
      }),
    );
    const eventId = storyRef("fx-platformer", 1);
    const path = "/issues/fx-platformer/stories/1/follow";
    try {
      expect((await call<FollowingResponse>("GET", "/following")).body).toEqual({
        items: [],
        unseen: 0,
      });
      const followed = await call<Follow>("POST", path);
      expect(followed.status).toBe(200);
      const f = followed.body;
      expect(f).toMatchObject({
        eventId,
        issueId: "fx-platformer",
        n: 1,
        headline: "A new accelerator ships",
        unseen: 0,
        quiet: false,
        stories: [eventId],
      });
      expect(f.points).toEqual([
        {
          at: platformer.receivedAt,
          text: summary,
          sources: [{ issueId: "fx-platformer", publication: platformer.publication }],
          current: true,
        },
      ]);
      // Following it again is the same follow, and it is listed at once.
      expect((await call<Follow>("POST", path)).body).toEqual(f);
      expect((await call<FollowingResponse>("GET", "/following")).body).toEqual({
        items: [f],
        unseen: 0,
      });

      // A move, added the way the check after an ingest adds one, is new until Following is seen.
      const move = {
        at: platformer.receivedAt,
        text: "A second cloud provider starts renting the accelerator.",
        sources: [{ issueId: "fx-lenny", publication: "Lenny's Newsletter" }],
        added: new Date(Date.parse(f.followedAt) + 1).toISOString(),
      };
      await ddb.send(
        new UpdateCommand({
          TableName: stack.tableName,
          Key: followKey(eventId),
          UpdateExpression: "SET points = list_append(points, :p), movedAt = :m",
          ExpressionAttributeValues: { ":p": [move], ":m": move.at },
        }),
      );
      const moved = (await call<FollowingResponse>("GET", "/following")).body;
      expect(moved.unseen).toBe(1);
      expect(moved.items[0]!).toMatchObject({ unseen: 1, movedAt: move.at });
      expect(moved.items[0]!.stories).toEqual([eventId, storyRef("fx-lenny", 1)]);
      expect((await call("POST", "/following/seen")).status).toBe(204);
      expect((await call<FollowingResponse>("GET", "/following")).body.unseen).toBe(0);

      expect((await call("DELETE", path)).status).toBe(204);
      expect((await call<FollowingResponse>("GET", "/following")).body.items).toEqual([]);
      expect((await call("POST", "/issues/fx-platformer/stories/2/follow")).status).toBe(404);
    } finally {
      await Promise.all([
        ddb.send(
          new DeleteCommand({ TableName: stack.tableName, Key: storyKey("fx-platformer", 1) }),
        ),
        ddb.send(new DeleteCommand({ TableName: stack.tableName, Key: followKey(eventId) })),
      ]);
    }
  });

  it("audit: a card per newsletter, repeats by who carried them first, a suggestion (#150)", async () => {
    const DAY = 86_400_000;
    const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
    const alpha = senderIdentity("alpha@audit.example.test", "").senderId;
    const beta = senderIdentity("beta@audit.example.test", "").senderId;
    const senders = [
      { id: alpha, publication: "Audit Alpha", unsub: "https://alpha.example.test/unsubscribe" },
      { id: beta, publication: "Audit Beta" },
    ];
    const issues = [
      ...[2, 4, 6, 8].map((d, k) => ({ id: `int-aud-a${k + 1}`, senderId: alpha, d })),
      ...[1, 3, 5, 7].map((d, k) => ({ id: `int-aud-b${k + 1}`, senderId: beta, d })),
    ];
    const stories = [
      // Alpha carried e1 first and Beta a day later; e2 is Alpha's alone.
      { id: "int-aud-a1", senderId: alpha, d: 2, eventId: "int-aud-e1", headline: "Both" },
      { id: "int-aud-b1", senderId: beta, d: 1, eventId: "int-aud-e1", headline: "Both, later" },
      { id: "int-aud-a2", senderId: alpha, d: 4, eventId: "int-aud-e2", headline: "Alpha alone" },
    ];
    // An open 25 days ago starts the window there; one yesterday opens Alpha's first issue.
    const opens = [
      { id: "fx-lenny", at: ago(25) },
      { id: "int-aud-a1", at: ago(1) },
    ];
    const keys = [
      ...senders.map((x) => senderItemKey(x.id)),
      ...issues.map((i) => issueKey(i.id)),
      ...stories.map((x) => storyKey(x.id, 1)),
      ...opens.map((o, k) => eventKey(o.id, o.at, `audit${k}`)),
    ];
    try {
      for (const x of senders) {
        await ddb.send(
          new PutCommand({
            TableName: stack.tableName,
            Item: {
              ...senderItemKey(x.id),
              senderId: x.id,
              senderKey: `${x.publication.toLowerCase()}@audit.example.test`,
              publication: x.publication,
              muted: false,
              mustRead: false,
              up: x.id === alpha ? 1 : 0,
              down: 0,
              issueCount: 4,
              lastSeenAt: ago(1),
              ...(x.unsub ? { unsubscribeUrl: x.unsub } : {}),
              ...senderIndexAttributes(x.id, x.publication),
            },
          }),
        );
      }
      for (const i of issues) {
        const receivedAt = ago(i.d);
        const rated = i.id === "int-aud-a1" ? { rating: 1 as const, ratedAt: ago(1) } : {};
        await ddb.send(
          new PutCommand({
            TableName: stack.tableName,
            Item: {
              ...issueKey(i.id),
              id: i.id,
              senderId: i.senderId,
              publication: senders.find((x) => x.id === i.senderId)!.publication,
              subject: i.id,
              receivedAt,
              state: "unread",
              ...rated,
              ...issueIndexAttributes({
                id: i.id,
                senderId: i.senderId,
                receivedAt,
                state: "unread",
                ...rated,
              }).set,
            },
          }),
        );
      }
      for (const x of stories) {
        const receivedAt = ago(x.d);
        await ddb.send(
          new PutCommand({
            TableName: stack.tableName,
            Item: {
              ...storyKey(x.id, 1),
              id: x.id,
              n: 1,
              senderId: x.senderId,
              receivedAt,
              headline: x.headline,
              summary: "",
              names: [],
              eventId: x.eventId,
              gsi1pk: "STORIES",
              gsi1sk: `${receivedAt}#${storyRef(x.id, 1)}`,
            },
          }),
        );
      }
      for (const [k, o] of opens.entries()) {
        await ddb.send(
          new PutCommand({
            TableName: stack.tableName,
            Item: {
              ...eventKey(o.id, o.at, `audit${k}`),
              type: "open",
              ...openIndexAttributes(o.id, o.at),
            },
          }),
        );
      }

      const r = await eventually(
        () => call<AuditResponse>("GET", "/audit"),
        (x) =>
          x.body.cards?.filter((c) => c.senderId === alpha || c.senderId === beta).length === 2 &&
          x.body.cards.find((c) => c.senderId === beta)!.repeats === 1 &&
          x.body.days >= 25,
      );
      expect(r.status).toBe(200);
      expect(r.body.days).toBeGreaterThanOrEqual(25);
      const a = r.body.cards.find((c) => c.senderId === alpha)!;
      const b = r.body.cards.find((c) => c.senderId === beta)!;
      expect(a).toMatchObject({
        publication: "Audit Alpha",
        unsubscribeUrl: "https://alpha.example.test/unsubscribe",
        issues: 4,
        opened: 1,
        useful: 1,
        stories: 2,
        repeats: 0,
        only: 1,
        onlyHeadlines: [{ issueId: "int-aud-a2", n: 1, headline: "Alpha alone" }],
        verdict: "keep",
        reason: "useful",
      });
      expect(b).toMatchObject({
        issues: 4,
        opened: 0,
        stories: 1,
        repeats: 1,
        firstBy: { senderId: alpha, publication: "Audit Alpha", stories: 1 },
        verdict: "drop",
        reason: "unopened",
      });
      // Worth dropping comes first.
      expect(r.body.cards.indexOf(b)).toBeLessThan(r.body.cards.indexOf(a));
    } finally {
      await Promise.all(
        keys.map((Key) => ddb.send(new DeleteCommand({ TableName: stack.tableName, Key }))),
      );
    }
  });

  it("tune-up: moves against Jev counted, a newsletter rule proposed, put off with Not now (#158)", async () => {
    const DAY = 86_400_000;
    const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
    const alpha = senderIdentity("alpha@tuneup.example.test", "").senderId;
    const publication = "Tune Alpha";
    const id = "int-tun-a1";
    const receivedAt = ago(2);
    // Jev put three of its twelve stories on News; Sandip moves them to Learning below.
    const learning = (n: number) => (n <= 3 ? 0.2 : 0.8);
    const ns = Array.from({ length: 12 }, (_, k) => k + 1);
    const promos = [
      { id: "int-tun-p1", state: "unread" as const },
      { id: "int-tun-p2", state: "archived" as const },
    ];
    const proposal = `${alpha}.learning`;
    const keys = [
      senderItemKey(alpha),
      issueKey(id),
      ...promos.map((p) => issueKey(p.id)),
      ...ns.map((n) => storyKey(id, n)),
    ];
    try {
      await ddb.send(
        new PutCommand({
          TableName: stack.tableName,
          Item: {
            ...senderItemKey(alpha),
            senderId: alpha,
            senderKey: "alpha@tuneup.example.test",
            publication,
            muted: false,
            mustRead: false,
            up: 0,
            down: 0,
            issueCount: 3,
            lastSeenAt: receivedAt,
            ...senderIndexAttributes(alpha, publication),
          },
        }),
      );
      for (const x of [{ id, state: "unread" as const }, ...promos]) {
        const promo = x.id === id ? {} : { promo: true, autoArchived: "promo" };
        await ddb.send(
          new PutCommand({
            TableName: stack.tableName,
            Item: {
              ...issueKey(x.id),
              id: x.id,
              senderId: alpha,
              publication,
              subject: x.id,
              receivedAt,
              state: x.state,
              ...promo,
              ...issueIndexAttributes({ id: x.id, senderId: alpha, receivedAt, state: x.state })
                .set,
            },
          }),
        );
      }
      for (const n of ns) {
        const shelf = shelfFor(learning(n));
        await ddb.send(
          new PutCommand({
            TableName: stack.tableName,
            Item: {
              ...storyKey(id, n),
              id,
              n,
              senderId: alpha,
              receivedAt,
              headline: `Tune story ${n}`,
              summary: "",
              names: [],
              shelf,
              shelfSetBy: "jev",
              learning: learning(n),
              gsi1pk: "STORIES",
              gsi1sk: `${receivedAt}#${storyRef(id, n)}`,
              ...storyIndexAttributes({ issueId: id, n, receivedAt, shelf }).set,
            },
          }),
        );
      }
      for (const n of [1, 2, 3]) {
        const moved = await call("PATCH", `/issues/${id}/stories/${n}`, {
          body: { shelf: "learning" },
        });
        expect(moved.status).toBe(200);
      }

      const r = await eventually(
        () => call<TuneupResponse>("GET", "/tuneup"),
        (x) =>
          x.body.proposals?.some((p) => p.id === proposal) === true &&
          x.body.newsletters.find((n) => n.senderId === alpha)?.pulledBack === 1,
      );
      expect(r.status).toBe(200);
      expect(r.body.proposals.find((p) => p.id === proposal)).toMatchObject({
        senderId: alpha,
        publication,
        shelf: "learning",
        fixes: 3,
        moves: 0,
        stories: 12,
        onShelf: 12,
        wouldMove: [],
      });
      expect(r.body.proposals.find((p) => p.id === proposal)!.fixed).toHaveLength(3);
      expect(r.body.newsletters.find((n) => n.senderId === alpha)).toEqual({
        senderId: alpha,
        publication,
        stories: 12,
        learning: 12,
        moved: 3,
        toLearning: 3,
        toNews: 0,
        unsure: 0,
        promos: 2,
        pulledBack: 1,
      });

      // Not now hides it, and it stays hidden while no more stories move.
      const put = await call<TuneupResponse>("POST", "/tuneup/dismissed", {
        body: { id: proposal },
      });
      expect(put.status).toBe(200);
      expect(put.body.proposals.map((p) => p.id)).not.toContain(proposal);
      expect(put.body.dismissed).toBeGreaterThanOrEqual(1);
      const again = await call<TuneupResponse>("GET", "/tuneup");
      expect(again.body.proposals.map((p) => p.id)).not.toContain(proposal);
      const gone = await call("POST", "/tuneup/dismissed", { body: { id: proposal } });
      expect(gone.status).toBe(404);
    } finally {
      await Promise.all(
        keys.map((Key) => ddb.send(new DeleteCommand({ TableName: stack.tableName, Key }))),
      );
      await ddb
        .send(
          new UpdateCommand({
            TableName: stack.tableName,
            Key: TUNEUP_KEY,
            UpdateExpression: "REMOVE dismissed.#id",
            ConditionExpression: "attribute_exists(dismissed)",
            ExpressionAttributeNames: { "#id": proposal },
          }),
        )
        .catch(() => undefined);
    }
  });
});
