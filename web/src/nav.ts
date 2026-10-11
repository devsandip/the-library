import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

/**
 * Back must restore every view exactly (the redesign). The views keep their state in the URL;
 * this module adds what a URL cannot hold: where the page was scrolled, and which view the reader
 * came from (for the reader's "‹ Today").
 */

let popped = false;
/** This tab's place in the app's history: 0 is the entry the app was opened on. */
let index = 0;
/** The in-app URL at each history index this session. */
const urls: string[] = [];

const here = () => location.pathname + location.search;
const indexOf = (state: unknown) =>
  typeof state === "object" && state !== null && typeof (state as { i?: unknown }).i === "number"
    ? (state as { i: number }).i
    : 0;

/** Install once, before the app renders: preact-iso navigates with pushState and replaceState. */
export function trackNavigation() {
  history.scrollRestoration = "manual";
  index = indexOf(history.state);
  history.replaceState({ ...(history.state as object), i: index }, "");
  urls[index] = here();
  addEventListener("popstate", (e) => {
    popped = true;
    index = indexOf(e.state);
    urls[index] = here();
  });
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = (_state: unknown, unused: string, url?: string | URL | null) => {
    popped = false;
    index += 1;
    push({ i: index }, unused, url);
    urls[index] = here();
    urls.length = index + 1;
  };
  history.replaceState = (state: unknown, unused: string, url?: string | URL | null) => {
    replace({ ...(state as object), i: index }, unused, url);
    urls[index] = here();
  };
}

/** The in-app URL before this one, if the app has been somewhere else first. */
export function previousPath(): string | undefined {
  return index > 0 ? urls[index - 1] : undefined;
}

/** Go back if the app has been somewhere before (that view comes back as it was); else to `fallback`. */
export function goBack(route: (url: string, replace?: boolean) => void, fallback: string) {
  if (index > 0) history.back();
  else route(fallback, true);
}

const SCROLL_KEY = "library.scroll";

function readPlaces(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function savePlace(url: string, y: number) {
  try {
    const places = readPlaces();
    places[url] = y;
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify(places));
  } catch {
    // Blocked storage: Back starts at the top.
  }
}

/**
 * Remembers how far down a view was scrolled and puts it back when Back (or Forward) returns to
 * it, once its content is `ready`. A view reached by a link starts at the top.
 */
export function useScrollMemory(ready: boolean) {
  const url = useRef(here());
  const pending = useRef(popped);
  const y = useRef(0);

  useEffect(() => {
    if (!pending.current) scrollTo(0, 0);
    const at = url.current;
    const onScroll = () => {
      if (!pending.current) y.current = scrollY;
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      if (!pending.current) savePlace(at, y.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!pending.current || !ready) return;
    pending.current = false;
    const to = readPlaces()[url.current] ?? 0;
    y.current = to;
    // Twice: once now, once after late layout (fonts, images) settles.
    scrollTo(0, to);
    requestAnimationFrame(() => scrollTo(0, to));
  }, [ready]);
}

/**
 * Handle a plain click on a link in place instead of following it. Modified clicks keep the
 * browser's own behaviour (new tab, new window). The click must not reach preact-iso's window
 * listener: it follows every in-scope link and ignores preventDefault.
 */
export function clickInPlace(e: MouseEvent, handle: () => void) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  e.stopPropagation();
  handle();
}
