import { afterEach, describe, expect, it, vi } from "vitest";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoRepo } from "../src/repo.js";

afterEach(() => vi.restoreAllMocks());

/** The table answers the owner item and the READERS index; everything else is empty. */
function table(owner: string | undefined, listed: string[]) {
  const sent: Record<string, unknown>[] = [];
  vi.spyOn(DynamoDBDocumentClient.prototype, "send").mockImplementation(async (cmd: unknown) => {
    const input = (cmd as { input: Record<string, unknown> }).input;
    sent.push(input);
    if ((input.Key as { sk?: string } | undefined)?.sk === "OWNER") {
      return { Item: owner ? { readerId: owner } : undefined } as never;
    }
    return { Items: listed.map((id) => ({ gsi1sk: id })) } as never;
  });
  return sent;
}

const repo = () => new DynamoRepo({ table: "t", bucket: "b", stage: "test" });

describe("the list of readers (#210)", () => {
  it("lists the owner first, then every reader with settings, once each", async () => {
    const sent = table("owner-1", ["reader-a", "owner-1", "reader-b"]);
    expect(await repo().readers()).toEqual([
      { id: "owner-1" },
      { id: "reader-a" },
      { id: "reader-b" },
    ]);
    const q = sent.find((i) => i.IndexName);
    expect(q).toMatchObject({ IndexName: "gsi1", ExpressionAttributeValues: { ":p": "READERS" } });
  });

  it("lists readers with settings when no owner is named", async () => {
    table(undefined, ["reader-a"]);
    expect(await repo().readers()).toEqual([{ id: "reader-a" }]);
  });

  it("puts a reader in the list when they save settings, under no reader's prefix", async () => {
    const sent = table(undefined, []);
    const keyed = new DynamoRepo({
      table: "t",
      bucket: "b",
      stage: "test",
      reader: { id: "r1" },
      keyed: true,
    });
    await keyed.saveSettings({ timeZone: "UTC" });
    const put = sent.find((i) => i.Item) as { Item: Record<string, unknown> };
    expect(put.Item).toMatchObject({
      pk: "READER#r1",
      sk: "SETTINGS",
      gsi1pk: "READERS",
      gsi1sk: "r1",
    });
  });
});
