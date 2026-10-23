import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import {
  NodejsFunction,
  OutputFormat,
  type NodejsFunctionProps,
} from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Node 24 arm64 Lambda bundled locally by esbuild (no Docker). ESM output with a require shim
 * so CommonJS dependencies (mailparser, sanitize-html) still load. The runtime provides @aws-sdk.
 */
export function nodeFunction(
  scope: Construct,
  id: string,
  props: { entry: string; logRemoval: RemovalPolicy } & Omit<NodejsFunctionProps, "entry">,
) {
  const { entry, logRemoval, ...rest } = props;
  const logGroup = new LogGroup(scope, `${id}Logs`, {
    retention: RetentionDays.TWO_WEEKS,
    removalPolicy: logRemoval,
  });
  return new NodejsFunction(scope, id, {
    entry: join(REPO_ROOT, entry),
    projectRoot: REPO_ROOT,
    depsLockFilePath: join(REPO_ROOT, "pnpm-lock.yaml"),
    runtime: Runtime.NODEJS_24_X,
    architecture: Architecture.ARM_64,
    memorySize: 256,
    timeout: Duration.seconds(15),
    logGroup,
    bundling: {
      format: OutputFormat.ESM,
      target: "node24",
      mainFields: ["module", "main"],
      externalModules: ["@aws-sdk/*"],
      sourceMap: true,
      banner:
        "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
    },
    environment: { NODE_OPTIONS: "--enable-source-maps" },
    ...rest,
  });
}

/**
 * The Bedrock models ingest and the API call (keep in step with packages/core/src/claude.ts and
 * EMBED_MODEL in packages/core/src/vectors.ts): Claude Haiku 4.5, or 5.5 once the account has it,
 * through US cross-region inference profiles, which may run in any US region; and Titan Text
 * Embeddings V2 in this region.
 */
export function bedrockModels(scope: Construct): PolicyStatement {
  const { partition, region, account } = Stack.of(scope);
  return new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["bedrock:InvokeModel"],
    resources: [
      `arn:${partition}:bedrock:${region}:${account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
      `arn:${partition}:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
      `arn:${partition}:bedrock:${region}:${account}:inference-profile/us.anthropic.claude-haiku-5-5`,
      `arn:${partition}:bedrock:*::foundation-model/anthropic.claude-haiku-5-5`,
      `arn:${partition}:bedrock:${region}::foundation-model/amazon.titan-embed-text-v2:0`,
    ],
  });
}
