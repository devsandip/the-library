import { describe, expect, it } from "vitest";
import {
  propose,
  tuneup,
  tuneupId,
  type TuneupData,
  type TuneupIssue,
  type TuneupStory,
} from "../src/tuneup.js";
import type { SenderListItem, Shelf } from "../src/types.js";

const sender = (senderId: string, publication: string, o: Partial<SenderListItem> = {}) => ({
  senderId,
  senderKey: `${publication.toLowerCase()}@example.test`,
  publication,
  muted: false,
  mustRead: false,
  up: 0,
  down: 0,
  issueCount: 0,
  lastSeenAt: "2026-10-28T00:00:00.000Z",
  ...o,
});

let k = 0;
/** A story Jev read at `learning`; `moved` puts it on a shelf as Sandip. */
const story = (senderId: string, learning: number | undefined, moved?: Shelf): TuneupStory => {
  k++;
  const day = String((k % 28) + 1).padStart(2, "0");
  return {
    id: `${senderId}-i${k}`,
    n: 1,
    senderId,
    receivedAt: `2026-10-${day}T08:00:00.000Z`,
    headline: `Story ${k}`,
    ...(learning !== undefined ? { learning } : {}),
    ...(moved
      ? { shelf: moved, shelfSetBy: "sandip" as const }
      : learning !== undefined
        ? {
            shelf: learning >= 0.5 ? ("learning" as const) : ("news" as const),
            shelfSetBy: "jev" as const,
          }
        : {}),
  };
};
const many = (n: number, make: () => TuneupStory) => Array.from({ length: n }, make);

const data = (o: Partial<TuneupData> = {}): TuneupData => ({
  senders: [],
  issues: [],
  stories: [],
  dismissed: {},
  ...o,
});

const A = sender("sA", "Alpha");

describe("a proposed rule", () => {
  it("is always Learning when Sandip moved 3 stories there against Jev and most are there", () => {
    const stories = [
      ...many(3, () => story("sA", 0.2, "learning")),
      ...many(8, () => story("sA", 0.8)),
      story("sA", 0.3),
    ];
    expect(propose(A, stories, "learning")).toMatchObject({
      id: "sA.learning",
      senderId: "sA",
      publication: "Alpha",
      shelf: "learning",
      fixes: 3,
      moves: 1,
      stories: 12,
      onShelf: 11,
    });
    expect(propose(A, stories, "news")).toBeUndefined();
  });

  it("needs 3 moves against Jev: moves Jev agreed with do not count", () => {
    const stories = [
      ...many(2, () => story("sA", 0.2, "learning")),
      ...many(3, () => story("sA", 0.9, "learning")),
      ...many(8, () => story("sA", 0.8)),
    ];
    expect(propose(A, stories, "learning")).toBeUndefined();
    expect(propose(A, [...stories, story("sA", 0.45, "learning")], "learning")?.fixes).toBe(3);
  });

  it("is not proposed when Sandip put any of its stories on the other shelf", () => {
    const stories = [
      ...many(4, () => story("sA", 0.2, "learning")),
      ...many(20, () => story("sA", 0.8)),
      story("sA", 0.1, "news"),
    ];
    expect(propose(A, stories, "learning")).toBeUndefined();
  });

  it("is not proposed for a mixed newsletter: it would overrule Jev too often", () => {
    const fixes = many(3, () => story("sA", 0.2, "learning"));
    const mixed = [
      ...fixes,
      ...many(5, () => story("sA", 0.8)),
      ...many(4, () => story("sA", 0.1)),
    ];
    // 8 of 12 on Learning, under three quarters.
    expect(propose(A, mixed, "learning")).toBeUndefined();
    // 9 of 12 is three quarters.
    const most = [...fixes, ...many(6, () => story("sA", 0.8)), ...many(3, () => story("sA", 0.1))];
    expect(propose(A, most, "learning")).toMatchObject({ fixes: 3, moves: 3, onShelf: 9 });
  });

  it("is always News the same way", () => {
    const stories = [
      ...many(3, () => story("sA", 0.7, "news")),
      ...many(10, () => story("sA", 0.1)),
    ];
    expect(propose(A, stories, "news")).toMatchObject({ shelf: "news", fixes: 3, moves: 0 });
  });

  it("is not proposed for a newsletter with a setting already, or a muted one", () => {
    const stories = [
      ...many(3, () => story("sA", 0.2, "learning")),
      ...many(9, () => story("sA", 0.8)),
    ];
    expect(propose(sender("sA", "Alpha", { shelf: "news" }), stories, "learning")).toBeUndefined();
    expect(propose(sender("sA", "Alpha", { muted: true }), stories, "learning")).toBeUndefined();
  });

  it("leaves out stories Jev has not read and Sandip has not moved", () => {
    const stories = [
      ...many(3, () => story("sA", 0.2, "learning")),
      ...many(9, () => story("sA", 0.8)),
      ...many(30, () => story("sA", undefined)),
    ];
    expect(propose(A, stories, "learning")).toMatchObject({ stories: 12, onShelf: 12 });
  });

  it("shows the latest few of what it fixes and what it would move", () => {
    const fixed = [
      { ...story("sA", 0.2, "learning"), receivedAt: "2026-10-01T08:00:00.000Z", headline: "Old" },
      { ...story("sA", 0.2, "learning"), receivedAt: "2026-10-20T08:00:00.000Z", headline: "New" },
      { ...story("sA", 0.2, "learning"), receivedAt: "2026-10-10T08:00:00.000Z", headline: "Mid" },
      {
        ...story("sA", 0.2, "learning"),
        receivedAt: "2026-10-05T08:00:00.000Z",
        headline: "Older",
      },
    ];
    const p = propose(
      A,
      [...fixed, ...many(12, () => story("sA", 0.8)), story("sA", 0.1)],
      "learning",
    );
    expect(p?.fixed.map((h) => h.headline)).toEqual(["New", "Mid", "Older"]);
    expect(p?.wouldMove).toHaveLength(1);
    expect(p?.fixed[0]).toEqual({ issueId: fixed[1]!.id, n: 1, headline: "New" });
  });
});

describe("the tune-up", () => {
  const B = sender("sB", "Beta");
  const C = sender("sC", "Gamma", { shelf: "learning" });

  it("counts each newsletter's moves against Jev, the unsure ones and the promos pulled back", () => {
    const issues: TuneupIssue[] = [
      { id: "p1", senderId: "sB", autoArchived: "promo", archived: false },
      { id: "p2", senderId: "sB", autoArchived: "promo", archived: true },
      { id: "p3", senderId: "sB", autoArchived: "old-news", archived: false },
    ];
    const r = tuneup(
      data({
        senders: [A, B, C],
        issues,
        stories: [
          story("sA", 0.2, "learning"),
          story("sA", 0.45, "learning"),
          story("sA", 0.55, "news"),
          story("sA", 0.9, "learning"),
          story("sA", 0.1),
          story("sB", 0.1),
          // Gamma's setting puts this on Learning, but Sandip's move still counts against Jev. Gamma and
          // Beta have one correction each; Gamma's is a move, so it comes first.
          story("sC", 0.1),
          story("sC", 0.7, "news"),
        ],
      }),
    );
    expect(r.newsletters).toEqual([
      {
        senderId: "sA",
        publication: "Alpha",
        stories: 5,
        learning: 3,
        moved: 4,
        toLearning: 2,
        toNews: 1,
        unsure: 2,
        promos: 0,
        pulledBack: 0,
      },
      expect.objectContaining({ senderId: "sC", shelf: "learning", learning: 1, toNews: 1 }),
      {
        senderId: "sB",
        publication: "Beta",
        stories: 1,
        learning: 0,
        moved: 0,
        toLearning: 0,
        toNews: 0,
        unsure: 0,
        promos: 2,
        pulledBack: 1,
      },
    ]);
    expect(r.totals).toEqual({
      stories: 8,
      moved: 5,
      toLearning: 2,
      toNews: 2,
      unsure: 2,
      promos: 2,
      pulledBack: 1,
    });
    expect(r.proposals).toEqual([]);
  });

  it("files a story under its issue's newsletter, which wins over the one written at the split", () => {
    const s = { ...story("sOld", 0.2, "learning"), id: "x1" };
    const r = tuneup(
      data({
        senders: [A],
        issues: [{ id: "x1", senderId: "sA", archived: false }],
        stories: [s],
      }),
    );
    expect(r.newsletters).toMatchObject([{ senderId: "sA", toLearning: 1 }]);
  });

  it("lists proposals with the most fixes first, then the fewest moves", () => {
    const stories = [
      ...many(3, () => story("sA", 0.2, "learning")),
      ...many(9, () => story("sA", 0.8)),
      ...many(4, () => story("sB", 0.7, "news")),
      ...many(9, () => story("sB", 0.1)),
      story("sB", 0.9),
    ];
    const r = tuneup(data({ senders: [A, B], stories }));
    expect(r.proposals.map((p) => p.id)).toEqual(["sB.news", "sA.learning"]);
    expect(r.dismissed).toBe(0);
  });

  it("hides a proposal put off with Not now until Sandip's moves toward it grow", () => {
    const stories = [
      ...many(3, () => story("sA", 0.2, "learning")),
      ...many(9, () => story("sA", 0.8)),
    ];
    const put = data({ senders: [A], stories, dismissed: { [tuneupId("sA", "learning")]: 3 } });
    expect(tuneup(put)).toMatchObject({ proposals: [], dismissed: 1 });
    put.stories.push(story("sA", 0.3, "learning"));
    expect(tuneup(put)).toMatchObject({
      proposals: [{ id: "sA.learning", fixes: 4 }],
      dismissed: 0,
    });
  });

  it("has nothing to say before any correction", () => {
    const r = tuneup(data({ senders: [A], stories: [story("sA", 0.8)] }));
    expect(r).toEqual({
      proposals: [],
      dismissed: 0,
      newsletters: [],
      totals: {
        stories: 1,
        moved: 0,
        toLearning: 0,
        toNews: 0,
        unsure: 0,
        promos: 0,
        pulledBack: 0,
      },
    });
  });
});
