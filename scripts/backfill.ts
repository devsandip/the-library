/**
 * Import past issues by running the prod ingest Lambda with a longer look-back:
 *   AWS_PROFILE=admin pnpm backfill [--weeks 4]
 * Safe to rerun: already-stored messages are skipped.
 */
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { IngestStats } from "@library/core";

const weeks = Number(process.argv[process.argv.indexOf("--weeks") + 1]) || 4;
const region = "us-east-1";

const stack = (
  await new CloudFormationClient({ region }).send(
    new DescribeStacksCommand({ StackName: "TheLibrary-prod" }),
  )
).Stacks?.[0];
const fn = stack?.Outputs?.find((o) => o.OutputKey === "IngestFunction")?.OutputValue;
if (!fn) throw new Error("TheLibrary-prod has no IngestFunction output");

console.log(`Backfilling ${weeks} weeks via ${fn} (can take a few minutes)...`);
// The Lambda may run up to 10 minutes; wait for it.
const lambda = new LambdaClient({
  region,
  requestHandler: new NodeHttpHandler({ requestTimeout: 11 * 60_000 }),
});
const res = await lambda.send(
  new InvokeCommand({
    FunctionName: fn,
    Payload: Buffer.from(JSON.stringify({ newerThanDays: weeks * 7, maxMessages: 5000 })),
  }),
);
const payload = JSON.parse(Buffer.from(res.Payload ?? []).toString() || "null") as
  IngestStats | { errorMessage?: string };
if (res.FunctionError) {
  console.error("Ingest reported errors:", (payload as { errorMessage?: string })?.errorMessage);
  console.error("Stored messages stay stored; rerun to retry the failed ones.");
  process.exit(1);
}
const s = payload as IngestStats;
console.log(
  `Done in ${Math.round(s.durationMs / 1000)}s: ${s.listed} listed, ${s.newsletters} newsletters, ` +
    `${s.filtered} filtered, ${s.alreadyStored} already stored, ${s.errors} errors.`,
);
