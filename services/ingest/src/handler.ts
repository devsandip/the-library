import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { Gmail, type GmailCredentials } from "./gmail.js";
import { ingest } from "./ingest.js";
import { reprocess } from "./reprocess.js";
import { Store } from "./store.js";

const { TABLE_NAME, BUCKET_NAME, GMAIL_PARAM, STAGE } = process.env;

let gmail: Gmail | undefined;
const store = new Store(TABLE_NAME!, BUCKET_NAME!);

async function getGmail(): Promise<Gmail> {
  if (gmail) return gmail;
  const res = await new SSMClient({}).send(
    new GetParameterCommand({ Name: GMAIL_PARAM, WithDecryption: true }),
  );
  gmail = new Gmail(JSON.parse(res.Parameter!.Value!) as GmailCredentials);
  return gmail;
}

/** CloudWatch embedded metric: one data point per clean run, for the staleness alarm. */
function emitSucceeded() {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: "TheLibrary",
            Dimensions: [["Stage"]],
            Metrics: [{ Name: "IngestSucceeded", Unit: "Count" }],
          },
        ],
      },
      Stage: STAGE,
      IngestSucceeded: 1,
    }),
  );
}

export interface IngestEvent {
  /** Look-back window. Scheduled runs use 3; backfill passes 28. */
  newerThanDays?: number;
  maxMessages?: number;
  /** Re-run the pipeline on stored issues instead of fetching (`pnpm reprocess`). */
  reprocess?: { days?: number };
}

export async function handler(event: IngestEvent = {}) {
  if (event.reprocess) {
    const stats = await reprocess(store, { days: event.reprocess.days ?? 30 });
    console.log(JSON.stringify({ level: "info", msg: "reprocess done", ...stats }));
    if (stats.errors > 0) throw new Error(`reprocess finished with ${stats.errors} errors`);
    return stats;
  }

  const stats = await ingest(await getGmail(), store, {
    newerThanDays: event.newerThanDays ?? 3,
    maxMessages: event.maxMessages,
  });
  console.log(JSON.stringify({ level: "info", msg: "ingest done", ...stats }));
  await store.putIngestState(stats);
  // A run with errors fails the invocation so the alarm fires. What was stored stays stored,
  // and async retries are off, so this is one failed run, not three.
  if (stats.errors > 0) throw new Error(`ingest finished with ${stats.errors} errors`);
  emitSucceeded();
  return stats;
}
