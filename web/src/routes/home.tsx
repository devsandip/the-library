import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { IssueListItem, Shelf, View } from "@library/core/types";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { IssueRow } from "../components/issue-row.js";
import { useAsync } from "../hooks.js";

const SHELVES: { id: Shelf; label: string }[] = [
  { id: "news", label: "News" },
  { id: "learning", label: "Learning" },
];

const VIEWS: { id: View; label: string }[] = [
  { id: "unread", label: "Unread" },
  { id: "all", label: "All" },
  { id: "archived", label: "Archived" },
];

interface Filters {
  shelf: Shelf;
  view: View;
  sender?: string;
  topic?: string;
}

/** Filters live in the URL, so Back from an issue restores them. */
function filtersHref(f: Filters): string {
  const q = new URLSearchParams();
  if (f.shelf !== "news") q.set("shelf", f.shelf);
  if (f.view !== "unread") q.set("view", f.view);
  if (f.sender) q.set("sender", f.sender);
  if (f.topic) q.set("topic", f.topic);
  const qs = q.toString();
  return `${BASE}/${qs ? `?${qs}` : ""}`;
}

function IssueList({
  items,
  topicHref,
}: {
  items: IssueListItem[];
  topicHref: (topic: string) => string;
}) {
  return (
    <ul class="issue-list">
      {items.map((i) => (
        <IssueRow key={i.id} issue={i} topicHref={topicHref} />
      ))}
    </ul>
  );
}

export function Home() {
  const { api } = useApp();
  const { query, route } = useLocation();
  // The shelves appear once Claude has proposed topics and started sorting (`pnpm topics`).
  const topicList = useAsync(() => api.listTopics(), []);
  const shelvesOn = (topicList.data?.topics.length ?? 0) > 0;
  const filters: Filters = {
    shelf: query.shelf === "learning" ? "learning" : "news",
    view: (VIEWS.some((v) => v.id === query.view) ? query.view : "unread") as View,
    sender: query.sender || undefined,
    topic: query.topic || undefined,
  };
  const { shelf, view, sender, topic } = filters;

  const senders = useAsync(() => api.listSenders(), []);
  const listShelf = shelvesOn ? shelf : undefined;
  const topicsKnown = topicList.status !== "loading";
  // Wait for the topic check, so the list loads once, with or without a shelf.
  const list = useAsync(
    () =>
      topicsKnown
        ? api.listIssues({ shelf: listShelf, view, sender, topic })
        : new Promise<never>(() => undefined),
    [topicsKnown, listShelf, view, sender, topic],
  );
  const [more, setMore] = useState<{ items: IssueListItem[]; cursor?: string; loading: boolean }>();
  const [refreshing, setRefreshing] = useState(false);

  const setFilter = (next: Partial<Filters>) => {
    setMore(undefined);
    route(filtersHref({ ...filters, ...next }));
  };
  const topicHref = (t: string) => filtersHref({ ...filters, topic: t });

  const cursor = more ? more.cursor : list.data?.cursor;
  const items = [...(list.data?.items ?? []), ...(more?.items ?? [])];
  // Unread lists Must Read newsletters first; label the two groups.
  const grouped = view === "unread" && !sender && items.some((i) => i.mustRead);

  const loadMore = async () => {
    if (!cursor) return;
    setMore((m) => ({ items: m?.items ?? [], cursor, loading: true }));
    const page = await api.listIssues({ shelf: listShelf, view, sender, topic, cursor });
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
      {shelvesOn && (
        <div class="shelves" role="tablist" aria-label="Shelf">
          {SHELVES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={shelf === s.id}
              class={shelf === s.id ? "active" : ""}
              onClick={() => setFilter({ shelf: s.id })}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

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

      {topic && (
        <p class="filter-pill">
          <span>
            Topic: <strong>{topic}</strong>
          </span>
          <button type="button" class="link" onClick={() => setFilter({ topic: undefined })}>
            Show all topics
          </button>
        </p>
      )}

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
            <p class="muted">
              {!shelvesOn
                ? "Everything is read. New issues arrive every two hours."
                : shelf === "news"
                  ? "No unread news. New issues arrive every two hours."
                  : "Nothing waiting on the Learning shelf."}
            </p>
          )}
        </div>
      )}
      {items.length > 0 &&
        (grouped ? (
          <>
            <h2 class="list-heading">Must Read</h2>
            <IssueList items={items.filter((i) => i.mustRead)} topicHref={topicHref} />
            {items.some((i) => !i.mustRead) && (
              <>
                <h2 class="list-heading">Everything else</h2>
                <IssueList items={items.filter((i) => !i.mustRead)} topicHref={topicHref} />
              </>
            )}
          </>
        ) : (
          <IssueList items={items} topicHref={topicHref} />
        ))}
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
