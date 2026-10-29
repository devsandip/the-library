import { DEFAULT_SETTINGS } from "@library/core/settings";
import { describe, expect, it, vi } from "vitest";
import type { SenderListItem, Takes as TakesResult } from "@library/core/types";
import type { ClaudePort, ToolRequest } from "../src/claude.js";
import { buildCorpus, CorpusCache, type CorpusIssue, type CorpusStory } from "../src/corpus.js";
import { HttpError } from "../src/errors.js";
import {
  onlyOne,
  parseTakes,
  Takes,
  takesItems,
  takesRequest,
  type StoredTakes,
  type TakesStore,
} from "../src/takes.js";
import type { TimelineStory } from "../src/timeline.js";

const unit = (...xs: number[]) => {
  const n = Math.hypot(...xs);
  return Float32Array.from(xs.map((x) => x / n));
};
const at = (date: string) => `${date}T08:00:00.000Z`;
const issue = (id: string, senderId: string, date: string, promo = false): CorpusIssue => ({
  id,
  senderId,
  publication: `Pub ${senderId}`,
  subject: `Subject of ${id}`,
  receivedAt: at(date),
  promo,
});
const story = (
  id: string,
  n: number,
  headline: string,
  vector: Float32Array,
  eventId?: string,
): CorpusStory => ({
  id,
  n,
  headline,
  summary: `What ${headline} says.`,
  names: ["Anthropic"],
  vector,
  ...(eventId ? { eventId } : {}),
});

// Axis 0 is the IPO; axis 1 is other news.
const issues = [
  issue("ken", "K", "2026-10-20"),
  issue("tldr", "T", "2026-10-20"),
  issue("wsj", "W", "2026-10-21"),
  issue("wsj-2", "W", "2026-10-21"),
  issue("verge", "V", "2026-10-22"),
  issue("late", "L", "2026-10-30"),
  issue("muted", "M", "2026-10-21"),
  issue("promo", "P", "2026-10-21", true),
  issue("far", "F", "2026-10-21"),
];
const stories = [
  story("ken", 1, "Anthropic files to list", unit(1, 0), "ev-ipo"),
  story("tldr", 1, "Rates rise", unit(0, 1)),
  story("tldr", 2, "Anthropic's IPO filing, in numbers", unit(1, 0.1), "ev-ipo"),
  story("wsj", 1, "Anthropic eyes a listing", unit(1, 0.3)),
  story("wsj-2", 1, "Anthropic IPO: what bankers say", unit(1, 0.2)),
  story("verge", 1, "Why Anthropic is going public", unit(1, 0.4), "ev-other"),
  // Reads alike but a week later; the event links it all the same.
  story("late", 1, "Anthropic sets its price range", unit(1, 0.6), "ev-ipo"),
  story("muted", 1, "Anthropic gossip", unit(1, 0.05)),
  story("promo", 1, "Our IPO course", unit(1, 0.05)),
  story("far", 1, "A bundle size tool", unit(0, -1)),
];
const corpus = buildCorpus({ issues, stories });
const open = (id = "ken", n = 1): TimelineStory => {
  const s = stories.find((x) => x.id === id && x.n === n)!;
  const i = issues.find((x) => x.id === id)!;
  return {
    issueId: id,
    n,
    senderId: i.senderId,
    receivedAt: i.receivedAt,
    vector: s.vector!,
    headline: s.headline,
    summary: s.summary,
    names: s.names,
    eventId: s.eventId ?? `${id}#0${n}`,
    publication: i.publication,
    digest: stories.filter((x) => x.id === id).length > 1,
  };
};
const notMuted = (id: string) => issues.find((i) => i.id === id)?.senderId !== "M";

describe("takesItems", () => {
  it("takes the event's stories and close ones nearby, one per newsletter, oldest first", () => {
    const items = takesItems(open(), corpus, notMuted);
    expect(items.map((i) => `${i.id} ${i.issueId}#${i.n}`)).toEqual([
      "1 ken#1",
      "2 tldr#2",
      // WSJ twice: its closer story stands for it.
      "3 wsj-2#1",
      "4 verge#1",
      "5 late#1",
    ]);
    expect(items.find((i) => i.reading)?.issueId).toBe("ken");
    expect(items.find((i) => i.issueId === "tldr")?.digest).toBe(true);
  });

  it("leaves out muted newsletters, promos and stories about other things", () => {
    const keys = takesItems(open(), corpus, notMuted).map((i) => i.issueId);
    expect(keys).not.toContain("muted");
    expect(keys).not.toContain("promo");
    expect(keys).not.toContain("far");
  });

  it("is the open story alone when nothing else covered it", () => {
    expect(takesItems(open("far", 1), corpus, notMuted).map((i) => i.issueId)).toEqual(["far"]);
  });
});

describe("takesRequest", () => {
  it("marks the open story and asks for groups by where they land", () => {
    const req = takesRequest(takesItems(open(), corpus, notMuted));
    expect(req.tool.name).toBe("group_takes");
    expect(req.system).toContain("where they land");
    const lines = req.user.split("\n");
    expect(lines[0]).toBe(
      "1 | 2026-10-20 | Pub K | Anthropic files to list. What Anthropic files to list says. | Anthropic | READING",
    );
    expect(lines).toHaveLength(5);
  });
});

describe("parseTakes", () => {
  const items = takesItems(open(), corpus, notMuted);

  it("keeps known stories, each newsletter once, the open one marked, the digest's story named", () => {
    const t = parseTakes(
      {
        gist: " They agree on the filing — not on the timing. ",
        groups: [
          {
            label: "Just the facts",
            takes: [
              { text: "The Ken reports the filing.", story: "1" },
              { text: "TLDR lists the numbers.", story: "2" },
            ],
          },
          {
            label: "Skeptical",
            takes: [
              { text: "WSJ doubts the timing.", story: "3" },
              { text: "The Ken again.", story: "1" },
              { text: "Made up.", story: "9" },
            ],
          },
          { label: "Empty", takes: [{ text: "", story: "4" }] },
        ],
      },
      items,
    );
    expect(t).toEqual({
      gist: "They agree on the filing, not on the timing.",
      groups: [
        {
          label: "Just the facts",
          takes: [
            {
              text: "The Ken reports the filing.",
              source: { issueId: "ken", publication: "Pub K" },
              current: true,
            },
            {
              text: "TLDR lists the numbers.",
              source: {
                issueId: "tldr",
                publication: "Pub T",
                story: { n: 2, headline: "Anthropic's IPO filing, in numbers" },
              },
            },
          ],
        },
        {
          label: "Skeptical",
          takes: [
            { text: "WSJ doubts the timing.", source: { issueId: "wsj-2", publication: "Pub W" } },
          ],
        },
      ],
    });
  });

  it("is nothing to compare when fewer than two newsletters are left", () => {
    expect(
      parseTakes(
        { gist: "x", groups: [{ label: "Alone", takes: [{ text: "Hi.", story: "1" }] }] },
        items,
      ),
    ).toBeUndefined();
    expect(parseTakes({}, items)).toBeUndefined();
  });
});

describe("Takes", () => {
  function setup(answer: unknown) {
    const kept = new Map<string, TakesResult>();
    const store: TakesStore = {
      settings: vi.fn(async () => DEFAULT_SETTINGS),
      timelineStory: vi.fn(async (id: string, n: number) =>
        stories.some((s) => s.id === id && s.n === n) ? open(id, n) : undefined,
      ),
      listSenders: vi.fn(async () => [{ senderId: "M", muted: true } as SenderListItem]),
      getTakes: vi.fn(async (eventId: string) => kept.get(eventId)),
      putTakes: vi.fn(async (eventId: string, t: StoredTakes) => void kept.set(eventId, t)),
    };
    const calls: ToolRequest[] = [];
    const claude: ClaudePort = {
      callTool: vi.fn(async (req: ToolRequest) => {
        calls.push(req);
        return { input: answer, inputTokens: 1200, outputTokens: 300 };
      }),
    };
    const takes = new Takes(
      store,
      new CorpusCache({ readCorpus: async () => ({ issues, stories }) }),
      claude,
      () => Date.parse("2026-10-27T10:00:00.000Z"),
    );
    return { takes, store, calls };
  }

  it("writes takes for the event, keeps them, and serves them back", async () => {
    const { takes, store, calls } = setup({
      gist: "All report the filing.",
      groups: [
        {
          label: "Just the facts",
          takes: [
            { text: "The Ken reports it.", story: "1" },
            { text: "TLDR has the numbers.", story: "2" },
          ],
        },
      ],
    });
    expect(await takes.get("ken", 1)).toEqual({});
    const r = await takes.run("ken", 1);
    expect(calls).toHaveLength(1);
    expect(r.takes).toMatchObject({ newsletters: 2, cents: 0.3, gist: "All report the filing." });
    expect(store.putTakes).toHaveBeenCalledWith(
      "ev-ipo",
      expect.objectContaining({ from: "ken#01", storyKeys: expect.arrayContaining(["ken#01"]) }),
    );
    // Another newsletter's story of the same event opens them free.
    expect((await takes.get("tldr", 2)).takes?.gist).toBe("All report the filing.");
  });

  it("says only one newsletter carried it, without a call, and keeps nothing", async () => {
    const { takes, store, calls } = setup({});
    expect(await takes.run("far", 1)).toEqual({ none: onlyOne("Pub F") });
    expect(calls).toHaveLength(0);
    expect(store.putTakes).not.toHaveBeenCalled();
  });

  it("keeps nothing when Claude finds fewer than two takes", async () => {
    const { takes, store } = setup({
      gist: "x",
      groups: [{ label: "Alone", takes: [{ text: "The Ken.", story: "1" }] }],
    });
    expect(await takes.run("ken", 1)).toEqual({ none: onlyOne("Pub K") });
    expect(store.putTakes).not.toHaveBeenCalled();
  });

  it("404s a story the issue does not have", async () => {
    const { takes } = setup({});
    await expect(takes.get("ken", 9)).rejects.toBeInstanceOf(HttpError);
  });
});
