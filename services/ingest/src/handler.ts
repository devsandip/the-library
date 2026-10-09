import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { EnrichStats } from "@library/core/types";
import { Bedrock } from "./bedrock.js";
import { archiveOldNews, enrich, proposeTopics } from "./enrich.js";
import { Gmail, type GmailCredentials } from "./gmail.js";
import { ingest } from "./ingest.js";
import { reprocess } from "./reprocess.js";
import { rebuildSenders } from "./senders.js";
import { Store } from "./store.js";

const { TABLE_NAME, BUCKET_NAME, GMAIL_PARAM, STAGE } = process.env;

let gmail: Gmail | undefined;
const store = new Store(TABLE_NAME!, BUCKET_NAME!);
const bedrock = new Bedrock();
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

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
  /** Re-key issues and rebuild sender items after a sender-rule change (`pnpm rebuild-senders`). */
  rebuildSenders?: { apply?: boolean };
  /** Enrich stored issues from the last `days` (`pnpm enrich`); `force` redoes enriched ones. */
  enrich?: { days?: number; force?: boolean };
  /** Claude proposes the topic list from stored issues (`pnpm topics`); stored with `apply`. */
  proposeTopics?: { days?: number; apply?: boolean; replace?: boolean };
}

export async function handler(event: IngestEvent = {}) {
  const started = Date.now();
  if (event.enrich) {
    const stats = await enrich(store, bedrock, {
      sinceIso: daysAgo(event.enrich.days ?? 30),
      force: event.enrich.force === true,
      deadline: started + 9 * 60_000,
    });
    stats.oldNewsArchived = await archiveOldNews(store);
    console.log(JSON.stringify({ level: "info", msg: "enrich done", ...stats }));
    return stats;
  }
  if (event.proposeTopics) {
    const proposal = await proposeTopics(store, bedrock, {
      sinceIso: daysAgo(event.proposeTopics.days ?? 30),
      apply: event.proposeTopics.apply === true,
      replace: event.proposeTopics.replace === true,
    });
    console.log(JSON.stringify({ level: "info", msg: "topics proposed", ...proposal }));
    return proposal;
  }
  if (event.rebuildSenders) {
    const report = await rebuildSenders(store, { apply: event.rebuildSenders.apply === true });
    console.log(JSON.stringify({ level: "info", msg: "rebuild senders done", ...report }));
    if (report.errors > 0) {
      throw new Error(
        `rebuild finished with ${report.errors} errors: ${report.errorSamples.join("; ")}`,
      );
    }
    return report;
  }
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
  // New issues, plus any from the last two weeks that failed before. Enrichment problems are
  // reported on /status but never fail the run: reading works without summaries.
  // Then the 7-day rule for unread news.
  const enriched = await enrich(store, bedrock, {
    sinceIso: daysAgo(14),
    deadline: started + 8 * 60_000,
  })
    .then(async (s) => ({ ...s, oldNewsArchived: await archiveOldNews(store) }))
    .catch((err: Error): EnrichStats => ({
      checked: 0,
      classified: 0,
      embedded: 0,
      promosArchived: 0,
      oldNewsArchived: 0,
      waitingForTopics: 0,
      deferred: 0,
      errors: 1,
      errorSamples: [err.message],
      inputTokens: 0,
      outputTokens: 0,
      embedTokens: 0,
      durationMs: 0,
    }));
  console.log(JSON.stringify({ level: "info", msg: "enrich done", ...enriched }));
  await store.putIngestState(stats, enriched);
  // A run with errors fails the invocation so the alarm fires. What was stored stays stored,
  // and async retries are off, so this is one failed run, not three.
  if (stats.errors > 0) throw new Error(`ingest finished with ${stats.errors} errors`);
  emitSucceeded();
  return stats;
}
