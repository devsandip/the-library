/**
 * Integration: enrichment and the archive rules against the dev table, with real Bedrock.
 * Titan embeddings always run. Claude classification runs only when the account has Anthropic
 * model access (a one-time form in the Bedrock console); otherwise those tests are skipped.
 */
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import {
  embeddingKey,
  issueKey,
  senderIdentity,
  senderItemKey,
  storyKey,
  TOPICS_KEY,
} from "@library/core";
import type { Topic } from "@library/core/types";
import { Bedrock, MODELS } from "../src/bedrock.js";
import { archiveOldNews, classifyRequest, enrich, parseClassification } from "../src/enrich.js";
import { Store } from "../src/store.js";
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
let haiku = false;
const ddb = docClient();
const bedrock = new Bedrock(new BedrockRuntimeClient({ region: "us-east-1", maxAttempts: 6 }));
const since = "2020-01-01T00:00:00.000Z";
const topics: Topic[] = [
  { name: "AI", description: "Models, AI tools and the AI industry" },
  { name: "Engineering", description: "Systems, architecture, APIs and engineering practice" },
  { name: "Product", description: "Product management craft and product strategy" },
  { name: "Media", description: "Publishing, newsletters, culture and everything else" },
];

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

beforeAll(async () => {
  stack = await devStack();
  store = new Store(stack.tableName, stack.contentBucket);
  await wipeDevTable(stack);
  await seedDev(stack);
  try {
    await new BedrockRuntimeClient({ region: "us-east-1" }).send(
      new ConverseCommand({
        modelId: MODELS.classify,
        messages: [{ role: "user", content: [{ text: "Reply OK." }] }],
        inferenceConfig: { maxTokens: 5 },
        additionalModelRequestFields: { thinking: { type: "disabled" } },
      }),
    );
    haiku = true;
  } catch (err) {
    console.warn(`Skipping Claude classification tests: ${(err as Error).message}`);
  }
});

describe("enrichment on dev", () => {
  it("without a topic list, embeds every newsletter and waits to sort them", async () => {
    const stats = await enrich(store, bedrock, { sinceIso: since });
    expect(stats).toMatchObject({ checked: 6, embedded: 6, classified: 0, waitingForTopics: 6 });
    const emb = await get(embeddingKey("fx-bytebytego"));
    expect(emb?.dims).toBe(512);
    expect((emb?.vector as Uint8Array).byteLength).toBe(512 * 4);
    expect((await get(issueKey("fx-bytebytego")))?.embeddedAt).toBeDefined();
  });

  it("with topics, Claude sorts every newsletter within the schema", async (ctx) => {
    if (!haiku) ctx.skip();
    await ddb.send(new PutCommand({ TableName: stack.tableName, Item: { ...TOPICS_KEY, topics } }));
    const stats = await enrich(store, bedrock, { sinceIso: since });
    expect(stats).toMatchObject({ classified: 6, accountFiltered: 0, errors: 0 });
    expect(stats.inputTokens).toBeGreaterThan(0);
    for (const id of FIXTURE_NEWSLETTER_IDS) {
      const i = await get(issueKey(id));
      expect(i?.summary, id).toMatch(/\S/);
      expect(["news", "learning"], id).toContain(i?.shelf);
      expect(i?.shelfSetBy).toBe("claude");
      expect(
        topics.map((t) => t.name),
        id,
      ).toContain(i?.topic);
      expect(typeof i?.promo).toBe("boolean");
    }
  });

  it("Claude calls a sign-up confirmation account mail, and an issue about codes an issue (#50)", async (ctx) => {
    if (!haiku) ctx.skip();
    const selling = async (subject: string, text: string) =>
      parseClassification(
        (
          await bedrock.callTool(
            classifyRequest({ publication: "ByteByteGo", subject, text }, topics),
          )
        ).input,
        topics,
      ).selling;
    // Worded so the noise rules miss it: this is what the fourth answer is for.
    expect(
      await selling(
        "One more step",
        "Tap the button below to finish signing up for ByteByteGo. Confirm. If you did not ask " +
          "for this, ignore this email.",
      ),
    ).toBe("account");
    expect(
      await selling(
        "EP183: How one-time passwords work",
        "A one-time password is derived from a shared secret and the current time. The server " +
          "and the authenticator app each compute an HMAC of the 30-second window and keep six " +
          "digits. This week: why the window drifts, how servers allow for it, and why SMS codes " +
          "are weaker than app codes. Sponsored by Clerk.",
      ),
    ).not.toBe("account");
  });
});

describe("archive rules on dev", () => {
  it("archives a promo once; once Sandip restores it, never again", async () => {
    expect(await store.autoArchive("fx-example", "promo")).toBe(true);
    const archived = await get(issueKey("fx-example"));
    expect(archived).toMatchObject({ state: "archived", gsi1pk: "ARCHIVE", autoArchived: "promo" });
    expect(archived?.gsi2pk).toBeUndefined();
    expect(await store.autoArchive("fx-example", "promo")).toBe(false);

    await ddb.send(
      new UpdateCommand({
        TableName: stack.tableName,
        Key: issueKey("fx-example"),
        UpdateExpression: "SET #st = :u, gsi1pk = :inbox, gsi2pk = :unread, gsi2sk = gsi1sk",
        ExpressionAttributeNames: { "#st": "state" },
        ExpressionAttributeValues: { ":u": "unread", ":inbox": "INBOX", ":unread": "UNREAD" },
      }),
    );
    expect(await store.autoArchive("fx-example", "promo")).toBe(false);
  });

  it("archives week-old unread news except from Must Read newsletters", async () => {
    // Fixtures were received on 2026-10-01, so a cutoff a week after that catches them all.
    const news = ["fx-tldr", "fx-platformer"];
    for (const id of FIXTURE_NEWSLETTER_IDS) {
      await ddb.send(
        new UpdateCommand({
          TableName: stack.tableName,
          Key: issueKey(id),
          UpdateExpression: "SET shelf = :s",
          ExpressionAttributeValues: { ":s": news.includes(id) ? "news" : "learning" },
        }),
      );
    }
    const platformer = senderIdentity("casey@platformer.news", "").senderId;
    await ddb.send(
      new UpdateCommand({
        TableName: stack.tableName,
        Key: senderItemKey(platformer),
        UpdateExpression: "SET mustRead = :t",
        ExpressionAttributeValues: { ":t": true },
      }),
    );
    const now = Date.parse("2026-10-09T00:00:00.000Z");
    // The rule reads senders and unread news through GSIs, which lag the writes above: wait
    // until both show them, or Platformer can be archived before its Must Read star arrives.
    const cutoff = new Date(now - 7 * 86_400_000).toISOString();
    await eventually(
      () => Promise.all([store.senderSettings(), store.unreadNewsBefore(cutoff)]),
      ([senders, stale]) =>
        senders.get(platformer)?.mustRead === true &&
        stale
          .map((i) => i.id)
          .sort()
          .join() === "fx-platformer,fx-tldr",
    );
    expect(await archiveOldNews(store, { now })).toBe(1);
    expect((await get(issueKey("fx-tldr")))?.autoArchived).toBe("old-news");
    expect((await get(issueKey("fx-platformer")))?.state).toBe("unread"); // Must Read
    expect((await get(issueKey("fx-lenny")))?.state).toBe("unread"); // Learning
  });

  it("leaves a saved issue alone (#43)", async () => {
    const savedAt = "2026-10-02T00:00:00.000Z";
    await ddb.send(
      new UpdateCommand({
        TableName: stack.tableName,
        Key: issueKey("fx-lenny"),
        UpdateExpression: "SET savedAt = :at, gsi2pk = :saved, gsi2sk = :sk, shelf = :news",
        ExpressionAttributeValues: {
          ":at": savedAt,
          ":saved": "SAVED",
          ":sk": `${savedAt}#fx-lenny`,
          ":news": "news",
        },
      }),
    );
    expect(await store.autoArchive("fx-lenny", "promo")).toBe(false);
    expect(await archiveOldNews(store, { now: Date.parse("2026-10-09T00:00:00.000Z") })).toBe(0);
    expect((await get(issueKey("fx-lenny")))?.state).toBe("unread");
  });
});

describe("filing a stored issue as filtered on dev (#50)", () => {
  it("takes it out of every index, deletes its stories and lowers its sender's count", async () => {
    const id = "fx-pragmatic";
    const issue = (await get(issueKey(id)))!;
    const senderKey = senderItemKey(issue.senderId as string);
    const count = (await get(senderKey))?.issueCount as number;
    await store.putStories(
      { id, senderId: issue.senderId as string, receivedAt: issue.receivedAt as string },
      [
        {
          n: 1,
          headline: "H",
          summary: "S",
          names: [],
          eventId: "e1",
          vector: Array(512).fill(0.01),
        },
      ],
    );

    expect(await store.fileAsFiltered(id, "account", "claude")).toBe(true);
    const filtered = await get(issueKey(id));
    expect(filtered).toMatchObject({ state: "filtered", filterReason: "account" });
    for (const a of ["gsi1pk", "gsi1sk", "gsi2pk", "gsi2sk", "gsi3pk", "gsi3sk"]) {
      expect(filtered?.[a], a).toBeUndefined();
    }
    expect((await get(senderKey))?.issueCount).toBe(count - 1);
    expect(await get(storyKey(id, 1))).toBeUndefined();
    const events = await ddb.send(
      new QueryCommand({
        TableName: stack.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :evt)",
        ExpressionAttributeValues: { ":pk": issueKey(id).pk, ":evt": "EVT#" },
      }),
    );
    expect(events.Items).toContainEqual(
      expect.objectContaining({
        type: "state",
        value: "filtered",
        prev: "unread",
        by: "claude:account",
      }),
    );
    // Once is enough: the sender's count moves only once.
    expect(await store.fileAsFiltered(id, "account", "rule")).toBe(false);
    expect((await get(senderKey))?.issueCount).toBe(count - 1);
  });

  it("never files an issue Sandip rated or saved", async () => {
    // fx-lenny was saved above.
    expect(await store.fileAsFiltered("fx-lenny", "account", "rule")).toBe(false);
    await ddb.send(
      new UpdateCommand({
        TableName: stack.tableName,
        Key: issueKey("fx-bytebytego"),
        UpdateExpression: "SET rating = :r, ratedAt = :at",
        ExpressionAttributeValues: { ":r": 1, ":at": "2026-10-02T00:00:00.000Z" },
      }),
    );
    expect(await store.fileAsFiltered("fx-bytebytego", "account", "rule")).toBe(false);
    expect((await get(issueKey("fx-bytebytego")))?.state).not.toBe("filtered");
  });
});
