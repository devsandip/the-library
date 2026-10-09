/**
 * Integration: rebuilding senders on the dev table re-keys issues stored under the old sender
 * rules (one merged TLDR sender, author names), recomputes sender items, and is idempotent.
 */
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import {
  issueIndexAttributes,
  issueKey,
  senderIdentity,
  senderIndexAttributes,
  senderItemKey,
} from "@library/core";
import { rebuildSenders, type RebuildReport } from "../src/senders.js";
import { Store } from "../src/store.js";
import {
  docClient,
  devStack,
  seedDev,
  wipeDevTable,
  type DevStack,
} from "../../../scripts/dev-stack.js";

let stack: DevStack;
const ddb = docClient();
const lambda = new LambdaClient({ region: "us-east-1" });
const sid = (addr: string, name = "") => senderIdentity(addr, name).senderId;
const legacyTldr = sid("dan@tldrnewsletter.com"); // the merged sender before the split rule
const casey = sid("casey@platformer.news");

const get = (key: Record<string, string>) =>
  ddb
    .send(new GetCommand({ TableName: stack.tableName, Key: key, ConsistentRead: true }))
    .then((r) => r.Item);

/** A TLDR issue as stored before the split rule: merged sender, no From name kept. */
async function putLegacyTldrIssue(id: string, publication: string, receivedAt: string, rating?: 1) {
  const idx = issueIndexAttributes({
    id,
    senderId: legacyTldr,
    receivedAt,
    state: "unread",
    rating,
    ratedAt: rating ? receivedAt : undefined,
  });
  await ddb.send(
    new PutCommand({
      TableName: stack.tableName,
      Item: {
        ...issueKey(id),
        ...idx.set,
        id,
        senderId: legacyTldr,
        publication,
        fromAddr: "dan@tldrnewsletter.com",
        subject: `${publication}: legacy issue`,
        receivedAt,
        snippet: "",
        state: "unread",
        ...(rating ? { rating, ratedAt: receivedAt } : {}),
      },
    }),
  );
}

beforeAll(async () => {
  stack = await devStack();
  await wipeDevTable(stack);
  await seedDev(stack);

  await putLegacyTldrIssue("fx-legacy-tldr-dev", "TLDR Dev", "2026-09-30T06:00:00.000Z");
  await putLegacyTldrIssue("fx-legacy-tldr-it", "TLDR IT", "2026-09-30T07:00:00.000Z", 1);
  await ddb.send(
    new PutCommand({
      TableName: stack.tableName,
      Item: {
        ...senderItemKey(legacyTldr),
        ...senderIndexAttributes(legacyTldr, "TLDR Dev"),
        senderId: legacyTldr,
        senderKey: "dan@tldrnewsletter.com",
        publication: "TLDR Dev",
        muted: true,
        mustRead: true,
        up: 1,
        down: 0,
        issueCount: 2,
        addresses: new Set(["dan@tldrnewsletter.com"]),
        lastSeenAt: "2026-09-30T07:00:00.000Z",
      },
    }),
  );

  // Platformer as stored before its alias: named after the author, no From name kept.
  await ddb.send(
    new UpdateCommand({
      TableName: stack.tableName,
      Key: issueKey("fx-platformer"),
      UpdateExpression: "SET publication = :p REMOVE fromName",
      ExpressionAttributeValues: { ":p": "Casey Newton" },
    }),
  );
  await ddb.send(
    new UpdateCommand({
      TableName: stack.tableName,
      Key: senderItemKey(casey),
      UpdateExpression: "SET publication = :p, gsi1sk = :sk",
      ExpressionAttributeValues: {
        ":p": "Casey Newton",
        ":sk": senderIndexAttributes(casey, "Casey Newton").gsi1sk,
      },
    }),
  );
});

describe("rebuild senders on dev", () => {
  it("a dry run reports the plan and writes nothing", async () => {
    const report = await rebuildSenders(new Store(stack.tableName, stack.contentBucket), {
      apply: false,
    });
    expect(report).toMatchObject({
      applied: false,
      issuesRekeyed: 3,
      renamed: ["Casey Newton -> Platformer"],
      recounted: [],
      deleted: ["TLDR Dev"],
    });
    expect([...report.created].sort()).toEqual(["TLDR Dev (1)", "TLDR IT (1)"]);
    expect((await get(senderItemKey(legacyTldr)))?.issueCount).toBe(2);
  });

  it("apply splits and renames senders, keeping ratings, mutes and stars", async () => {
    const report = await rebuildSenders(new Store(stack.tableName, stack.contentBucket), {
      apply: true,
    });
    expect(report).toMatchObject({ applied: true, errors: 0 });

    const dev = sid("dan@tldrnewsletter.com", "TLDR Dev");
    const it_ = sid("dan@tldrnewsletter.com", "TLDR IT");
    expect(await get(issueKey("fx-legacy-tldr-it"))).toMatchObject({
      senderId: it_,
      gsi3pk: `SENDER#${it_}`,
      rating: 1,
      state: "unread",
    });
    expect(await get(senderItemKey(it_))).toMatchObject({
      publication: "TLDR IT",
      issueCount: 1,
      up: 1,
      muted: true,
      mustRead: true,
    });
    expect(await get(senderItemKey(dev))).toMatchObject({
      publication: "TLDR Dev",
      issueCount: 1,
      up: 0,
      muted: true,
    });
    expect(await get(senderItemKey(legacyTldr))).toBeUndefined();

    expect(await get(senderItemKey(casey))).toMatchObject({
      publication: "Platformer",
      gsi1sk: senderIndexAttributes(casey, "Platformer").gsi1sk,
      issueCount: 1,
    });
    expect((await get(issueKey("fx-platformer")))?.publication).toBe("Platformer");
  });

  it("a second run, through the dev Lambda, finds nothing to change", async () => {
    const res = await lambda.send(
      new InvokeCommand({
        FunctionName: stack.ingestFunction,
        Payload: Buffer.from(JSON.stringify({ rebuildSenders: {} })),
      }),
    );
    expect(res.FunctionError).toBeUndefined();
    const report = JSON.parse(Buffer.from(res.Payload!).toString()) as RebuildReport;
    expect(report).toMatchObject({
      applied: false,
      issuesRekeyed: 0,
      created: [],
      renamed: [],
      recounted: [],
      deleted: [],
    });
  });
});
