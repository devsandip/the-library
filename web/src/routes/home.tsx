import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { IssueListItem, View } from "@library/core/types";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { IssueRow } from "../components/issue-row.js";
import { useAsync } from "../hooks.js";

const VIEWS: { id: View; label: string }[] = [
  { id: "unread", label: "Unread" },
  { id: "all", label: "All" },
  { id: "archived", label: "Archived" },
];

export function Home() {
  const { api } = useApp();
  const { query, route } = useLocation();
  // Filters live in the URL, so Back from an issue restores them.
  const view = (VIEWS.some((v) => v.id === query.view) ? query.view : "unread") as View;
  const sender = query.sender || undefined;

  const senders = useAsync(() => api.listSenders(), []);
  const list = useAsync(() => api.listIssues({ view, sender }), [view, sender]);
  const [more, setMore] = useState<{ items: IssueListItem[]; cursor?: string; loading: boolean }>();
  const [refreshing, setRefreshing] = useState(false);

  const setFilter = (next: { view?: View; sender?: string }) => {
    setMore(undefined);
    const q = new URLSearchParams();
    const v = next.view ?? view;
    const s = "sender" in next ? next.sender : sender;
    if (v !== "unread") q.set("view", v);
    if (s) q.set("sender", s);
    const qs = q.toString();
    route(`${BASE}/${qs ? `?${qs}` : ""}`);
  };

  const cursor = more ? more.cursor : list.data?.cursor;
  const items = [...(list.data?.items ?? []), ...(more?.items ?? [])];

  const loadMore = async () => {
    if (!cursor) return;
    setMore((m) => ({ items: m?.items ?? [], cursor, loading: true }));
    const page = await api.listIssues({ view, sender, cursor });
    setMore((m) => ({
      items: [...(m?.items ?? []), ...page.items],
      cursor: page.cursor,
      loading: false,
    }));
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.refreshNow();
      // The run takes a few seconds; check back shortly.
      await new Promise((r) => setTimeout(r, 8000));
      setMore(undefined);
      list.reload();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section class="home">
      <div class="toolbar">
        <div class="tabs" role="tablist" aria-label="Which issues">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              class={view === v.id ? "active" : ""}
              onClick={() => setFilter({ view: v.id })}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div class="toolbar-right">
          <select
            aria-label="Filter by sender"
            value={sender ?? ""}
            onChange={(e) =>
              setFilter({ sender: (e.target as HTMLSelectElement).value || undefined })
            }
          >
            <option value="">All senders</option>
            {senders.data?.items.map((s) => (
              <option key={s.senderId} value={s.senderId}>
                {s.publication}
                {s.muted ? " (muted)" : ""}
              </option>
            ))}
          </select>
          <button type="button" onClick={refresh} disabled={refreshing} title="Check Gmail now">
            {refreshing ? "Checking..." : "Refresh"}
          </button>
        </div>
      </div>

      {list.status === "loading" && <p class="muted">Loading...</p>}
      {list.status === "error" && (
        <p class="error">
          {list.error}{" "}
          <button type="button" class="link" onClick={list.reload}>
            Retry
          </button>
        </p>
      )}
      {list.status === "ok" && items.length === 0 && (
        <div class="empty">
          <p class="empty-title">No new numbers.</p>
          {view === "unread" && (
            <p class="muted">Everything is read. New issues arrive every two hours.</p>
          )}
        </div>
      )}
      {items.length > 0 && (
        <ul class="issue-list">
          {items.map((i) => (
            <IssueRow key={i.id} issue={i} />
          ))}
        </ul>
      )}
      {cursor && list.status === "ok" && (
        <p class="load-more">
          <button type="button" onClick={loadMore} disabled={more?.loading}>
            {more?.loading ? "Loading..." : "Load more"}
          </button>
        </p>
      )}
    </section>
  );
}
