import { describe, expect, it, vi } from "vitest";
import type { IssueListItem, SenderListItem } from "@library/core/types";
import { CorpusCache, type CorpusIssue, type CorpusStory } from "../src/corpus.js";
import { Related, type OwnStory, type RelatedSource } from "../src/related.js";

const unit = (...xs: number[]) => {
  const n = Math.hypot(...xs);
  return Float32Array.from(xs.map((x) => x / n));
};
const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}T08:00:00.000Z`;
const issue = (id: string, senderId: string, d: number, promo = false): CorpusIssue => ({
  id,
  senderId,
  publication: `Pub ${senderId}`,
  subject: `Subject of ${id}`,
  summary: `Claude's line for ${id}`,
  receivedAt: day(d),
  promo,
});
const story = (id: string, n: number, headline: string, vector: Float32Array): CorpusStory => ({
  id,
  n,
  headline,
  summary: "",
  names: [],
  vector,
});

// Axes are topics: 0 Kafka, 1 Postgres, 2 rates.
const issues = [
  issue("tldr", "T", 5),
  issue("essay", "E", 3),
  issue("digest", "D", 2),
  issue("later", "L", 8),
  issue("muted", "M", 4),
  issue("promo", "P", 4, true),
];
const stories = [
  story("tldr", 1, "Diskless Kafka", unit(1, 0, 0)),
  story("tldr", 2, "Postgres 19 ships", unit(0, 1, 0)),
  story("tldr", 3, "Rates rise", unit(0, 0, 1)),
  story("essay", 1, "Kafka vs SQS", unit(1, 0.3, 0)),
  story("digest", 1, "Postgres at scale", unit(0.1, 1, 0)),
  story("digest", 2, "Something else", unit(0, 0.2, -1)),
  story("later", 1, "Postgres sharding", unit(0, 1, 0.3)),
  story("muted", 1, "Kafka gossip", unit(1, 0.01, 0)),
  story("promo", 1, "Kafka course", unit(1, 0.02, 0)),
];
const own = (id: string): OwnStory[] =>
  stories
    .filter((s) => s.id === id)
    .map((s) => ({
      issueId: id,
      n: s.n,
      headline: s.headline,
      senderId: issues.find((i) => i.id === id)!.senderId,
      receivedAt: issues.find((i) => i.id === id)!.receivedAt,
      vector: s.vector!,
    }));
const row = (i: CorpusIssue, extra: Partial<IssueListItem> = {}): IssueListItem => ({
  id: i.id,
  senderId: i.senderId,
  publication: i.publication,
  subject: i.subject,
  summary: i.summary,
  snippet: "",
  receivedAt: i.receivedAt,
  readMinutes: 3,
  state: "read",
  ...extra,
});
const sender = (senderId: string, muted = false): SenderListItem => ({
  senderId,
  senderKey: senderId,
  publication: senderId,
  muted,
  mustRead: false,
  up: 0,
  down: 0,
  issueCount: 1,
  lastSeenAt: day(1),
});

function setup() {
  const source: RelatedSource = {
    storyVectors: vi.fn(async (id: string) => own(id)),
    relatedIssues: vi.fn(async () => ({ earlier: [], since: [] })),
    listSenders: vi.fn(async () =>
      ["T", "E", "D", "L", "P"].map((s) => sender(s)).concat(sender("M", true)),
    ),
    listItems: vi.fn(async (ids: string[]) =>
      issues.filter((i) => ids.includes(i.id)).map((i) => row(i)),
    ),
  };
  const corpus = new CorpusCache({ readCorpus: vi.fn(async () => ({ issues, stories })) });
  return { related: new Related(source, corpus), source };
}

describe("Related", () => {
  it("gives each story of a digest its own relatives, by date, naming a digest's story", async () => {
    const { related } = setup();
    const r = await related.related("tldr");
    expect(r.earlier).toEqual([]);
    expect(r.since).toEqual([]);
    expect(r.stories!.map((s) => [s.n, s.headline])).toEqual([
      [1, "Diskless Kafka"],
      [2, "Postgres 19 ships"],
    ]);
    const [kafka, postgres] = r.stories!;
    // The one-story essay is the issue itself: no story named on its row.
    expect(kafka!.earlier.map((i) => [i.id, i.story])).toEqual([["essay", undefined]]);
    expect(kafka!.earlier[0]!.similarity).toBeCloseTo(0.958, 3);
    expect(postgres!.earlier).toMatchObject([
      { id: "digest", story: { n: 1, headline: "Postgres at scale" } },
    ]);
    expect(postgres!.since.map((i) => i.id)).toEqual(["later"]);
  });

  it("leaves out muted newsletters and promos", async () => {
    const { related } = setup();
    const ids = (await related.related("tldr")).stories!.flatMap((s) =>
      [...s.earlier, ...s.since].map((i) => i.id),
    );
    expect(ids).not.toContain("muted");
    expect(ids).not.toContain("promo");
  });

  it("matches a one-story issue as a whole, before and since", async () => {
    const { related } = setup();
    const r = await related.related("essay");
    expect(r.stories).toBeUndefined();
    expect(r.earlier).toEqual([]);
    expect(r.since).toMatchObject([{ id: "tldr", story: { n: 1, headline: "Diskless Kafka" } }]);
  });

  it("falls back to the whole issue when it has no stories yet", async () => {
    const { related, source } = setup();
    const r = await related.related("unsplit");
    expect(source.relatedIssues).toHaveBeenCalledWith("unsplit");
    expect(r).toEqual({ earlier: [], since: [] });
  });

  it("drops a relative that turned out a promo, and a story left with none", async () => {
    const { related, source } = setup();
    vi.mocked(source.listItems).mockImplementationOnce(async (ids) =>
      issues
        .filter((i) => ids.includes(i.id))
        .map((i) => row(i, i.id === "essay" ? { promo: true } : {})),
    );
    const r = await related.related("tldr");
    expect(r.stories!.map((s) => s.n)).toEqual([2]);
  });
});
