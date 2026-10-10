import { describe, expect, it } from "vitest";
import { relatedIssues, type RelatedCandidate } from "../src/related.js";

const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}T08:00:00.000Z`;
const issue = (id: string, senderId: string, d: number, vector: number[]): RelatedCandidate => ({
  id,
  senderId,
  receivedAt: day(d),
  vector,
});

// Axis 0 is newsletter A's house style; axes 1 to 3 are topics X, Y and Z; 4 and 5 are B's and
// C's own (weaker) styles.
const corpus = [
  issue("a-x", "A", 5, [2, 1, 0, 0, 0, 0]),
  issue("a-y", "A", 3, [2, 0, 1, 0, 0, 0]),
  issue("a-z", "A", 1, [2, 0, 0, 1, 0, 0]),
  issue("b-x", "B", 4, [0, 1, 0, 0, 0.5, 0]),
  issue("b-z", "B", 6, [0, 0, 0, 1, 0.5, 0]),
  issue("c-x", "C", 7, [0, 1, 0, 0, 0, 0.5]),
  issue("c-y", "C", 2, [0, 0, 1, 0, 0, 0.5]),
];

describe("relatedIssues", () => {
  it("matches the topic, not the newsletter's house style", () => {
    const r = relatedIssues("a-x", corpus, { cutoff: -1, perSide: 10 });
    expect(r.earlier[0]!.id).toBe("b-x");
    expect(r.since[0]!.id).toBe("c-x");
    const sim = (id: string) => [...r.earlier, ...r.since].find((m) => m.id === id)!.similarity;
    expect(sim("b-x")).toBeGreaterThan(sim("a-y"));
  });

  it("splits by arrival and keeps a few on each side, most similar first", () => {
    const r = relatedIssues("a-x", corpus, { cutoff: -1, perSide: 2 });
    expect(r.earlier).toHaveLength(2);
    expect(r.since).toHaveLength(2);
    const at = (id: string) => corpus.find((c) => c.id === id)!.receivedAt;
    for (const m of r.earlier) expect(at(m.id) < day(5)).toBe(true);
    for (const m of r.since) expect(at(m.id) > day(5)).toBe(true);
    expect(r.earlier[0]!.similarity).toBeGreaterThanOrEqual(r.earlier[1]!.similarity);
  });

  it("shows nothing when nothing is close", () => {
    const lonely = [
      issue("p", "P", 1, [1, 0, 0, 0]),
      issue("q", "Q", 2, [0, 1, 0, 0]),
      issue("r", "R", 3, [0, 0, 1, 0]),
      issue("s", "S", 4, [0, 0, 0, 1]),
    ];
    expect(relatedIssues("p", lonely)).toEqual({ earlier: [], since: [] });
  });

  it("leaves out ineligible issues and unknown targets", () => {
    const r = relatedIssues("a-x", corpus, {
      cutoff: -1,
      perSide: 10,
      eligible: (c) => c.senderId !== "B",
    });
    expect([...r.earlier, ...r.since].some((m) => m.id.startsWith("b-"))).toBe(false);
    expect(relatedIssues("nope", corpus)).toEqual({ earlier: [], since: [] });
  });
});
