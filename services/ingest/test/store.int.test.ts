/**
 * Integration: the real Store against the dev stack's DynamoDB table and S3 bucket.
 * Run with `pnpm test:int` (needs AWS credentials and a deployed TheLibrary-dev).
 */
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import { INDEX, issueKey, s3Keys, senderIdentity, senderItemKey } from "@library/core";
import {
  docClient,
  devStack,
  FIXTURE_FILTERED_IDS,
  FIXTURE_NEWSLETTER_IDS,
  seedDev,
  wipeDevTable,
  type DevStack,
} from "../../../scripts/dev-stack.js";

let stack: DevStack;
const ddb = docClient();
const get = (key: Record<string, string>) =>
  ddb.send(new GetCommand({ TableName: stack.tableName, Key: key })).then((r) => r.Item);

/** GSIs are eventually consistent; poll until the expected count shows up. */
async function queryUntil(index: string, pk: string, want: number) {
  for (let i = 0; i < 20; i++) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: stack.tableName,
        IndexName: index,
        KeyConditionExpression: `${index}pk = :p`,
        ExpressionAttributeValues: { ":p": pk },
      }),
    );
    if ((res.Items?.length ?? 0) >= want) return res.Items ?? [];
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${index}/${pk} never reached ${want} items`);
}

beforeAll(async () => {
  stack = await devStack();
  await wipeDevTable(stack);
});

describe("Store on dev", () => {
  it("seeding twice stores each message once", async () => {
    const first = await seedDev(stack);
    const second = await seedDev(stack);
    expect(first).toEqual({ newsletters: 6, filtered: 4 });
    expect(second).toEqual(first); // processed again, but writes were no-ops

    const pragmatic = await get(
      senderItemKey(senderIdentity("pragmaticengineer@substack.com", "").senderId),
    );
    expect(pragmatic?.issueCount).toBe(1);
  });

  it("newsletters land in INBOX and UNREAD, newest first; filtered in neither", async () => {
    const inbox = await queryUntil(INDEX.list, "INBOX", 6);
    const unread = await queryUntil(INDEX.unread, "UNREAD", 6);
    expect(inbox.map((i) => i.id).sort()).toEqual([...FIXTURE_NEWSLETTER_IDS].sort());
    expect(unread).toHaveLength(6);
    for (const id of FIXTURE_FILTERED_IDS) {
      const item = await get(issueKey(id));
      expect(item?.state).toBe("filtered");
      expect(item?.gsi1pk).toBeUndefined();
    }
  });

  it("senders are listed once each with their readable key", async () => {
    const senders = await queryUntil(INDEX.list, "SENDERS", 6);
    expect(senders.map((s) => s.senderKey).sort()).toEqual(
      [
        "bytebytego@substack.com",
        "casey@platformer.news",
        "dan@tldrnewsletter.com",
        "hello@example-weekly.test",
        "lenny@substack.com",
        "pragmaticengineer@substack.com",
      ].sort(),
    );
    const bbg = senders.find((s) => s.senderKey === "bytebytego@substack.com");
    expect(bbg).toMatchObject({ muted: false, up: 0, down: 0, onKeepList: true });
    expect(bbg?.lastSeenAt).toBe("2026-10-01T12:00:00.000Z");
    expect(bbg?.unsubscribeUrl).toContain("bytebytego.substack.com");
  });

  it("writes raw, html and text objects for each newsletter", async () => {
    const s3 = new S3Client({ region: "us-east-1" });
    for (const key of Object.values(s3Keys("fx-bytebytego"))) {
      const head = await s3.send(new HeadObjectCommand({ Bucket: stack.contentBucket, Key: key }));
      expect(head.ContentLength).toBeGreaterThan(0);
    }
  });
});
