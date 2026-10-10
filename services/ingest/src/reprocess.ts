import { processMessage } from "@library/core";
import { mapLimit } from "./ingest.js";
import type { Store } from "./store.js";

export interface ReprocessStats {
  since: string;
  checked: number;
  updated: number;
  /** Older than the 30-day raw retention: nothing to re-run. */
  missingRaw: number;
  /** Caught by a noise rule now (account mail, say, #50), so filed as filtered. */
  filtered: number;
  /** "<id> (<reason>): <subject>" for the first few filed, to check none was a real issue. */
  filteredSamples: string[];
  /** Would now be filtered but left as is: rated or saved, or no longer from a source. */
  nowFiltered: number;
  errors: number;
  errorSamples: string[];
}

/**
 * Re-run classification, sanitizing and extraction on stored issues from their raw MIME, after a
 * change to packages/core. Content only, with one exception: an issue a noise rule now catches is
 * filed as filtered, unless Sandip rated or saved it. A sender that is no longer a source keeps
 * its issues.
 */
export async function reprocess(store: Store, opts: { days: number }): Promise<ReprocessStats> {
  const since = new Date(Date.now() - opts.days * 86_400_000).toISOString();
  const issues = await store.recentIssues(since);
  const stats: ReprocessStats = {
    since,
    checked: issues.length,
    updated: 0,
    missingRaw: 0,
    filtered: 0,
    filteredSamples: [],
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
        const filed =
          p.reason !== "not-a-source" && (await store.fileAsFiltered(issue.id, p.reason, "rule"));
        if (!filed) stats.nowFiltered++;
        else if (stats.filtered++ < 10) {
          stats.filteredSamples.push(`${issue.id} (${p.reason}): ${p.subject}`);
        }
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
