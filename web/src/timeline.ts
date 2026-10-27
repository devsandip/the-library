/**
 * The deep dives as the app holds them: How this evolved (#19), Takes (#17) and the source
 * check (#23). One state per
 * story and kind, shared by the phone's tabs and the Mac's story index, and kept for the page's
 * life. A deep dive is written only when the reader asks, and a run carries on when its sheet
 * closes: coming back finds it writing, or done.
 */
import { useEffect, useState } from "preact/hooks";
import type { SourceCheck, Takes, Timeline } from "@library/core/types";
import type { LibraryApi } from "./api.js";
import { useApp } from "./context.js";

export type DeepState<T> =
  | { status: "loading" }
  /** Nothing kept. `none` says why the last run found nothing to tell. */
  | { status: "idle"; none?: string }
  | { status: "writing"; since: number }
  | { status: "kept"; value: T }
  | { status: "error"; error: string; retry: "read" | "write" };

export type TimelineState = DeepState<Timeline>;
export type TakesState = DeepState<Takes>;
export type SourceState = DeepState<SourceCheck>;

/** What the API answers for a deep dive: the kept result, or why there is none. */
type Answer<T> = Promise<{ value?: T; none?: string }>;

/**
 * One kind of deep dive: its states by story, reading what is kept and writing on request (one
 * run at a time per story), and a hook that follows a story's state.
 */
function deepDive<T>(get: (api: LibraryApi, id: string, n: number) => Answer<T>, run: typeof get) {
  const states = new Map<string, DeepState<T>>();
  const reading = new Set<string>();
  const listeners = new Set<() => void>();
  const keyOf = (id: string, n: number) => `${id}#${n}`;

  const put = (key: string, state: DeepState<T>) => {
    states.set(key, state);
    for (const l of listeners) l();
  };
  const stateOf = (id: string, n: number): DeepState<T> =>
    states.get(keyOf(id, n)) ?? { status: "loading" };

  /** Asks whether one is kept for the story's event. What is on screen stays meanwhile. */
  const read = (api: LibraryApi, id: string, n: number) => {
    const key = keyOf(id, n);
    if (reading.has(key)) return;
    reading.add(key);
    if (!states.has(key)) put(key, { status: "loading" });
    get(api, id, n)
      .then(
        (r) => {
          // A run started meanwhile answers for itself.
          if (states.get(key)?.status === "writing") return;
          put(key, r.value ? { status: "kept", value: r.value } : { status: "idle" });
        },
        (err: Error) => put(key, { status: "error", error: err.message, retry: "read" }),
      )
      .finally(() => reading.delete(key));
  };

  const write = (api: LibraryApi, id: string, n: number) => {
    const key = keyOf(id, n);
    if (states.get(key)?.status === "writing") return;
    put(key, { status: "writing", since: Date.now() });
    run(api, id, n).then(
      (r) =>
        put(key, r.value ? { status: "kept", value: r.value } : { status: "idle", none: r.none }),
      (err: Error) => put(key, { status: "error", error: err.message, retry: "write" }),
    );
  };

  /**
   * The story's deep dive, read when first shown (and again while nothing is kept: another story
   * of the same event may have written one), with `write` and `retry` after an error.
   */
  const use = (id: string, n: number) => {
    const { api } = useApp();
    const [, tick] = useState(0);
    useEffect(() => {
      const l = () => tick((t) => t + 1);
      listeners.add(l);
      return () => void listeners.delete(l);
    }, []);
    useEffect(() => {
      const s = states.get(keyOf(id, n));
      if (!s || s.status === "idle" || (s.status === "error" && s.retry === "read")) {
        read(api, id, n);
      }
    }, [id, n]);
    const state = stateOf(id, n);
    return {
      state,
      write: () => write(api, id, n),
      retry: () =>
        state.status === "error" && state.retry === "read" ? read(api, id, n) : write(api, id, n),
    };
  };

  return { stateOf, write, use };
}

const timelines = deepDive<Timeline>(
  (api, id, n) => api.timeline(id, n).then((r) => ({ value: r.timeline, none: r.none })),
  (api, id, n) => api.writeTimeline(id, n).then((r) => ({ value: r.timeline, none: r.none })),
);

const takes = deepDive<Takes>(
  (api, id, n) => api.takes(id, n).then((r) => ({ value: r.takes, none: r.none })),
  (api, id, n) => api.writeTakes(id, n).then((r) => ({ value: r.takes, none: r.none })),
);

export const timelineState = timelines.stateOf;
/** Writes the story's timeline: one Claude call, about half a cent. */
export const writeTimeline = timelines.write;
export const useTimeline = timelines.use;

const sources = deepDive<SourceCheck>(
  (api, id, n) => api.source(id, n).then((r) => ({ value: r.check, none: r.none })),
  (api, id, n) => api.checkSource(id, n).then((r) => ({ value: r.check, none: r.none })),
);

export const sourceState = sources.stateOf;
/** Checks the story against its source: a page read and one Claude call, about a cent. */
export const checkSource = sources.write;
export const useSource = sources.use;

export const takesState = takes.stateOf;
/** Writes the takes on the story's event: one Claude call, about a cent. */
export const writeTakes = takes.write;
export const useTakes = takes.use;

/** Seconds since `since`, ticking once a second: the writing line's "0:03". */
export function useElapsed(since: number | undefined): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (since === undefined) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since === undefined ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

/** "0:03". */
export const elapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
