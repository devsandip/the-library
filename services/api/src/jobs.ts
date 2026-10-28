/**
 * The jobs Lambda: deep dives that may take longer than the API's 28 seconds. The API starts one
 * with an async invoke (no retries) and answers at once; the job keeps its result where the API's
 * GET finds it. Today that is the source check (#23).
 */
import { BedrockClaude } from "./claude.js";
import type { Job } from "./port.js";
import { DynamoRepo } from "./repo.js";
import { SourceChecker } from "./source.js";

export function createJobHandler(checker: Pick<SourceChecker, "check">) {
  return async (job: Job): Promise<void> => {
    const started = Date.now();
    try {
      if (job.kind !== "source") throw new Error(`unknown job ${String(job.kind)}`);
      await checker.check(job.id, job.n);
    } catch (err) {
      // The run is marked failed already; thrown so the Lambda counts the error.
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

export const handler = createJobHandler(
  new SourceChecker(
    new DynamoRepo({ table: TABLE_NAME!, bucket: BUCKET_NAME!, stage: STAGE ?? "unknown" }),
    new BedrockClaude(),
  ),
);
