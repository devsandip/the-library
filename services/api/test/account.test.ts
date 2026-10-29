import { afterEach, describe, expect, it, vi } from "vitest";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { Accounts, deleteSignIn } from "../src/account.js";
import { DynamoRepo } from "../src/repo.js";

afterEach(() => vi.restoreAllMocks());

describe("deleting an account (#220)", () => {
  it("starts the job for a reader on reader keys, and refuses today's keys and the owner", async () => {
    const startJob = vi.fn(async () => undefined);
    const ok = new Accounts({ deletable: async () => "yes" }, { id: "r1" }, startJob);
    expect(await ok.delete()).toEqual({ deleting: true });
    expect(startJob).toHaveBeenCalledWith({ kind: "delete-account", reader: "r1" });
    for (const why of ["today's keys", "owner"] as const) {
      const no = new Accounts({ deletable: async () => why }, { id: "r1" }, startJob);
      await expect(no.delete()).rejects.toMatchObject({ status: 409 });
    }
    expect(startJob).toHaveBeenCalledTimes(1);
  });

  it("deletes the sign-in found by the reader's sub, and nothing where there is no pool", async () => {
    const send = vi.fn(async (cmd: { input: Record<string, unknown> }) =>
      "Filter" in cmd.input ? { Users: [{ Username: "abc@example.test" }] } : {},
    );
    expect(await deleteSignIn({ id: "r1" }, "pool-1", { send } as never)).toBe(true);
    expect(send.mock.calls[0]![0].input).toMatchObject({
      UserPoolId: "pool-1",
      Filter: 'sub = "r1"',
    });
    expect(send.mock.calls[1]![0].input).toEqual({
      UserPoolId: "pool-1",
      Username: "abc@example.test",
    });
    expect(await deleteSignIn({ id: "r1" }, undefined, { send } as never)).toBe(false);
  });

  it("deletes every item under the reader's keys, their settings and their stored mail", async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    vi.spyOn(DynamoDBDocumentClient.prototype, "send").mockImplementation(async (cmd: unknown) => {
      const c = cmd as { constructor: { name: string }; input: Record<string, unknown> };
      sent.push({ name: c.constructor.name, input: c.input });
      return c.constructor.name === "ScanCommand"
        ? ({
            Items: [
              { pk: "R#r1#ISSUE#a", sk: "META", s3Keys: { raw: "raw/a.eml", html: "html/a.html" } },
              { pk: "R#r1#ISSUE#a", sk: "STORY#01" },
            ],
          } as never)
        : ({} as never);
    });
    const s3 = vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => ({}) as never);
    const repo = new DynamoRepo({
      table: "t",
      bucket: "b",
      stage: "test",
      reader: { id: "r1" },
      keyed: true,
    });
    expect(await repo.deleteEverything()).toEqual({ items: 4, objects: 2 });
    const scan = sent.find((c) => c.name === "ScanCommand")!.input;
    expect(scan.ExpressionAttributeValues).toEqual({ ":own": "R#r1#" });
    const deleted = sent
      .filter((c) => c.name === "BatchWriteCommand")
      .flatMap((c) => (c.input.RequestItems as { t: { DeleteRequest: { Key: object } }[] }).t)
      .map((r) => r.DeleteRequest.Key);
    expect(deleted).toEqual([
      { pk: "R#r1#ISSUE#a", sk: "META" },
      { pk: "R#r1#ISSUE#a", sk: "STORY#01" },
      { pk: "READER#r1", sk: "SETTINGS" },
      { pk: "READER#r1", sk: "INTERESTS" },
    ]);
    expect((s3.mock.calls[0]![0] as { input: { Delete: unknown } }).input.Delete).toEqual({
      Objects: [{ Key: "raw/a.eml" }, { Key: "html/a.html" }],
      Quiet: true,
    });
  });

  it("refuses to delete anything on today's keys", async () => {
    const repo = new DynamoRepo({ table: "t", bucket: "b", stage: "test", reader: { id: "r1" } });
    await expect(repo.deleteEverything()).rejects.toThrow("reader keys");
    expect(await repo.deletable()).toBe("today's keys");
  });
});
