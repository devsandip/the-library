import { afterEach, describe, expect, it, vi } from "vitest";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoRepo } from "../src/repo.js";

afterEach(() => vi.restoreAllMocks());

/** A table with the reader's settings item or not, and an owner or not. */
function table(opts: { settings: boolean; owner?: string }) {
  vi.spyOn(DynamoDBDocumentClient.prototype, "send").mockImplementation(async (cmd: unknown) => {
    const key = (cmd as { input: { Key?: { pk: string; sk: string } } }).input.Key;
    if (key?.sk === "SETTINGS")
      return { Item: opts.settings ? { pk: key.pk } : undefined } as never;
    if (key?.sk === "OWNER")
      return { Item: opts.owner ? { readerId: opts.owner } : undefined } as never;
    return {} as never;
  });
}

const repo = (keyed: boolean) =>
  new DynamoRepo({ table: "t", bucket: "b", stage: "test", reader: { id: "r1" }, keyed });

describe("onboarding (#221)", () => {
  it("is for a new reader on reader keys only", async () => {
    table({ settings: false });
    expect(await repo(true).onboarded()).toBe(false);
  });

  it("is done once settings are saved, and never for the owner or on today's keys", async () => {
    table({ settings: true });
    expect(await repo(true).onboarded()).toBe(true);
    vi.restoreAllMocks();
    table({ settings: false, owner: "r1" });
    expect(await repo(true).onboarded()).toBe(true);
    vi.restoreAllMocks();
    table({ settings: false });
    expect(await repo(false).onboarded()).toBe(true);
  });
});
