import { useEffect, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { BASE } from "../config.js";
import { readSearch, searchHref } from "../filters.js";
import { SearchIcon } from "./icons.js";

/** A pause in typing this long runs the search (#53). */
const PAUSE_MS = 300;

/**
 * The search field (#53): at the top of the Mac's sidebar, and on the phone's search page. It
 * searches as you type, after a short pause. The query lives in the URL: the first search from
 * another page adds a step to Back, and typing on the results page replaces it, so Back leaves
 * search rather than walking through every word typed. On the Mac, "/" jumps to it.
 */
export function SearchBox({ sidebar = false, autoFocus = false }) {
  const { path, query, route } = useLocation();
  const here = path === `${BASE}/search`;
  const { q, sort } = readSearch(here ? query : {});
  const [text, setText] = useState(q);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Follow the URL (Back, leaving search), but never undo what is being typed.
  useEffect(() => setText((t) => (t.trim() === q ? t : q)), [q]);
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!sidebar) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebar]);

  const go = (value: string) => {
    clearTimeout(timer.current);
    const next = value.trim();
    if (next === q && here) return;
    if (!next && !here) return;
    route(searchHref({ q: next, sort }), here);
  };

  return (
    <form
      role="search"
      class="search-form"
      onSubmit={(e) => {
        e.preventDefault();
        go(text);
      }}
    >
      <label class={sidebar ? "search side-search" : "search"}>
        <SearchIcon />
        <input
          ref={input}
          type="search"
          aria-label="Search the library"
          placeholder="Search the library"
          title={sidebar ? "Search the library (/)" : undefined}
          enterKeyHint="search"
          autoFocus={autoFocus}
          value={text}
          onInput={(e) => {
            const value = (e.target as HTMLInputElement).value;
            setText(value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => go(value), PAUSE_MS);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.target as HTMLInputElement).blur();
          }}
        />
      </label>
    </form>
  );
}
