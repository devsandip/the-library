/**
 * Weekly tune-up (#26, #158): Sandip's corrections counted and newsletter rules proposed from them,
 * worked out when asked from what is stored (`@library/core`'s `tuneup`). No model is called; only
 * the proposals put off with Not now are kept.
 */
import { tuneup, type TuneupData } from "@library/core";
import type { TuneupResponse } from "@library/core/types";
import { notFound } from "./errors.js";
import type { TuneupPort } from "./port.js";

/** Where the tune-up's numbers are read. DynamoRepo implements it; tests use a fake. */
export interface TuneupStore {
  /** Every sender, issue and story, and the proposals put off. */
  readTuneup(): Promise<TuneupData>;
  /** Put a proposal off while Sandip's moves toward it are at most `fixes`. */
  dismissTuneup(id: string, fixes: number): Promise<void>;
}

export class Tuneups implements TuneupPort {
  constructor(private readonly store: TuneupStore) {}

  async tuneup(): Promise<TuneupResponse> {
    return tuneup(await this.store.readTuneup());
  }

  /** Not now, with the number of moves the proposal has now, so more of them bring it back. */
  async dismiss(id: string): Promise<TuneupResponse> {
    const data = await this.store.readTuneup();
    const p = tuneup(data).proposals.find((x) => x.id === id);
    if (!p) throw notFound("no such proposal");
    await this.store.dismissTuneup(id, p.fixes);
    return tuneup({ ...data, dismissed: { ...data.dismissed, [id]: p.fixes } });
  }
}
