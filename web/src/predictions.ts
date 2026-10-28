/**
 * Predictions (#24, #141) as the app holds them: the open and settled lists, each read when first
 * shown and again when its page opens, kept for the page's life so Library and ⌘K can show how
 * many are due. A verdict Sandip sets moves the prediction at once; the API's answer replaces it.
 */
import { useEffect, useState } from "preact/hooks";
import type {
  Prediction,
  PredictionStatus,
  PredictionsResponse,
  PredictionView,
} from "@library/core/types";
import type { LibraryApi } from "./api.js";
import { useApp } from "./context.js";

export type PredictionsState =
  | { status: "loading" }
  | { status: "ok"; data: PredictionsResponse }
  | { status: "error"; error: string };

const states: Record<PredictionView, PredictionsState> = {
  open: { status: "loading" },
  settled: { status: "loading" },
};
const reading: Partial<Record<PredictionView, Promise<void>>> = {};
const listeners = new Set<() => void>();

function put(view: PredictionView, next: PredictionsState) {
  states[view] = next;
  for (const l of listeners) l();
}

export const predictionsState = (view: PredictionView) => states[view];

/** Reads a view again; what is on screen stays meanwhile. */
export function readPredictions(api: LibraryApi, view: PredictionView): Promise<void> {
  reading[view] ??= api
    .predictions(view)
    .then(
      (data) => put(view, { status: "ok", data }),
      (err: Error) => {
        if (states[view].status !== "ok") put(view, { status: "error", error: err.message });
      },
    )
    .finally(() => delete reading[view]);
  return reading[view]!;
}

/** A view, read when first shown and again when `fresh` (its page opening). */
export function usePredictions(
  view: PredictionView,
  fresh = true,
): { state: PredictionsState; reload: () => Promise<void> } {
  const { api } = useApp();
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    if (fresh || states[view].status === "loading") void readPredictions(api, view);
  }, [view]);
  return { state: states[view], reload: () => readPredictions(api, view) };
}

/** Moves a prediction to where its status puts it, in both lists. */
function place(p: Prediction) {
  for (const view of ["open", "settled"] as const) {
    const s = states[view];
    if (s.status !== "ok") continue;
    const others = s.data.items.filter((i) => i.id !== p.id);
    const belongs = (view === "open") === (p.status === "open");
    const items = belongs
      ? [...others, p].sort((a, b) =>
          view === "open"
            ? a.due.localeCompare(b.due) || a.id.localeCompare(b.id)
            : (b.settledAt ?? "").localeCompare(a.settledAt ?? ""),
        )
      : others;
    put(view, { status: "ok", data: { ...s.data, items } });
  }
}

/** Sandip's verdict, or null to hand it back to settling. Throws the API's error. */
export async function setVerdict(
  api: LibraryApi,
  p: Prediction,
  verdict: Exclude<PredictionStatus, "open"> | null,
): Promise<void> {
  const next = await api.setVerdict(p.id, verdict);
  place(next);
}
