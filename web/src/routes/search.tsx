import { useRef } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { IssueListItem, SearchHit, SearchResponse, SearchSort } from "@library/core/types";
import { BASE } from "../config.js";
import { useApp } from "../context.js";
import { readSearch, searchHref } from "../filters.js";
import { patchIssue } from "../groups.js";
import { useAsync } from "../hooks.js";
import { PANES, useMedia, WIDE } from "../media.js";
import { backIfPossible } from "../nav.js";
import { BackIcon } from "../components/icons.js";
import { IssueCard } from "../components/issue-card.js";
import { IssueReader } from "../components/issue-reader.js";
import { IssueRow } from "../components/issue-row.js";
import { useSaveToggle } from "../components/save.js";
import { SearchBox } from "../components/search-box.js";
import { useSwipeRating } from "../components/swipe.js";

/**
 * Search (#53): every issue and story that matches, across everything received (unread, read,
 * saved and archived). First the issues that hold the query's words, the words marked and a
 * digest's matching story named; then those only close in meaning. On the Mac a click opens the
 * issue in the reading pane; on the phone a tap peeks inside and a double tap opens it.
 */
export function Search() {
  const { api } = useApp();
  const { query, route } = useLocation();
  const wide = useMedia(WIDE);
  const panes = useMedia(PANES);
  const { q, sort, issue } = readSearch(query);
  const results = useAsync(
    (): Promise<SearchResponse | undefined> =>
      q ? api.search(q, sort) : Promise.resolve(undefined),
    [q, sort],
  );
  // While the next query runs, the last results stay on screen instead of a blank list.
  const last = useRef<SearchResponse | undefined>(undefined);
  if (results.status === "ok") last.current = results.data;
  const data = results.status === "loading" && q ? last.current : results.data;

  const open = panes ? issue : undefined;
  const openHere = (id: string) => route(searchHref({ q, sort, issue: id }), true);
  const patch = (id: string, change: Partial<IssueListItem>) => {
    results.set((d) => (d ? { ...d, items: patchIssue(d.items, id, change) } : d));
    if (last.current)
      last.current = { ...last.current, items: patchIssue(last.current.items, id, change) };
  };
  const save = useSaveToggle(patch);
  // An archived issue is still a result: a swiped card stays, showing what changed.
  const rating = useSwipeRating({ patch });

  const items = data?.items ?? [];
  const byWords = items.filter((i) => i.match !== "meaning");
  const byMeaning = items.filter((i) => i.match === "meaning");
  const found = (i: SearchHit) => ({ terms: data?.terms ?? [], story: i.story?.headline });

  const sortTool = (
    <span class="list-tools">
      <select
        aria-label="Order"
        value={sort}
        onChange={(e) =>
          route(searchHref({ q, sort: (e.target as HTMLSelectElement).value as SearchSort }), true)
        }
      >
        <option value="best">Best match</option>
        <option value="newest">Newest first</option>
      </select>
    </span>
  );

  const subline = (
    <p class="subline">
      {!q
        ? "Everything your newsletters said"
        : results.status === "loading"
          ? "Searching..."
          : data
            ? `${byWords.length} with your words${
                byMeaning.length ? ` · ${byMeaning.length} close in meaning` : ""
              }`
            : ""}
    </p>
  );

  const list = (hits: SearchHit[]) =>
    wide ? (
      <ul class="rows">
        {hits.map((i) => (
          <IssueRow
            key={i.id}
            issue={i}
            found={found(i)}
            selected={i.id === open}
            onOpen={panes ? openHere : undefined}
            onSave={save}
          />
        ))}
      </ul>
    ) : (
      <ul class="cards">
        {hits.map((i) => (
          <IssueCard
            key={i.id}
            issue={i}
            found={found(i)}
            swipe={rating.actions(i)}
            onSave={save}
          />
        ))}
      </ul>
    );

  const body = (
    <>
      {!q && (
        <div class="empty">
          <p class="empty-title">Search what your newsletters said.</p>
          <p class="muted">
            Subjects, Claude's lines and every story inside a digest, read or not, archived or not.
            A company, a person, an idea.
          </p>
        </div>
      )}
      {q && results.status === "error" && (
        <p class="error list-note">
          {results.error}{" "}
          <button type="button" class="link" onClick={results.reload}>
            Retry
          </button>
        </p>
      )}
      {q && results.status === "ok" && data && items.length === 0 && (
        <div class="empty">
          <p class="empty-title">Nothing found.</p>
          <p class="muted">
            No issue holds those words{data.byMeaning ? " or comes close in meaning" : ""}.
          </p>
        </div>
      )}
      {data && !data.byMeaning && items.length > 0 && (
        <p class="muted list-note">
          Search by meaning is unavailable right now: these hold your words.
        </p>
      )}
      {byWords.length > 0 && list(byWords)}
      {byMeaning.length > 0 && (
        <>
          <h2 class={wide ? "band" : "section-head"}>Close in meaning</h2>
          {list(byMeaning)}
        </>
      )}
    </>
  );

  if (!wide) {
    return (
      <section class="search-page">
        <a class="back" href={`${BASE}/`} onClick={backIfPossible}>
          <BackIcon /> Library
        </a>
        <h1>Search</h1>
        <SearchBox autoFocus={!q} />
        {q && (
          <div class="list-bar">
            {subline}
            {sortTool}
          </div>
        )}
        {body}
        {rating.toast}
      </section>
    );
  }

  return (
    <div class={`desk-home${panes ? " with-reader" : ""}`}>
      <section class="pane-list search-page" aria-label="Search results">
        <header class="list-head">
          <div class="list-title">
            <h1>{q ? `“${q}”` : "Search"}</h1>
            {q && sortTool}
          </div>
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
              <p class="empty-title">Pick a result to read it here.</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
