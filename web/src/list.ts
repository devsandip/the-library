import { useEffect, useRef, useState } from "preact/hooks";
import type { IssueListItem, IssueListResponse } from "@library/core/types";
import type { IssueChange } from "./actions.js";
import { patchIssue } from "./data.js";
import { useAsync } from "./hooks.js";
import { useOnRefresh } from "./library.js";

/**
 * Rows keep their place (RET-10): when a fresh copy of a list no longer holds a row the reader
 * saw (it was read, or saved, from the list or in the reader), the row stays where it was, so
 * nothing jumps under the finger. Fresh rows come in at their own place.
 */
export function steady<T extends { id: string }>(
  prev: T[],
  fresh: T[],
): { items: T[]; kept: Set<string> } {
  const items = [...fresh];
  const at = new Set(fresh.map((i) => i.id));
  const kept = new Set<string>();
  prev.forEach((p, k) => {
    if (at.has(p.id)) return;
    // After the nearest earlier row that is still listed; first if there is none.
    let after = -1;
    for (let j = k - 1; j >= 0; j--) {
      const idx = items.findIndex((i) => i.id === prev[j]!.id);
      if (idx !== -1) {
        after = idx;
        break;
      }
    }
    items.splice(after + 1, 0, p);
    at.add(p.id);
    kept.add(p.id);
  });
  return { items, kept };
}

/** The rows each list showed last, by list, so Back finds them where they were. */
const shown = new Map<string, { id: string }[]>();

/**
 * A paged list of issues with its rows held in place (see `steady`). `key` names the view (its
 * URL); a new key is a new view and starts over. A refresh (pull to refresh) starts over too.
 */
export function useIssueList(key: string, load: (cursor?: string) => Promise<IssueListResponse>) {
  return useList<IssueListItem, IssueChange>(key, load, patchIssue);
}

/** `useIssueList` for any rows with an id: Learning's stories (#81) use it too. */
export function useList<T extends { id: string }, C>(
  key: string,
  load: (cursor?: string) => Promise<{ items: T[]; cursor?: string }>,
  patchRows: (items: T[], id: string, change: C) => T[],
) {
  const first = useAsync(() => load(), [key], `list:${key}`);
  const [more, setMore] = useState<{ items: T[]; cursor?: string; loading: boolean }>();
  const lastKey = useRef(key);

  // A different view: forget how the last one looked.
  useEffect(() => {
    if (lastKey.current === key) return;
    shown.delete(lastKey.current);
    lastKey.current = key;
    setMore(undefined);
  }, [key]);

  useOnRefresh(() => {
    shown.delete(key);
    setMore(undefined);
    first.reload();
  });

  const fresh = [...(first.data?.items ?? []), ...(more?.items ?? [])];
  const ready = first.status === "ok";
  const { items, kept } = ready
    ? steady((shown.get(key) as T[] | undefined) ?? [], fresh)
    : { items: [], kept: new Set<string>() };
  useEffect(() => {
    if (ready) shown.set(key, items);
  });

  const cursor = more ? more.cursor : first.data?.cursor;
  const loadMore = async () => {
    if (!cursor || more?.loading) return;
    setMore((m) => ({ items: m?.items ?? [], cursor, loading: true }));
    try {
      const page = await load(cursor);
      setMore((m) => ({
        items: [...(m?.items ?? []), ...page.items],
        cursor: page.cursor,
        loading: false,
      }));
    } catch {
      setMore((m) => (m ? { ...m, loading: false } : m));
    }
  };

  const patch = (id: string, change: C) => {
    first.set((d) => ({ ...d, items: patchRows(d.items, id, change) }));
    setMore((m) => (m ? { ...m, items: patchRows(m.items, id, change) } : m));
    const s = shown.get(key) as T[] | undefined;
    if (s) shown.set(key, patchRows(s, id, change));
  };

  return {
    status: first.status,
    error: first.error,
    reload: first.reload,
    items,
    kept,
    patch,
    hasMore: Boolean(cursor),
    loadingMore: more?.loading ?? false,
    loadMore,
  };
}
