/**
 * Integration: spotting predictions (#24) against the dev table and bucket, with a fake model (no
 * Claude calls). One fixture's stored text is given a forward-looking sentence; the rest have none.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeAll, describe, expect, it } from "vitest";
import { issueKey, PREDICTIONS_PK, s3Keys } from "@library/core";
import type { ModelPort, ToolRequest } from "../src/bedrock.js";
import { spotPredictions } from "../src/predictions.js";
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
const ddb = docClient();
const since = "2020-01-01T00:00:00.000Z";
const said = "Acme will ship its first robot by March 2027, its founder told investors.";

const calls: ToolRequest[] = [];
const model: ModelPort = {
  callTool: async (req) => {
    calls.push(req);
    return {
      input: {
        predictions: [
          {
            text: "Acme will ship its first robot by March 2027.",
            who: "Acme's founder",
            own: false,
            kind: "promise",
            quote: "Acme will ship its first robot by March 2027",
            by: "2027-03",
            story: 0,
          },
        ],
      },
      inputTokens: 1,
      outputTokens: 1,
    };
  },
  embed: async () => ({ vector: [], tokens: 0 }),
};

beforeAll(async () => {
  stack = await devStack();
  store = new Store(stack.tableName, stack.contentBucket);
  await wipeDevTable(stack);
  await seedDev(stack);
  await new S3Client({ region: "us-east-1" }).send(
    new PutObjectCommand({
      Bucket: stack.contentBucket,
      Key: s3Keys("fx-tldr").text,
      Body: `Headlines and launches. ${said} Model news two.`,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
});

describe("predictions on dev", () => {
  it("screens every fixture newsletter and keeps the one prediction, due at its period's end", async () => {
    const stats = await spotPredictions(store, model, { sinceIso: since });
    const n = FIXTURE_NEWSLETTER_IDS.length;
    expect(stats).toMatchObject({ checked: n, screened: n, called: 1, predictions: 1, errors: 0 });
    expect(calls[0]!.user).toContain(said);

    const kept = await ddb.send(
      new QueryCommand({
        TableName: stack.tableName,
        KeyConditionExpression: "pk = :p",
        ExpressionAttributeValues: { ":p": PREDICTIONS_PK },
        ConsistentRead: true,
      }),
    );
    expect(kept.Items).toHaveLength(1);
    expect(kept.Items![0]).toMatchObject({
      id: "fx-tldr.1",
      issueId: "fx-tldr",
      who: "Acme's founder",
      own: false,
      quote: "Acme will ship its first robot by March 2027",
      due: "2027-03-31",
      kind: "promise",
      status: "open",
    });
    const issue = await ddb.send(
      new GetCommand({
        TableName: stack.tableName,
        Key: issueKey("fx-tldr"),
        ConsistentRead: true,
      }),
    );
    expect(issue.Item).toMatchObject({ predictionCount: 1 });

    const again = await spotPredictions(store, model, { sinceIso: since });
    expect(again).toMatchObject({ checked: 0, screened: 0, called: 0 });
  });

  it("screens again when forced, overwriting the open prediction in one batch (#143)", async () => {
    const reworded: ModelPort = {
      ...model,
      callTool: async () => ({
        input: {
          predictions: [
            {
              text: "Acme's first robot ships by March 2027.",
              who: "Acme's founder",
              own: false,
              kind: "promise",
              quote: "its first robot by March 2027, its founder told investors",
              by: "2027-03",
              story: 0,
            },
          ],
        },
        inputTokens: 1,
        outputTokens: 1,
      }),
    };
    const stats = await spotPredictions(store, reworded, { sinceIso: since, force: true });
    expect(stats).toMatchObject({ screened: FIXTURE_NEWSLETTER_IDS.length, errors: 0 });
    const kept = await ddb.send(
      new QueryCommand({
        TableName: stack.tableName,
        KeyConditionExpression: "pk = :p",
        ExpressionAttributeValues: { ":p": PREDICTIONS_PK },
        ConsistentRead: true,
      }),
    );
    expect(kept.Items).toHaveLength(1);
    expect(kept.Items![0]).toMatchObject({
      id: "fx-tldr.1",
      quote: "its first robot by March 2027, its founder told investors",
    });
  });
});
