import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { IssueListItem } from "@library/core/types";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { patchIssue } from "../groups.js";
import { useAsync } from "../hooks.js";
import { useLibrary } from "../library.js";
import { PANES, useMedia, WIDE } from "../media.js";
import { backIfPossible } from "../nav.js";
import { BackIcon } from "../components/icons.js";
import { IssueCard } from "../components/issue-card.js";
import { IssueReader } from "../components/issue-reader.js";
import { IssueRow } from "../components/issue-row.js";
import { useSaveToggle } from "../components/save.js";
import { useSwipeRating } from "../components/swipe.js";

const savedHref = (issue?: string) =>
  `${BASE}/saved${issue ? `?issue=${encodeURIComponent(issue)}` : ""}`;

/**
 * Saved for later (#43): every saved issue, read or not, newest saved first. Saving takes an issue
 * out of Unread and keeps the archive rules off it. The bookmark again, or archiving it, takes it
 * off this list; the row stays until the list loads again, so a slip can be undone in place.
 */
export function Saved() {
  const { api } = useApp();
  const { counts } = useLibrary();
  const { query, route } = useLocation();
  const wide = useMedia(WIDE);
  const panes = useMedia(PANES);
  const list = useAsync(() => api.listIssues({ view: "saved" }), []);
  const [more, setMore] = useState<{ items: IssueListItem[]; cursor?: string; loading: boolean }>();
  // Issues swiped away (#13): archived, which also unsaves them, waiting out the Undo.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const open = panes ? query.issue : undefined;
  const openHere = (id: string) => route(savedHref(id), true);

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
  const save = useSaveToggle(patch);
  const rating = useSwipeRating({ patch, hide });

  const cursor = more ? more.cursor : list.data?.cursor;
  const items = [...(list.data?.items ?? []), ...(more?.items ?? [])].filter(
    (i) => !gone.has(i.id),
  );
  const loadMore = async () => {
    if (!cursor) return;
    setMore((m) => ({ items: m?.items ?? [], cursor, loading: true }));
    const page = await api.listIssues({ view: "saved", cursor });
    setMore((m) => ({
      items: [...(m?.items ?? []), ...page.items],
      cursor: page.cursor,
      loading: false,
    }));
  };

  const total = counts.data?.saved;
  const subline = (
    <p class="subline">
      {total === undefined ? "To read later" : `${total} saved`} · newest saved first
    </p>
  );

  const body = (
    <>
      {list.status === "loading" && <p class="subline list-note">Loading...</p>}
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
          <p class="empty-title">Nothing saved.</p>
          <p class="muted">The bookmark on an issue keeps it here to read later.</p>
        </div>
      )}
      {items.length > 0 &&
        (wide ? (
          <ul class="rows">
            {items.map((i) => (
              <IssueRow
                key={i.id}
                issue={i}
                selected={i.id === open}
                onOpen={panes ? openHere : undefined}
                onSave={save}
              />
            ))}
          </ul>
        ) : (
          <ul class="cards">
            {items.map((i) => (
              <IssueCard key={i.id} issue={i} swipe={rating.actions(i)} onSave={save} />
            ))}
          </ul>
        ))}
      {cursor && list.status === "ok" && (
        <p class="load-more">
          <button type="button" onClick={loadMore} disabled={more?.loading}>
            {more?.loading ? "Loading..." : "Load more"}
          </button>
        </p>
      )}
    </>
  );

  if (!wide) {
    return (
      <section class="saved">
        <a class="back" href={`${BASE}/`} onClick={backIfPossible}>
          <BackIcon /> Library
        </a>
        <h1>Saved</h1>
        {subline}
        {body}
        {rating.toast}
      </section>
    );
  }

  return (
    <div class={`desk-home${panes ? " with-reader" : ""}`}>
      <section class="pane-list saved" aria-label="Saved">
        <header class="list-head">
          <h1>Saved</h1>
          {subline}
        </header>
        {body}
      </section>
      {panes && (
        <section class="pane-reader" aria-label="Reading pane">
          {open ? (
            <IssueReader key={open} id={open} wide onChange={patch} onOpen={openHere} />
          ) : (
            <div class="reader-empty">
              <p class="empty-title">Pick an issue to read it here.</p>
              <p class="muted">Saved issues stay here until you take them off.</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
