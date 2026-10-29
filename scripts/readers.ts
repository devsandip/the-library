/**
 * The operator's view of readers (#210): every reader the scheduled work serves, the owner first,
 * with their time zone and today's model use.
 *   AWS_PROFILE=admin pnpm readers                 prod
 *   ... --stage dev                               the dev stack
 */
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { LIMITED } from "@library/core/usage";
import { READER_KEYS } from "../infra/lib/config.js";
import { DynamoRepo } from "../services/api/src/repo.js";
import { stageArg } from "./ingest-lambda.js";

const REGION = "us-east-1";
const stage = stageArg();
const stack = (
  await new CloudFormationClient({ region: REGION }).send(
    new DescribeStacksCommand({ StackName: `TheLibrary-${stage}` }),
  )
).Stacks?.[0];
const out = (key: string) => stack?.Outputs?.find((o) => o.OutputKey === key)?.OutputValue;
const table = out("TableName");
const bucket = out("ContentBucket");
if (!table || !bucket) throw new Error(`TheLibrary-${stage} has no TableName or ContentBucket`);

const base = new DynamoRepo({ table, bucket, stage });
const owner = await base.owner();
const readers = await base.readers();
console.log(
  `${stage}: ${readers.length} readers, ${READER_KEYS[stage] ? "on reader keys" : "on today's keys (one library)"}`,
);
for (const reader of readers) {
  const repo = new DynamoRepo({ table, bucket, stage, reader, keyed: READER_KEYS[stage] });
  const [{ timeZone }, { days }] = await Promise.all([repo.settings(), repo.usage(1)]);
  const today = days[0];
  const uses = LIMITED.map((f) => `${f} ${today?.features[f]?.calls ?? 0}`).join(", ");
  console.log(
    `  ${reader.id}${reader.id === owner?.id ? " (owner)" : ""}  ${timeZone}  ` +
      `today ${(today?.cents ?? 0).toFixed(2)}¢  calls: ${uses}`,
  );
}
