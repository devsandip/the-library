/**
 * Story shelves (#81). Jev reads each story (its newsletter, headline and summary) and gives the
 * probability that it builds the reader's craft; 0.5 and up is Learning. A pass of its own after
 * the story index, so a Jev outage never holds up stories and the next run picks up what failed.
 * Nothing reads the story's shelf yet: Learning still lists issues until #81's step 4.
 */
import { storyRef } from "@library/core";
import type { Shelf, ShelfStats, StoryShelfSetBy } from "@library/core/types";
import {
  JEV_MODEL,
  SHELF_QUESTIONS,
  isUnsure,
  learningProbability,
  storyState,
  type DecisionPort,
} from "./jev.js";
import type { Store } from "./store.js";

/** Learning from this probability up. */
export const LEARNING_FROM = 0.5;

/** A stored story as shelving reads it. */
export interface ShelfCandidate {
  issueId: string;
  n: number;
  receivedAt: string;
  headline: string;
  summary: string;
  shelfSetBy?: StoryShelfSetBy;
}

export interface ShelveOptions {
  sinceIso: string;
  /** Ask Jev again about its own calls (after a change to the question). Sandip's moves stay. */
  force?: boolean;
  concurrency?: number;
  /** Epoch ms after which no new story is started; the rest wait for the next run. */
  deadline?: number;
}

export const shelfFor = (learning: number): Shelf =>
  learning >= LEARNING_FROM ? "learning" : "news";

/**
 * Shelve the stories received since `sinceIso` that have no shelf yet. `jev` is only called when
 * there is work, so a run with nothing to shelve never reads the key.
 */
export async function shelveStories(
  store: Store,
  jev: () => Promise<DecisionPort>,
  opts: ShelveOptions,
): Promise<ShelfStats> {
  const started = Date.now();
  const stats: ShelfStats = {
    checked: 0,
    shelved: 0,
    learning: 0,
    unsure: 0,
    deferred: 0,
    errors: 0,
    errorSamples: [],
    inputTokens: 0,
    durationMs: 0,
  };
  const fail = (ref: string, err: unknown) => {
    stats.errors++;
    if (stats.errorSamples.length < 5) stats.errorSamples.push(`${ref}: ${(err as Error).message}`);
    console.error(JSON.stringify({ level: "error", msg: "shelf failed", ref, error: String(err) }));
  };

  const [stories, issues] = await Promise.all([
    store.storyShelves(opts.sinceIso),
    store.enrichCandidates(opts.sinceIso),
  ]);
  const todo = stories.filter((s) => !s.shelfSetBy || (opts.force && s.shelfSetBy === "jev"));
  stats.checked = todo.length;

  if (todo.length) {
    const publication = new Map(issues.map((i) => [i.id, i.publication]));
    const port = await jev();
    const shelve = async (s: ShelfCandidate) => {
      const d = await port.decide(
        storyState({
          publication: publication.get(s.issueId) ?? "",
          headline: s.headline,
          summary: s.summary,
        }),
        SHELF_QUESTIONS,
      );
      stats.inputTokens += d.inputTokens;
      const learning = learningProbability(d.answers.craft);
      const shelf = shelfFor(learning);
      const model = d.model || JEV_MODEL;
      // False when Sandip moved it meanwhile: his call stands.
      if (!(await store.putStoryShelf(s.issueId, s.n, { shelf, learning, model }))) return;
      stats.shelved++;
      if (shelf === "learning") stats.learning++;
      if (isUnsure(learning)) stats.unsure++;
    };
    const size = opts.concurrency ?? 4;
    for (let i = 0; i < todo.length; i += size) {
      if (opts.deadline && Date.now() > opts.deadline) {
        stats.deferred = todo.length - i;
        break;
      }
      await Promise.all(
        todo
          .slice(i, i + size)
          .map((s) => shelve(s).catch((err: unknown) => fail(storyRef(s.issueId, s.n), err))),
      );
    }
  }
  stats.durationMs = Date.now() - started;
  return stats;
}
