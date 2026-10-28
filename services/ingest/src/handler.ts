import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { EnrichStats, PredictionStats, ShelfStats, StoryStats } from "@library/core/types";
import { Bedrock } from "./bedrock.js";
import { archiveOldNews, enrich, proposeTopics } from "./enrich.js";
import { checkFollows } from "./follow.js";
import { Gmail, type GmailCredentials } from "./gmail.js";
import { ingest } from "./ingest.js";
import { Jev } from "./jev.js";
import { writeNarrative } from "./narrative.js";
import { spotPredictions } from "./predictions.js";
import { reprocess } from "./reprocess.js";
import { rebuildSenders } from "./senders.js";
import { deriveShelves, shelveStories } from "./shelves.js";
import { Store } from "./store.js";
import { indexStories, relinkStories } from "./stories.js";

const { TABLE_NAME, BUCKET_NAME, GMAIL_PARAM, JEV_PARAM, STAGE } = process.env;

let gmail: Gmail | undefined;
let jev: Jev | undefined;
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

/** The key is Sandip's, stored in SSM by hand; dev has none, so shelving fails there. */
async function getJev(): Promise<Jev> {
  if (jev) return jev;
  const res = await new SSMClient({}).send(
    new GetParameterCommand({ Name: JEV_PARAM, WithDecryption: true }),
  );
  jev = new Jev(res.Parameter!.Value!);
  return jev;
}

const shelfFailed = (err: Error): ShelfStats => ({
  checked: 0,
  shelved: 0,
  learning: 0,
  unsure: 0,
  deferred: 0,
  errors: 1,
  errorSamples: [err.message],
  inputTokens: 0,
  durationMs: 0,
});

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
  /** Split stored issues into stories (`pnpm stories`); `relink` only recomputes event links. */
  stories?: { days?: number; force?: boolean; relink?: boolean };
  /**
   * Jev shelves stored stories (`pnpm shelves`); `force` asks again about all but Sandip's moves;
   * `derive` asks Jev nothing and brings shelves, states and issues in line (#81).
   */
  shelves?: { days?: number; force?: boolean; derive?: boolean };
  /**
   * Screen stored issues for predictions (`pnpm predictions`), those not screened yet (#24);
   * `force` screens them all again, keeping settled predictions and Sandip's (#143).
   */
  predictions?: { days?: number; force?: boolean };
  /** Write today's narrative now (`pnpm narrative`); `force` even if the last one is recent. */
  narrative?: { force?: boolean };
  /** Index opens logged before read history existed (`pnpm history-backfill`). */
  historyBackfill?: Record<string, never>;
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
  if (event.stories) {
    if (event.stories.relink) {
      const report = await relinkStories(store);
      console.log(JSON.stringify({ level: "info", msg: "relink done", ...report }));
      return report;
    }
    const stats = await indexStories(store, bedrock, {
      sinceIso: daysAgo(event.stories.days ?? 30),
      force: event.stories.force === true,
      deadline: started + 8.5 * 60_000,
    });
    console.log(JSON.stringify({ level: "info", msg: "stories done", ...stats }));
    return stats;
  }
  if (event.shelves?.derive) {
    const stats = await deriveShelves(store, { sinceIso: daysAgo(event.shelves.days ?? 3650) });
    console.log(JSON.stringify({ level: "info", msg: "shelves derived", ...stats }));
    return stats;
  }
  if (event.shelves) {
    const stats = await shelveStories(store, getJev, {
      sinceIso: daysAgo(event.shelves.days ?? 30),
      force: event.shelves.force === true,
      concurrency: 8,
      deadline: started + 9 * 60_000,
    });
    console.log(JSON.stringify({ level: "info", msg: "shelves done", ...stats }));
    return stats;
  }
  if (event.predictions) {
    const stats = await spotPredictions(store, bedrock, {
      sinceIso: daysAgo(event.predictions.days ?? 30),
      force: event.predictions.force === true,
      deadline: started + 8.5 * 60_000,
    });
    console.log(JSON.stringify({ level: "info", msg: "predictions done", ...stats }));
    return stats;
  }
  if (event.historyBackfill) {
    const indexed = await store.indexOpens();
    console.log(JSON.stringify({ level: "info", msg: "history backfill done", indexed }));
    return { indexed };
  }
  if (event.narrative) {
    const stats = await writeNarrative(store, bedrock, { force: event.narrative.force === true });
    console.log(JSON.stringify({ level: "info", msg: "narrative done", ...stats }));
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
      accountFiltered: 0,
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
  // Then the story index (#15), which needs the promo flag. Like enrichment, it never fails the run.
  const storied = await indexStories(store, bedrock, {
    sinceIso: daysAgo(14),
    deadline: started + 8.5 * 60_000,
  }).catch((err: Error): StoryStats => ({
    checked: 0,
    storied: 0,
    stories: 0,
    linked: 0,
    deferred: 0,
    errors: 1,
    errorSamples: [err.message],
    inputTokens: 0,
    outputTokens: 0,
    embedTokens: 0,
    durationMs: 0,
  }));
  console.log(JSON.stringify({ level: "info", msg: "stories done", ...storied }));
  // Then Jev shelves the new stories and their issues follow (#81); it never fails the run.
  const shelved = await shelveStories(store, getJev, {
    sinceIso: daysAgo(14),
    deadline: started + 8.75 * 60_000,
  }).catch(shelfFailed);
  console.log(JSON.stringify({ level: "info", msg: "shelves done", ...shelved }));
  // Then predictions (#24), from the new issues' forward-looking sentences. Never fails the run.
  if (Date.now() < started + 8.8 * 60_000) {
    await spotPredictions(store, bedrock, {
      sinceIso: daysAgo(14),
      deadline: started + 8.8 * 60_000,
    })
      .then((s: PredictionStats) =>
        console.log(JSON.stringify({ level: "info", msg: "predictions done", ...s })),
      )
      .catch((err: Error) =>
        console.error(
          JSON.stringify({ level: "error", msg: "predictions failed", error: String(err) }),
        ),
      );
  }
  // Then followed stories (#22): a new story that moves one becomes a point. Like the steps
  // before it, it never fails the run.
  if (Date.now() < started + 8.9 * 60_000) {
    await checkFollows(store, bedrock)
      .then((s) => console.log(JSON.stringify({ level: "info", msg: "follows done", ...s })))
      .catch((err: Error) =>
        console.error(
          JSON.stringify({ level: "error", msg: "follows failed", error: String(err) }),
        ),
      );
  }
  // Then today's narrative (#18), when the day's News has moved on. It never fails the run either.
  await writeNarrative(store, bedrock, { deadline: started + 9 * 60_000 })
    .then((told) => console.log(JSON.stringify({ level: "info", msg: "narrative done", ...told })))
    .catch((err: Error) =>
      console.error(
        JSON.stringify({ level: "error", msg: "narrative failed", error: String(err) }),
      ),
    );
  await store.putIngestState(stats, enriched, storied, shelved);
  // A run with errors fails the invocation so the alarm fires. What was stored stays stored,
  // and async retries are off, so this is one failed run, not three.
  if (stats.errors > 0) throw new Error(`ingest finished with ${stats.errors} errors`);
  emitSucceeded();
  return stats;
}
