import { describe, expect, it } from "vitest";
import {
  betaSample,
  cosine,
  freshness,
  normalCdf,
  rank,
  readerDay,
  seededRandom,
  senderScore,
  type RankCandidate,
  type RankInput,
  type RankSender,
} from "../src/rank.js";

const NOW = Date.parse("2026-10-10T06:00:00.000Z");
const DAY = "2026-10-10";
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

/** Unit vectors along one axis, so cosines are 1 (same axis) or 0. */
const axis = (i: number, dims = 4) => Array.from({ length: dims }, (_, j) => (j === i ? 1 : 0));

const neutral: RankSender = { mustRead: false, up: 0, down: 0 };

function input(over: Partial<RankInput>): RankInput {
  return {
    candidates: [],
    senders: new Map(),
    interests: [],
    rated: [],
    now: NOW,
    day: DAY,
    ...over,
  };
}

describe("building blocks", () => {
  it("seeded randomness repeats for a seed and differs across seeds", () => {
    const a = seededRandom("2026-10-10#s1");
    const b = seededRandom("2026-10-10#s1");
    const c = seededRandom("2026-10-11#s1");
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });

  it("beta draws average out to a / (a + b)", () => {
    const rand = seededRandom("beta");
    const mean = (a: number, b: number) =>
      Array.from({ length: 4000 }, () => betaSample(a, b, rand)).reduce((n, x) => n + x, 0) / 4000;
    expect(mean(3, 1)).toBeCloseTo(0.75, 1);
    expect(mean(2, 2)).toBeCloseTo(0.5, 1);
    expect(mean(2, 7)).toBeCloseTo(2 / 9, 1);
  });

  it("a sender's sample holds still within a day", () => {
    expect(senderScore("s1", neutral, DAY)).toBe(senderScore("s1", neutral, DAY));
    expect(senderScore("s1", neutral, DAY)).not.toBe(senderScore("s1", neutral, "2026-10-11"));
  });

  it("freshness halves every 48 hours", () => {
    expect(freshness(hoursAgo(0), NOW)).toBe(1);
    expect(freshness(hoursAgo(48), NOW)).toBeCloseTo(0.5, 6);
    expect(freshness(hoursAgo(96), NOW)).toBeCloseTo(0.25, 6);
  });

  it("cosine and the normal CDF", () => {
    expect(cosine(axis(0), axis(0))).toBe(1);
    expect(cosine(axis(0), axis(1))).toBe(0);
    expect(cosine([0, 0], [1, 0])).toBe(0);
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("the reader's day is in IST", () => {
    // 20:00 UTC on the 9th is 01:30 on the 10th in India.
    expect(readerDay(Date.parse("2026-10-09T20:00:00.000Z"))).toBe("2026-10-10");
  });
});

describe("rank", () => {
  it("Must Read senders come out ahead of neutral ones on average", () => {
    // Same age, no embeddings: only the sender part differs. Count wins across many days.
    let mustAhead = 0;
    for (let d = 1; d <= 200; d++) {
      const day = `2026-01-${String(d).padStart(3, "0")}`;
      const ranked = rank(
        input({
          day,
          candidates: [
            { id: "a", senderId: "must", receivedAt: hoursAgo(5) },
            { id: "b", senderId: "plain", receivedAt: hoursAgo(5) },
          ],
          senders: new Map([
            ["must", { mustRead: true, up: 0, down: 0 }],
            ["plain", neutral],
          ]),
        }),
      );
      if (ranked[0]!.id === "a") mustAhead++;
    }
    expect(mustAhead).toBeGreaterThan(130);
  });

  it("five Irrelevant ratings sink a sender", () => {
    let sunk = 0;
    for (let d = 1; d <= 200; d++) {
      const ranked = rank(
        input({
          day: `d${d}`,
          candidates: [
            { id: "disliked", senderId: "x", receivedAt: hoursAgo(5) },
            { id: "other", senderId: "y", receivedAt: hoursAgo(5) },
          ],
          senders: new Map([
            ["x", { mustRead: false, up: 0, down: 5 }],
            ["y", neutral],
          ]),
        }),
      );
      if (ranked[1]!.id === "disliked") sunk++;
    }
    expect(sunk).toBeGreaterThan(150);
  });

  it("the order is the same twice on one day", () => {
    const opts = input({
      candidates: ["s1", "s2", "s3", "s4"].map((s, i) => ({
        id: `i${i}`,
        senderId: s,
        receivedAt: hoursAgo(i * 7),
      })),
    });
    expect(rank(opts).map((r) => r.id)).toEqual(rank(opts).map((r) => r.id));
  });

  it("issues close to the interests rise, and say which interest", () => {
    // Sender and freshness equal; only the topic part separates them.
    const sameSender = (id: string, v: number[]): RankCandidate => ({
      id,
      senderId: "s",
      receivedAt: hoursAgo(5),
      vector: v,
    });
    const ranked = rank(
      input({
        candidates: [sameSender("off", axis(3)), sameSender("on", axis(0))],
        senders: new Map([["s", neutral]]),
        interests: [{ name: "product management", vector: axis(0) }],
      }),
    );
    expect(ranked.map((r) => r.id)).toEqual(["on", "off"]);
    expect(ranked[0]!.parts.topic).toBeGreaterThan(0.5);
    expect(ranked[0]!.reason).toBe("Close to your interest in product management");
  });

  it("an Irrelevant rating pushes similar issues down", () => {
    const c = (id: string, v: number[]): RankCandidate => ({
      id,
      senderId: "s",
      receivedAt: hoursAgo(5),
      vector: v,
    });
    const ranked = rank(
      input({
        candidates: [c("like-the-dud", axis(1)), c("elsewhere", axis(2))],
        senders: new Map([["s", neutral]]),
        interests: [{ name: "AI", vector: [0, 0.5, 0.5, 0] }],
        rated: [
          { id: "dud", subject: "Crypto", rating: -1, ratedAt: hoursAgo(10), vector: axis(1) },
        ],
      }),
    );
    expect(ranked.map((r) => r.id)).toEqual(["elsewhere", "like-the-dud"]);
  });

  it("explains a Relevant-rated newsletter and a Relevant-rated look-alike", () => {
    const ranked = rank(
      input({
        candidates: [
          { id: "fav", senderId: "liked", receivedAt: hoursAgo(30), vector: axis(2) },
          { id: "twin", senderId: "s", receivedAt: hoursAgo(30), vector: axis(1) },
          { id: "far", senderId: "s", receivedAt: hoursAgo(30), vector: axis(3) },
        ],
        senders: new Map([
          ["liked", { mustRead: false, up: 9, down: 0 }],
          ["s", neutral],
        ]),
        rated: [
          { id: "r", subject: "Rate limiting", rating: 1, ratedAt: hoursAgo(20), vector: axis(1) },
        ],
      }),
    );
    const reason = (id: string) => ranked.find((r) => r.id === id)!.reason;
    expect(reason("fav")).toBe("You rated this newsletter Relevant 9 times");
    expect(reason("twin")).toBe('Like "Rate limiting", which you rated Relevant');
  });

  it("issues without embeddings sit in the middle of the topic scale", () => {
    const ranked = rank(
      input({
        candidates: [
          { id: "bare", senderId: "s", receivedAt: hoursAgo(1) },
          { id: "emb", senderId: "s", receivedAt: hoursAgo(1), vector: axis(0) },
        ],
        interests: [{ name: "AI", vector: axis(0) }],
      }),
    );
    expect(ranked.find((r) => r.id === "bare")!.parts.topic).toBe(0.5);
  });

  it("fresh issues say so when freshness lifts them most", () => {
    const ranked = rank(
      input({
        candidates: [
          { id: "new", senderId: "s", receivedAt: hoursAgo(1) },
          { id: "old", senderId: "s", receivedAt: hoursAgo(200) },
        ],
        senders: new Map([["s", { mustRead: false, up: 1, down: 3 }]]),
      }),
    );
    expect(ranked[0]!.id).toBe("new");
    expect(ranked[0]!.reason).toBe("Just in");
  });
});
