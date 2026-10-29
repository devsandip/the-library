/**
 * The move (#199): copy every item still on today's keys to the owner's, for READER_KEYS.
 *   AWS_PROFILE=admin pnpm move-to-reader                    prod: count what would move
 *   ... --apply                                             copy each (never over a copy there)
 *   ... --check                                             count the items still without a copy
 *   ... --delete-old                                        delete today's keys, once every one has
 *                                                           its copy and the stage runs on reader keys
 *   ... --stage dev                                         the dev stack
 * The owner comes from `CONFIG/OWNER` (`pnpm name-owner`). See docs/features/multi-reader.md.
 */
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { READER_KEYS } from "../infra/lib/config.js";
import { Store } from "../services/ingest/src/store.js";
import { stageArg } from "./ingest-lambda.js";
import { move } from "./move.js";

const REGION = "us-east-1";
const stage = stageArg();
const stack = (
  await new CloudFormationClient({ region: REGION }).send(
    new DescribeStacksCommand({ StackName: `TheLibrary-${stage}` }),
  )
).Stacks?.[0];
const table = stack?.Outputs?.find((o) => o.OutputKey === "TableName")?.OutputValue;
const bucket = stack?.Outputs?.find((o) => o.OutputKey === "ContentBucket")?.OutputValue;
if (!table || !bucket) throw new Error(`TheLibrary-${stage} has no TableName or ContentBucket`);

const owner = await new Store(table, bucket).owner();
if (!owner) {
  console.error(`${stage}: no owner named. Run: AWS_PROFILE=admin pnpm name-owner`);
  process.exit(1);
}

const mode = process.argv.includes("--apply")
  ? "apply"
  : process.argv.includes("--check")
    ? "check"
    : process.argv.includes("--delete-old")
      ? "delete"
      : "count";
if (mode === "delete" && !READER_KEYS[stage]) {
  console.error(`${stage} does not run on reader keys yet: today's keys are still the live ones`);
  process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
const r = await move(ddb, table, owner, mode);
const found = Object.values(r.found).reduce((a, b) => a + b, 0);
console.log(`${stage}: ${found} items on today's keys, for owner ${owner.id}`);
for (const [kind, n] of Object.entries(r.found).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(6)}  ${kind}`);
}
if (mode === "apply") console.log(`Copied ${r.copied}; ${r.already} had a copy already.`);
if (mode === "check" || mode === "delete") console.log(`${r.missing} without a copy.`);
if (mode === "delete") console.log(`Deleted ${r.deleted} on today's keys.`);
if (mode === "count") console.log("Dry run: nothing written. --apply copies them.");
