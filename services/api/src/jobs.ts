/**
 * The jobs Lambda: deep dives that may take longer than the API's 28 seconds. The API starts one
 * with an async invoke (no retries) and answers at once; the job keeps its result where the API's
 * GET finds it. Source checks (#23) start that way; the day's settling of predictions (#139) on a
 * schedule, or by hand with `pnpm settle`.
 */
import { CLAUDE_MODEL } from "@library/core";
import type { SettleStats } from "@library/core/types";
import { BedrockClaude } from "./claude.js";
import { CorpusCache } from "./corpus.js";
import { TitanEmbedder } from "./embed.js";
import type { Job } from "./port.js";
import { DynamoRepo } from "./repo.js";
import { Settler } from "./settle.js";
import { SourceChecker } from "./source.js";

export function createJobHandler(work: {
  checker: Pick<SourceChecker, "check">;
  settler: Pick<Settler, "settleDue">;
}) {
  return async (job: Job): Promise<SettleStats | void> => {
    const started = Date.now();
    try {
      if (job.kind === "source") {
        await work.checker.check(job.id, job.n);
        return;
      }
      if (job.kind === "settle") return await work.settler.settleDue(job.limit);
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
const repo = new DynamoRepo({
  table: TABLE_NAME!,
  bucket: BUCKET_NAME!,
  stage: STAGE ?? "unknown",
});
const claude = new BedrockClaude();

export const handler = createJobHandler({
  checker: new SourceChecker(repo, claude),
  settler: new Settler(repo, new CorpusCache(repo), new TitanEmbedder(), claude, CLAUDE_MODEL),
});
