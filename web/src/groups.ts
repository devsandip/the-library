import type { IssueListItem } from "@library/core/types";

/** The heading for issues Claude has not sorted yet. */
export const UNSORTED = "Not sorted yet";

export interface TopicSection {
  name: string;
  items: IssueListItem[];
}

/**
 * The phone's Home groups issues under their topic, in Claude's topic order. Topics no longer on
 * Claude's list follow in the order they first appear; issues without a topic come last. Each
 * section keeps the list's own order.
 */
export function topicSections(items: IssueListItem[], order: string[]): TopicSection[] {
  const by = new Map<string, IssueListItem[]>();
  for (const i of items) {
    const name = i.topic ?? UNSORTED;
    const section = by.get(name);
    if (section) section.push(i);
    else by.set(name, [i]);
  }
  const rank = (name: string) => {
    if (name === UNSORTED) return order.length + 1;
    const n = order.indexOf(name);
    return n === -1 ? order.length : n;
  };
  return [...by]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([name, section]) => ({ name, items: section }));
}

/** One issue's fields replaced, for lists that follow what the reading pane changes. */
export function patchIssue<T extends { id: string }>(
  items: T[],
  id: string,
  patch: Partial<T>,
): T[] {
  return items.map((i) => (i.id === id ? { ...i, ...patch } : i));
}
