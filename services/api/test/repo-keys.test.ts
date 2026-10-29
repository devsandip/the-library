import { afterEach, describe, expect, it, vi } from "vitest";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoRepo } from "../src/repo.js";

const READER = "0f6c2b1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f";
const P = `R#${READER}#`;

/** Every DynamoDB command the repository sends, answered with nothing found. */
function capture() {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  vi.spyOn(DynamoDBDocumentClient.prototype, "send").mockImplementation(async (cmd: unknown) => {
    const c = cmd as { constructor: { name: string }; input: Record<string, unknown> };
    sent.push({ name: c.constructor.name, input: c.input });
    return { Items: [], Responses: {} } as never;
  });
  return sent;
}

/** Every partition value a command names: its key, its index partitions and its `:p`-like values. */
function partitions(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  const key = input.Key as { pk?: string } | undefined;
  if (key?.pk) out.push(key.pk);
  const cond = input.KeyConditionExpression as string | undefined;
  const values = (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
  const names = (input.ExpressionAttributeNames ?? {}) as Record<string, string>;
  if (cond) {
    const m = /(?:^|\s)(#?\w+) = (:\w+)/.exec(cond);
    const attr = m && (names[m[1]!] ?? m[1]!);
    if (attr && /^(pk|gsi[1-4]pk)$/.test(attr)) out.push(values[m[2]!] as string);
  }
  return out;
}

const repo = (keyed: boolean) =>
  new DynamoRepo({ table: "t", bucket: "b", stage: "test", reader: { id: READER }, keyed });

afterEach(() => vi.restoreAllMocks());

describe("the repository on the reader's keys (#196)", () => {
  const reads = async (r: DynamoRepo) => {
    await r.listIssues("unread", { limit: 30 }).catch(() => undefined);
    await r.listIssues("archived", { limit: 30 }).catch(() => undefined);
    await r.listIssues("saved", { limit: 30 }).catch(() => undefined);
    await r.getIssue("abc").catch(() => undefined);
    await r.listSenders().catch(() => undefined);
    await r.history("2026-10-29").catch(() => undefined);
    await r.listHighlights(50).catch(() => undefined);
    await r.listTopics().catch(() => undefined);
  };

  it("names only the reader's partitions when keyed", async () => {
    const sent = capture();
    await reads(repo(true));
    const named = sent.flatMap((c) => partitions(c.input));
    expect(named.length).toBeGreaterThan(8);
    // Settings and interests are the reader's own items already (READER#<id>).
    expect(named.filter((pk) => !pk.startsWith(P) && pk !== `READER#${READER}`)).toEqual([]);
  });

  it("names today's partitions with the switch off", async () => {
    const sent = capture();
    await reads(repo(false));
    const named = sent.flatMap((c) => partitions(c.input));
    expect(named.length).toBeGreaterThan(8);
    expect(named.filter((pk) => pk.startsWith("R#"))).toEqual([]);
    expect(named).toContain("UNREAD");
  });

  it("refuses a cursor from another reader's partition", async () => {
    capture();
    const other = Buffer.from(
      JSON.stringify({ pk: "R#someone#ISSUE#x", sk: "META", gsi1pk: `${P}ARCHIVE`, gsi1sk: "s" }),
    ).toString("base64url");
    await expect(repo(true).listIssues("archived", { limit: 30, cursor: other })).rejects.toThrow(
      "bad cursor",
    );
  });
});
