import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { IssueListItem, View } from "@library/core/types";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { facets } from "../counts.js";
import {
  homeHref,
  readFilters,
  SHELF_LABEL,
  SHELVES,
  VIEWS,
  type HomeFilters,
} from "../filters.js";
import { patchIssue, topicSections, UNSORTED } from "../groups.js";
import { useAsync } from "../hooks.js";
import { useLibrary } from "../library.js";
import { PANES, useMedia, WIDE } from "../media.js";
import { BriefHeader } from "../components/header.js";
import { CloseIcon, FilterIcon, RefreshIcon, StarIcon } from "../components/icons.js";
import { IssueCard } from "../components/issue-card.js";
import { IssueReader } from "../components/issue-reader.js";
import { IssueRow } from "../components/issue-row.js";
import { useSaveToggle } from "../components/save.js";
import { SenderPicker } from "../components/sender-picker.js";
import { useSwipeRating } from "../components/swipe.js";

/**
 * Home (#12). On the phone, briefing cards: Must Read as a row of large cards, then the rest
 * under their topics. On the Mac, the list column beside the sidebar, and a reading pane when the
 * window is wide enough.
 */
export function Home() {
  const { api } = useApp();
  const { query, route } = useLocation();
  const lib = useLibrary();
  const wide = useMedia(WIDE);
  const panes = useMedia(PANES);
  // The tabs appear once Claude has proposed topics and started sorting (`pnpm topics`).
  const shelvesOn = (lib.topics.data?.topics.length ?? 0) > 0;
  const filters = readFilters(query);
  const { shelf, view, senders: picked, topics: pickedTopics } = filters;

  const listShelf = shelvesOn ? shelf : undefined;
  const topicsKnown = lib.topics.status !== "loading";
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
  // Issues swiped away (#13): archived, waiting out the Undo.
  const [gone, setGone] = useState<Set<string>>(new Set());

  const setFilter = (next: Partial<HomeFilters>) => {
    setMore(undefined);
    route(homeHref({ ...filters, ...next }));
  };
  const toggleTopic = (t: string) =>
    setFilter({
      topics: pickedTopics.includes(t) ? pickedTopics.filter((x) => x !== t) : [...pickedTopics, t],
    });
  // Opening in the pane replaces the history entry, so Back still leaves the list.
  const openInPane = (id: string) => route(homeHref({ ...filters, issue: id }), true);

  const senderItems = lib.senders.data?.items ?? [];
  const muted = new Set(senderItems.filter((s) => s.muted).map((s) => s.senderId));
  const f = lib.counts.data
    ? facets(
        lib.counts.data.counts,
        { shelf: listShelf, senders: picked, topics: pickedTopics },
        muted,
      )
    : undefined;
  const nameOf = (id: string) =>
    senderItems.find((s) => s.senderId === id)?.publication ?? "Newsletter";
  const topicOrder = (lib.topics.data?.topics ?? []).map((t) => t.name);
  // Claude's topic order; topics with nothing unread here drop out unless they are on.
  const topicChips = topicOrder
    .map((name) => ({ name, n: f?.topics.get(name) ?? 0, on: pickedTopics.includes(name) }))
    .filter((t) => t.on || t.n > 0 || !f);

  const cursor = more ? more.cursor : list.data?.cursor;
  const items = [...(list.data?.items ?? []), ...(more?.items ?? [])].filter(
    (i) => !gone.has(i.id),
  );
  // Unread lists Must Read newsletters first; they lead as their own group.
  const grouped = view === "unread" && !picked.length && items.some((i) => i.mustRead);
  const must = grouped ? items.filter((i) => i.mustRead) : [];
  const rest = grouped ? items.filter((i) => !i.mustRead) : items;
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
      lib.counts.reload();
    } finally {
      setRefreshing(false);
    }
  };

  /** Keeps rows in step with what the reading pane or a swipe changes. */
  const patch = (id: string, change: Partial<IssueListItem>) => {
    list.set((d) => ({ ...d, items: patchIssue(d.items, id, change) }));
    setMore((m) => (m ? { ...m, items: patchIssue(m.items, id, change) } : m));
  };
  const hide = (id: string, on: boolean) =>
    setGone((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  // The Archived view keeps archived issues, so a left swipe there only rates.
  const rating = useSwipeRating({ patch, hide: view === "archived" ? undefined : hide });
  // Save for later (#43): a saved row stays put until the list reloads, then leaves Unread.
  const save = useSaveToggle(patch);
  const savedCount = lib.counts.data?.saved ?? 0;

  const countLine =
    view === "unread"
      ? f
        ? `${f.total} unread`
        : ""
      : view === "all"
        ? "Read and unread"
        : "Archived";

  const viewTools = (
    <span class="list-tools">
      <select
        aria-label="Which issues"
        value={view}
        onChange={(e) => {
          const next = (e.target as HTMLSelectElement).value;
          // Saved (#43) is its own page: every saved issue, newest saved first, across shelves.
          if (next === "saved") route(`${BASE}/saved`);
          else setFilter({ view: next as View });
        }}
      >
        {VIEWS.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
        <option value="saved">{savedCount ? `Saved (${savedCount})` : "Saved"}</option>
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
  );

  const listStatus = (
    <>
      {list.status === "loading" && <p class="muted list-note">Loading...</p>}
      {list.status === "error" && (
        <p class="error list-note">
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
    </>
  );

  const loadMoreButton = cursor && list.status === "ok" && (
    <p class="load-more">
      <button type="button" onClick={loadMore} disabled={more?.loading}>
        {more?.loading ? "Loading..." : "Load more"}
      </button>
    </p>
  );

  if (wide) {
    const rows = (xs: IssueListItem[]) => (
      <ul class="rows">
        {xs.map((i) => (
          <IssueRow
            key={i.id}
            issue={i}
            selected={panes && i.id === filters.issue}
            onOpen={panes ? openInPane : undefined}
            onSave={save}
          />
        ))}
      </ul>
    );
    return (
      <div class={`desk-home${panes ? " with-reader" : ""}`}>
        <section class="pane-list" aria-label="Issues">
          <header class="list-head">
            <div class="list-title">
              <h1>{shelvesOn ? SHELF_LABEL[shelf] : "Issues"}</h1>
              {viewTools}
            </div>
            <p class="subline">
              {countLine}
              {grouped && " · Must Read first"}
              {filtered && (
                <>
                  {countLine && " · "}
                  <button
                    type="button"
                    class="link"
                    onClick={() => setFilter({ senders: [], topics: [] })}
                  >
                    Clear filters
                  </button>
                </>
              )}
            </p>
          </header>
          {listStatus}
          {items.length > 0 &&
            (grouped ? (
              <>
                <h2 class="band">
                  <StarIcon filled /> Must Read
                </h2>
                {rows(must)}
                {rest.length > 0 && (
                  <>
                    <h2 class="band">Everything else</h2>
                    {rows(rest)}
                  </>
                )}
              </>
            ) : (
              rows(items)
            ))}
          {loadMoreButton}
        </section>
        {panes && (
          <section class="pane-reader" aria-label="Reading pane">
            {filters.issue ? (
              <IssueReader
                key={filters.issue}
                id={filters.issue}
                wide
                onChange={patch}
                onOpen={openInPane}
              />
            ) : (
              <div class="reader-empty">
                <p class="empty-title">Pick an issue to read it here.</p>
                <p class="muted">Opening one marks it read.</p>
              </div>
            )}
          </section>
        )}
      </div>
    );
  }

  const sections = topicSections(rest, topicOrder);
  return (
    <section class="home">
      <BriefHeader />

      {shelvesOn && (
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
              {f && ` · ${f.shelves[s.id]}`}
            </button>
          ))}
        </div>
      )}

      <div class="filter-bar" role="group" aria-label="Filters">
        <button
          type="button"
          class="chip senders"
          aria-haspopup="dialog"
          onClick={() => setPicking(true)}
        >
          <FilterIcon />
          {picked.length ? `Senders: ${picked.length}` : "Senders"}
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
            {t.name}
            {!t.on && f && <span class="n">{t.n}</span>}
          </button>
        ))}
      </div>

      <div class="list-bar">
        <span class="muted">{countLine}</span>
        {viewTools}
      </div>

      {listStatus}
      {must.length > 0 && (
        <>
          <h2 class="section-head must">
            <StarIcon filled /> Must Read
          </h2>
          <ul class="must-row" aria-label="Must Read">
            {must.map((i) => (
              <IssueCard key={i.id} issue={i} lead onSave={save} />
            ))}
          </ul>
        </>
      )}
      {sections.map((s) => (
        <section key={s.name} class="topic-section">
          <h2 class="section-head">
            {/* Tapping a topic's heading switches its chip on (#10). */}
            {s.name !== UNSORTED && !pickedTopics.includes(s.name) ? (
              <button
                type="button"
                class="section-topic"
                title={`Only ${s.name}`}
                onClick={() => toggleTopic(s.name)}
              >
                {s.name}
              </button>
            ) : (
              <span>{s.name}</span>
            )}
            <span class="n">{s.items.length}</span>
          </h2>
          <ul class="cards">
            {s.items.map((i) => (
              <IssueCard key={i.id} issue={i} swipe={rating.actions(i)} onSave={save} />
            ))}
          </ul>
        </section>
      ))}
      {loadMoreButton}

      <SenderPicker
        open={picking}
        senders={senderItems}
        counts={f?.senders ?? new Map()}
        picked={picked}
        unreadView={view === "unread"}
        onApply={(ids) => {
          setPicking(false);
          setFilter({ senders: ids });
        }}
        onClose={() => setPicking(false)}
      />
      {rating.toast}
    </section>
  );
}
