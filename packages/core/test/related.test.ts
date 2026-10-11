import { describe, expect, it } from "vitest";
import { relatedIssues, relatedStories, type RelatedCandidate } from "../src/related.js";

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

describe("relatedStories", () => {
  const unit = (...xs: number[]) => {
    const n = Math.hypot(...xs);
    return xs.map((x) => x / n);
  };
  const story = (issueId: string, n: number, senderId: string, d: number, vector: number[]) => ({
    issueId,
    n,
    senderId,
    receivedAt: day(d),
    vector,
  });
  // Axes are topics: 0 Kafka, 1 Postgres, 2 agents, 3 rates.
  const digest = [
    story("tldr", 1, "T", 5, unit(1, 0, 0, 0)),
    story("tldr", 2, "T", 5, unit(0, 1, 0, 0)),
    story("tldr", 3, "T", 5, unit(0, 0, 0, 1)),
  ];
  const corpus = [
    ...digest,
    story("sdr", 1, "S", 3, unit(1, 0.4, 0, 0)),
    story("pg-a", 1, "P", 2, unit(0.2, 1, 0, 0)),
    story("pg-a", 2, "P", 2, unit(0.1, 1, 0, 0)),
    story("pg-b", 1, "Q", 7, unit(0, 1, 0.5, 0)),
    story("agents", 1, "A", 4, unit(0, 0, 1, 0)),
    // Yesterday's TLDR ran the Kafka story again, word for word.
    story("tldr-rerun", 4, "T", 4, unit(1, 0.05, 0, 0)),
  ];

  it("gives a digest's stories their own relatives, split by date, one per issue", () => {
    const r = relatedStories(digest, corpus);
    expect(r.earlier).toEqual([]);
    expect(r.since).toEqual([]);
    expect(r.stories.map((s) => s.n)).toEqual([1, 2]);
    const [kafka, postgres] = r.stories;
    expect(kafka!.earlier.map((m) => m.issueId)).toEqual(["sdr"]);
    expect(kafka!.since).toEqual([]);
    // pg-a's closer story counts once, as its own match.
    expect(postgres!.earlier.map((m) => [m.issueId, m.n])).toEqual([["pg-a", 2]]);
    expect(postgres!.since.map((m) => m.issueId)).toEqual(["pg-b"]);
  });

  it("leaves out the same newsletter's reruns but not another's near copy", () => {
    const r = relatedStories(digest, corpus);
    expect(r.stories[0]!.earlier.some((m) => m.issueId === "tldr-rerun")).toBe(false);
    const elsewhere = corpus.map((c) => (c.issueId === "tldr-rerun" ? { ...c, senderId: "W" } : c));
    expect(relatedStories(digest, elsewhere).stories[0]!.earlier[0]!.issueId).toBe("tldr-rerun");
  });

  it("keeps a few per digest story, closest first", () => {
    const r = relatedStories(digest, corpus, { cutoff: -1, perStory: 2 });
    for (const s of r.stories) {
      const all = [...s.earlier, ...s.since];
      expect(all.length).toBeLessThanOrEqual(2);
    }
    const sims = r.stories[0]!.earlier.map((m) => m.similarity);
    expect(sims).toEqual([...sims].sort((a, b) => b - a));
  });

  it("treats a one-story issue as the issue itself, a few each side", () => {
    const r = relatedStories([corpus.find((c) => c.issueId === "pg-b")!], corpus, {
      perSide: 1,
    });
    expect(r.stories).toEqual([]);
    expect(r.earlier.map((m) => [m.issueId, m.n])).toEqual([["tldr", 2]]);
    expect(r.since).toEqual([]);
  });

  it("leaves out ineligible issues, and has nothing for an issue without stories", () => {
    const r = relatedStories(digest, corpus, { eligible: (c) => c.issueId !== "sdr" });
    expect(r.stories.map((s) => s.n)).toEqual([2]);
    expect(relatedStories([], corpus)).toEqual({ earlier: [], since: [], stories: [] });
  });
});
