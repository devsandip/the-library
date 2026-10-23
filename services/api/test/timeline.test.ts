import { describe, expect, it, vi } from "vitest";
import type { SenderListItem, Timeline } from "@library/core/types";
import type { ClaudePort, ToolRequest } from "../src/claude.js";
import { CorpusCache, type CorpusIssue, type CorpusStory } from "../src/corpus.js";
import { HttpError } from "../src/errors.js";
import {
  NOTHING_CLOSE,
  NOTHING_MOVES,
  TIMELINE_STORIES,
  timelineRequest,
  Timelines,
  type TimelineItem,
  type TimelineStore,
  type TimelineStory,
} from "../src/timeline.js";

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
const story = (id: string, n: number, headline: string, vector: Float32Array): CorpusStory => ({
  id,
  n,
  headline,
  summary: `What ${headline} says.`,
  names: ["FlyDubai"],
  vector,
});

// Axis 0 is the FlyDubai story; axes 1 and 2 are other news.
const issues = [
  issue("wsj", "W", "2026-10-09"),
  issue("wsj-early", "W", "2026-10-01"),
  issue("verge", "V", "2026-10-05"),
  issue("since", "S", "2026-10-12"),
  issue("old", "O", "2026-09-08"),
  issue("muted", "M", "2026-10-06"),
  issue("promo", "P", "2026-10-06", true),
  issue("far", "F", "2026-10-07"),
];
const stories = [
  story("wsj", 1, "Rates rise", unit(0, 1, 0)),
  story("wsj", 2, "FlyDubai bans the attacker", unit(1, 0, 0)),
  story("wsj-early", 1, "A co-pilot is stabbed", unit(1, 1.02, 0)),
  story("verge", 1, "Phones get faster", unit(0, 0, 1)),
  story("verge", 2, "Chips sell out", unit(0, 0.9, 0.1)),
  story("verge", 3, "Airlines review cockpit rules", unit(1, 0.3, 0)),
  story("since", 1, "The attacker is charged", unit(1, 0.2, 0.1)),
  story("old", 1, "An older FlyDubai incident", unit(1, 0.1, 0)),
  story("muted", 1, "FlyDubai gossip", unit(1, 0.05, 0)),
  story("promo", 1, "Fly with us", unit(1, 0.05, 0.05)),
  story("far", 1, "A bundle size tool", unit(0, 1, 0.1)),
];
const sender = (senderId: string, muted = false) =>
  ({ senderId, publication: `Pub ${senderId}`, muted }) as SenderListItem;

function setup(answer: unknown, extra: { issues?: CorpusIssue[]; stories?: CorpusStory[] } = {}) {
  const allIssues = [...issues, ...(extra.issues ?? [])];
  const allStories = [...stories, ...(extra.stories ?? [])];
  const kept = new Map<string, Timeline>();
  const store: TimelineStore = {
    timelineStory: vi.fn(async (id: string, n: number): Promise<TimelineStory | undefined> => {
      const s = allStories.find((x) => x.id === id && x.n === n);
      const i = allIssues.find((x) => x.id === id);
      if (!s || !i) return undefined;
      return {
        issueId: id,
        n,
        senderId: i.senderId,
        receivedAt: i.receivedAt,
        vector: s.vector!,
        headline: s.headline,
        summary: s.summary,
        names: s.names,
        eventId: id === "wsj" ? "ev-flydubai" : `${id}#0${n}`,
        publication: i.publication,
        digest: allStories.filter((x) => x.id === id).length > 1,
      };
    }),
    getTimeline: vi.fn(async (eventId: string) => kept.get(eventId)),
    // As DynamoRepo reads it back: what the app shows, not what it was written from.
    putTimeline: vi.fn(async (eventId: string, t: Timeline) => {
      const { gist, points, at, stories, ms, cents } = t;
      kept.set(eventId, { gist, points, at, stories, ms, cents });
    }),
    listSenders: vi.fn(async () => [sender("W"), sender("V"), sender("M", true)]),
  };
  const claude = {
    callTool: vi.fn(async (_req: ToolRequest) => ({
      input: answer,
      inputTokens: 1500,
      outputTokens: 300,
    })),
  } satisfies ClaudePort;
  const corpus = new CorpusCache({
    readCorpus: vi.fn(async () => ({ issues: allIssues, stories: allStories })),
  });
  const clock = [Date.parse("2026-10-23T05:00:00.000Z"), Date.parse("2026-10-23T05:00:04.200Z")];
  const now = vi.fn(() => clock.shift() ?? 0);
  return { timelines: new Timelines(store, corpus, claude, now), store, claude };
}

const items = (claude: { callTool: { mock: { calls: [ToolRequest][] } } }) =>
  claude.callTool.mock.calls[0]![0].user.split("\n");

describe("Timelines", () => {
  const answer = {
    points: [
      { text: "FlyDubai bans the attacker — for life.", stories: ["3", "2", "99"] },
      { text: "A co-pilot is stabbed on a FlyDubai flight.", stories: ["1"] },
      { text: "", stories: ["4"] },
      { text: "Something Claude made up.", stories: ["nope"] },
    ],
    gist: "From an attack in the air  to a lifetime ban.",
  };

  it("reads the story and its closest stories from four weeks before it, oldest first", async () => {
    const { timelines, claude } = setup(answer);
    await timelines.run("wsj", 2);
    expect(items(claude)).toEqual([
      "1 | 2026-10-01 | Pub W | A co-pilot is stabbed. What A co-pilot is stabbed says. | FlyDubai",
      "2 | 2026-10-05 | Pub V | Airlines review cockpit rules. What Airlines review cockpit rules says. | FlyDubai",
      "3 | 2026-10-09 | Pub W | FlyDubai bans the attacker. What FlyDubai bans the attacker says. | FlyDubai | READING",
      "4 | 2026-10-12 | Pub S | The attacker is charged. What The attacker is charged says. | FlyDubai",
    ]);
    // Left out: older than four weeks, a muted newsletter, a promo, far apart, its own issue.
  });

  it("dates each point by its stories, in date order, and keeps it for the event", async () => {
    const { timelines, store } = setup(answer);
    const { timeline } = await timelines.run("wsj", 2);
    expect(timeline).toEqual({
      gist: "From an attack in the air to a lifetime ban.",
      points: [
        {
          at: at("2026-10-01"),
          text: "A co-pilot is stabbed on a FlyDubai flight.",
          sources: [{ issueId: "wsj-early", publication: "Pub W" }],
        },
        {
          at: at("2026-10-05"),
          text: "FlyDubai bans the attacker, for life.",
          sources: [
            {
              issueId: "verge",
              publication: "Pub V",
              story: { n: 3, headline: "Airlines review cockpit rules" },
            },
            {
              issueId: "wsj",
              publication: "Pub W",
              story: { n: 2, headline: "FlyDubai bans the attacker" },
            },
          ],
          current: true,
        },
      ],
      at: "2026-10-23T05:00:00.000Z",
      stories: 4,
      ms: 4200,
      cents: 0.3,
    });
    expect(store.putTimeline).toHaveBeenCalledWith("ev-flydubai", {
      ...timeline,
      from: "wsj#02",
      storyKeys: ["wsj-early#01", "verge#03", "wsj#02", "since#01"],
      model: expect.stringContaining("claude-haiku"),
      inputTokens: 1500,
      outputTokens: 300,
    });
  });

  it("serves the kept timeline to any story of the event, without a call", async () => {
    const { timelines, claude } = setup(answer);
    expect(await timelines.get("wsj", 2)).toEqual({});
    const { timeline } = await timelines.run("wsj", 2);
    expect(await timelines.get("wsj", 2)).toEqual({ timeline });
    expect(claude.callTool).toHaveBeenCalledTimes(1);
  });

  it("marks one point current when Claude cites the story twice: the latest", async () => {
    const { timelines } = setup({
      points: [
        { text: "The launch is announced.", stories: ["2", "3"] },
        { text: "FlyDubai bans the attacker.", stories: ["3"] },
        { text: "The attacker is charged.", stories: ["4"] },
      ],
      gist: "Twice cited.",
    });
    const { timeline } = await timelines.run("wsj", 2);
    expect(timeline!.points.map((p) => p.current ?? false)).toEqual([false, true, false]);
  });

  it("makes no call when nothing is close", async () => {
    const { timelines, claude, store } = setup(answer);
    expect(await timelines.run("verge", 1)).toEqual({ none: NOTHING_CLOSE });
    expect(claude.callTool).not.toHaveBeenCalled();
    expect(store.putTimeline).not.toHaveBeenCalled();
  });

  it("keeps nothing when Claude finds no other step of the story", async () => {
    const { timelines, store } = setup({
      points: [{ text: "FlyDubai bans the attacker.", stories: ["3"] }],
      gist: "Only this.",
    });
    expect(await timelines.run("wsj", 2)).toEqual({ none: NOTHING_MOVES });
    expect(store.putTimeline).not.toHaveBeenCalled();
  });

  it("reads at most the closest few stories", async () => {
    const many = Array.from({ length: 20 }, (_, k) => issue(`near${k}`, `N${k}`, "2026-10-08"));
    const { timelines, claude } = setup(answer, {
      issues: many,
      stories: many.map((i, k) => story(i.id, 1, `Near ${k}`, unit(1, 0.01 * k, 0))),
    });
    await timelines.run("wsj", 2);
    const lines = items(claude);
    expect(lines).toHaveLength(TIMELINE_STORIES + 1);
    expect(lines.filter((l) => l.includes("Near"))).toHaveLength(TIMELINE_STORIES);
  });

  it("answers 404 for a story the issue does not have", async () => {
    const { timelines } = setup(answer);
    await expect(timelines.get("wsj", 9)).rejects.toMatchObject({ status: 404 });
    await expect(timelines.run("nope", 1)).rejects.toBeInstanceOf(HttpError);
  });

  it("rejects an answer without a point list", async () => {
    const { timelines, store } = setup({ gist: "No points." });
    await expect(timelines.run("wsj", 2)).rejects.toThrow("no point list");
    expect(store.putTimeline).not.toHaveBeenCalled();
  });
});

describe("timelineRequest", () => {
  it("dates each line by the reader's day, in India", () => {
    const item: TimelineItem = {
      id: "1",
      issueId: "a",
      n: 1,
      // 20:00 UTC is 01:30 the next day in India.
      receivedAt: "2026-10-01T20:00:00.000Z",
      publication: "TLDR",
      headline: "Late news",
      summary: "It arrived late.",
      names: [],
      digest: false,
      reading: false,
    };
    expect(timelineRequest([item]).user).toBe(
      "1 | 2026-10-02 | TLDR | Late news. It arrived late. | -",
    );
  });
});
