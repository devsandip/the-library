/**
 * Integration: the story index against the dev table and bucket, on the fixture issues' stored
 * HTML, with a fake model (no Claude calls).
 */
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import { storyText, toVector } from "@library/core";
import type { ModelPort } from "../src/bedrock.js";
import { Store } from "../src/store.js";
import { indexStories, relinkStories } from "../src/stories.js";
import {
  docClient,
  devStack,
  FIXTURE_NEWSLETTER_IDS,
  seedDev,
  wipeDevTable,
  type DevStack,
  devKeys,
  devStore,
} from "../../../scripts/dev-stack.js";

let stack: DevStack;
let store: Store;
const ddb = docClient();
const since = "2020-01-01T00:00:00.000Z";
const until = "2100-01-01T00:00:00.000Z";

const get = (key: Record<string, string>) =>
  ddb
    .send(new GetCommand({ TableName: stack.tableName, Key: key, ConsistentRead: true }))
    .then((r) => r.Item);

/** Every issue is one story about the same event, linked to its first source. */
const vector = Array.from({ length: 512 }, (_, i) => (i === 7 ? 1 : 0));
const model: ModelPort = {
  callTool: async () => ({
    input: {
      stories: [
        { headline: "Acme ships a thing", summary: "It shipped.", names: ["Acme"], link: 1 },
      ],
    },
    inputTokens: 1,
    outputTokens: 1,
  }),
  embed: async () => ({ vector, tokens: 1 }),
};

beforeAll(async () => {
  stack = await devStack();
  store = devStore(stack);
  await wipeDevTable(stack);
  await seedDev(stack);
});

describe("story index on dev", () => {
  it("splits every fixture newsletter and links their stories as one event", async () => {
    const stats = await indexStories(store, model, { sinceIso: since });
    const n = FIXTURE_NEWSLETTER_IDS.length;
    expect(stats).toMatchObject({ checked: n, storied: n, stories: n, linked: n - 1, errors: 0 });

    const stored = await store.storiesBetween(since, until);
    expect(stored).toHaveLength(n);
    // Oldest first: the oldest fixture started the event and the rest joined it.
    expect(new Set(stored.map((s) => s.eventId))).toEqual(new Set([stored[0]!.key]));
    expect(stored[0]!.vector).toHaveLength(512);

    const id = FIXTURE_NEWSLETTER_IDS[0]!;
    const item = await get(devKeys.story(id, 1));
    const html = await store.getHtml(id);
    expect(item).toMatchObject({ headline: "Acme ships a thing", names: ["Acme"], n: 1 });
    expect(item?.link).toBe(html ? storyText(html).links[0] : undefined);
    expect(toVector(item!.vector as Uint8Array)[7]).toBe(1);
    expect(await get(devKeys.issue(id))).toMatchObject({ storyCount: 1 });

    const again = await indexStories(store, model, { sinceIso: since });
    expect(again).toMatchObject({ checked: 0, storied: 0 });
  });

  it("counts failed splits on the issue until a split succeeds", async () => {
    const id = FIXTURE_NEWSLETTER_IDS[1]!;
    await store.putStoryError(id, "first");
    await store.putStoryError(id, "second");
    expect(await get(devKeys.issue(id))).toMatchObject({ storyAttempts: 2, storyError: "second" });
    const meta = (await get(devKeys.issue(id)))!;
    const issue = { id, senderId: meta.senderId as string, receivedAt: meta.receivedAt as string };
    const story = (n: number, headline: string) => ({
      n,
      headline,
      summary: "S.",
      names: [],
      vector,
      eventId: `${id}#0${n}`,
    });
    await store.putStories(issue, [story(1, "One"), story(2, "Two")]);
    const after = (await get(devKeys.issue(id)))!;
    expect(after.storyAttempts).toBeUndefined();
    expect(after.storyError).toBeUndefined();

    // A redo with fewer stories drops the ones no longer there.
    await store.putStories(issue, [story(1, "Only")]);
    expect(await get(devKeys.story(id, 2))).toBeUndefined();
    expect(await get(devKeys.story(id, 1))).toMatchObject({ headline: "Only" });
    expect(await get(devKeys.issue(id))).toMatchObject({ storyCount: 1 });

    // A redo keeps Sandip's move and the story's read state, by headline here (#98).
    await ddb.send(
      new UpdateCommand({
        TableName: stack.tableName,
        Key: devKeys.story(id, 1),
        UpdateExpression: "SET shelf = :l, shelfSetBy = :sandip, #st = :read",
        ExpressionAttributeNames: { "#st": "state" },
        ExpressionAttributeValues: { ":l": "learning", ":sandip": "sandip", ":read": "read" },
      }),
    );
    await store.putStories(issue, [story(1, "New first"), story(2, "only")]);
    expect(await get(devKeys.story(id, 2))).toMatchObject({
      headline: "only",
      shelf: "learning",
      shelfSetBy: "sandip",
      state: "read",
    });
    // Read, so not in the unread Learning index; the other story carries nothing.
    expect((await get(devKeys.story(id, 2)))?.gsi2pk).toBeUndefined();
    expect((await get(devKeys.story(id, 1)))?.shelfSetBy).toBeUndefined();
    // Back to one story, as the tests below expect.
    await store.putStories(issue, [story(1, "Only")]);
  });

  it("moves an issue's stories along when a sender rebuild re-keys the issue", async () => {
    const id = FIXTURE_NEWSLETTER_IDS[2]!;
    const meta = (await get(devKeys.issue(id)))!;
    const errors = await store.applySenderPlan({
      rekeys: [
        {
          id,
          fromSenderId: meta.senderId as string,
          toSenderId: "s0000000000ff",
          publication: "Renamed",
        },
      ],
      creates: [],
      updates: [],
      deletes: [],
      unchanged: 0,
    });
    expect(errors).toEqual([]);
    expect(await get(devKeys.story(id, 1))).toMatchObject({ senderId: "s0000000000ff" });
  });

  it("reads stories with their text, and keeps one narrative", async () => {
    const texts = await store.storyTexts(since, until);
    expect(texts).toHaveLength(FIXTURE_NEWSLETTER_IDS.length);
    for (const t of texts) {
      expect(t.headline.length).toBeGreaterThan(0);
      expect(t.eventId).toMatch(/#\d\d$/);
    }

    expect(await store.getNarrative()).toBeUndefined();
    const narrative = {
      at: "2026-10-10T12:00:00.000Z",
      threads: [{ title: "T", text: "Text.", sources: [{ issueId: "a", publication: "A" }] }],
      stories: 6,
      newsletters: 3,
      storyKeys: ["a#01"],
      model: "m",
    };
    await store.putNarrative(narrative);
    expect(await store.getNarrative()).toEqual(narrative);
  });

  it("relinks every story and writes only what changed", async () => {
    const report = await relinkStories(store);
    expect(report.stories).toBe(FIXTURE_NEWSLETTER_IDS.length);
    expect(report.events).toBe(1);
    const second = await relinkStories(store);
    expect(second.changed).toBe(0);
  });
});
