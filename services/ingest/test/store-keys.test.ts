import { afterEach, describe, expect, it, vi } from "vitest";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Store } from "../src/store.js";

const READER = "0f6c2b1e-1d2a-4c3b-9e8f-7a6b5c4d3e2f";
const P = `R#${READER}#`;

/** Every DynamoDB command the store sends, answered with nothing found. */
function capture() {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  vi.spyOn(DynamoDBDocumentClient.prototype, "send").mockImplementation(async (cmd: unknown) => {
    const c = cmd as { constructor: { name: string }; input: Record<string, unknown> };
    sent.push({ name: c.constructor.name, input: c.input });
    return { Items: [], Responses: {} } as never;
  });
  return sent;
}

/** The partition values a command names: keys, batch keys and the partition it queries. */
function partitions(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  const key = input.Key as { pk?: string } | undefined;
  if (key?.pk) out.push(key.pk);
  for (const r of Object.values(
    (input.RequestItems ?? {}) as Record<string, { Keys?: { pk: string }[] }>,
  )) {
    for (const k of r.Keys ?? []) out.push(k.pk);
  }
  const cond = input.KeyConditionExpression as string | undefined;
  const values = (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
  const m = cond && /(?:^|\s)(pk|gsi[1-4]pk) = (:\w+)/.exec(cond);
  if (m) out.push(values[m[2]!] as string);
  return out;
}

const store = (keyed: boolean) => new Store("t", "b", { keyed }).forReader({ id: READER });

afterEach(() => vi.restoreAllMocks());

describe("ingest's store on the owner's keys (#197)", () => {
  const reads = async (s: Store) => {
    await s.existingIds(["a", "b"]);
    await s.getTopics();
    await s.getInterests();
    await s.follows();
    await s.senderSettings();
  };

  it("names only the reader's partitions when keyed", async () => {
    const sent = capture();
    await reads(store(true));
    const named = sent.flatMap((c) => partitions(c.input));
    expect(named.length).toBeGreaterThan(4);
    expect(named.filter((pk) => !pk.startsWith(P))).toEqual([]);
  });

  it("names today's partitions with the switch off", async () => {
    const sent = capture();
    await reads(store(false));
    expect(sent.flatMap((c) => partitions(c.input)).filter((pk) => pk.startsWith("R#"))).toEqual(
      [],
    );
  });

  it("scans only the reader's items when keyed, and none of any reader's when not", async () => {
    let sent = capture();
    await store(true).scanForSenderRebuild();
    await store(true).indexOpens();
    let scans = sent.filter((c) => c.name === "ScanCommand").map((c) => c.input);
    expect(scans).toHaveLength(2);
    for (const s of scans) {
      expect(s.FilterExpression).toContain("begins_with(pk, :own)");
      expect((s.ExpressionAttributeValues as Record<string, string>)[":own"]).toBe(P);
    }
    vi.restoreAllMocks();
    sent = capture();
    await store(false).scanForSenderRebuild();
    scans = sent.filter((c) => c.name === "ScanCommand").map((c) => c.input);
    expect(scans[0]!.FilterExpression).toContain("NOT begins_with(pk, :own)");
    expect((scans[0]!.ExpressionAttributeValues as Record<string, string>)[":own"]).toBe("R#");
  });
});
