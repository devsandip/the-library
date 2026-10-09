import { gmailQuery, processMessage, type IngestStats } from "@library/core";
import type { Gmail } from "./gmail.js";
import type { Store } from "./store.js";

export type { IngestStats };

export interface IngestOptions {
  newerThanDays: number;
  maxMessages?: number;
  concurrency?: number;
}

export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function ingest(
  gmail: Gmail,
  store: Store,
  opts: IngestOptions,
): Promise<IngestStats> {
  const started = Date.now();
  const query = gmailQuery(opts.newerThanDays);
  const ids = await gmail.listMessageIds(query, opts.maxMessages ?? 2000);
  const existing = await store.existingIds(ids);
  const fresh = ids.filter((id) => !existing.has(id));

  const stats: IngestStats = {
    query,
    listed: ids.length,
    alreadyStored: existing.size,
    newsletters: 0,
    filtered: 0,
    errors: 0,
    errorSamples: [],
    durationMs: 0,
  };

  await mapLimit(fresh, opts.concurrency ?? 5, async (id) => {
    try {
      const msg = await gmail.getRaw(id);
      const p = await processMessage(msg);
      if (p.kind === "newsletter") {
        await store.putNewsletter(p, msg.raw);
        stats.newsletters++;
      } else {
        await store.putFiltered(p);
        stats.filtered++;
      }
    } catch (err) {
      // One bad message must not stop the run; it is retried next run (still not stored).
      stats.errors++;
      const detail = `${id}: ${(err as Error).message}`;
      if (stats.errorSamples.length < 5) stats.errorSamples.push(detail);
      console.error(
        JSON.stringify({ level: "error", msg: "message failed", id, error: String(err) }),
      );
    }
  });

  stats.durationMs = Date.now() - started;
  return stats;
}
