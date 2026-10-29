/**
 * The jobs Lambda: deep dives that may take longer than the API's 28 seconds. The API starts one
 * with an async invoke (no retries) and answers at once; the job keeps its result where the API's
 * GET finds it. Source checks (#23) start that way; the day's settling of predictions (#139) on a
 * schedule, or by hand with `pnpm settle`.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { CLAUDE_MODEL } from "@library/core";
import { readerOf, type Reader } from "@library/core/reader";
import type { SettleStats } from "@library/core/types";
import { BedrockClaude } from "./claude.js";
import { CorpusCache } from "./corpus.js";
import { TitanEmbedder } from "./embed.js";
import type { Job } from "./port.js";
import { DynamoRepo } from "./repo.js";
import { Settler } from "./settle.js";
import { SourceChecker } from "./source.js";

/**
 * The jobs Lambda's handler. A source check runs for the reader who asked for it (#179); settling
 * runs for the owner (#180), until the daily jobs run per reader.
 */
export function createJobHandler(
  workFor: (reader: Reader | undefined) => {
    checker: Pick<SourceChecker, "check">;
    settler: Pick<Settler, "settleDue">;
  },
  owner: () => Promise<Reader | undefined>,
) {
  return async (job: Job): Promise<SettleStats | void> => {
    const started = Date.now();
    try {
      if (job.kind === "source") {
        await workFor(readerOf(job.reader)).checker.check(job.id, job.n);
        return;
      }
      if (job.kind === "settle") return await workFor(await owner()).settler.settleDue(job.limit);
      throw new Error(`unknown job ${String((job as { kind: unknown }).kind)}`);
    } catch (err) {
      // A source check's run is marked failed already; thrown so the Lambda counts the error.
      console.error(
        JSON.stringify({
          level: "error",
          msg: "job failed",
          job,
          error: String(err),
          stack: (err as Error).stack,
        }),
      );
      throw err;
    } finally {
      console.log(JSON.stringify({ level: "info", msg: "job", job, ms: Date.now() - started }));
    }
  };
}

const { TABLE_NAME, BUCKET_NAME, STAGE } = process.env;
const ddb = new DynamoDBClient({});
const s3 = new S3Client({});
const claude = new BedrockClaude();

const repoFor = (reader: Reader | undefined) =>
  new DynamoRepo({
    table: TABLE_NAME!,
    bucket: BUCKET_NAME!,
    stage: STAGE ?? "unknown",
    reader,
    ddb,
    s3,
  });

export const handler = createJobHandler(
  (reader) => {
    const repo = repoFor(reader);
    return {
      checker: new SourceChecker(repo, claude),
      settler: new Settler(repo, new CorpusCache(repo), new TitanEmbedder(), claude, CLAUDE_MODEL),
    };
  },
  () => repoFor(undefined).owner(),
);
