/**
 * Re-run the current classify/sanitize/extract code on stored prod issues from their raw MIME:
 *   AWS_PROFILE=admin pnpm reprocess [--days 30]
 * Use after changing packages/core. Raw messages are kept 30 days, so older issues are skipped.
 * State, ratings and sender counts are never touched.
 */
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { ReprocessStats } from "../services/ingest/src/reprocess.js";

const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || 30;
const region = "us-east-1";

const stack = (
  await new CloudFormationClient({ region }).send(
    new DescribeStacksCommand({ StackName: "TheLibrary-prod" }),
  )
).Stacks?.[0];
const fn = stack?.Outputs?.find((o) => o.OutputKey === "IngestFunction")?.OutputValue;
if (!fn) throw new Error("TheLibrary-prod has no IngestFunction output");

const lambda = new LambdaClient({
  region,
  requestHandler: new NodeHttpHandler({ requestTimeout: 11 * 60_000 }),
});
const res = await lambda.send(
  new InvokeCommand({
    FunctionName: fn,
    Payload: Buffer.from(JSON.stringify({ reprocess: { days } })),
  }),
);
const out = JSON.parse(Buffer.from(res.Payload ?? []).toString() || "null") as
  ReprocessStats | { errorMessage?: string };
if (res.FunctionError) {
  console.error("Reprocess reported errors:", (out as { errorMessage?: string }).errorMessage);
  process.exit(1);
}
const s = out as ReprocessStats;
console.log(
  `Since ${s.since}: ${s.checked} checked, ${s.updated} updated, ${s.missingRaw} past raw retention, ` +
    `${s.nowFiltered} would now be filtered (left as is).`,
);
