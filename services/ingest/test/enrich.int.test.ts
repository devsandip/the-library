/**
 * Integration: enrichment and the archive rules against the dev table, with real Bedrock.
 * Titan embeddings always run. Claude classification runs only when the account has Anthropic
 * model access (a one-time form in the Bedrock console); otherwise those tests are skipped.
 */
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import { embeddingKey, issueKey, senderIdentity, senderItemKey, TOPICS_KEY } from "@library/core";
import type { Topic } from "@library/core/types";
import { Bedrock, MODELS } from "../src/bedrock.js";
import { archiveOldNews, enrich } from "../src/enrich.js";
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
    expect(stats).toMatchObject({ classified: 6, errors: 0 });
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
    await ddb.send(
      new UpdateCommand({
        TableName: stack.tableName,
        Key: senderItemKey(senderIdentity("casey@platformer.news", "").senderId),
        UpdateExpression: "SET mustRead = :t",
        ExpressionAttributeValues: { ":t": true },
      }),
    );
    const now = Date.parse("2026-10-09T00:00:00.000Z");
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
