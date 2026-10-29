/**
 * Highlights (#71, #168) as the app holds them: every highlight, read when the Highlights page
 * opens and kept for the page's life, so Library and ⌘K can say how many there are. The page
 * groups them by issue, filters them by newsletter and exports them as Markdown.
 */
import { useEffect, useState } from "preact/hooks";
import { isReaderDay, readerDay, readerDayBounds } from "@library/core/days";
import { byIssue, highlightsMarkdown } from "@library/core/highlights";
import type { Highlight, HighlightListItem, IssueListItem } from "@library/core/types";
import type { LibraryApi } from "./api.js";
import { useApp } from "./context.js";

export type HighlightsState =
  | { status: "loading" }
  | { status: "ok"; items: HighlightListItem[] }
  | { status: "error"; error: string };

let state: HighlightsState = { status: "loading" };
let reading: Promise<void> | undefined;
const listeners = new Set<() => void>();

function put(next: HighlightsState) {
  state = next;
  for (const l of listeners) l();
}

/** The API's pages read to the end, 200 at a time: one reader's highlights are a few hundred. */
const PAGE = 200;
const MAX_PAGES = 50;

async function readAll(api: LibraryApi): Promise<HighlightListItem[]> {
  const items: HighlightListItem[] = [];
  let before: string | undefined;
  for (let n = 0; n < MAX_PAGES; n++) {
    const page = await api.highlights({ limit: PAGE, before });
    items.push(...page.items);
    if (!page.next) break;
    before = page.next;
  }
  return items;
}

/** Reads every highlight again; what is on screen stays meanwhile. */
export function readHighlights(api: LibraryApi): Promise<void> {
  reading ??= readAll(api)
    .then(
      (items) => put({ status: "ok", items }),
      (err: Error) => {
        if (state.status !== "ok") put({ status: "error", error: err.message });
      },
    )
    .finally(() => (reading = undefined));
  return reading;
}

/** How many highlights there are, once they have been read. */
export const highlightCount = (s: HighlightsState) =>
  s.status === "ok" ? s.items.length : undefined;

/** The highlights: read again each time (their page), only if not read yet (Library), or never (⌘K). */
export function useHighlights(read: "again" | "once" | "never" = "again"): {
  state: HighlightsState;
  reload: () => Promise<void>;
} {
  const { api } = useApp();
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    if (read === "again" || (read === "once" && state.status === "loading")) {
      void readHighlights(api);
    }
  }, []);
  return { state, reload: () => readHighlights(api) };
}

// ---------- the page ----------

/** The newsletters highlighted from, most highlights first, for the filter. */
export function newsletters(items: HighlightListItem[]): { publication: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const h of items)
    counts.set(h.issue.publication, (counts.get(h.issue.publication) ?? 0) + 1);
  return [...counts]
    .map(([publication, count]) => ({ publication, count }))
    .sort((a, b) => b.count - a.count || a.publication.localeCompare(b.publication));
}

/**
 * The highlights shown: from one newsletter, or all, and made on or after a day (the reader's day
 * in India, `YYYY-MM-DD`), or ever.
 */
export function pick(
  items: HighlightListItem[],
  opts: { newsletter?: string; since?: string },
): HighlightListItem[] {
  return items.filter(
    (h) =>
      (!opts.newsletter || h.issue.publication === opts.newsletter) &&
      (!opts.since || readerDay(Date.parse(h.createdAt)) >= opts.since),
  );
}

/**
 * The page's groups: an issue each, the one highlighted last first, its passages in the order
 * they were made, as the export has them.
 */
export function groups(
  items: HighlightListItem[],
): { issue: IssueListItem; highlights: Highlight[] }[] {
  return byIssue(items).map((g) => ({
    issue: g.issue,
    highlights: [...g.highlights].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));
}

/**
 * The Markdown file for the highlights shown: `nutgraf-highlights-<day>.md`, saying since when
 * when it is not everything.
 */
export function exportFile(
  items: HighlightListItem[],
  opts: { appUrl: string; since?: string; now: number },
): { name: string; markdown: string } {
  const exportedAt = new Date(opts.now).toISOString();
  return {
    name: `nutgraf-highlights-${readerDay(opts.now)}.md`,
    markdown: highlightsMarkdown(items, {
      appUrl: opts.appUrl,
      exportedAt,
      ...(opts.since && isReaderDay(opts.since) ? { since: readerDayBounds(opts.since).from } : {}),
    }),
  };
}
