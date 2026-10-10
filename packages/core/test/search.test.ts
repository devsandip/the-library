import { describe, expect, it } from "vitest";
import {
  fuse,
  highlightRuns,
  issueDoc,
  matchWeight,
  MEANING_FLOOR,
  queryTerms,
  rankByMeaning,
  rankByWords,
  searchIssues,
  searchWords,
  stem,
  storyDoc,
} from "../src/search.js";

describe("stem", () => {
  // From Porter's paper and his sample vocabulary.
  it.each([
    ["caresses", "caress"],
    ["ponies", "poni"],
    ["cats", "cat"],
    ["feed", "feed"],
    ["agreed", "agre"],
    ["plastered", "plaster"],
    ["motoring", "motor"],
    ["sing", "sing"],
    ["conflated", "conflat"],
    ["sized", "size"],
    ["hopping", "hop"],
    ["falling", "fall"],
    ["hissing", "hiss"],
    ["filing", "file"],
    ["happy", "happi"],
    ["sky", "sky"],
    ["relational", "relat"],
    ["conditional", "condit"],
    ["digitizer", "digit"],
    ["vietnamization", "vietnam"],
    ["predication", "predic"],
    ["operator", "oper"],
    ["decisiveness", "decis"],
    ["hopefulness", "hope"],
    ["sensibiliti", "sensibl"],
    ["triplicate", "triplic"],
    ["formative", "form"],
    ["electrical", "electr"],
    ["goodness", "good"],
    ["allowance", "allow"],
    ["airliner", "airlin"],
    ["adjustable", "adjust"],
    ["replacement", "replac"],
    ["adoption", "adopt"],
    ["homologous", "homolog"],
    ["effective", "effect"],
    ["probate", "probat"],
    ["rate", "rate"],
    ["cease", "ceas"],
    ["controll", "control"],
    ["roll", "roll"],
  ])("%s is %s", (word, stemmed) => {
    expect(stem(word)).toBe(stemmed);
  });

  it("makes one word of a word's forms, and leaves other words alone", () => {
    expect(new Set(["limit", "limits", "limiting", "limiter"].map(stem))).toEqual(
      new Set(["limit"]),
    );
    expect(stem("manager")).toBe(stem("management"));
    expect(["ai", "gpt5", "über"].map(stem)).toEqual(["ai", "gpt5", "über"]);
  });
});

describe("words and terms", () => {
  it("lowercases, drops accents, stems, and splits on anything but letters and digits", () => {
    expect(searchWords("Café's Rates: Next.js 16 & LLMs")).toEqual([
      "cafe",
      "s",
      "rate",
      "next",
      "js",
      "16",
      "llm",
    ]);
    expect(searchWords("Rate limiting")).toEqual(searchWords("rate limits"));
  });

  it("drops words that match nearly everything, single letters and repeats", () => {
    expect(queryTerms("How did the Fed cut a rate, and the rates?")).toEqual([
      "fed",
      "cut",
      "rate",
    ]);
    expect(queryTerms("this is it")).toEqual([]);
    expect(queryTerms("one two three four five six seven eight nine ten")).toHaveLength(8);
  });

  it("matches the word itself, or a longer word once the term has three letters", () => {
    expect(matchWeight("rate", "rate")).toBe(1);
    expect(matchWeight("agent", "agentic")).toBeGreaterThan(0);
    expect(matchWeight("agent", "agentic")).toBeLessThan(1);
    expect(matchWeight("ai", "aid")).toBe(0);
    expect(matchWeight("rate", "pirate")).toBe(0);
  });
});

const issue = (id: string, subject: string, summary = "", publication = "TLDR AI") =>
  issueDoc({ id, subject, publication, summary });
const story = (id: string, n: number, headline: string, summary = "", names: string[] = []) =>
  storyDoc({ id, n, headline, summary, names }, "TLDR AI");

describe("rankByWords", () => {
  const docs = [
    issue("digest", "Agents ship, chips sell out, Kafka goes diskless", "Three things today."),
    story("digest", 1, "OpenAI ships agents that book travel", "", ["OpenAI"]),
    story("digest", 2, "Diskless Kafka moves storage to object stores", "", ["Kafka"]),
    issue("essay", "Why rate limits matter", "An essay on rate limiting.", "ByteByteGo"),
    issue("other", "Nothing to see here", "Gardening and cakes.", "The Atlantic"),
  ];

  it("needs every term in one document, and names the story that matched", () => {
    expect(rankByWords(queryTerms("diskless kafka"), docs)).toEqual([
      { issueId: "digest", score: expect.any(Number), story: 2 },
    ]);
    // "agents" is in the subject and story 1, "kafka" only in story 2: no single story has both,
    // but the subject does.
    const both = rankByWords(queryTerms("agents kafka"), docs);
    expect(both.map((m) => m.issueId)).toEqual(["digest"]);
    expect(both[0]!.story).toBeUndefined();
    expect(rankByWords(queryTerms("kafka cakes"), docs)).toEqual([]);
  });

  it("finds a newsletter's stories by its name", () => {
    expect(rankByWords(queryTerms("tldr travel"), docs)[0]).toMatchObject({
      issueId: "digest",
      story: 1,
    });
  });

  it("ranks a subject match over a mention deep in a summary, and plurals as the word", () => {
    const more = [
      ...docs,
      issue("mention", "Weekly links", "Also: a short note on rate limits.", "Medium"),
    ];
    expect(rankByWords(queryTerms("rate limit"), more).map((m) => m.issueId)).toEqual([
      "essay",
      "mention",
    ]);
  });

  it("with three terms or more, takes all but one, marked partial, after those with every term", () => {
    const more = [
      ...docs,
      issue("all3", "Kafka storage for agents", "", "Medium"),
      issue("two", "Kafka storage costs", "", "Medium"),
    ];
    const found = rankByWords(queryTerms("kafka storage agents"), more);
    expect(found[0]).toEqual({ issueId: "all3", score: expect.any(Number) });
    expect(found.slice(1).every((m) => m.partial)).toBe(true);
    expect(found.map((m) => m.issueId)).toContain("two");
    // Two terms: both, always.
    expect(rankByWords(queryTerms("kafka costs"), more).map((m) => m.issueId)).toEqual(["two"]);
  });

  it("ranks terms side by side over the same terms apart", () => {
    const pair = [
      issue("apart", "Rates rise again", "Markets limit their bets.", "WSJ"),
      issue("phrase", "Design an API gateway", "Rate limiting, auth and routing.", "System Design"),
    ];
    expect(rankByWords(queryTerms("rate limiting"), pair).map((m) => m.issueId)).toEqual([
      "phrase",
      "apart",
    ]);
  });

  it("returns nothing for no terms", () => {
    expect(rankByWords([], docs)).toEqual([]);
  });
});

describe("rankByMeaning", () => {
  const unit = (...xs: number[]) => {
    const n = Math.hypot(...xs);
    return Float32Array.from(xs.map((x) => x / n));
  };
  const query = unit(1, 0, 0);
  const stories = [
    { issueId: "a", n: 1, vector: unit(1, 0.2, 0) },
    { issueId: "a", n: 2, vector: unit(1, 1, 0) },
    { issueId: "b", n: 1, vector: unit(1, 2, 0) },
    { issueId: "c", n: 1, vector: unit(0, 1, 0) },
  ];

  it("keeps stories at the floor or above, each issue at its closest story", () => {
    const found = rankByMeaning(query, stories);
    expect(found.map((m) => [m.issueId, m.story])).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
    expect(found.every((m) => m.score >= MEANING_FLOOR)).toBe(true);
    expect(rankByMeaning(query, stories, 0.95)).toEqual([
      { issueId: "a", score: expect.any(Number), story: 1 },
    ]);
  });
});

describe("fuse", () => {
  it("puts an issue found both ways first, and keeps the story its words found", () => {
    const fused = fuse(
      [
        { issueId: "w1", score: 9 },
        { issueId: "both", score: 5, story: 2 },
      ],
      [
        { issueId: "m1", score: 0.6, story: 4 },
        { issueId: "both", score: 0.5, story: 3 },
      ],
    );
    expect(fused.map((f) => [f.issueId, f.match, f.story])).toEqual([
      ["both", "both", 2],
      ["w1", "words", undefined],
      ["m1", "meaning", 4],
    ]);
  });

  it("lists what holds the words before what is only close in meaning", () => {
    // m1 tops the meaning list, so fused in it would tie with w2; it goes after the words.
    const fused = fuse(
      [
        { issueId: "w1", score: 9 },
        { issueId: "w2", score: 8 },
      ],
      [{ issueId: "m1", score: 0.6, story: 1 }],
    );
    expect(fused.map((f) => f.issueId)).toEqual(["w1", "w2", "m1"]);
  });

  it("takes the story from meaning when the words matched the issue itself", () => {
    const [f] = fuse([{ issueId: "x", score: 1 }], [{ issueId: "x", score: 0.4, story: 3 }]);
    expect(f).toMatchObject({ match: "both", story: 3 });
  });
});

describe("searchIssues", () => {
  const corpus = {
    docs: [
      issue("full", "Kafka storage for agents"),
      issue("near", "Kafka storage costs"),
      issue("far", "Kafka storage pricing"),
    ],
    stories: [
      { issueId: "near", n: 1, vector: Float32Array.from([0.25, Math.sqrt(1 - 0.0625)]) },
      { issueId: "far", n: 1, vector: Float32Array.from([0.1, Math.sqrt(1 - 0.01)]) },
    ],
  };
  const terms = queryTerms("kafka storage agents");

  it("keeps an issue missing a term only when it is at least loosely close in meaning", () => {
    const found = searchIssues(terms, [1, 0], corpus);
    expect(found.map((f) => [f.issueId, f.match])).toEqual([
      ["full", "words"],
      ["near", "words"],
    ]);
  });

  it("without the query's embedding, keeps only issues with every term", () => {
    expect(searchIssues(terms, undefined, corpus).map((f) => f.issueId)).toEqual(["full"]);
  });
});

describe("highlightRuns", () => {
  it("marks the words a term matches and keeps everything else as it was", () => {
    expect(highlightRuns("Fed raises rates; ratelimits (not pirates)", ["rate", "fed"])).toEqual([
      { text: "Fed", hit: true },
      { text: " raises ", hit: false },
      { text: "rates", hit: true },
      { text: "; ", hit: false },
      { text: "ratelimits", hit: true },
      { text: " (not pirates)", hit: false },
    ]);
    expect(highlightRuns("Café", ["cafe"])).toEqual([{ text: "Café", hit: true }]);
    expect(highlightRuns("No terms", [])).toEqual([{ text: "No terms", hit: false }]);
  });
});
