import { describe, expect, it, vi } from "vitest";
import type { Shelf } from "@library/core/types";
import type { EnrichCandidate } from "../src/enrich.js";
import type { DecisionPort, Question } from "../src/jev.js";
import {
  deriveShelves,
  shelveStories,
  startingState,
  type ShelfCandidate,
} from "../src/shelves.js";
import type { Store } from "../src/store.js";

const since = "2026-10-01T00:00:00.000Z";

const story = (
  issueId: string,
  n: number,
  extra: Partial<ShelfCandidate> = {},
): ShelfCandidate => ({
  issueId,
  n,
  senderId: `s-${issueId}`,
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

interface Put {
  ref: string;
  shelf?: string;
  shelfSetBy?: string;
  state?: string;
  learning?: number;
}

function fakeStore(
  stories: ShelfCandidate[],
  opts: {
    moved?: string[];
    /** Stories whose index read was stale: their first write fails, the table has them. */
    stale?: string[];
    /** Stories gone from the table since the index read. */
    gone?: string[];
    senderShelf?: Record<string, Shelf>;
    issues?: Partial<EnrichCandidate>[];
  } = {},
) {
  const put: Put[] = [];
  const derived: string[][] = [];
  const stale = new Set(opts.stale);
  const store = {
    storyShelves: vi.fn(async () => stories),
    enrichCandidates: vi.fn(
      async () =>
        opts.issues ??
        [...new Set(stories.map((s) => s.issueId))].map(
          (id) => ({ id, publication: `Pub ${id}` }) as EnrichCandidate,
        ),
    ),
    senderSettings: vi.fn(
      async () =>
        new Map(
          Object.entries(opts.senderShelf ?? {}).map(([id, shelf]) => [
            id,
            { shelf, mustRead: false, muted: false },
          ]),
        ),
    ),
    putStoryShelf: vi.fn(
      async (
        s: ShelfCandidate,
        next: { shelf?: string; shelfSetBy?: string; state?: string },
        jev?: { learning: number },
      ) => {
        const ref = `${s.issueId} ${s.n}`;
        if (opts.moved?.includes(ref) || opts.gone?.includes(ref)) return false;
        if (stale.delete(ref)) return false;
        put.push({ ref, ...next, ...(jev ? { learning: jev.learning } : {}) });
        return true;
      },
    ),
    storyShelf: vi.fn(async (s: ShelfCandidate) => {
      const ref = `${s.issueId} ${s.n}`;
      if (opts.gone?.includes(ref)) return undefined;
      return opts.moved?.includes(ref) ? { ...s, shelfSetBy: "sandip" as const } : s;
    }),
    deriveIssueShelves: vi.fn(async (ids: Iterable<string>) => {
      derived.push([...ids]);
      return derived.at(-1)!.length;
    }),
  };
  return { store: store as unknown as Store, put, derived, spies: store };
}

describe("shelveStories", () => {
  it("asks Jev about stories it has not read, with the newsletter's name, and stores its answer", async () => {
    const { store, put, derived } = fakeStore([
      story("a", 1),
      story("a", 2),
      story("b", 1, { shelfSetBy: "jev", learning: 0.3 }),
      story("b", 2, { shelf: "news", shelfSetBy: "sandip", learning: 0.8 }),
    ]);
    const { port, states } = fakeJev({ "a 1": 0.92, "a 2": 0.45 });
    const stats = await shelveStories(store, async () => port, { sinceIso: since });

    expect(put).toEqual([
      { ref: "a 1", shelf: "learning", shelfSetBy: "jev", learning: 0.92 },
      { ref: "a 2", shelf: "news", shelfSetBy: "jev", learning: 0.45 },
    ]);
    expect(derived).toEqual([["a"]]);
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

  it("with force, asks again about every story but Sandip's moves", async () => {
    const { store, put } = fakeStore([
      story("a", 1, { shelfSetBy: "jev", learning: 0.9 }),
      story("a", 2, { shelf: "learning", shelfSetBy: "sandip", learning: 0.1 }),
    ]);
    const { port } = fakeJev({ "a 1": 0.1, "a 2": 0.9 });
    const stats = await shelveStories(store, async () => port, { sinceIso: since, force: true });
    expect(put.map((p) => p.ref)).toEqual(["a 1"]);
    expect(stats).toMatchObject({ checked: 1, shelved: 1 });
  });

  it("keeps going past a failed story, and does not count one Sandip moved meanwhile", async () => {
    const { store, put } = fakeStore([story("a", 1), story("a", 2), story("a", 3)], {
      moved: ["a 3"],
    });
    const { port } = fakeJev({ "a 1": 0.7, "a 3": 0.2 });
    const stats = await shelveStories(store, async () => port, { sinceIso: since });
    expect(put.map((p) => p.ref)).toEqual(["a 1"]);
    expect(stats).toMatchObject({ checked: 3, shelved: 1, errors: 1 });
    expect(stats.errorSamples).toEqual(["a#02: jev 500: down"]);
  });

  it("does not read the key when there is nothing to shelve", async () => {
    const { store } = fakeStore([story("a", 1, { shelfSetBy: "jev", learning: 0.2 })]);
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

  it("writes again from the table when the index read was stale; a story gone is left", async () => {
    const { store, put, spies } = fakeStore([story("a", 1), story("a", 2)], {
      stale: ["a 1"],
      gone: ["a 2"],
    });
    const { port } = fakeJev({ "a 1": 0.8, "a 2": 0.8 });
    const stats = await shelveStories(store, async () => port, { sinceIso: since });
    expect(put.map((p) => p.ref)).toEqual(["a 1"]);
    expect(spies.storyShelf).toHaveBeenCalledTimes(2);
    expect(stats).toMatchObject({ checked: 2, shelved: 1, errors: 0 });
  });

  it("puts a story on its newsletter's setting, keeping Jev's answer beside it", async () => {
    const { store, put } = fakeStore([story("a", 1)], { senderShelf: { "s-a": "learning" } });
    const { port } = fakeJev({ "a 1": 0.1 });
    const stats = await shelveStories(store, async () => port, { sinceIso: since });
    expect(put).toEqual([{ ref: "a 1", shelf: "learning", shelfSetBy: "sender", learning: 0.1 }]);
    // The stats count Jev's calls, whatever the setting.
    expect(stats).toMatchObject({ shelved: 1, learning: 0 });
  });
});

describe("startingState", () => {
  it("is read for an issue read or archived by Sandip, unread inside news a rule archived", () => {
    const issue = (e: Partial<EnrichCandidate>) => e as EnrichCandidate;
    expect(startingState(issue({ state: "read" }))).toBe("read");
    expect(startingState(issue({ state: "archived" }))).toBe("read");
    expect(startingState(issue({ state: "archived", autoArchived: true }))).toBeUndefined();
    expect(startingState(issue({ state: "unread" }))).toBeUndefined();
    expect(startingState(undefined)).toBeUndefined();
  });
});

describe("deriveShelves", () => {
  it("writes only what differs, and derives every issue with stories", async () => {
    const { store, put, derived } = fakeStore(
      [
        // Already in line: Jev's Learning, unread, indexed.
        story("a", 1, { shelf: "learning", shelfSetBy: "jev", learning: 0.8, indexed: true }),
        // Learning but not indexed yet.
        story("a", 2, { shelf: "learning", shelfSetBy: "jev", learning: 0.7 }),
        // Its issue was read: the story starts read, out of the index.
        story("b", 1, { shelf: "learning", shelfSetBy: "jev", learning: 0.9, indexed: true }),
        // Its newsletter is always News now.
        story("c", 1, { shelf: "learning", shelfSetBy: "jev", learning: 0.9, indexed: true }),
      ],
      {
        senderShelf: { "s-c": "news" },
        issues: [
          { id: "a", state: "unread" },
          { id: "b", state: "read" },
          { id: "c", state: "unread" },
        ],
      },
    );
    const stats = await deriveShelves(store, { sinceIso: since });
    expect(put).toEqual([
      { ref: "a 2", shelf: "learning", shelfSetBy: "jev" },
      { ref: "b 1", shelf: "learning", shelfSetBy: "jev", state: "read" },
      { ref: "c 1", shelf: "news", shelfSetBy: "sender" },
    ]);
    expect(derived).toEqual([["a", "b", "c"]]);
    expect(stats).toMatchObject({
      stories: 4,
      storiesChanged: 3,
      unreadLearning: 2,
      issues: 3,
      issuesChanged: 3,
      skipped: 0,
    });
  });
});
