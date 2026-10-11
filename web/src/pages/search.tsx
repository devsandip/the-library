import { useEffect, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { SearchResponse, SearchSort } from "@library/core/types";
import { useIssueActions, type IssueChange } from "../actions.js";
import { useApp } from "../context.js";
import { patchIssue } from "../data.js";
import { useAsync } from "../hooks.js";
import { useScrollMemory } from "../nav.js";
import { searchHref } from "../paths.js";
import { SearchIcon } from "../components/icons.js";
import { Row } from "../components/row.js";
import { Failed, Skeleton } from "../components/ui.js";
import { openHref, Page } from "./page.js";

/** A pause in typing this long runs the search (#53). */
const PAUSE_MS = 300;

/**
 * Search (#53): every issue and story that matches, across everything received (unread, read,
 * saved and archived). First the issues that hold the words, marked, with a digest's matching
 * story named; then those only close in meaning. The query lives in the URL: typing replaces it,
 * so Back leaves search rather than walking through every word.
 */
export function Search({ q, sort, wide }: { q: string; sort: SearchSort; wide: boolean }) {
  const { api } = useApp();
  const { route } = useLocation();
  const [text, setText] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const results = useAsync(
    (): Promise<SearchResponse | undefined> =>
      q ? api.search(q, sort) : Promise.resolve(undefined),
    [q, sort],
    `search:${q}:${sort}`,
  );
  // While the next query runs, the last results stay on screen.
  const last = useRef<SearchResponse | undefined>(undefined);
  if (results.status === "ok") last.current = results.data;
  const data = results.status === "loading" && q ? last.current : results.data;
  useScrollMemory(results.status === "ok");

  useEffect(() => setText((t) => (t.trim() === q ? t : q)), [q]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const go = (value: string) => {
    clearTimeout(timer.current);
    const next = value.trim();
    if (next !== q) route(searchHref(next, sort), true);
  };

  const patch = (id: string, change: IssueChange) => {
    results.set((d) => (d ? { ...d, items: patchIssue(d.items, id, change) } : d));
    if (last.current)
      last.current = { ...last.current, items: patchIssue(last.current.items, id, change) };
  };
  // A result stays a result when it is archived: the row shows what changed.
  const actions = useIssueActions({ patch });
  const items = data?.items ?? [];
  const byWords = items.filter((i) => i.match !== "meaning");
  const byMeaning = items.filter((i) => i.match === "meaning");
  const href = openHref(wide);

  const rows = (hits: typeof items) => (
    <ul class="rows">
      {hits.map((i) => (
        <Row
          key={i.id}
          issue={i}
          href={href(i)}
          actions={actions}
          onChange={patch}
          wide={wide}
          found={{ terms: data?.terms ?? [], story: i.story?.headline }}
        />
      ))}
    </ul>
  );

  return (
    <Page title="Search" wide={wide} class="search">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go(text);
        }}
      >
        <label class="field">
          <SearchIcon size={18} />
          <input
            type="search"
            enterKeyHint="search"
            aria-label="Search everything you received"
            placeholder="Search everything you received"
            autoFocus={!q}
            value={text}
            onInput={(e) => {
              const value = (e.target as HTMLInputElement).value;
              setText(value);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => go(value), PAUSE_MS);
            }}
          />
        </label>
      </form>
      {q && (
        <div class="search-bar label">
          <span>
            {results.status === "loading"
              ? "Searching…"
              : data
                ? `${byWords.length} with your words${byMeaning.length ? ` · ${byMeaning.length} close in meaning` : ""}`
                : ""}
          </span>
          <button
            type="button"
            class="link-btn label"
            onClick={() => route(searchHref(q, sort === "best" ? "newest" : "best"), true)}
          >
            {sort === "best" ? "Best match" : "Newest first"} ⇅
          </button>
        </div>
      )}
      {!q && (
        <p class="search-hint">
          Subjects, Claude's lines and every story inside a digest, read or not, archived or not. A
          company, a person, an idea.
        </p>
      )}
      {q && results.status === "loading" && !data && <Skeleton />}
      {q && results.status === "error" && <Failed message={results.error} retry={results.reload} />}
      {q && data && items.length === 0 && (
        <div class="empty">
          <p class="empty-text">Nothing matches "{q}". Try other words, or ask the Library.</p>
        </div>
      )}
      {data && !data.byMeaning && items.length > 0 && (
        <p class="search-hint">
          Search by meaning is unavailable right now: these hold your words.
        </p>
      )}
      {byWords.length > 0 && rows(byWords)}
      {byMeaning.length > 0 && (
        <>
          <p class="label section-label">Close in meaning</p>
          {rows(byMeaning)}
        </>
      )}
    </Page>
  );
}
