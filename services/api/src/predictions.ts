/**
 * Predictions (#24, #140): open ones by due date, settled ones latest first, and Sandip's own
 * verdicts. Settling is the jobs Lambda's (`./settle.ts`); this only lists and overrules.
 */
import type { ReaderSettings } from "@library/core/settings";
import { readerDay } from "@library/core";
import type {
  Prediction,
  PredictionStatus,
  PredictionsResponse,
  PredictionView,
} from "@library/core/types";
import { notFound } from "./errors.js";
import type { PredictionsPort } from "./port.js";
import type { StoredPrediction } from "./settle.js";

/** A verdict Sandip can set: right, wrong or unclear, or null to hand it back to settling. */
export type Verdict = Exclude<PredictionStatus, "open"> | null;

/** Where predictions are read and overruled. DynamoRepo implements it; tests use a fake. */
export interface PredictionStore {
  /** The reader's settings: what is due is by their day (#185). */
  settings(): Promise<ReaderSettings>;
  listPredictions(): Promise<StoredPrediction[]>;
  /** Sets Sandip's verdict, or hands it back; undefined when there is no such prediction. */
  setPredictionVerdict(
    id: string,
    verdict: Verdict,
    at: string,
  ): Promise<StoredPrediction | undefined>;
}

/** A prediction as the API answers it: without settling's own bookkeeping. */
export function shown(p: StoredPrediction): Prediction {
  const { tries: _tries, nextTry: _nextTry, ...rest } = p;
  return rest;
}

/** One view: open by due date, soonest first; settled latest first. */
export function predictionView(
  list: StoredPrediction[],
  view: PredictionView,
  today: string,
): PredictionsResponse {
  const open = list.filter((p) => p.status === "open");
  const items =
    view === "open"
      ? open.sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id))
      : list
          .filter((p) => p.status !== "open")
          .sort(
            (a, b) =>
              (b.settledAt ?? "").localeCompare(a.settledAt ?? "") || a.id.localeCompare(b.id),
          );
  return { items: items.map(shown), due: open.filter((p) => p.due <= today).length };
}

export class Predictions implements PredictionsPort {
  constructor(
    private readonly store: PredictionStore,
    private readonly now: () => number = Date.now,
  ) {}

  async list(view: PredictionView): Promise<PredictionsResponse> {
    return predictionView(
      await this.store.listPredictions(),
      view,
      readerDay(this.now(), (await this.store.settings()).timeZone),
    );
  }

  async set(id: string, verdict: Verdict): Promise<Prediction> {
    const at = new Date(this.now()).toISOString();
    const p = await this.store.setPredictionVerdict(id, verdict, at);
    if (!p) throw notFound(`no prediction ${id}`);
    return shown(p);
  }
}
