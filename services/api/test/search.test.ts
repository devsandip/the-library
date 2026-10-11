import { describe, expect, it, vi } from "vitest";
import type { IssueListItem, SenderListItem } from "@library/core/types";
import {
  CORPUS_TTL_MS,
  CorpusCache,
  type CorpusIssue,
  type CorpusSource,
  type CorpusStory,
} from "../src/corpus.js";
import { Search, type Embedder, type SearchSource } from "../src/search.js";

const unit = (...xs: number[]) => {
  const n = Math.hypot(...xs);
  return Float32Array.from(xs.map((x) => x / n));
};

const issues: CorpusIssue[] = [
  {
    id: "digest",
    senderId: "s-tldr",
    publication: "TLDR Data",
    subject: "Postgres, Kafka, agents",
    receivedAt: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "single",
    senderId: "s-sdr",
    publication: "System Design",
    subject: "Kafka vs SQS",
    receivedAt: "2026-10-05T00:00:00.000Z",
  },
  {
    id: "promo",
    senderId: "s-sdr",
    publication: "System Design",
    subject: "Kafka course",
    promo: true,
    receivedAt: "2026-10-06T00:00:00.000Z",
  },
  {
    id: "muted",
    senderId: "s-muted",
    publication: "Noise",
    subject: "Kafka gossip",
    receivedAt: "2026-10-07T00:00:00.000Z",
  },
  {
    id: "near",
    senderId: "s-tldr",
    publication: "TLDR Data",
    subject: "Log pipelines",
    receivedAt: "2026-10-09T00:00:00.000Z",
  },
];
const stories: CorpusStory[] = [
  { id: "digest", n: 1, headline: "Postgres at scale", summary: "", names: [], vector: unit(0, 1) },
  {
    id: "digest",
    n: 2,
    headline: "Diskless Kafka",
    summary: "",
    names: ["Kafka"],
    vector: unit(1, 0.1),
  },
  { id: "single", n: 1, headline: "Kafka vs SQS", summary: "", names: [], vector: unit(1, 0.3) },
  {
    id: "near",
    n: 1,
    headline: "Log processing pipelines",
    summary: "",
    names: [],
    vector: unit(1, 0.5),
  },
];
const row = (i: CorpusIssue, extra: Partial<IssueListItem> = {}) => ({
  id: i.id,
  senderId: i.senderId,
  publication: i.publication,
  subject: i.subject,
  snippet: "",
  receivedAt: i.receivedAt,
  readMinutes: 3,
  state: "archived" as const,
  ...extra,
});
const sender = (senderId: string, flags: Partial<SenderListItem> = {}): SenderListItem => ({
  senderId,
  senderKey: senderId,
  publication: senderId,
  muted: false,
  mustRead: false,
  up: 0,
  down: 0,
  issueCount: 1,
  lastSeenAt: "2026-10-01T00:00:00.000Z",
  ...flags,
});

function setup(opts: { embed?: Embedder["embed"] } = {}) {
  const corpusSource: CorpusSource = { readCorpus: vi.fn(async () => ({ issues, stories })) };
  const source: SearchSource = {
    listSenders: vi.fn(async () => [
      sender("s-tldr", { mustRead: true }),
      sender("s-sdr"),
      sender("s-muted", { muted: true }),
    ]),
    listItems: vi.fn(async (ids: string[]) =>
      issues.filter((i) => ids.includes(i.id)).map((i) => row(i)),
    ),
  };
  // "kafka" means the first axis: close to Diskless Kafka, Kafka vs SQS and the log pipelines.
  const embedder: Embedder = { embed: vi.fn(opts.embed ?? (async () => unit(1, 0))) };
  let now = 1_000_000;
  const search = new Search(source, embedder, new CorpusCache(corpusSource, { now: () => now }));
  return { search, source, corpusSource, embedder, tick: (ms: number) => (now += ms) };
}

describe("Search", () => {
  it("finds by words, then by meaning, leaving out promos and muted newsletters", async () => {
    const { search } = setup();
    const r = await search.search("kafka", "best");
    expect(r.terms).toEqual(["kafka"]);
    expect(r.byMeaning).toBe(true);
    expect(r.items.map((i) => [i.id, i.match])).toEqual([
      ["digest", "both"],
      ["single", "both"],
      ["near", "meaning"],
    ]);
  });

  it("names the matching story inside a digest only, and stars Must Read newsletters", async () => {
    const { search } = setup();
    const [digest, single] = (await search.search("kafka", "best")).items;
    expect(digest).toMatchObject({ story: { n: 2, headline: "Diskless Kafka" }, mustRead: true });
    expect(single!.story).toBeUndefined();
    expect(single!.mustRead).toBeUndefined();
  });

  it("newest first keeps the words group ahead of the meaning group", async () => {
    const { search } = setup();
    const r = await search.search("kafka", "newest");
    expect(r.items.map((i) => i.id)).toEqual(["single", "digest", "near"]);
  });

  it("goes on by words alone when Titan fails", async () => {
    const { search } = setup({
      embed: async () => {
        throw new Error("ThrottlingException");
      },
    });
    const r = await search.search("kafka", "best");
    expect(r.byMeaning).toBe(false);
    expect(r.items.map((i) => [i.id, i.match])).toEqual([
      ["digest", "words"],
      ["single", "words"],
    ]);
  });

  it("reads the corpus once for a few minutes, and embeds a query once", async () => {
    const { search, corpusSource, embedder, tick } = setup();
    await search.search("kafka", "best");
    await search.search("Kafka", "newest");
    expect(corpusSource.readCorpus).toHaveBeenCalledTimes(1);
    expect(embedder.embed).toHaveBeenCalledTimes(1);
    tick(CORPUS_TTL_MS + 1);
    await search.search("kafka", "best");
    expect(corpusSource.readCorpus).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failed corpus read", async () => {
    const { search, corpusSource } = setup();
    vi.mocked(corpusSource.readCorpus).mockRejectedValueOnce(new Error("throttled"));
    await expect(search.search("kafka", "best")).rejects.toThrow("throttled");
    expect((await search.search("kafka", "best")).items).toHaveLength(3);
  });

  it("drops a result that is gone or a promo by the time its row is read", async () => {
    const { search, source } = setup();
    vi.mocked(source.listItems).mockResolvedValueOnce([
      row(issues[0]!, { promo: true }),
      row(issues[1]!),
    ]);
    expect((await search.search("kafka", "best")).items.map((i) => i.id)).toEqual(["single"]);
  });
});
