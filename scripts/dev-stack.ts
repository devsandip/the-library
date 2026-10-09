/**
 * Helpers for the disposable dev stack: locate it, wipe it, seed it with fixture emails.
 * Every destructive helper refuses to run unless the target stack is TheLibrary-dev, tagged
 * stage=dev, and reports Stage=dev in its outputs.
 */
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
  type ScanCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { processMessage } from "@library/core";
import { Store } from "../services/ingest/src/store.js";
import * as f from "../packages/core/test/fixtures.js";

export const REGION = "us-east-1";
export const DEV_STACK = "TheLibrary-dev";

export interface DevStack {
  tableName: string;
  contentBucket: string;
  ingestFunction: string;
  apiFunction?: string;
}

export async function devStack(): Promise<DevStack> {
  const cfn = new CloudFormationClient({ region: REGION });
  const stack = (await cfn.send(new DescribeStacksCommand({ StackName: DEV_STACK }))).Stacks?.[0];
  if (!stack) throw new Error(`${DEV_STACK} is not deployed`);
  const out = (key: string) => stack.Outputs?.find((o) => o.OutputKey === key)?.OutputValue;
  const tag = stack.Tags?.find((t) => t.Key === "stage")?.Value;
  if (out("Stage") !== "dev" || tag !== "dev") {
    throw new Error(`Refusing: ${DEV_STACK} does not identify as stage=dev (output/tag mismatch)`);
  }
  const tableName = out("TableName");
  const contentBucket = out("ContentBucket");
  const ingestFunction = out("IngestFunction");
  if (!tableName || !contentBucket || !ingestFunction) {
    throw new Error(`${DEV_STACK} is missing outputs`);
  }
  return { tableName, contentBucket, ingestFunction, apiFunction: out("ApiFunction") };
}

export const docClient = () =>
  DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
    marshallOptions: { removeUndefinedValues: true },
  });

/** Delete every item in the dev table. */
export async function wipeDevTable(stack: DevStack): Promise<number> {
  if (!/TheLibrary-dev/.test(stack.tableName)) {
    throw new Error(`Refusing to wipe ${stack.tableName}: not a dev table`);
  }
  const ddb = docClient();
  let deleted = 0;
  let start: Record<string, unknown> | undefined;
  do {
    const page: ScanCommandOutput = await ddb.send(
      new ScanCommand({
        TableName: stack.tableName,
        ProjectionExpression: "pk, sk",
        ExclusiveStartKey: start,
      }),
    );
    const keys = (page.Items ?? []).map((i) => ({ pk: i.pk, sk: i.sk }));
    for (let i = 0; i < keys.length; i += 25) {
      let requests = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
      while (requests.length) {
        const res = await ddb.send(
          new BatchWriteCommand({ RequestItems: { [stack.tableName]: requests } }),
        );
        requests = (res.UnprocessedItems?.[stack.tableName] ?? []) as typeof requests;
      }
    }
    deleted += keys.length;
    start = page.LastEvaluatedKey;
  } while (start);
  return deleted;
}

/**
 * The fixture inbox. IDs and times are synthetic and stable, so tests can refer to them.
 * Times are one hour apart, newest first.
 */
export const FIXTURE_INBOX: { id: string; raw: Buffer; labelIds: string[] }[] = [
  { id: "fx-bytebytego", raw: f.substackByteByteGo, labelIds: ["INBOX"] },
  { id: "fx-platformer", raw: f.platformerLabeled, labelIds: [f.LABEL_NEWSLETTERS] },
  { id: "fx-tldr", raw: f.tldrPlainText, labelIds: [f.LABEL_MECO] },
  { id: "fx-lenny", raw: f.lennyWildcard, labelIds: ["INBOX"] },
  { id: "fx-pragmatic", raw: f.pragmaticDeepDive, labelIds: ["INBOX"] },
  { id: "fx-example", raw: f.mixedImages, labelIds: [f.LABEL_NEWSLETTERS] },
  { id: "fx-github", raw: f.githubNoise, labelIds: [f.LABEL_NEWSLETTERS] },
  { id: "fx-notes", raw: f.substackNotes, labelIds: [f.LABEL_MECO] },
  { id: "fx-receipt", raw: f.stripeReceipt, labelIds: [f.LABEL_NEWSLETTERS] },
  { id: "fx-random", raw: f.randomSubstack, labelIds: [] },
];
export const FIXTURE_NEWSLETTER_IDS = FIXTURE_INBOX.slice(0, 6).map((m) => m.id);
export const FIXTURE_FILTERED_IDS = FIXTURE_INBOX.slice(6).map((m) => m.id);
const BASE_TIME = Date.parse("2026-10-01T12:00:00.000Z");

/** Run every fixture through the real pipeline and Store, exactly as ingest does. */
export async function seedDev(stack: DevStack) {
  const store = new Store(stack.tableName, stack.contentBucket);
  const counts = { newsletters: 0, filtered: 0 };
  for (const [i, m] of FIXTURE_INBOX.entries()) {
    const internalDate = String(BASE_TIME - i * 3_600_000);
    const p = await processMessage({ ...m, internalDate });
    if (p.kind === "newsletter") {
      await store.putNewsletter(p, m.raw);
      counts.newsletters++;
    } else {
      await store.putFiltered(p);
      counts.filtered++;
    }
  }
  return counts;
}
