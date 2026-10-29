import { DEFAULT_SETTINGS } from "@library/core/settings";
import { describe, expect, it, vi } from "vitest";
import type { StoredFollow } from "@library/core";
import type { ModelPort, ToolRequest } from "../src/bedrock.js";
import {
  anchorRefs,
  checkFollows,
  FOLLOW_CANDIDATES,
  followCandidates,
  movesRequest,
  parseMoves,
  type MoveItem,
  type RecentStory,
} from "../src/follow.js";

const NOW = Date.parse("2026-10-27T10:00:00.000Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A unit vector along one axis, or between two. */
const axis = (i: number, j?: number, w = 0.6) =>
  Array.from({ length: 8 }, (_, k) =>
    j === undefined ? (k === i ? 1 : 0) : k === i ? w : k === j ? Math.sqrt(1 - w * w) : 0,
  );

function story(over: Partial<RecentStory> & { issueId: string }): RecentStory {
  const n = over.n ?? 1;
  return {
    key: `${over.issueId}#${String(n).padStart(2, "0")}`,
    n,
    senderId: "s000000000002",
    receivedAt: iso(NOW - DAY),
    eventId: `${over.issueId}#${String(n).padStart(2, "0")}`,
    headline: "Headline",
    summary: "Summary.",
    names: [],
    vector: axis(0),
    ...over,
  };
}

function follow(over: Partial<StoredFollow> = {}): StoredFollow {
  return {
    eventId: "wsj#01",
    issueId: "wsj",
    n: 1,
    headline: "Starlink caps drones",
    publication: "WSJ",
    followedAt: iso(NOW - 5 * DAY),
    seenAt: iso(NOW - 5 * DAY),
    points: [
      {
        at: iso(NOW - 6 * DAY),
        text: "Drones lose Starlink above 100 mph.",
        sources: [{ issueId: "wsj", publication: "WSJ" }],
        current: true,
      },
    ],
    checked: [],
    ...over,
  };
}

describe("followCandidates", () => {
  const anchors = [axis(0)];

  it("takes the follow's event and stories that read alike, oldest first", () => {
    const sameEvent = story({ issueId: "a", eventId: "wsj#01", vector: axis(3) });
    const close = story({ issueId: "b", vector: axis(0, 1, 0.6), receivedAt: iso(NOW - 2 * DAY) });
    const far = story({ issueId: "c", vector: axis(0, 1, 0.3) });
    expect(followCandidates(follow(), anchors, [sameEvent, close, far], new Set())).toEqual([
      close,
      sameEvent,
    ]);
  });

  it("leaves out its own stories, those checked before and muted newsletters", () => {
    const own = story({ issueId: "wsj" });
    const checked = story({ issueId: "b" });
    const muted = story({ issueId: "c", senderId: "s00000000000m" });
    const fresh = story({ issueId: "d" });
    expect(
      followCandidates(
        follow({ checked: ["b#01"] }),
        anchors,
        [own, checked, muted, fresh],
        new Set(["s00000000000m"]),
      ),
    ).toEqual([fresh]);
  });

  it("keeps the closest few", () => {
    const many = Array.from({ length: 12 }, (_, k) =>
      story({ issueId: `x${k}`, vector: axis(0, 1, 0.5 + k * 0.04) }),
    );
    const picked = followCandidates(follow(), anchors, many, new Set());
    expect(picked).toHaveLength(FOLLOW_CANDIDATES);
    expect(picked.map((s) => s.issueId)).not.toContain("x0");
  });
});

describe("anchorRefs", () => {
  it("is the story followed and the newest of its points' stories", () => {
    const points = Array.from({ length: 9 }, (_, k) => ({
      at: iso(NOW - (9 - k) * DAY),
      text: "x",
      sources: [{ issueId: `p${k}`, publication: "P" }],
    }));
    expect(anchorRefs(follow({ points }))).toEqual([
      "wsj#01",
      "p3#01",
      "p4#01",
      "p5#01",
      "p6#01",
      "p7#01",
      "p8#01",
    ]);
  });
});

function items(): MoveItem[] {
  return [
    {
      id: "F1",
      follow: follow(),
      stories: [
        {
          id: "S1",
          story: story({
            issueId: "ft",
            n: 3,
            headline: "Trump asks Musk to lift the cap",
            receivedAt: iso(NOW - DAY),
          }),
          publication: "FT",
          digest: true,
        },
        {
          id: "S2",
          story: story({
            issueId: "wapo",
            headline: "Musk lifts the cap",
            receivedAt: iso(NOW - 2 * DAY),
          }),
          publication: "WaPo",
          digest: false,
        },
        {
          id: "S3",
          story: story({ issueId: "recap", headline: "Drones lose Starlink" }),
          publication: "Recap",
          digest: false,
        },
      ],
    },
    {
      id: "F2",
      follow: follow({ eventId: "other", headline: "Another" }),
      stories: [{ id: "S4", story: story({ issueId: "z" }), publication: "Z", digest: false }],
    },
  ];
}

describe("movesRequest", () => {
  it("sends each follow's steps and its new stories, and asks for a kind on every story", () => {
    const req = movesRequest(items());
    expect(req.tool.name).toBe("record_moves");
    expect(req.user).toContain("F1: Starlink caps drones");
    expect(req.user).toContain("| Drones lose Starlink above 100 mph.");
    expect(req.user).toContain("S1 | ");
    expect(req.user).toContain("FT | Trump asks Musk to lift the cap. Summary.");
    expect(req.system).toContain("named narrowly");
    expect(JSON.stringify(req.tool.schema)).toContain('"enum":["move","repeat","other"]');
  });
});

describe("parseMoves", () => {
  it("keeps a move's stories that are its follow's and called moves, dated by the earliest", () => {
    const added = iso(NOW);
    const moves = parseMoves(
      {
        matters: [{ follow: "F1", matter: "Musk's Starlink cap on Ukraine's drones" }],
        stories: [
          { id: "S1", kind: "move" },
          { id: "S2", kind: "move" },
          { id: "S3", kind: "repeat" },
          { id: "S4", kind: "move" },
        ],
        moves: [
          // S3 is a repeat and S4 is another follow's: neither counts.
          {
            follow: "F1",
            text: "Trump asked Musk to lift the cap — and he did.",
            stories: ["S1", "S2", "S3", "S4"],
          },
          { follow: "F1", text: "Only a repeat.", stories: ["S3"] },
          { follow: "F9", text: "Unknown.", stories: ["S1"] },
          { follow: "F2", text: "", stories: ["S4"] },
        ],
      },
      items(),
      added,
    );
    expect([...moves.keys()]).toEqual(["F1"]);
    expect(moves.get("F1")).toEqual([
      {
        at: iso(NOW - 2 * DAY),
        text: "Trump asked Musk to lift the cap, and he did.",
        sources: [
          { issueId: "wapo", publication: "WaPo" },
          {
            issueId: "ft",
            publication: "FT",
            story: { n: 3, headline: "Trump asks Musk to lift the cap" },
          },
        ],
        added,
      },
    ]);
  });

  it("is nothing for an answer without moves", () => {
    expect(parseMoves({}, items(), iso(NOW)).size).toBe(0);
    expect(parseMoves({ stories: [], moves: "no" }, items(), iso(NOW)).size).toBe(0);
  });
});

describe("checkFollows", () => {
  function setup(follows: StoredFollow[], recent: RecentStory[], answer: unknown) {
    const store = {
      settings: vi.fn(async () => DEFAULT_SETTINGS),
      follows: vi.fn(async () => follows),
      recentStories: vi.fn(async () => recent),
      senderSettings: vi.fn(
        async () => new Map([["s00000000000m", { mustRead: false, muted: true }]]),
      ),
      storyVectors: vi.fn(
        async (refs: string[]) => new Map(refs.map((r) => [r, new Float32Array(axis(0))])),
      ),
      issueBriefs: vi.fn(
        async (ids: string[]) =>
          new Map(ids.map((id) => [id, { publication: id.toUpperCase(), storyCount: 1 }])),
      ),
      addMoves: vi.fn(async () => undefined),
    };
    const calls: ToolRequest[] = [];
    const model: ModelPort = {
      callTool: vi.fn(async (req: ToolRequest) => {
        calls.push(req);
        return { input: answer, inputTokens: 2000, outputTokens: 300 };
      }),
      embed: vi.fn(),
    };
    return { store, model, calls };
  }

  it("adds each follow's moves, remembers every candidate, and skips quiet follows", async () => {
    const quiet = follow({ eventId: "quiet", followedAt: iso(NOW - 40 * DAY) });
    const moving = follow({ checked: ["old#01"] });
    const recent = [
      story({ issueId: "ft", receivedAt: iso(NOW - DAY) }),
      story({ issueId: "recap", receivedAt: iso(NOW - 2 * DAY) }),
    ];
    const { store, model, calls } = setup([quiet, moving], recent, {
      matters: [{ follow: "F1", matter: "The cap" }],
      stories: [
        { id: "S1", kind: "repeat" },
        { id: "S2", kind: "move" },
      ],
      moves: [{ follow: "F1", text: "Musk lifted the cap.", stories: ["S2"] }],
    });
    const stats = await checkFollows(store, model, { now: NOW });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.user).not.toContain("quiet");
    expect(store.recentStories).toHaveBeenCalledWith(iso(NOW - 3 * DAY));
    expect(stats).toMatchObject({ follows: 1, candidates: 2, moves: 1, inputTokens: 2000 });
    expect(store.addMoves).toHaveBeenCalledTimes(1);
    expect(store.addMoves).toHaveBeenCalledWith(
      "wsj#01",
      [
        {
          at: iso(NOW - DAY),
          text: "Musk lifted the cap.",
          sources: [{ issueId: "ft", publication: "FT" }],
          added: iso(NOW),
        },
      ],
      ["old#01", "recap#01", "ft#01"],
      iso(NOW - DAY),
    );
  });

  it("makes no call when nothing new reads like a followed story", async () => {
    const { store, model } = setup([follow()], [story({ issueId: "far", vector: axis(5) })], {});
    expect(await checkFollows(store, model, { now: NOW })).toMatchObject({
      follows: 1,
      candidates: 0,
      moves: 0,
    });
    expect(model.callTool).not.toHaveBeenCalled();
    expect(store.addMoves).not.toHaveBeenCalled();
  });

  it("remembers repeats too, so they are not asked about again", async () => {
    const { store, model } = setup([follow()], [story({ issueId: "ft" })], {
      stories: [{ id: "S1", kind: "repeat" }],
      moves: [],
    });
    await checkFollows(store, model, { now: NOW });
    expect(store.addMoves).toHaveBeenCalledWith("wsj#01", [], ["ft#01"], undefined);
  });
});
