import { describe, expect, it, vi } from "vitest";
import type { EnrichCandidate } from "../src/enrich.js";
import type { DecisionPort, Question } from "../src/jev.js";
import { shelfFor, shelveStories, type ShelfCandidate } from "../src/shelves.js";
import type { Store } from "../src/store.js";

const since = "2026-10-01T00:00:00.000Z";

const story = (
  issueId: string,
  n: number,
  extra: Partial<ShelfCandidate> = {},
): ShelfCandidate => ({
  issueId,
  n,
  receivedAt: "2026-10-16T08:00:00.000Z",
  headline: `${issueId} ${n}`,
  summary: "What it says.",
  ...extra,
});

/** Jev answers with the probability in each story's headline table; a missing one is a 500. */
function fakeJev(p: Record<string, number>) {
  const states: string[] = [];
  const port: DecisionPort = {
    decide: vi.fn(async (state: string, questions: Record<string, Question>) => {
      states.push(state);
      expect(Object.keys(questions)).toEqual(["craft"]);
      const headline = /Headline: (.+)/.exec(state)![1]!;
      if (!(headline in p)) throw new Error("jev 500: down");
      return {
        model: "jev-1.13.0",
        answers: { craft: { type: "noul" as const, noul: p[headline]! } },
        inputTokens: 600,
        outputTokens: 0,
      };
    }),
  };
  return { port, states };
}

function fakeStore(stories: ShelfCandidate[], moved: string[] = []) {
  const put: { ref: string; shelf: string; learning: number; model: string }[] = [];
  const store = {
    storyShelves: vi.fn(async () => stories),
    enrichCandidates: vi.fn(async () =>
      [...new Set(stories.map((s) => s.issueId))].map(
        (id) => ({ id, publication: `Pub ${id}` }) as EnrichCandidate,
      ),
    ),
    putStoryShelf: vi.fn(
      async (issueId: string, n: number, s: { shelf: string; learning: number; model: string }) => {
        const ref = `${issueId} ${n}`;
        if (moved.includes(ref)) return false;
        put.push({ ref, ...s });
        return true;
      },
    ),
  };
  return { store: store as unknown as Store, put, spies: store };
}

describe("shelfFor", () => {
  it("puts 0.5 and up on Learning", () => {
    expect([0, 0.49, 0.5, 1].map(shelfFor)).toEqual(["news", "news", "learning", "learning"]);
  });
});

describe("shelveStories", () => {
  it("asks Jev about unshelved stories only, with the newsletter's name, and stores its answer", async () => {
    const { store, put } = fakeStore([
      story("a", 1),
      story("a", 2),
      story("b", 1, { shelfSetBy: "jev" }),
      story("b", 2, { shelfSetBy: "sandip" }),
    ]);
    const { port, states } = fakeJev({ "a 1": 0.92, "a 2": 0.45 });
    const stats = await shelveStories(store, async () => port, { sinceIso: since });

    expect(put).toEqual([
      { ref: "a 1", shelf: "learning", learning: 0.92, model: "jev-1.13.0" },
      { ref: "a 2", shelf: "news", learning: 0.45, model: "jev-1.13.0" },
    ]);
    expect(states[0]).toContain("Newsletter: Pub a\nHeadline: a 1\nSummary: What it says.");
    expect(stats).toMatchObject({
      checked: 2,
      shelved: 2,
      learning: 1,
      unsure: 1,
      errors: 0,
      inputTokens: 1200,
    });
  });

  it("with force, asks again about Jev's own calls but never over Sandip's", async () => {
    const { store, put } = fakeStore([
      story("a", 1, { shelfSetBy: "jev" }),
      story("a", 2, { shelfSetBy: "sandip" }),
    ]);
    const { port } = fakeJev({ "a 1": 0.1, "a 2": 0.9 });
    const stats = await shelveStories(store, async () => port, { sinceIso: since, force: true });
    expect(put.map((p) => p.ref)).toEqual(["a 1"]);
    expect(stats).toMatchObject({ checked: 1, shelved: 1 });
  });

  it("keeps going past a failed story, and does not count one Sandip moved meanwhile", async () => {
    const { store, put } = fakeStore([story("a", 1), story("a", 2), story("a", 3)], ["a 3"]);
    const { port } = fakeJev({ "a 1": 0.7, "a 3": 0.2 });
    const stats = await shelveStories(store, async () => port, { sinceIso: since });
    expect(put.map((p) => p.ref)).toEqual(["a 1"]);
    expect(stats).toMatchObject({ checked: 3, shelved: 1, errors: 1 });
    expect(stats.errorSamples).toEqual(["a#02: jev 500: down"]);
  });

  it("does not read the key when there is nothing to shelve", async () => {
    const { store } = fakeStore([story("a", 1, { shelfSetBy: "jev" })]);
    const jev = vi.fn(async () => fakeJev({}).port);
    const stats = await shelveStories(store, jev, { sinceIso: since });
    expect(jev).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ checked: 0, shelved: 0 });
  });

  it("leaves the rest for the next run once the time budget is spent", async () => {
    const { store, put } = fakeStore([story("a", 1), story("a", 2), story("a", 3)]);
    const { port } = fakeJev({ "a 1": 0.7, "a 2": 0.7, "a 3": 0.7 });
    const stats = await shelveStories(store, async () => port, {
      sinceIso: since,
      concurrency: 2,
      deadline: Date.now() - 1,
    });
    expect(put).toEqual([]);
    expect(stats).toMatchObject({ checked: 3, shelved: 0, deferred: 3 });
  });
});
