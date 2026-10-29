/**
 * Integration: the move (#199) on dev. A library on today's keys, as prod's is, is copied to the
 * owner's keys, checked, copied again without change, and today's keys deleted.
 * Run with `pnpm test:int` (needs AWS credentials and a deployed TheLibrary-dev).
 */
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import { issueKey, storyKey } from "@library/core";
import { Store } from "../src/store.js";
import {
  devKeys,
  devStack,
  devStore,
  docClient,
  FIXTURE_NEWSLETTER_IDS,
  INT_READER,
  seedDev,
  wipeDevTable,
  type DevStack,
} from "../../../scripts/dev-stack.js";
import { move, ownersCopy } from "../../../scripts/move.js";

let stack: DevStack;
const ddb = docClient();
const get = (key: Record<string, string>) =>
  ddb.send(new GetCommand({ TableName: stack.tableName, Key: key })).then((r) => r.Item);

beforeAll(async () => {
  stack = await devStack();
  await wipeDevTable(stack);
  // A library on today's keys, with a story Sandip moved, as on prod before the move.
  await seedDev(stack, new Store(stack.tableName, stack.contentBucket));
  await ddb.send(
    new PutCommand({
      TableName: stack.tableName,
      Item: {
        ...storyKey("fx-tldr", 1),
        n: 1,
        headline: "H",
        shelf: "learning",
        shelfSetBy: "sandip",
      },
    }),
  );
}, 300_000);

describe("the move on dev (#199)", () => {
  it("counts today's keys and writes nothing on a dry run", async () => {
    const r = await move(ddb, stack.tableName, INT_READER, "count");
    expect(r.found["ISSUE META"]).toBeGreaterThanOrEqual(FIXTURE_NEWSLETTER_IDS.length);
    expect(r.found["SENDER"]).toBeGreaterThan(0);
    expect(r.copied).toBe(0);
    expect(await get(devKeys.issue("fx-tldr"))).toBeUndefined();
  });

  it("copies every item to the owner's keys, with its index partitions, and 'reader' for 'sandip'", async () => {
    const r = await move(ddb, stack.tableName, INT_READER, "apply");
    const found = Object.values(r.found).reduce((a, b) => a + b, 0);
    expect(r.copied).toBe(found);
    const copy = await get(devKeys.issue("fx-tldr"));
    const old = await get(issueKey("fx-tldr"));
    expect(copy).toEqual(ownersCopy(old!, INT_READER));
    expect(copy).toMatchObject({
      pk: devKeys.issue("fx-tldr").pk,
      gsi1pk: devKeys.partition.inbox,
    });
    expect((await get(devKeys.story("fx-tldr", 1)))?.shelfSetBy).toBe("reader");
    // The owner's store sees the library.
    const seen = await devStore(stack).existingIds(FIXTURE_NEWSLETTER_IDS);
    expect([...seen].sort()).toEqual([...FIXTURE_NEWSLETTER_IDS].sort());
  });

  it("runs again without overwriting a copy, and checks every one arrived", async () => {
    await ddb.send(
      new PutCommand({
        TableName: stack.tableName,
        Item: { ...(await get(devKeys.issue("fx-tldr")))!, state: "read" },
      }),
    );
    const again = await move(ddb, stack.tableName, INT_READER, "apply");
    expect(again.copied).toBe(0);
    expect(again.already).toBeGreaterThan(0);
    expect((await get(devKeys.issue("fx-tldr")))?.state).toBe("read");
    expect((await move(ddb, stack.tableName, INT_READER, "check")).missing).toBe(0);
  });

  it("deletes today's keys once every one has its copy, leaving the owner and the copies", async () => {
    const r = await move(ddb, stack.tableName, INT_READER, "delete");
    expect(r.deleted).toBe(Object.values(r.found).reduce((a, b) => a + b, 0));
    expect(await get(issueKey("fx-tldr"))).toBeUndefined();
    expect(await get(devKeys.issue("fx-tldr"))).toBeDefined();
    expect(await new Store(stack.tableName, stack.contentBucket).owner()).toEqual(INT_READER);
    expect(Object.keys((await move(ddb, stack.tableName, INT_READER, "count")).found)).toEqual([]);
  });
});
