/**
 * Integration: indexing the opens logged before read history (#42) existed, on the dev table.
 */
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import { eventKey } from "@library/core";
import { Store } from "../src/store.js";
import {
  docClient,
  devStack,
  seedDev,
  wipeDevTable,
  type DevStack,
} from "../../../scripts/dev-stack.js";

let stack: DevStack;
let store: Store;
const ddb = docClient();

beforeAll(async () => {
  stack = await devStack();
  store = new Store(stack.tableName, stack.contentBucket);
  await wipeDevTable(stack);
  await seedDev(stack);
});

describe("read history backfill on dev", () => {
  it("indexes earlier opens by time, once", async () => {
    const at = "2026-10-09T05:00:00.000Z";
    const key = eventKey("fx-tldr", at, "older001");
    await ddb.send(new PutCommand({ TableName: stack.tableName, Item: { ...key, type: "open" } }));
    // A rating event is left alone.
    await ddb.send(
      new PutCommand({
        TableName: stack.tableName,
        Item: { ...eventKey("fx-tldr", at, "older002"), type: "rating", value: 1 },
      }),
    );

    expect(await store.indexOpens()).toBe(1);
    const item = (
      await ddb.send(new GetCommand({ TableName: stack.tableName, Key: key, ConsistentRead: true }))
    ).Item;
    expect(item).toMatchObject({ gsi1pk: "OPENS", gsi1sk: `${at}#fx-tldr` });
    expect(await store.indexOpens()).toBe(0);
  });
});
