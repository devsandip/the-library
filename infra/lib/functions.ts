import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
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
