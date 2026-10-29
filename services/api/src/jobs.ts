/**
 * The jobs Lambda: deep dives that may take longer than the API's 28 seconds. The API starts one
 * with an async invoke (no retries) and answers at once; the job keeps its result where the API's
 * GET finds it. Source checks (#23) start that way; the day's settling of predictions (#139) on a
 * schedule, or by hand with `pnpm settle`.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { CLAUDE_MODEL, localHour } from "@library/core";
import { readerOf, type Reader } from "@library/core/reader";
import type { SettleStats } from "@library/core/types";

/** The hour of a reader's day their predictions are settled (#139, #211). */
const DAILY_HOUR = 7;
import { deleteSignIn } from "./account.js";
import { BedrockClaude } from "./claude.js";
import { CorpusCache } from "./corpus.js";
import { meteredClaude, meteredEmbedder } from "./meter.js";
import type { Job } from "./port.js";
import { DynamoRepo } from "./repo.js";
import { Settler } from "./settle.js";
import { SourceChecker } from "./source.js";

/** What the hourly round did (#211): the readers whose 07:00 it was, and their settling. */
export interface DailyStats {
  at: string;
  settled: { reader?: string; stats: SettleStats }[];
}

/**
 * The jobs Lambda's handler. A source check runs for the reader who asked for it (#179); `settle`
 * runs for the owner (#180); the hourly round (#211) settles each reader whose clock reads 07:xx.
 */
export function createJobHandler(
  workFor: (reader: Reader | undefined) => {
    checker: Pick<SourceChecker, "check">;
    settler: Pick<Settler, "settleDue">;
  },
  deps: {
    /** Deletes everything a reader has, then their sign-in (#220). */
    deleteAccount?: (reader: Reader) => Promise<unknown>;
    owner: () => Promise<Reader | undefined>;
    /** The readers the round serves; one undefined reader is the one library. */
    readers: () => Promise<(Reader | undefined)[]>;
    timeZoneOf: (reader: Reader | undefined) => Promise<string>;
  },
) {
  return async (job: Job): Promise<SettleStats | DailyStats | unknown> => {
    const started = Date.now();
    try {
      if (job.kind === "source") {
        await workFor(readerOf(job.reader)).checker.check(job.id, job.n);
        return;
      }
      if (job.kind === "settle") {
        return await workFor(await deps.owner()).settler.settleDue(job.limit);
      }
      if (job.kind === "delete-account") {
        const reader = readerOf(job.reader);
        if (!reader || !deps.deleteAccount) throw new Error("no reader to delete");
        return await deps.deleteAccount(reader);
      }
      if (job.kind === "daily") {
        const at = job.at ? Date.parse(job.at) : Date.now();
        const settled: DailyStats["settled"] = [];
        for (const reader of await deps.readers()) {
          if (localHour(at, await deps.timeZoneOf(reader)) !== DAILY_HOUR) continue;
          const stats = await workFor(reader).settler.settleDue();
          settled.push({ ...(reader ? { reader: reader.id } : {}), stats });
        }
        return { at: new Date(at).toISOString(), settled };
      }
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

const { TABLE_NAME, BUCKET_NAME, STAGE, READER_KEYS, USER_POOL_ID } = process.env;
const ddb = new DynamoDBClient({});
const s3 = new S3Client({});
const claude = new BedrockClaude();

const repoFor = (reader: Reader | undefined) =>
  new DynamoRepo({
    table: TABLE_NAME!,
    bucket: BUCKET_NAME!,
    stage: STAGE ?? "unknown",
    reader,
    keyed: READER_KEYS === "1",
    ddb,
    s3,
  });

export const handler = createJobHandler(
  (reader) => {
    const repo = repoFor(reader);
    // Every model call is recorded against the reader the job runs for (#208).
    const meter = { record: repo.recordUsage.bind(repo) };
    return {
      checker: new SourceChecker(repo, meteredClaude(claude, "source", meter)),
      settler: new Settler(
        repo,
        new CorpusCache(repo),
        meteredEmbedder("settle", meter),
        meteredClaude(claude, "settle", meter),
        CLAUDE_MODEL,
      ),
    };
  },
  {
    deleteAccount: async (reader) => {
      const repo = repoFor(reader);
      if ((await repo.deletable()) !== "yes") throw new Error("not deletable");
      const deleted = await repo.deleteEverything();
      const signIn = await deleteSignIn(reader, USER_POOL_ID);
      return { ...deleted, signIn };
    },
    owner: () => repoFor(undefined).owner(),
    // On reader keys, every reader; on today's keys there is one library, the owner's.
    readers: async () => {
      const base = repoFor(undefined);
      if (READER_KEYS !== "1") return [await base.owner()];
      const all = await base.readers();
      return all.length ? all : [undefined];
    },
    timeZoneOf: async (reader) => (await repoFor(reader).settings()).timeZone,
  },
);
