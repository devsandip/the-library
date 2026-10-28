/** Shared by the scripts that run a job in the ingest Lambda (one run at a time, like ingest) or the jobs Lambda. */
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { NodeHttpHandler } from "@smithy/node-http-handler";

const region = "us-east-1";

/** `--stage dev` targets the dev stack; prod otherwise. */
export const stageArg = (): "dev" | "prod" =>
  process.argv[process.argv.indexOf("--stage") + 1] === "dev" ? "dev" : "prod";

export const numberArg = (name: string, fallback: number): number =>
  process.argv.includes(name)
    ? Number(process.argv[process.argv.indexOf(name) + 1]) || fallback
    : fallback;

/** Invoke the stage's ingest Lambda and wait (up to 11 minutes). Exits on a function error. */
export function invokeIngest<T>(stage: "dev" | "prod", payload: unknown): Promise<T> {
  return invokeOutput<T>(stage, "IngestFunction", payload);
}

/** Invoke the stage's jobs Lambda (#23, #139) and wait. Exits on a function error. */
export function invokeJobs<T>(stage: "dev" | "prod", payload: unknown): Promise<T> {
  return invokeOutput<T>(stage, "JobsFunction", payload);
}

async function invokeOutput<T>(
  stage: "dev" | "prod",
  output: string,
  payload: unknown,
): Promise<T> {
  const stack = (
    await new CloudFormationClient({ region }).send(
      new DescribeStacksCommand({ StackName: `TheLibrary-${stage}` }),
    )
  ).Stacks?.[0];
  const fn = stack?.Outputs?.find((o) => o.OutputKey === output)?.OutputValue;
  if (!fn) throw new Error(`TheLibrary-${stage} has no ${output} output`);

  const lambda = new LambdaClient({
    region,
    requestHandler: new NodeHttpHandler({ requestTimeout: 11 * 60_000 }),
  });
  const res = await lambda.send(
    new InvokeCommand({ FunctionName: fn, Payload: Buffer.from(JSON.stringify(payload)) }),
  );
  const out = JSON.parse(Buffer.from(res.Payload ?? []).toString() || "null") as unknown;
  if (res.FunctionError) {
    console.error("Failed:", (out as { errorMessage?: string } | null)?.errorMessage ?? out);
    process.exit(1);
  }
  return out as T;
}
