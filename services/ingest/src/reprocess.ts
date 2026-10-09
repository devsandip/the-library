import { processMessage } from "@library/core";
import { mapLimit } from "./ingest.js";
import type { Store } from "./store.js";

export interface ReprocessStats {
  since: string;
  checked: number;
  updated: number;
  /** Older than the 30-day raw retention: nothing to re-run. */
  missingRaw: number;
  /** Would now be filtered by the current rules; left as is and only reported. */
  nowFiltered: number;
  errors: number;
  errorSamples: string[];
}

/**
 * Re-run classification, sanitizing and extraction on stored issues from their raw MIME, after a
 * change to packages/core. Content only: state, ratings and sender counts are never touched.
 */
export async function reprocess(store: Store, opts: { days: number }): Promise<ReprocessStats> {
  const since = new Date(Date.now() - opts.days * 86_400_000).toISOString();
  const issues = await store.recentIssues(since);
  const stats: ReprocessStats = {
    since,
    checked: issues.length,
    updated: 0,
    missingRaw: 0,
    nowFiltered: 0,
    errors: 0,
    errorSamples: [],
  };

  await mapLimit(issues, 5, async (issue) => {
    try {
      const raw = await store.getRaw(issue.id);
      if (!raw) {
        stats.missingRaw++;
        return;
      }
      const p = await processMessage({
        id: issue.id,
        raw,
        labelIds: issue.labelIds,
        snippet: issue.snippet,
        internalDate: String(Date.parse(issue.receivedAt)),
      });
      if (p.kind === "filtered") {
        stats.nowFiltered++;
        return;
      }
      await store.updateContent(p);
      stats.updated++;
    } catch (err) {
      stats.errors++;
      if (stats.errorSamples.length < 5)
        stats.errorSamples.push(`${issue.id}: ${(err as Error).message}`);
    }
  });
  return stats;
}
