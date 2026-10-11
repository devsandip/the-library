import { useCallback, useEffect, useRef, useState } from "preact/hooks";

export type Async<T> =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "ok"; data: T; error?: undefined }
  | { status: "error"; data?: undefined; error: string };

export type AsyncHandle<T> = Async<T> & {
  reload: () => void;
  set: (data: T | ((current: T) => T)) => void;
};

/** The last data each cached load returned, so a view that comes back shows it at once. */
const cache = new Map<string, unknown>();

/**
 * Load when `deps` change (showing a loading state), `reload()` refetches in place (keeping the
 * current data on screen), `set()` replaces data for optimistic updates. Given a function, `set()`
 * updates whatever is current, so quick successive changes do not overwrite each other.
 *
 * With a `cacheKey`, a view opened again (a tab switch, Back) starts from the last data under
 * that key and refreshes it in the background, so nothing jumps to a loading state.
 */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[],
  cacheKey?: string,
): AsyncHandle<T> {
  const initial = (): Async<T> =>
    cacheKey !== undefined && cache.has(cacheKey)
      ? { status: "ok", data: cache.get(cacheKey) as T }
      : { status: "loading" };
  const [state, setState] = useState<Async<T>>(initial);
  const key = useRef(cacheKey);
  key.current = cacheKey;
  const first = useRef(true);

  const run = useCallback((keepData: boolean) => {
    let live = true;
    if (!keepData) setState(initial());
    load().then(
      (data) => {
        if (!live) return;
        if (key.current !== undefined) cache.set(key.current, data);
        setState({ status: "ok", data });
      },
      (err: Error) => live && setState({ status: "error", error: err.message }),
    );
    return () => {
      live = false;
    };
  }, deps);

  useEffect(() => {
    // The first load keeps cached data on screen; a change of deps starts over.
    const keep = first.current && state.status === "ok";
    first.current = false;
    return run(keep);
  }, [run]);

  const reload = useCallback(() => void run(true), [run]);
  const set = useCallback(
    (next: T | ((current: T) => T)) =>
      setState((s) => {
        const data =
          typeof next !== "function"
            ? next
            : s.status === "ok"
              ? (next as (current: T) => T)(s.data)
              : undefined;
        if (data === undefined) return s;
        if (key.current !== undefined) cache.set(key.current, data);
        return { status: "ok", data };
      }),
    [],
  );
  return { ...state, reload, set } as AsyncHandle<T>;
}
