import { useCallback, useEffect, useState } from "preact/hooks";

export type Async<T> =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "ok"; data: T; error?: undefined }
  | { status: "error"; data?: undefined; error: string };

/**
 * Load when `deps` change (showing a loading state), `reload()` refetches in place (keeping the
 * current data on screen), `set()` replaces data for optimistic updates.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
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
  const set = useCallback((data: T) => setState({ status: "ok", data }), []);
  return { ...state, reload, set };
}
