import { describe, expect, it, vi } from "vitest";
import { INTERESTS } from "@library/core";
import type { Shelf, Topic } from "@library/core/types";
import type { ModelPort } from "../src/bedrock.js";
import {
  archiveOldNews,
  classifyRequest,
  compactText,
  enrich,
  ensureInterests,
  parseClassification,
  parseTopics,
  proposeTopics,
  type EnrichCandidate,
} from "../src/enrich.js";
import type { Store } from "../src/store.js";

const topics: Topic[] = [
  { name: "AI", description: "Models, tools and the AI industry" },
  { name: "Product", description: "Product management craft" },
  { name: "Engineering", description: "Systems, architecture and engineering practice" },
  { name: "Business", description: "Companies, markets and deals" },
];

const candidate = (id: string, extra: Partial<EnrichCandidate> = {}): EnrichCandidate => ({
  id,
  senderId: "s000000000001",
  publication: "ByteByteGo",
  subject: `Subject ${id}`,
  receivedAt: "2026-10-08T06:00:00.000Z",
  enriched: false,
  embedded: false,
  ...extra,
});

function fakes(opts: {
  candidates: EnrichCandidate[];
  topics?: Topic[];
  senderShelves?: Map<string, Shelf>;
  mustRead?: string[];
  failOn?: string;
  promo?: boolean;
  /** Claude answers "account" (#50); `keep` lists issues Sandip rated or saved. */
  account?: { keep?: string[] };
  staleNews?: { id: string; senderId: string }[];
}) {
  const classified: { id: string; shelf: Shelf; senderShelf?: Shelf }[] = [];
  const embedded: string[] = [];
  const archived: { id: string; reason: string }[] = [];
  const filtered: { id: string; reason: string; by: string }[] = [];
  let stored: Topic[] | undefined = opts.topics;
  let interests: { name: string; text: string; vector: number[] }[] | undefined;
  const store = {
    enrichCandidates: async () => opts.candidates,
    getTopics: async () => stored,
    putTopics: async (t: Topic[]) => void (stored = t),
    getInterests: async () => interests?.map(({ name, text }) => ({ name, text })),
    putInterests: async (list: typeof interests) => void (interests = list),
    senderSettings: async () => {
      const ids = new Set([...(opts.senderShelves?.keys() ?? []), ...(opts.mustRead ?? [])]);
      return new Map(
        [...ids].map((id) => [
          id,
          { shelf: opts.senderShelves?.get(id), mustRead: (opts.mustRead ?? []).includes(id) },
        ]),
      );
    },
    autoArchive: async (id: string, reason: string) => {
      archived.push({ id, reason });
      return true;
    },
    fileAsFiltered: async (id: string, reason: string, by: string) => {
      if (opts.account?.keep?.includes(id)) return false;
      filtered.push({ id, reason, by });
      return true;
    },
    unreadNewsBefore: async () => opts.staleNews ?? [],
    getText: async (id: string) => `Body of ${id}`,
    putClassification: async (id: string, c: { shelf: Shelf }, senderShelf?: Shelf) =>
      void classified.push({ id, shelf: c.shelf, senderShelf }),
    putEmbedding: async (id: string) => void embedded.push(id),
  } as unknown as Store;
  const model: ModelPort = {
    callTool: vi.fn(async (req) => {
      if (opts.failOn && req.user.includes(`Subject ${opts.failOn}`)) {
        throw new Error("ThrottlingException");
      }
      return {
        input: {
          summary: "  A sentence  about it. ",
          shelf: "learning",
          topic: "engineering",
          selling: opts.account ? "account" : opts.promo ? "promo" : "ad-supported",
        },
        inputTokens: 1000,
        outputTokens: 40,
      };
    }),
    embed: vi.fn(async () => ({ vector: new Array(512).fill(0.01), tokens: 900 })),
  };
  return {
    store,
    model,
    classified,
    embedded,
    archived,
    filtered,
    stored: () => stored,
    interests: () => interests,
  };
}

describe("classification request and parsing", () => {
  it("asks for one forced tool call with the topic list and the three-month test", () => {
    const req = classifyRequest(
      { publication: "TLDR AI", subject: "Agents ship", text: "x".repeat(10_000) },
      topics,
    );
    expect(req.tool.name).toBe("classify_issue");
    expect(req.system).toContain("- AI: Models, tools and the AI industry");
    expect(req.system).toContain("worth reading in three months");
    expect(req.user).toMatch(/^Newsletter: TLDR AI\nSubject: Agents ship\n\n/);
    expect(req.user.length).toBeLessThan(6100); // text is cut to about 1,500 tokens
    expect(req.tool.schema).toMatchObject({
      properties: {
        shelf: { enum: ["news", "learning"] },
        topic: { enum: ["AI", "Product", "Engineering", "Business"] },
      },
    });
  });

  it("normalizes a good answer and matches topics case-insensitively", () => {
    expect(
      parseClassification(
        { summary: " Two\n lines ", shelf: "news", topic: "ai", selling: "promo" },
        topics,
      ),
    ).toEqual({ summary: "Two lines", shelf: "news", topic: "AI", selling: "promo", promo: true });
  });

  it("reads an account answer as no promo (#50)", () => {
    const c = parseClassification(
      { summary: "A sign-in code.", shelf: "news", topic: "AI", selling: "account" },
      topics,
    );
    expect(c).toMatchObject({ selling: "account", promo: false });
  });

  it("describes account mail and asks for it only when plain", () => {
    const req = classifyRequest({ publication: "ByteByteGo", subject: "Code", text: "" }, topics);
    expect(req.system).toContain('"account": not an issue at all');
    expect(req.system).toContain('Answer "account" only when the mail plainly is one.');
    expect(req.tool.schema).toMatchObject({
      properties: { selling: { enum: ["none", "ad-supported", "promo", "account"] } },
    });
  });

  it("rejects answers outside the schema", () => {
    const ok = { summary: "S", shelf: "news", topic: "AI", selling: "ad-supported" };
    expect(() => parseClassification({ ...ok, shelf: "opinion" }, topics)).toThrow("bad shelf");
    expect(() => parseClassification({ ...ok, topic: "Sports" }, topics)).toThrow("unknown topic");
    expect(() => parseClassification({ ...ok, selling: "yes" }, topics)).toThrow("bad selling");
    expect(() => parseClassification({ ...ok, summary: " " }, topics)).toThrow("summary");
  });

  it("accepts a usable topic list and rejects duplicates or too few", () => {
    expect(parseTopics({ topics })).toEqual(topics);
    expect(() => parseTopics({ topics: topics.slice(0, 2) })).toThrow("unusable");
    expect(() =>
      parseTopics({ topics: [...topics, { name: "ai", description: "again" }] }),
    ).toThrow("unusable");
    expect(() => parseTopics({})).toThrow("no topic list");
    expect(() =>
      parseTopics({
        topics: [...topics.slice(0, 3), { name: "Data, analytics", description: "x" }],
      }),
    ).toThrow("commas");
  });
});

describe("compactText", () => {
  it("drops invisible preview padding and collapses whitespace", () => {
    expect(compactText("Week 27\u00a0\u2007\u034f\u200c \n\n Lesson\u00ad text")).toBe(
      "Week 27 Lesson text",
    );
  });
});

describe("enrich", () => {
  const since = "2026-09-01T00:00:00.000Z";

  it("without a topic list, embeds but leaves sorting for later", async () => {
    const f = fakes({ candidates: [candidate("a")] });
    const stats = await enrich(f.store, f.model, { sinceIso: since });
    expect(stats).toMatchObject({ checked: 1, classified: 0, waitingForTopics: 1, embedded: 1 });
    expect(f.model.callTool).not.toHaveBeenCalled();
  });

  it("sorts and embeds what is missing, honoring a sender's shelf, and counts tokens", async () => {
    const f = fakes({
      candidates: [
        candidate("a"),
        candidate("b", { senderId: "s000000000002" }),
        candidate("done", { enriched: true, embedded: true }),
        candidate("half", { enriched: true, summary: "Old summary" }),
      ],
      topics,
      senderShelves: new Map([["s000000000002", "news"]]),
    });
    const stats = await enrich(f.store, f.model, { sinceIso: since });
    expect(stats).toMatchObject({
      checked: 3,
      classified: 2,
      embedded: 3,
      errors: 0,
      inputTokens: 2000,
      outputTokens: 80,
      // Three issues, plus the five interests on the first run.
      embedTokens: 2700 + 4500,
    });
    expect(f.classified).toEqual(
      expect.arrayContaining([
        { id: "a", shelf: "learning", senderShelf: undefined },
        { id: "b", shelf: "learning", senderShelf: "news" },
      ]),
    );
    expect(f.embedded.sort()).toEqual(["a", "b", "half"]);
  });

  it("embeds the five interests once, and again only when the list changes", async () => {
    const f = fakes({ candidates: [], topics });
    await enrich(f.store, f.model, { sinceIso: since });
    expect(f.interests()?.map((i) => i.name)).toEqual(INTERESTS.map((i) => i.name));
    expect(f.model.embed).toHaveBeenCalledTimes(5);
    expect(await ensureInterests(f.store, f.model)).toBe(0);
    expect(f.model.embed).toHaveBeenCalledTimes(5);
  });

  it("a failed interest embedding is reported and the issues still get enriched", async () => {
    const f = fakes({ candidates: [candidate("a")], topics });
    f.store.getInterests = async () => {
      throw new Error("ThrottlingException");
    };
    const stats = await enrich(f.store, f.model, { sinceIso: since });
    expect(stats).toMatchObject({ classified: 1, embedded: 1, errors: 1 });
    expect(stats.errorSamples).toEqual(["interests: ThrottlingException"]);
  });

  it("force redoes everything", async () => {
    const f = fakes({
      candidates: [candidate("done", { enriched: true, embedded: true })],
      topics,
    });
    expect(await enrich(f.store, f.model, { sinceIso: since, force: true })).toMatchObject({
      checked: 1,
      classified: 1,
      embedded: 1,
    });
  });

  it("counts a failed issue and carries on with the rest", async () => {
    const f = fakes({ candidates: [candidate("a"), candidate("b")], topics, failOn: "a" });
    const stats = await enrich(f.store, f.model, { sinceIso: since });
    expect(stats).toMatchObject({ classified: 1, embedded: 1, errors: 1 });
    expect(stats.errorSamples[0]).toBe("a: ThrottlingException");
  });

  it("starts nothing after the deadline", async () => {
    const f = fakes({ candidates: [candidate("a"), candidate("b")], topics });
    const stats = await enrich(f.store, f.model, { sinceIso: since, deadline: Date.now() - 1 });
    expect(stats).toMatchObject({ checked: 2, deferred: 2, classified: 0, embedded: 0 });
  });
});

describe("archive rules", () => {
  it("archives an issue Claude marks as a promo", async () => {
    const f = fakes({ candidates: [candidate("offer")], topics, promo: true });
    const stats = await enrich(f.store, f.model, { sinceIso: "x" });
    expect(stats.promosArchived).toBe(1);
    expect(f.archived).toEqual([{ id: "offer", reason: "promo" }]);
  });

  it("files account mail as filtered and does not embed it (#50)", async () => {
    const f = fakes({ candidates: [candidate("code")], topics, account: {} });
    const stats = await enrich(f.store, f.model, { sinceIso: "x" });
    expect(stats).toMatchObject({ classified: 1, accountFiltered: 1, embedded: 0, errors: 0 });
    expect(f.filtered).toEqual([{ id: "code", reason: "account", by: "claude" }]);
    expect(f.archived).toEqual([]);
  });

  it("keeps an issue Sandip rated or saved even when Claude calls it account mail", async () => {
    const f = fakes({ candidates: [candidate("kept")], topics, account: { keep: ["kept"] } });
    const stats = await enrich(f.store, f.model, { sinceIso: "x" });
    expect(stats).toMatchObject({ classified: 1, accountFiltered: 0, embedded: 1 });
    expect(f.filtered).toEqual([]);
  });

  it("archives week-old unread news, but never from a Must Read newsletter", async () => {
    const f = fakes({
      candidates: [],
      mustRead: ["s-star"],
      staleNews: [
        { id: "old", senderId: "s-other" },
        { id: "kept", senderId: "s-star" },
      ],
    });
    expect(await archiveOldNews(f.store)).toBe(1);
    expect(f.archived).toEqual([{ id: "old", reason: "old-news" }]);
  });
});

describe("proposeTopics", () => {
  it("stores the proposal only when asked, and never over an existing list without replace", async () => {
    const proposal = { topics };
    const f = fakes({ candidates: [candidate("a")] });
    f.model.callTool = vi.fn(async () => ({ input: proposal, inputTokens: 1, outputTokens: 1 }));

    expect((await proposeTopics(f.store, f.model, { sinceIso: "x", apply: false })).applied).toBe(
      false,
    );
    expect(f.stored()).toBeUndefined();
    expect((await proposeTopics(f.store, f.model, { sinceIso: "x", apply: true })).applied).toBe(
      true,
    );
    expect(f.stored()).toEqual(topics);

    const again = await proposeTopics(f.store, f.model, { sinceIso: "x", apply: true });
    expect(again).toMatchObject({ applied: false, existing: topics });
    const replaced = await proposeTopics(f.store, f.model, {
      sinceIso: "x",
      apply: true,
      replace: true,
    });
    expect(replaced.applied).toBe(true);
  });
});
