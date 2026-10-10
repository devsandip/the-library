import { describe, expect, it, vi } from "vitest";
import type { ModelPort } from "../src/bedrock.js";
import type { EnrichCandidate } from "../src/enrich.js";
import {
  narrativeItems,
  narrativeRequest,
  parseNarrative,
  writeNarrative,
  type StoredNarrative,
  type StoryText,
} from "../src/narrative.js";
import type { Store } from "../src/store.js";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const story = (issueId: string, n: number, eventId = `${issueId}#0${n}`): StoryText => ({
  key: `${issueId}#0${n}`,
  issueId,
  receivedAt: hoursAgo(5),
  headline: `Headline ${issueId}${n}`,
  summary: `Summary ${issueId}${n}.`,
  names: [`Name ${issueId}`],
  eventId,
});

describe("narrativeItems", () => {
  it("merges the stories of one event, in the order the events began", () => {
    const items = narrativeItems(
      [story("a", 1), story("b", 1, "a#01"), story("b", 2)],
      new Map([
        ["a", "TLDR"],
        ["b", "WSJ"],
      ]),
    );
    expect(items).toEqual([
      {
        id: "1",
        headline: "Headline a1",
        summary: "Summary a1.",
        names: ["Name a", "Name b"],
        sources: [
          { issueId: "a", publication: "TLDR" },
          { issueId: "b", publication: "WSJ" },
        ],
      },
      {
        id: "2",
        headline: "Headline b2",
        summary: "Summary b2.",
        names: ["Name b"],
        sources: [{ issueId: "b", publication: "WSJ" }],
      },
    ]);
    expect(narrativeRequest(items).user).toBe(
      "1 | Headline a1. Summary a1. | Name a, Name b | TLDR, WSJ\n" +
        "2 | Headline b2. Summary b2. | Name b | WSJ",
    );
  });
});

describe("parseNarrative", () => {
  const items = narrativeItems(
    [story("a", 1), story("b", 1)],
    new Map([
      ["a", "TLDR"],
      ["b", "WSJ"],
    ]),
  );

  it("keeps threads with known stories, and turns em-dashes into commas", () => {
    const threads = parseNarrative(
      {
        threads: [
          {
            title: "Chips",
            text: "TSMC grew\u2014again\u2014on AI demand.",
            stories: ["2", "1", "2"],
          },
          { title: "Ghost", text: "Cites nothing real.", stories: ["9"] },
          { title: "", text: "No title.", stories: ["1"] },
        ],
      },
      items,
    );
    expect(threads).toEqual([
      {
        title: "Chips",
        text: "TSMC grew, again, on AI demand.",
        sources: [
          { issueId: "b", publication: "WSJ" },
          { issueId: "a", publication: "TLDR" },
        ],
      },
    ]);
  });

  it("fails when nothing usable is left", () => {
    expect(() =>
      parseNarrative({ threads: [{ title: "x", text: "y", stories: [] }] }, items),
    ).toThrow("no usable threads");
    expect(() => parseNarrative({}, items)).toThrow("no thread list");
  });
});

const issue = (id: string, extra: Partial<EnrichCandidate> = {}): EnrichCandidate => ({
  id,
  senderId: `s-${id}`,
  publication: `Pub ${id}`,
  subject: `Subject ${id}`,
  receivedAt: hoursAgo(5),
  enriched: true,
  embedded: true,
  shelf: "news",
  ...extra,
});

function fakes(opts: {
  stories: StoryText[];
  issues: EnrichCandidate[];
  latest?: StoredNarrative;
}) {
  const putNarrative = vi.fn(async () => undefined);
  const store = {
    storyTexts: vi.fn(async () => opts.stories),
    enrichCandidates: vi.fn(async () => opts.issues),
    senderSettings: vi.fn(
      async () =>
        new Map([["s-muted", { mustRead: false, muted: true }]]) as Map<
          string,
          { mustRead: boolean; muted: boolean }
        >,
    ),
    getNarrative: vi.fn(async () => opts.latest),
    putNarrative,
  } as unknown as Store;
  const model: ModelPort = {
    callTool: vi.fn(async () => ({
      input: { threads: [{ title: "The day", text: "Things happened.", stories: ["1"] }] },
      inputTokens: 900,
      outputTokens: 120,
    })),
    embed: vi.fn(),
  };
  return { store, model, putNarrative };
}

/** Ten News stories from ten issues, plus a promo, a muted newsletter and a Learning issue. */
const day = () => {
  const ids = Array.from({ length: 10 }, (_, k) => `n${k}`);
  return {
    stories: [...ids, "promo", "muted", "learn"].map((id) => story(id, 1)),
    issues: [
      ...ids.map((id) => issue(id)),
      issue("promo", { promo: true }),
      issue("muted", { senderId: "s-muted" }),
      issue("learn", { shelf: "learning" }),
    ],
  };
};

describe("writeNarrative", () => {
  it("writes a narrative from the last day's News stories only", async () => {
    const { store, model, putNarrative } = fakes(day());
    const stats = await writeNarrative(store, model, { now: NOW });
    expect(stats).toMatchObject({ written: true, stories: 10, threads: 1, titles: ["The day"] });
    expect(putNarrative).toHaveBeenCalledWith(
      expect.objectContaining({
        at: new Date(NOW).toISOString(),
        stories: 10,
        newsletters: 10,
        storyKeys: Array.from({ length: 10 }, (_, k) => `n${k}#01`),
      }),
    );
    expect(store.storyTexts).toHaveBeenCalledWith(hoursAgo(24), new Date(NOW).toISOString());
  });

  it("waits for enough News, six hours and five new stories", async () => {
    const quiet = fakes({ stories: day().stories.slice(0, 7), issues: day().issues });
    expect(await writeNarrative(quiet.store, quiet.model, { now: NOW })).toMatchObject({
      written: false,
      skipped: "too few News stories",
    });

    const latest = (at: string, keys: string[]): StoredNarrative => ({
      at,
      threads: [],
      stories: keys.length,
      newsletters: 1,
      storyKeys: keys,
      model: "m",
    });
    const recent = fakes({ ...day(), latest: latest(hoursAgo(5), []) });
    expect(await writeNarrative(recent.store, recent.model, { now: NOW })).toMatchObject({
      skipped: "written recently",
    });

    const seen = Array.from({ length: 6 }, (_, k) => `n${k}#01`);
    const stale = fakes({ ...day(), latest: latest(hoursAgo(7), seen) });
    expect(await writeNarrative(stale.store, stale.model, { now: NOW })).toMatchObject({
      skipped: "little new since the last one",
    });
    expect(stale.model.callTool).not.toHaveBeenCalled();

    const fresh = fakes({ ...day(), latest: latest(hoursAgo(7), seen.slice(0, 5)) });
    expect(await writeNarrative(fresh.store, fresh.model, { now: NOW })).toMatchObject({
      written: true,
    });
  });

  it("writes on demand, unless the run is out of time", async () => {
    const forced = fakes({
      ...day(),
      latest: {
        at: hoursAgo(1),
        threads: [],
        stories: 0,
        newsletters: 0,
        storyKeys: [],
        model: "m",
      },
    });
    expect(
      await writeNarrative(forced.store, forced.model, { now: NOW, force: true }),
    ).toMatchObject({ written: true });
    const late = fakes(day());
    expect(
      await writeNarrative(late.store, late.model, { now: NOW, deadline: Date.now() - 1 }),
    ).toMatchObject({ written: false, skipped: "out of time" });
  });
});
