import { useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { useLocation } from "preact-iso";
import type { IssueListItem, Shelf, View } from "@library/core/types";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { facets } from "../counts.js";
import { useHeaderSlot } from "../components/header.js";
import { CheckIcon, CloseIcon, FilterIcon, RefreshIcon, StarIcon } from "../components/icons.js";
import { IssueRow } from "../components/issue-row.js";
import { SenderPicker } from "../components/sender-picker.js";
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
  senders: string[];
  topics: string[];
}

const split = (v: string | undefined) => (v ? v.split(",").filter(Boolean) : []);

/** Filters live in the URL, so Back from an issue restores them. */
function filtersHref(f: Filters): string {
  const q = new URLSearchParams();
  if (f.shelf !== "news") q.set("shelf", f.shelf);
  if (f.view !== "unread") q.set("view", f.view);
  if (f.senders.length) q.set("sender", f.senders.join(","));
  if (f.topics.length) q.set("topic", f.topics.join(","));
  const qs = q.toString();
  return `${BASE}/${qs ? `?${qs}` : ""}`;
}

function IssueList({
  items,
  onTopic,
}: {
  items: IssueListItem[];
  onTopic: (topic: string) => void;
}) {
  return (
    <ul class="card-list issue-list">
      {items.map((i) => (
        <IssueRow key={i.id} issue={i} onTopic={onTopic} />
      ))}
    </ul>
  );
}

export function Home() {
  const { api } = useApp();
  const { query, route } = useLocation();
  const slot = useHeaderSlot();
  // The tabs appear once Claude has proposed topics and started sorting (`pnpm topics`).
  const topicList = useAsync(() => api.listTopics(), []);
  const shelvesOn = (topicList.data?.topics.length ?? 0) > 0;
  const filters: Filters = {
    shelf: query.shelf === "learning" ? "learning" : "news",
    view: (VIEWS.some((v) => v.id === query.view) ? query.view : "unread") as View,
    senders: split(query.sender),
    topics: split(query.topic),
  };
  const { shelf, view, senders: picked, topics: pickedTopics } = filters;

  const senders = useAsync(() => api.listSenders(), []);
  const counts = useAsync(() => api.unreadCounts(), []);
  const listShelf = shelvesOn ? shelf : undefined;
  const topicsKnown = topicList.status !== "loading";
  const senderKey = picked.join(",");
  const topicKey = pickedTopics.join(",");
  // Wait for the topic check, so the list loads once, with or without a tab.
  const list = useAsync(
    () =>
      topicsKnown
        ? api.listIssues({ shelf: listShelf, view, senders: picked, topics: pickedTopics })
        : new Promise<never>(() => undefined),
    [topicsKnown, listShelf, view, senderKey, topicKey],
  );
  const [more, setMore] = useState<{ items: IssueListItem[]; cursor?: string; loading: boolean }>();
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState(false);
  const sendersButton = useRef<HTMLButtonElement>(null);

  const setFilter = (next: Partial<Filters>) => {
    setMore(undefined);
    route(filtersHref({ ...filters, ...next }));
  };
  const toggleTopic = (t: string) =>
    setFilter({
      topics: pickedTopics.includes(t) ? pickedTopics.filter((x) => x !== t) : [...pickedTopics, t],
    });
  const showTopic = (t: string) => {
    if (!pickedTopics.includes(t)) setFilter({ topics: [...pickedTopics, t] });
  };

  const muted = new Set((senders.data?.items ?? []).filter((s) => s.muted).map((s) => s.senderId));
  const f = counts.data
    ? facets(counts.data.counts, { shelf: listShelf, senders: picked, topics: pickedTopics }, muted)
    : undefined;
  const nameOf = (id: string) =>
    senders.data?.items.find((s) => s.senderId === id)?.publication ?? "Newsletter";
  // Claude's topic order; topics with nothing unread here drop out unless they are on.
  const topicChips = (topicList.data?.topics ?? [])
    .map((t) => ({
      name: t.name,
      n: f?.topics.get(t.name) ?? 0,
      on: pickedTopics.includes(t.name),
    }))
    .filter((t) => t.on || t.n > 0 || !f);

  const cursor = more ? more.cursor : list.data?.cursor;
  const items = [...(list.data?.items ?? []), ...(more?.items ?? [])];
  // Unread lists Must Read newsletters first; label the two groups.
  const grouped = view === "unread" && !picked.length && items.some((i) => i.mustRead);
  const filtered = picked.length > 0 || pickedTopics.length > 0;

  const loadMore = async () => {
    if (!cursor) return;
    setMore((m) => ({ items: m?.items ?? [], cursor, loading: true }));
    const page = await api.listIssues({
      shelf: listShelf,
      view,
      senders: picked,
      topics: pickedTopics,
      cursor,
    });
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
      counts.reload();
    } finally {
      setRefreshing(false);
    }
  };

  const shelvesControl = shelvesOn && (
    <div class="shelves" role="tablist" aria-label="Shelf">
      {SHELVES.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={shelf === s.id}
          class={shelf === s.id ? "active" : ""}
          // Topics belong to a tab, so switching clears them; picked senders stay.
          onClick={() => setFilter({ shelf: s.id, topics: [] })}
        >
          {s.label}
          {f && <span class="n">{f.shelves[s.id]}</span>}
        </button>
      ))}
    </div>
  );

  return (
    <section class="home">
      {slot && shelvesControl && createPortal(shelvesControl, slot)}

      <div class="filter-bar" role="group" aria-label="Filters">
        <button
          ref={sendersButton}
          type="button"
          class="chip senders"
          aria-haspopup="dialog"
          onClick={() => setPicking(true)}
        >
          <FilterIcon />
          {picked.length ? `Senders: ${picked.length}` : "Senders: all"}
        </button>
        {picked.map((id) => (
          <button
            key={id}
            type="button"
            class="chip picked"
            aria-label={`Stop filtering by ${nameOf(id)}`}
            onClick={() => setFilter({ senders: picked.filter((x) => x !== id) })}
          >
            {nameOf(id)}
            <CloseIcon />
          </button>
        ))}
        {topicChips.map((t) => (
          <button
            key={t.name}
            type="button"
            class={`chip${t.on ? " on" : ""}`}
            aria-pressed={t.on}
            onClick={() => toggleTopic(t.name)}
          >
            {t.on && <CheckIcon />}
            {t.name}
            {!t.on && f && <span class="n">{t.n}</span>}
          </button>
        ))}
      </div>

      <div class="list-bar">
        <span class="muted">
          {view === "unread"
            ? f
              ? `${f.total} unread`
              : ""
            : view === "all"
              ? "Read and unread"
              : "Archived"}
        </span>
        <span class="list-bar-actions">
          <select
            aria-label="Which issues"
            value={view}
            onChange={(e) => setFilter({ view: (e.target as HTMLSelectElement).value as View })}
          >
            {VIEWS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            class={`icon-button${refreshing ? " spinning" : ""}`}
            onClick={refresh}
            disabled={refreshing}
            title="Check Gmail now"
            aria-label={refreshing ? "Checking Gmail" : "Check Gmail now"}
          >
            <RefreshIcon />
          </button>
        </span>
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
          {filtered ? (
            <button
              type="button"
              class="pill"
              onClick={() =>
                setFilter(picked.length ? { senders: [], topics: [] } : { topics: [] })
              }
            >
              {picked.length ? "Clear filters" : "Show all topics"}
            </button>
          ) : (
            view === "unread" && (
              <p class="muted">
                {!shelvesOn
                  ? "Everything is read. New issues arrive every two hours."
                  : shelf === "news"
                    ? "No unread news. New issues arrive every two hours."
                    : "Nothing waiting on the Learning shelf."}
              </p>
            )
          )}
        </div>
      )}
      {items.length > 0 &&
        (grouped ? (
          <>
            <h2 class="group-heading">
              <StarIcon filled /> Must Read
            </h2>
            <IssueList items={items.filter((i) => i.mustRead)} onTopic={showTopic} />
            {items.some((i) => !i.mustRead) && (
              <>
                <h2 class="group-heading">Everything else</h2>
                <IssueList items={items.filter((i) => !i.mustRead)} onTopic={showTopic} />
              </>
            )}
          </>
        ) : (
          <IssueList items={items} onTopic={showTopic} />
        ))}
      {cursor && list.status === "ok" && (
        <p class="load-more">
          <button type="button" onClick={loadMore} disabled={more?.loading}>
            {more?.loading ? "Loading..." : "Load more"}
          </button>
        </p>
      )}

      <SenderPicker
        open={picking}
        anchor={sendersButton.current}
        senders={senders.data?.items ?? []}
        counts={f?.senders ?? new Map()}
        picked={picked}
        unreadView={view === "unread"}
        onApply={(ids) => {
          setPicking(false);
          setFilter({ senders: ids });
        }}
        onClose={() => setPicking(false)}
      />
    </section>
  );
}
