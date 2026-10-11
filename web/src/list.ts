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
const shown = new Map<string, IssueListItem[]>();
/** Rows swiped away this session, by list: archived, waiting out the Undo. */
const goneBy = new Map<string, Set<string>>();

/**
 * A paged list of issues with its rows held in place (see `steady`). `key` names the view (its
 * URL); a new key is a new view and starts over. A refresh (pull to refresh) starts over too.
 */
export function useIssueList(key: string, load: (cursor?: string) => Promise<IssueListResponse>) {
  const first = useAsync(() => load(), [key], `list:${key}`);
  const [more, setMore] = useState<{ items: IssueListItem[]; cursor?: string; loading: boolean }>();
  const [gone, setGone] = useState<Set<string>>(() => goneBy.get(key) ?? new Set());
  const lastKey = useRef(key);

  // A different view: forget how the last one looked.
  useEffect(() => {
    if (lastKey.current === key) return;
    shown.delete(lastKey.current);
    goneBy.delete(lastKey.current);
    lastKey.current = key;
    setMore(undefined);
    setGone(new Set());
  }, [key]);

  useOnRefresh(() => {
    shown.delete(key);
    goneBy.delete(key);
    setMore(undefined);
    setGone(new Set());
    first.reload();
  });

  const fresh = [...(first.data?.items ?? []), ...(more?.items ?? [])];
  const ready = first.status === "ok";
  const { items, kept } = ready
    ? steady(shown.get(key) ?? [], fresh)
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

  const patch = (id: string, change: IssueChange) => {
    first.set((d) => ({ ...d, items: patchIssue(d.items, id, change) }));
    setMore((m) => (m ? { ...m, items: patchIssue(m.items, id, change) } : m));
    const s = shown.get(key);
    if (s) shown.set(key, patchIssue(s, id, change));
  };
  const hide = (id: string, on: boolean) =>
    setGone((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      goneBy.set(key, next);
      return next;
    });

  return {
    status: first.status,
    error: first.error,
    reload: first.reload,
    items: items.filter((i) => !gone.has(i.id)),
    kept,
    patch,
    hide,
    hasMore: Boolean(cursor),
    loadingMore: more?.loading ?? false,
    loadMore,
  };
}
