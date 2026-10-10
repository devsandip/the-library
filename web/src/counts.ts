import type { Shelf, UnreadCount } from "@library/core/types";

export interface Filters {
  shelf?: Shelf;
  senders: string[];
  topics: string[];
}

export interface Facets {
  /** Unread per tab within the picked senders. Topics reset when the tab changes, so they don't count. */
  shelves: Record<Shelf, number>;
  /** Unread per topic in the current tab, within the picked senders. */
  topics: Map<string, number>;
  /** Unread per sender in the current tab, within the picked topics (muted senders too). */
  senders: Map<string, number>;
  /** Unread matching every filter: what Unread lists. */
  total: number;
}

const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

/**
 * Counts for the tabs, topic chips and sender picker, from the unread tally. Same rules as the
 * API: unsorted issues sit under News, muted senders are hidden unless picked, and several
 * senders or topics mean any of them.
 */
export function facets(counts: UnreadCount[], f: Filters, muted: Set<string>): Facets {
  const senders = new Set(f.senders);
  const topics = new Set(f.topics);
  const out: Facets = {
    shelves: { news: 0, learning: 0 },
    topics: new Map(),
    senders: new Map(),
    total: 0,
  };
  for (const c of counts) {
    const shelf = c.shelf ?? "news";
    const senderOk = senders.size ? senders.has(c.senderId) : !muted.has(c.senderId);
    const shelfOk = !f.shelf || shelf === f.shelf;
    const topicOk = !topics.size || (c.topic !== undefined && topics.has(c.topic));
    if (senderOk) out.shelves[shelf] += c.n;
    if (senderOk && shelfOk && c.topic) add(out.topics, c.topic, c.n);
    if (shelfOk && topicOk) add(out.senders, c.senderId, c.n);
    if (senderOk && shelfOk && topicOk) out.total += c.n;
  }
  return out;
}
