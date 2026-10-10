/**
 * Integration: the deployed dev API Lambda, invoked directly with a crafted HTTP API event
 * (the JWT authorizer only exists in prod; its 401 is checked by scripts/check-hosting.sh).
 * Run with `pnpm test:int`.
 */
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import {
  embeddingKey,
  INTERESTS_KEY,
  issueIndexAttributes,
  issueKey,
  NARRATIVE_KEY,
  senderIdentity,
  TOPICS_KEY,
} from "@library/core";
import type {
  IssueDetailResponse,
  IssueListResponse,
  RelatedResponse,
  SenderDetailResponse,
  SenderListResponse,
  StatusResponse,
  SummaryResponse,
  TopicListResponse,
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
    rawPath: `/thelibrary/api${path}`,
    rawQueryString: new URLSearchParams(opts.query).toString(),
    queryStringParameters: opts.query,
    headers: { "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: {
      http: { method, path: `/thelibrary/api${path}` },
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
    const shelf = (q: Record<string, string>) =>
      call<IssueListResponse>("GET", "/issues", { query: q });
    expect(ids(await shelf({ shelf: "learning" }))).toEqual(["fx-bytebytego", "fx-pragmatic"]);
    expect(ids(await shelf({ shelf: "news" }))).toEqual([
      "fx-platformer",
      "fx-tldr",
      "fx-lenny",
      "fx-example",
    ]);
    expect(ids(await shelf({ shelf: "news", topic: "AI" }))).toEqual(["fx-tldr"]);
    expect(ids(await shelf({ shelf: "learning", view: "all", topic: "Engineering" }))).toEqual([
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
    expect((await call<SummaryResponse>("GET", "/summary")).body.digest).toEqual(digest);
    await call("POST", `/issues/${digest[0]}/rating`, { body: { value: 1 } });
    const status = await call<StatusResponse>("GET", "/status");
    expect(status.body.digestStats).toEqual({
      days: 1,
      shown: digest.length,
      relevant: 1,
      irrelevant: 0,
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
});
