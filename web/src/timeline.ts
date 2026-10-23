/**
 * How a story evolved (#19), as the app holds it: one state per story, shared by the phone's
 * Timeline tab and the Mac's story index, and kept for the page's life. A timeline is written only
 * when the reader asks, and a run carries on when its sheet closes: coming back finds it writing,
 * or done.
 */
import { useEffect, useState } from "preact/hooks";
import type { Timeline } from "@library/core/types";
import type { LibraryApi } from "./api.js";
import { useApp } from "./context.js";

export type TimelineState =
  | { status: "loading" }
  /** Nothing kept. `none` says why the last run found nothing to tell. */
  | { status: "idle"; none?: string }
  | { status: "writing"; since: number }
  | { status: "kept"; timeline: Timeline }
  | { status: "error"; error: string; retry: "read" | "write" };

const states = new Map<string, TimelineState>();
const reading = new Set<string>();
const listeners = new Set<() => void>();
const keyOf = (id: string, n: number) => `${id}#${n}`;

function put(key: string, state: TimelineState) {
  states.set(key, state);
  for (const l of listeners) l();
}

export const timelineState = (id: string, n: number): TimelineState =>
  states.get(keyOf(id, n)) ?? { status: "loading" };

/** Asks whether a timeline is kept for the story's event. What is on screen stays meanwhile. */
function read(api: LibraryApi, id: string, n: number) {
  const key = keyOf(id, n);
  if (reading.has(key)) return;
  reading.add(key);
  if (!states.has(key)) put(key, { status: "loading" });
  api
    .timeline(id, n)
    .then(
      (r) => {
        // A run started meanwhile answers for itself.
        if (states.get(key)?.status === "writing") return;
        put(key, r.timeline ? { status: "kept", timeline: r.timeline } : { status: "idle" });
      },
      (err: Error) => put(key, { status: "error", error: err.message, retry: "read" }),
    )
    .finally(() => reading.delete(key));
}

/** Writes the story's timeline: one Claude call, about half a cent. One run at a time per story. */
export function writeTimeline(api: LibraryApi, id: string, n: number) {
  const key = keyOf(id, n);
  if (states.get(key)?.status === "writing") return;
  put(key, { status: "writing", since: Date.now() });
  api.writeTimeline(id, n).then(
    (r) =>
      put(
        key,
        r.timeline ? { status: "kept", timeline: r.timeline } : { status: "idle", none: r.none },
      ),
    (err: Error) => put(key, { status: "error", error: err.message, retry: "write" }),
  );
}

/**
 * The story's timeline, read when first shown (and again while nothing is kept: another story of
 * the same event may have written one), with `write` to write it and `retry` after an error.
 */
export function useTimeline(id: string, n: number) {
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
  const state = timelineState(id, n);
  return {
    state,
    write: () => writeTimeline(api, id, n),
    retry: () =>
      state.status === "error" && state.retry === "read"
        ? read(api, id, n)
        : writeTimeline(api, id, n),
  };
}

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
