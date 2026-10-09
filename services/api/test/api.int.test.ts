/**
 * Integration: the deployed dev API Lambda, invoked directly with a crafted HTTP API event
 * (the JWT authorizer only exists in prod; its 401 is checked by scripts/check-hosting.sh).
 * Run with `pnpm test:int`.
 */
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { beforeAll, describe, expect, it } from "vitest";
import { senderIdentity } from "@library/core";
import type {
  IssueDetailResponse,
  IssueListResponse,
  SenderDetailResponse,
  SenderListResponse,
  StatusResponse,
} from "@library/core/types";
import {
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
});
