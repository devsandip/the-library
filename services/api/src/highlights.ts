/**
 * Highlights (#71, #166): passages Sandip keeps from an issue, each with an optional note. Kept
 * under the issue, so its detail carries them, and listed newest first for the Highlights page.
 * No model call; the Markdown they export as is `@library/core/highlights`.
 */
import { newHighlightKey, sameQuote } from "@library/core";
import type {
  Highlight,
  HighlightListItem,
  HighlightQuote,
  HighlightsResponse,
  IssueListItem,
} from "@library/core/types";
import { notFound } from "./errors.js";
import type { HighlightsPort } from "./port.js";

/** Where highlights are kept. DynamoRepo implements it; tests use a fake. */
export interface HighlightStore {
  /** These issues as rows; unknown and filtered ones are left out. */
  listItems(ids: string[]): Promise<IssueListItem[]>;
  /** An issue's highlights, oldest first. */
  issueHighlights(issueId: string): Promise<Highlight[]>;
  putHighlight(h: Highlight): Promise<void>;
  /** Sets the note, or clears it; undefined when there is no such highlight. */
  setHighlightNote(
    id: string,
    note: string | undefined,
    at: string,
  ): Promise<Highlight | undefined>;
  deleteHighlight(id: string): Promise<void>;
  /** Newest first, at most `limit`, from before `before` (the last page's `next`). */
  listHighlights(limit: number, before?: string): Promise<{ items: Highlight[]; next?: string }>;
}

export class Highlights implements HighlightsPort {
  constructor(
    private readonly store: HighlightStore,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  /** Keeps a passage; the same passage in the same place again answers the one kept. */
  async add(issueId: string, quote: HighlightQuote, note?: string): Promise<Highlight> {
    const [rows, kept] = await Promise.all([
      this.store.listItems([issueId]),
      this.store.issueHighlights(issueId),
    ]);
    if (!rows.length) throw notFound("issue not found");
    const same = kept.find((h) => sameQuote(h, quote));
    if (same) return same;
    const now = this.now();
    const h: Highlight = {
      id: `${issueId}.${newHighlightKey(now, this.random)}`,
      issueId,
      ...quote,
      ...(note ? { note } : {}),
      createdAt: new Date(now).toISOString(),
    };
    await this.store.putHighlight(h);
    return h;
  }

  async note(id: string, note: string | undefined): Promise<Highlight> {
    const h = await this.store.setHighlightNote(id, note, new Date(this.now()).toISOString());
    if (!h) throw notFound("no such highlight");
    return h;
  }

  async remove(id: string): Promise<void> {
    await this.store.deleteHighlight(id);
  }

  /** A page of highlights, each with its issue; one whose issue was filtered since is left out. */
  async list(limit: number, before?: string): Promise<HighlightsResponse> {
    const page = await this.store.listHighlights(limit, before);
    const ids = [...new Set(page.items.map((h) => h.issueId))];
    const rows = new Map((await this.store.listItems(ids)).map((i) => [i.id, i]));
    const items: HighlightListItem[] = page.items.flatMap((h) => {
      const issue = rows.get(h.issueId);
      return issue ? [{ ...h, issue }] : [];
    });
    return { items, ...(page.next ? { next: page.next } : {}) };
  }
}
