import { useCallback, useEffect, useState } from "preact/hooks";

export type Async<T> =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "ok"; data: T; error?: undefined }
  | { status: "error"; data?: undefined; error: string };

export type AsyncHandle<T> = Async<T> & {
  reload: () => void;
  set: (data: T | ((current: T) => T)) => void;
};

/**
 * Load when `deps` change (showing a loading state), `reload()` refetches in place (keeping the
 * current data on screen), `set()` replaces data for optimistic updates. Given a function, `set()`
 * updates whatever is current, so quick successive changes do not overwrite each other.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncHandle<T> {
  const [state, setState] = useState<Async<T>>({ status: "loading" });

  const run = useCallback((keepData: boolean) => {
    let live = true;
    if (!keepData) setState({ status: "loading" });
    load().then(
      (data) => live && setState({ status: "ok", data }),
      (err: Error) => live && setState({ status: "error", error: err.message }),
    );
    return () => {
      live = false;
    };
  }, deps);

  useEffect(() => run(false), [run]);

  const reload = useCallback(() => void run(true), [run]);
  const set = useCallback(
    (next: T | ((current: T) => T)) =>
      setState((s) => {
        if (typeof next !== "function") return { status: "ok", data: next };
        return s.status === "ok" ? { status: "ok", data: (next as (current: T) => T)(s.data) } : s;
      }),
    [],
  );
  return { ...state, reload, set } as AsyncHandle<T>;
}
