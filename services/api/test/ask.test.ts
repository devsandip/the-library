import { DEFAULT_SETTINGS } from "@library/core/settings";
import { describe, expect, it, vi } from "vitest";
import type { SenderListItem } from "@library/core/types";
import {
  ASK_STORIES,
  askItems,
  Asks,
  interleave,
  NOTHING_FOUND,
  parseAnswer,
  parsePlan,
  searchLabel,
  searchStories,
} from "../src/ask.js";
import type { ClaudePort, ToolRequest } from "../src/claude.js";
import { buildCorpus, CorpusCache, type CorpusIssue, type CorpusStory } from "../src/corpus.js";

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
  names: string[] = [],
): CorpusStory => ({ id, n, headline, summary: `What ${headline} says.`, names, vector });

// Axis 0 is agent evaluation; axis 1 is rates; axis 2 is chips.
const issues = [
  issue("tldr", "T", "2026-10-20"),
  issue("bbg", "B", "2026-10-02"),
  issue("wsj", "W", "2026-10-21"),
  issue("muted", "M", "2026-10-21"),
  issue("promo", "P", "2026-10-21", true),
  issue("old", "O", "2026-08-30"),
];
const stories = [
  story("tldr", 1, "Rates rise again", unit(0, 1, 0)),
  story("tldr", 2, "How to evaluate coding agents", unit(1, 0, 0), ["SWE-bench"]),
  story("tldr", 3, "Chips sell out", unit(0, 0, 1)),
  story("bbg", 1, "Agent evals: a field guide", unit(1, 0.2, 0), ["SWE-bench"]),
  story("wsj", 1, "The Fed holds rates", unit(0, 1, 0.1)),
  story("muted", 1, "Agent evals are broken", unit(1, 0.05, 0)),
  story("promo", 1, "Buy our agent eval course", unit(1, 0.05, 0.05)),
  story("old", 1, "Evaluating agents, the early days", unit(1, 0.1, 0)),
];
const corpus = buildCorpus({ issues, stories });
const everyone = () => true;

describe("parsePlan", () => {
  const today = "2026-10-27";

  it("keeps up to three searches, with real days no later than today", () => {
    const plan = parsePlan(
      {
        searches: [
          { query: " agent   evals ", from: "2026-10-01", to: "2026-10-27" },
          { query: "SWE-bench", from: "2026-10-31" },
          { query: "coding agents", from: "2026-10-20", to: "2026-10-02" },
          { query: "a fourth" },
        ],
      },
      "q",
      today,
    );
    expect(plan).toEqual([
      { query: "agent evals", from: "2026-10-01", to: "2026-10-27" },
      // A day after today is dropped; days the wrong way round are swapped.
      { query: "SWE-bench" },
      { query: "coding agents", from: "2026-10-02", to: "2026-10-20" },
    ]);
  });

  it("falls back to the question when Claude plans nothing usable", () => {
    expect(
      parsePlan({ searches: [{ query: "the" }, { from: "2026-10-01" }] }, "agent evals", today),
    ).toEqual([{ query: "agent evals" }]);
    expect(parsePlan(undefined, "agent evals", today)).toEqual([{ query: "agent evals" }]);
  });

  it("labels a search by its words and its dates", () => {
    expect(searchLabel({ query: "agent evals" })).toBe("agent evals");
    expect(searchLabel({ query: "agent evals", from: "2026-10-01" })).toBe(
      "agent evals (2026-10-01 to …)",
    );
  });
});

describe("searchStories", () => {
  it("ranks each story on its own, by words and meaning, so a digest's story stands alone", () => {
    const keys = searchStories({ query: "agent evals" }, unit(1, 0, 0), corpus, everyone);
    // The promo is not in the corpus; the digest's other stories do not come along.
    expect(keys).toContain("tldr#2");
    expect(keys).toContain("bbg#1");
    expect(keys).not.toContain("tldr#1");
    expect(keys.some((k) => k.startsWith("promo"))).toBe(false);
  });

  it("keeps to the search's days and to eligible newsletters", () => {
    const keys = searchStories(
      { query: "agent evals", from: "2026-10-15", to: "2026-10-27" },
      unit(1, 0, 0),
      corpus,
      (id) => id !== "muted",
    );
    expect(keys).toEqual(["tldr#2"]);
  });

  it("finds by words alone when there is no embedding", () => {
    expect(searchStories({ query: "SWE-bench" }, undefined, corpus, everyone).sort()).toEqual([
      "bbg#1",
      "tldr#2",
    ]);
  });
});

describe("interleave", () => {
  it("takes each search's best in turn, without repeats, up to the limit", () => {
    expect(interleave([["a", "b", "c"], ["b", "d"], ["e"]])).toEqual(["a", "b", "e", "d", "c"]);
    expect(interleave([["a", "b", "c"], ["d"]], 3)).toEqual(["a", "d", "b"]);
    expect(interleave([])).toEqual([]);
  });
});

describe("parseAnswer", () => {
  const items = askItems(["tldr#2", "bbg#1", "wsj#1"], corpus);

  it("numbers the stories oldest first", () => {
    expect(items.map((i) => `${i.id} ${i.issueId}#${i.n}`)).toEqual([
      "1 bbg#1",
      "2 tldr#2",
      "3 wsj#1",
    ]);
    expect(items.find((i) => i.issueId === "tldr")?.digest).toBe(true);
  });

  it("cites each paragraph's stories, with the story inside a digest, and drops the rest", () => {
    const a = parseAnswer(
      {
        paragraphs: [
          {
            text: " Two  newsletters — ByteByteGo and TLDR — cover evals. ",
            stories: ["2", "1", "1"],
          },
          { text: "Made up.", stories: ["9"] },
          { text: "", stories: ["1"] },
        ],
      },
      items,
    );
    expect(a).toEqual({
      paragraphs: [
        {
          text: "Two newsletters, ByteByteGo and TLDR, cover evals.",
          sources: [
            { issueId: "bbg", publication: "Pub B" },
            {
              issueId: "tldr",
              publication: "Pub T",
              story: { n: 2, headline: "How to evaluate coding agents" },
            },
          ],
        },
      ],
    });
  });

  it("says so when nothing answers, in Claude's words or the plain ones", () => {
    expect(parseAnswer({ paragraphs: [], none: "Nothing on agent pricing." }, items)).toEqual({
      paragraphs: [],
      none: "Nothing on agent pricing.",
    });
    expect(parseAnswer({}, items)).toEqual({ paragraphs: [], none: NOTHING_FOUND });
  });
});

describe("Asks", () => {
  const sender = (senderId: string, muted = false) =>
    ({ senderId, publication: `Pub ${senderId}`, muted }) as SenderListItem;

  /** The answer's fake reads the ids it was given, as Claude would. */
  function setup(plan: unknown, answer: unknown | ((req: ToolRequest) => unknown)) {
    const calls: ToolRequest[] = [];
    const claude: ClaudePort = {
      callTool: vi.fn(async (req: ToolRequest) => {
        calls.push(req);
        return {
          input:
            req.tool.name === "plan_searches"
              ? plan
              : typeof answer === "function"
                ? (answer as (r: ToolRequest) => unknown)(req)
                : answer,
          inputTokens: 1000,
          outputTokens: 200,
        };
      }),
    };
    const embedder = { embed: vi.fn(async () => unit(1, 0, 0)) };
    const asks = new Asks(
      {
        listSenders: async () => [sender("T"), sender("B"), sender("M", true)],
        settings: async () => DEFAULT_SETTINGS,
      },
      new CorpusCache({ readCorpus: async () => ({ issues, stories }) }),
      embedder,
      claude,
      () => Date.parse("2026-10-27T10:00:00.000Z"),
    );
    return { asks, calls, embedder };
  }

  it("plans, searches, and answers from the stories it found, muted newsletters left out", async () => {
    const { asks, calls, embedder } = setup(
      { searches: [{ query: "agent evals" }, { query: "SWE-bench" }] },
      (req: ToolRequest) => {
        const line = req.user.split("\n").find((l) => l.includes("field guide"))!;
        return {
          paragraphs: [{ text: "ByteByteGo has a field guide.", stories: [line.split(" | ")[0]] }],
        };
      },
    );
    const r = await asks.ask("What have my newsletters said about agent evals?");
    expect(embedder.embed).toHaveBeenCalledTimes(2);
    expect(calls.map((c) => c.tool.name)).toEqual(["plan_searches", "answer"]);
    const lines = calls[1]!.user.split("\n");
    expect(lines[0]).toBe("Question: What have my newsletters said about agent evals?");
    expect(calls[1]!.user).not.toContain("Agent evals are broken"); // muted
    expect(calls[1]!.system).toContain("Today is 2026-10-27.");
    expect(r).toMatchObject({
      q: "What have my newsletters said about agent evals?",
      searches: ["agent evals", "SWE-bench"],
      paragraphs: [{ text: "ByteByteGo has a field guide.", sources: [{ issueId: "bbg" }] }],
      // Two calls of 1,000 tokens in and 200 out.
      cents: 0.4,
    });
    expect(r.stories).toBeGreaterThan(0);
    expect(r.stories).toBeLessThanOrEqual(ASK_STORIES);
  });

  it("says when the latest match arrived when the question's days rule them all out", async () => {
    const { asks, calls } = setup(
      { searches: [{ query: "agent evals", from: "2026-10-25", to: "2026-10-27" }] },
      { paragraphs: [] },
    );
    const r = await asks.ask("Anything on agent evals in the last two days?");
    expect(calls).toHaveLength(1);
    expect(r.none).toBe(
      "Nothing in your newsletters from 2026-10-25 to 2026-10-27. The latest on this arrived 2026-10-20.",
    );
  });

  it("answers plainly, without a second call, when no story matches", async () => {
    const { asks, calls, embedder } = setup(
      { searches: [{ query: "quantum knitting", from: "2026-10-26" }] },
      { paragraphs: [] },
    );
    // Close to nothing in meaning, and no word in common.
    embedder.embed.mockResolvedValue(new Float32Array(3));
    const r = await asks.ask("Anything on quantum knitting yesterday?");
    expect(calls).toHaveLength(1);
    expect(r).toMatchObject({
      paragraphs: [],
      none: NOTHING_FOUND,
      searches: ["quantum knitting (2026-10-26 to …)"],
      stories: 0,
      cents: 0.2,
    });
  });
});
