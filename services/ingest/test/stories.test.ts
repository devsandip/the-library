import { DEFAULT_SETTINGS } from "@library/core/settings";
import { describe, expect, it, vi } from "vitest";
import type { ModelPort, ToolRequest } from "../src/bedrock.js";
import type { EnrichCandidate } from "../src/enrich.js";
import type { Store } from "../src/store.js";
import {
  carriedOver,
  indexStories,
  parseStories,
  relinkStories,
  storiesRequest,
  type NewStory,
  type StoredStory,
} from "../src/stories.js";

const at = (day: number, hour = 8) =>
  `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

describe("parseStories", () => {
  const links = ["https://a.example/1", "https://a.example/2"];

  it("turns link numbers into URLs and tidies the fields", () => {
    const out = parseStories(
      {
        stories: [
          {
            headline: "  OpenAI ships\nGPT-6 ",
            summary: "It is out.",
            names: ["OpenAI", "openai", " GPT-6 "],
            link: 2,
          },
          { headline: "No link", summary: "None.", names: [], link: 0 },
          { headline: "Bad link", summary: "Out of range.", names: [], link: 9 },
        ],
      },
      links,
    );
    expect(out).toEqual([
      {
        headline: "OpenAI ships GPT-6",
        summary: "It is out.",
        names: ["OpenAI", "GPT-6"],
        link: "https://a.example/2",
      },
      { headline: "No link", summary: "None.", names: [] },
      { headline: "Bad link", summary: "Out of range.", names: [] },
    ]);
  });

  it("drops stories without a headline or summary, and fails when none are left", () => {
    expect(
      parseStories(
        {
          stories: [
            { headline: "", summary: "x" },
            { headline: "Kept", summary: "Yes", names: "nope" },
          ],
        },
        [],
      ),
    ).toEqual([{ headline: "Kept", summary: "Yes", names: [] }]);
    expect(() => parseStories({ stories: [{ headline: "x" }] }, [])).toThrow("no usable stories");
    expect(() => parseStories({}, [])).toThrow("no story list");
  });
});

describe("storiesRequest", () => {
  it("sends the newsletter, the subject and the text, cut to a bounded length", () => {
    const req = storiesRequest({ publication: "TLDR", subject: "Today" }, "x".repeat(70_000));
    expect(req.tool.name).toBe("record_stories");
    expect(req.user.startsWith("Newsletter: TLDR\nSubject: Today\n\n")).toBe(true);
    expect(req.user.length).toBeLessThan(61_000);
  });
});

const issue = (id: string, day: number, extra: Partial<EnrichCandidate> = {}): EnrichCandidate => ({
  id,
  senderId: `s-${id}`,
  publication: `Pub ${id}`,
  subject: `About ${id}`,
  receivedAt: at(day),
  enriched: true,
  embedded: true,
  ...extra,
});

/** One story per issue, named after it; its vector comes from `vectors`. */
function fakeModel(vectors: Record<string, number[]>, failing: string[] = []): ModelPort {
  return {
    callTool: vi.fn(async (req: ToolRequest) => {
      const id = /^Subject: About (\S+)$/m.exec(req.user)![1]!;
      if (failing.includes(id)) throw new Error("model down");
      return {
        input: {
          stories: [
            { headline: `On ${id}`, summary: `What ${id} says.`, names: ["Acme"], link: 1 },
          ],
        },
        inputTokens: 100,
        outputTokens: 20,
      };
    }),
    embed: vi.fn(async (text: string) => ({
      vector: vectors[/^On (\S+)/.exec(text)![1]!]!,
      tokens: 5,
    })),
  };
}

function fakeStore(opts: {
  candidates: EnrichCandidate[];
  stored?: StoredStory[];
  muted?: string[];
}) {
  const put: { id: string; stories: NewStory[] }[] = [];
  const store = {
    settings: async () => DEFAULT_SETTINGS,
    enrichCandidates: vi.fn(async () => opts.candidates),
    senderSettings: vi.fn(
      async () =>
        new Map(
          opts.candidates.map((c) => [
            c.senderId,
            { mustRead: false, muted: opts.muted?.includes(c.senderId) ?? false },
          ]),
        ),
    ),
    getHtml: vi.fn(
      async (id: string) => `<p>${id}: <a href="https://src.example/${id}">source</a></p>`,
    ),
    getText: vi.fn(async () => undefined),
    storiesBetween: vi.fn(async () => opts.stored ?? []),
    putStories: vi.fn(async (i: { id: string }, stories: NewStory[]) => {
      put.push({ id: i.id, stories });
    }),
    putStoryError: vi.fn(async () => undefined),
  };
  return { store: store as unknown as Store, put, spies: store };
}

describe("indexStories", () => {
  const since = at(1);

  it("leaves out promos, muted newsletters, split issues and ones that failed three times", async () => {
    const { store, put } = fakeStore({
      candidates: [
        issue("ok", 5),
        issue("promo", 5, { promo: true }),
        issue("muted", 5),
        issue("done", 5, { storied: true }),
        issue("tried", 5, { storyAttempts: 3 }),
      ],
      muted: ["s-muted"],
    });
    const stats = await indexStories(store, fakeModel({ ok: [1, 0, 0] }), { sinceIso: since });
    expect(put.map((p) => p.id)).toEqual(["ok"]);
    expect(put[0]!.stories).toEqual([
      {
        n: 1,
        headline: "On ok",
        summary: "What ok says.",
        names: ["Acme"],
        link: "https://src.example/ok",
        vector: [1, 0, 0],
        eventId: "ok#01",
      },
    ]);
    expect(stats).toMatchObject({ checked: 1, storied: 1, stories: 1, linked: 0, errors: 0 });
  });

  it("goes oldest first, so a later story joins an earlier issue's event", async () => {
    const { store, put } = fakeStore({
      candidates: [
        issue("late", 6),
        issue("first", 5),
        issue("other", 5, { receivedAt: at(5, 9) }),
      ],
    });
    const vectors = { first: [1, 0, 0], other: [0, 0, 1], late: [0.9, 0.436, 0] };
    const stats = await indexStories(store, fakeModel(vectors), { sinceIso: since });
    expect(put.map((p) => p.id)).toEqual(["first", "other", "late"]);
    expect(put.map((p) => p.stories[0]!.eventId)).toEqual(["first#01", "other#01", "first#01"]);
    expect(stats.linked).toBe(1);
  });

  it("joins events from stories stored by earlier runs", async () => {
    const { store, put, spies } = fakeStore({
      candidates: [issue("new", 5)],
      stored: [
        {
          key: "old#02",
          issueId: "old",
          n: 2,
          senderId: "s-old",
          receivedAt: at(4),
          names: [],
          vector: [0.95, 0.31, 0],
          eventId: "older#03",
        },
      ],
    });
    await indexStories(store, fakeModel({ new: [1, 0, 0] }), { sinceIso: since });
    expect(spies.storiesBetween).toHaveBeenCalledWith(at(2), at(8));
    expect(put[0]!.stories[0]!.eventId).toBe("older#03");
  });

  it("counts a failed split against the issue and carries on", async () => {
    const { store, put, spies } = fakeStore({ candidates: [issue("a", 5), issue("b", 6)] });
    const stats = await indexStories(store, fakeModel({ a: [1, 0, 0] }, ["b"]), {
      sinceIso: since,
    });
    expect(put.map((p) => p.id)).toEqual(["a"]);
    expect(spies.putStoryError).toHaveBeenCalledWith("b", "model down");
    expect(stats).toMatchObject({ storied: 1, errors: 1, errorSamples: ["b: model down"] });
  });

  it("starts nothing once the deadline has passed", async () => {
    const { store, put } = fakeStore({ candidates: [issue("a", 5), issue("b", 6)] });
    const model = fakeModel({});
    const stats = await indexStories(store, model, { sinceIso: since, deadline: Date.now() - 1 });
    expect(put).toEqual([]);
    expect(model.callTool).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ checked: 2, deferred: 2 });
  });
});

describe("relinkStories", () => {
  it("recomputes every link and writes only the ones that changed", async () => {
    const story = (id: string, senderId: string, day: number, vector: number[], eventId: string) =>
      ({
        key: `${id}#01`,
        issueId: id,
        n: 1,
        senderId,
        receivedAt: at(day),
        names: ["Acme"],
        vector,
        eventId,
      }) satisfies StoredStory;
    const setEventIds = vi.fn(async () => undefined);
    const store = {
      settings: async () => DEFAULT_SETTINGS,
      storiesBetween: vi.fn(async () => [
        story("a", "s1", 5, [1, 0, 0], "a#01"),
        story("b", "s2", 6, [0.9, 0.436, 0], "b#01"),
        story("c", "s2", 6, [0, 0, 1], "c#01"),
      ]),
      setEventIds,
    } as unknown as Store;
    expect(await relinkStories(store)).toEqual({ stories: 3, events: 2, shared: 1, changed: 1 });
    expect(setEventIds).toHaveBeenCalledWith([{ issueId: "b", n: 1, eventId: "a#01" }]);
  });
});

describe("carriedOver (#98)", () => {
  const old = [
    {
      link: "https://a.test/1",
      headline: "Anthropic files to list",
      shelf: "learning" as const,
      shelfSetBy: "sandip",
      state: "read" as const,
    },
    {
      headline: "How caches fail!",
      shelf: "news" as const,
      shelfSetBy: "jev",
      state: "archived" as const,
    },
    { headline: "Rates rise", shelf: "news" as const, shelfSetBy: "jev" },
  ];
  const s = (headline: string, link?: string) => ({ headline, summary: "S.", names: [], link });

  it("keeps the reader's move and the read state of the old story with the same link", () => {
    // A move stored before #181 says "sandip"; carried, it says "reader".
    expect(carriedOver(s("A new headline", "https://a.test/1"), old)).toEqual({
      shelf: "learning",
      shelfSetBy: "reader",
      state: "read",
    });
    const moved = [{ ...old[0]!, shelfSetBy: "reader" }];
    expect(carriedOver(s("A new headline", "https://a.test/1"), moved).shelfSetBy).toBe("reader");
  });

  it("matches on the headline's words when the link does not, and leaves Jev's shelf to Jev", () => {
    expect(carriedOver(s("how caches fail"), old)).toEqual({ state: "archived" });
    expect(carriedOver(s("Rates rise"), old)).toEqual({});
  });

  it("carries nothing to a story that is new", () => {
    expect(carriedOver(s("Something else", "https://b.test"), old)).toEqual({});
  });
});
