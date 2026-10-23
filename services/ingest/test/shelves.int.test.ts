/**
 * Integration: story shelves against the dev table, on stories split from the fixture issues, with
 * a fake model and a fake Jev (no Claude or TypeSafe calls).
 */
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import { storyKey } from "@library/core";
import type { ModelPort } from "../src/bedrock.js";
import type { DecisionPort } from "../src/jev.js";
import { shelveStories } from "../src/shelves.js";
import { Store } from "../src/store.js";
import { indexStories } from "../src/stories.js";
import {
  docClient,
  devStack,
  FIXTURE_NEWSLETTER_IDS,
  seedDev,
  wipeDevTable,
  type DevStack,
} from "../../../scripts/dev-stack.js";

let stack: DevStack;
let store: Store;
const ddb = docClient();
const since = "2020-01-01T00:00:00.000Z";

const get = (key: Record<string, string>) =>
  ddb
    .send(new GetCommand({ TableName: stack.tableName, Key: key, ConsistentRead: true }))
    .then((r) => r.Item);

const vector = Array.from({ length: 512 }, (_, i) => (i === 7 ? 1 : 0));
const model: ModelPort = {
  callTool: async () => ({
    input: { stories: [{ headline: "How caches fail", summary: "A how-to.", names: [], link: 0 }] },
    inputTokens: 1,
    outputTokens: 1,
  }),
  embed: async () => ({ vector, tokens: 1 }),
};

const jevSaying = (p: number): DecisionPort => ({
  decide: async () => ({
    model: "jev-test",
    answers: { craft: { type: "noul", noul: p } },
    inputTokens: 1,
    outputTokens: 0,
  }),
});

beforeAll(async () => {
  stack = await devStack();
  store = new Store(stack.tableName, stack.contentBucket);
  await wipeDevTable(stack);
  await seedDev(stack);
  await indexStories(store, model, { sinceIso: since });
});

describe("story shelves on dev", () => {
  it("shelves every story once, and keeps a move by Sandip through a forced rerun", async () => {
    const n = FIXTURE_NEWSLETTER_IDS.length;
    const stats = await shelveStories(store, async () => jevSaying(0.8), { sinceIso: since });
    expect(stats).toMatchObject({ checked: n, shelved: n, learning: n, errors: 0 });

    const [moved, other] = FIXTURE_NEWSLETTER_IDS as [string, string];
    expect(await get(storyKey(other, 1))).toMatchObject({
      shelf: "learning",
      learning: 0.8,
      shelfSetBy: "jev",
      shelfModel: "jev-test",
    });

    const again = await shelveStories(store, async () => jevSaying(0.8), { sinceIso: since });
    expect(again).toMatchObject({ checked: 0, shelved: 0 });

    await ddb.send(
      new UpdateCommand({
        TableName: stack.tableName,
        Key: storyKey(moved, 1),
        UpdateExpression: "SET shelf = :news, shelfSetBy = :sandip",
        ExpressionAttributeValues: { ":news": "news", ":sandip": "sandip" },
      }),
    );
    const forced = await shelveStories(store, async () => jevSaying(0.2), {
      sinceIso: since,
      force: true,
    });
    expect(forced).toMatchObject({ checked: n - 1, shelved: n - 1, learning: 0 });
    expect(await get(storyKey(other, 1))).toMatchObject({ shelf: "news", learning: 0.2 });
    expect(await get(storyKey(moved, 1))).toMatchObject({
      shelf: "news",
      shelfSetBy: "sandip",
      learning: 0.8,
    });
  });
});
