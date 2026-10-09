/**
 * Re-key stored issues and rebuild sender items after changing the sender rules in
 * packages/core/src/sources.ts (aliases, split-by-name):
 *   AWS_PROFILE=admin pnpm rebuild-senders            dry run against prod: prints the plan
 *   AWS_PROFILE=admin pnpm rebuild-senders --apply    writes it
 *   ... --stage dev                                   same against the dev stack
 * Deploy first: the rebuild runs in the ingest Lambda with the deployed rules, one run at a time.
 * Read state, ratings and mutes are kept.
 */
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { RebuildReport } from "../services/ingest/src/senders.js";

const apply = process.argv.includes("--apply");
const stage = process.argv[process.argv.indexOf("--stage") + 1] === "dev" ? "dev" : "prod";
const region = "us-east-1";

const stack = (
  await new CloudFormationClient({ region }).send(
    new DescribeStacksCommand({ StackName: `TheLibrary-${stage}` }),
  )
).Stacks?.[0];
const fn = stack?.Outputs?.find((o) => o.OutputKey === "IngestFunction")?.OutputValue;
if (!fn) throw new Error(`TheLibrary-${stage} has no IngestFunction output`);

const lambda = new LambdaClient({
  region,
  requestHandler: new NodeHttpHandler({ requestTimeout: 11 * 60_000 }),
});
const res = await lambda.send(
  new InvokeCommand({
    FunctionName: fn,
    Payload: Buffer.from(JSON.stringify({ rebuildSenders: { apply } })),
  }),
);
const out = JSON.parse(Buffer.from(res.Payload ?? []).toString() || "null") as
  RebuildReport | { errorMessage?: string };
if (res.FunctionError) {
  console.error("Rebuild failed:", (out as { errorMessage?: string }).errorMessage);
  process.exit(1);
}

const r = out as RebuildReport;
const list = (title: string, lines: string[]) => {
  if (!lines.length) return;
  console.log(`\n${title} (${lines.length}):`);
  for (const l of lines) console.log(`  ${l}`);
};
console.log(
  `${stage}: ${r.issues} issues, ${r.sendersBefore} senders -> ${r.sendersAfter}. ` +
    `${r.issuesRekeyed} issues re-keyed.`,
);
list("New senders (issues)", r.created);
list("Renamed", r.renamed);
list("Recounted", r.recounted);
list("Removed (no issues left)", r.deleted);
const changes =
  r.issuesRekeyed + r.created.length + r.renamed.length + r.recounted.length + r.deleted.length;
if (!changes) console.log("\nNothing to change.");
else if (!r.applied) console.log("\nDry run: nothing written. Rerun with --apply to write it.");
else console.log("\nApplied.");
