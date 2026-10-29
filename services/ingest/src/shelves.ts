/**
 * Story shelves (#81). Jev reads each story (its newsletter, headline and summary) and gives the
 * probability that it builds the reader's craft; 0.5 and up is Learning. A pass of its own after
 * the story index, so a Jev outage never holds up stories and the next run picks up what failed.
 * The story's shelf is its effective one (Sandip's move, then its newsletter's setting, then
 * Jev), and its issue's shelf follows its stories.
 */
import { byReader, shelfFor, storyIndexAttributes, storyRef, storyShelf } from "@library/core";
import type {
  Shelf,
  ShelfDeriveStats,
  ShelfStats,
  StoryShelfSetBy,
  StoryState,
} from "@library/core/types";
import type { EnrichCandidate } from "./enrich.js";
import { mapLimit } from "./ingest.js";
import {
  JEV_MODEL,
  shelfQuestions,
  isUnsure,
  learningProbability,
  storyState,
  type DecisionPort,
} from "./jev.js";
import type { Store } from "./store.js";

export { LEARNING_FROM, shelfFor } from "@library/core";

/** A stored story as shelving reads it. */
export interface ShelfCandidate {
  issueId: string;
  n: number;
  senderId: string;
  receivedAt: string;
  headline: string;
  summary: string;
  shelf?: Shelf;
  shelfSetBy?: StoryShelfSetBy;
  /** Jev's probability of Learning, once Jev has read it. */
  learning?: number;
  state?: StoryState;
  /** In `gsi2` under LEARNING. */
  indexed?: boolean;
}

export interface ShelveOptions {
  sinceIso: string;
  /** Ask Jev again about every story but Sandip's moves (after a change to the question). */
  force?: boolean;
  concurrency?: number;
  /** Epoch ms after which no new story is started; the rest wait for the next run. */
  deadline?: number;
}

/**
 * Shelve the stories received since `sinceIso` that Jev has not read yet. `jev` is only called
 * when there is work, so a run with nothing to shelve never reads the key.
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
  const todo = stories.filter((s) =>
    opts.force ? !byReader(s.shelfSetBy) : s.learning === undefined,
  );
  stats.checked = todo.length;
  const touched = new Set<string>();

  if (todo.length) {
    const publication = new Map(issues.map((i) => [i.id, i.publication]));
    const [port, settings, { about, learning: meaning }] = await Promise.all([
      jev(),
      store.senderSettings(),
      store.settings(),
    ]);
    const questions = shelfQuestions(meaning);
    const shelve = async (s: ShelfCandidate) => {
      const d = await port.decide(
        storyState(
          {
            publication: publication.get(s.issueId) ?? "",
            headline: s.headline,
            summary: s.summary,
          },
          about,
        ),
        questions,
      );
      stats.inputTokens += d.inputTokens;
      const learning = learningProbability(d.answers.craft);
      const jevSaid = { learning, model: d.model || JEV_MODEL };
      const write = (c: ShelfCandidate) =>
        store.putStoryShelf(
          c,
          storyShelf({ ...c, learning }, settings.get(c.senderId)?.shelf),
          jevSaid,
        );
      // The index read can be stale, or Sandip moved or read it meanwhile: read it again from the
      // table once. A story gone since is left alone.
      if (!(await write(s))) {
        const fresh = await store.storyShelf(s);
        if (!fresh || !(await write(fresh))) return;
      }
      touched.add(s.issueId);
      stats.shelved++;
      if (shelfFor(learning) === "learning") stats.learning++;
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
    await store.deriveIssueShelves(touched);
  }
  stats.durationMs = Date.now() - started;
  return stats;
}

/**
 * A story's state when the derive pass meets one without its own: read when its issue was read,
 * or archived by Sandip; otherwise unread, including inside news a rule archived unseen.
 */
export function startingState(issue: EnrichCandidate | undefined): StoryState | undefined {
  if (issue?.state === "read") return "read";
  if (issue?.state === "archived" && !issue.autoArchived) return "read";
  return undefined;
}

/**
 * Bring every stored story since `sinceIso` to its effective shelf, a state and the `gsi2`
 * attributes that follow, then derive every issue's shelf from its stories. Asks Jev nothing.
 * Safe to run again: it writes only what differs.
 */
export async function deriveShelves(
  store: Store,
  opts: { sinceIso: string },
): Promise<ShelfDeriveStats> {
  const started = Date.now();
  const [stories, issues, settings] = await Promise.all([
    store.storyShelves(opts.sinceIso),
    store.enrichCandidates(opts.sinceIso),
    store.senderSettings(),
  ]);
  const byId = new Map(issues.map((i) => [i.id, i]));
  const stats: ShelfDeriveStats = {
    stories: stories.length,
    storiesChanged: 0,
    unreadLearning: 0,
    issues: 0,
    issuesChanged: 0,
    skipped: 0,
    durationMs: 0,
  };
  await mapLimit(stories, 8, async (s) => {
    const next = storyShelf(s, settings.get(s.senderId)?.shelf);
    const state = s.state ?? startingState(byId.get(s.issueId));
    const index = storyIndexAttributes({ ...s, shelf: next.shelf, state });
    if (next.shelf === "learning" && (state ?? "unread") === "unread") stats.unreadLearning++;
    const same =
      next.shelf === s.shelf &&
      next.shelfSetBy === s.shelfSetBy &&
      state === s.state &&
      (index.set.gsi2pk !== undefined) === Boolean(s.indexed);
    if (same) return;
    if (await store.putStoryShelf(s, { ...next, state })) {
      stats.storiesChanged++;
      return;
    }
    // A stale index read, or Sandip changed it meanwhile: once more from the table itself.
    const fresh = await store.storyShelf(s);
    if (!fresh) return;
    const again = storyShelf(fresh, settings.get(fresh.senderId)?.shelf);
    if (await store.putStoryShelf(fresh, { ...again, state: fresh.state ?? state })) {
      stats.storiesChanged++;
    } else stats.skipped++;
  });
  const storied = new Set(stories.map((s) => s.issueId));
  stats.issues = storied.size;
  stats.issuesChanged = await store.deriveIssueShelves(storied);
  stats.durationMs = Date.now() - started;
  return stats;
}
