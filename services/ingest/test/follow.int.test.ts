/**
 * Integration: the check after each ingest (#22) against the dev table, with a fake model (no
 * Claude call): a followed story, new stories that read like it or not, and the follow written
 * back.
 */
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import { EMBED_DIMENSIONS, storyRef, vectorBytes, type StoredFollow } from "@library/core";
import type { ModelPort, ToolRequest } from "../src/bedrock.js";
import { checkFollows } from "../src/follow.js";
import { Store } from "../src/store.js";
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

const axis = (i: number) => Array.from({ length: EMBED_DIMENSIONS }, (_, k) => (k === i ? 1 : 0));

beforeAll(async () => {
  stack = await devStack();
  store = devStore(stack);
  await wipeDevTable(stack);
  await seedDev(stack);
});

describe("following on dev", () => {
  it("adds a move to a follow, remembers what it read, and asks nothing twice", async () => {
    const [followed, close, far] = FIXTURE_NEWSLETTER_IDS as [string, string, string];
    const putStory = async (id: string, receivedAt: string, vector: number[], headline: string) => {
      const issue = (await get(devKeys.issue(id)))!;
      await ddb.send(
        new PutCommand({
          TableName: stack.tableName,
          Item: {
            ...devKeys.story(id, 1),
            id,
            n: 1,
            senderId: issue.senderId,
            receivedAt,
            headline,
            summary: `${headline}, in a sentence.`,
            names: ["Starlink"],
            eventId: storyRef(id, 1),
            vector: vectorBytes(vector),
            dims: vector.length,
            gsi1pk: devKeys.partition.stories,
            gsi1sk: `${receivedAt}#${storyRef(id, 1)}`,
          },
        }),
      );
      return issue;
    };
    await putStory(followed, "2026-10-19T06:00:00.000Z", axis(0), "Drones lose Starlink");
    const closeIssue = await putStory(
      close,
      "2026-10-20T06:00:00.000Z",
      axis(0),
      "Musk lifts the cap",
    );
    await putStory(far, "2026-10-20T07:00:00.000Z", axis(9), "Rates rise again");
    const eventId = storyRef(followed, 1);
    const f: StoredFollow = {
      eventId,
      issueId: followed,
      n: 1,
      headline: "Drones lose Starlink",
      publication: "Fixture",
      followedAt: "2026-10-19T08:00:00.000Z",
      seenAt: "2026-10-19T08:00:00.000Z",
      points: [
        {
          at: "2026-10-19T06:00:00.000Z",
          text: "Drones lose Starlink, in a sentence.",
          sources: [{ issueId: followed, publication: "Fixture" }],
          current: true,
        },
      ],
      checked: [],
    };
    await ddb.send(
      new PutCommand({ TableName: stack.tableName, Item: { ...devKeys.follow(eventId), ...f } }),
    );

    const now = Date.parse("2026-10-20T12:00:00.000Z");
    // The check reads recent stories through a GSI, which lags the writes above.
    await eventually(
      () => store.recentStories("2026-10-17T12:00:00.000Z"),
      (s) => s.length === 3,
    );
    const calls: ToolRequest[] = [];
    const model: ModelPort = {
      callTool: async (req) => {
        calls.push(req);
        return {
          input: {
            matters: [{ follow: "F1", matter: "Starlink's cap on Ukraine's drones" }],
            stories: [{ id: "S1", kind: "move" }],
            moves: [{ follow: "F1", text: "Musk lifted the cap.", stories: ["S1"] }],
          },
          inputTokens: 1,
          outputTokens: 1,
        };
      },
      embed: async () => ({ vector: axis(0), tokens: 1 }),
    };

    const stats = await checkFollows(store, model, { now });
    expect(stats).toMatchObject({ follows: 1, candidates: 1, moves: 1 });
    expect(calls[0]!.user).toContain(`${closeIssue.publication as string} | Musk lifts the cap.`);
    const kept = (await get(devKeys.follow(eventId)))!;
    expect(kept.points).toEqual([
      ...f.points,
      {
        at: "2026-10-20T06:00:00.000Z",
        text: "Musk lifted the cap.",
        sources: [{ issueId: close, publication: closeIssue.publication }],
        added: new Date(now).toISOString(),
      },
    ]);
    expect(kept).toMatchObject({
      checked: [storyRef(close, 1)],
      movedAt: "2026-10-20T06:00:00.000Z",
      seenAt: f.seenAt,
    });

    // The next run has nothing new to ask about.
    expect(await checkFollows(store, model, { now })).toMatchObject({ candidates: 0 });
    expect(calls).toHaveLength(1);

    // A follow gone while the check ran is not written back.
    await store.addMoves("gone#01", [], ["x#01"]);
    expect(await get(devKeys.follow("gone#01"))).toBeUndefined();
  });
});
