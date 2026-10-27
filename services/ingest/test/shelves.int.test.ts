/**
 * Integration: story shelves against the dev table, on stories split from the fixture issues, with
 * a fake model and a fake Jev (no Claude or TypeSafe calls).
 */
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import { issueKey, storyKey } from "@library/core";
import type { ModelPort } from "../src/bedrock.js";
import type { DecisionPort } from "../src/jev.js";
import { deriveShelves, shelveStories } from "../src/shelves.js";
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
    // Shelving reads stories through a GSI, which lags the split's writes: wait for all of them.
    await eventually(
      () => store.storyShelves(since),
      (stories) => stories.length === n && stories.every((s) => s.learning === undefined),
    );
    const stats = await shelveStories(store, async () => jevSaying(0.8), { sinceIso: since });
    expect(stats).toMatchObject({ checked: n, shelved: n, learning: n, errors: 0 });

    const [moved, other] = FIXTURE_NEWSLETTER_IDS as [string, string];
    expect(await get(storyKey(other, 1))).toMatchObject({
      shelf: "learning",
      learning: 0.8,
      shelfSetBy: "jev",
      shelfModel: "jev-test",
      // Unread Learning is indexed (#81), and a one-story issue follows its story.
      gsi2pk: "LEARNING",
    });
    expect(await get(issueKey(other))).toMatchObject({ shelf: "learning", shelfSetBy: "stories" });

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
    const news = await get(storyKey(other, 1));
    expect(news).toMatchObject({ shelf: "news", learning: 0.2 });
    expect(news?.gsi2pk).toBeUndefined();
    expect(await get(issueKey(other))).toMatchObject({ shelf: "news", shelfSetBy: "stories" });
    expect(await get(storyKey(moved, 1))).toMatchObject({
      shelf: "news",
      shelfSetBy: "sandip",
      learning: 0.8,
    });
  });

  it("derive brings every story and issue in line once, and then has nothing to do", async () => {
    const [first] = FIXTURE_NEWSLETTER_IDS as [string];
    // As before #81: a Learning story with no index attributes, and an issue on Claude's shelf.
    await ddb.send(
      new UpdateCommand({
        TableName: stack.tableName,
        Key: storyKey(first, 1),
        UpdateExpression: "SET shelf = :l, shelfSetBy = :jev, learning = :p REMOVE gsi2pk, gsi2sk",
        ExpressionAttributeValues: { ":l": "learning", ":jev": "jev", ":p": 0.9 },
      }),
    );
    await ddb.send(
      new UpdateCommand({
        TableName: stack.tableName,
        Key: issueKey(first),
        UpdateExpression: "SET shelf = :n, shelfSetBy = :claude",
        ExpressionAttributeValues: { ":n": "news", ":claude": "claude" },
      }),
    );
    const once = await deriveShelves(store, { sinceIso: since });
    expect(once.storiesChanged).toBeGreaterThanOrEqual(1);
    expect(once.skipped).toBe(0);
    expect(await get(storyKey(first, 1))).toMatchObject({ gsi2pk: "LEARNING" });
    expect(await get(issueKey(first))).toMatchObject({ shelf: "learning", shelfSetBy: "stories" });

    const twice = await deriveShelves(store, { sinceIso: since });
    expect(twice).toMatchObject({ storiesChanged: 0, issuesChanged: 0, skipped: 0 });
  });
});
