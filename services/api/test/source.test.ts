import { describe, expect, it, vi } from "vitest";
import type { SourceCheck } from "@library/core/types";
import type { ClaudePort, ToolRequest } from "../src/claude.js";
import { HttpError } from "../src/errors.js";
import { PageError, type Page } from "../src/page.js";
import {
  NO_LINK,
  pageText,
  parseSource,
  passage,
  sourceRequest,
  Sources,
  UNREADABLE,
  type SourceStore,
  type SourceStory,
  type StoredSource,
} from "../src/source.js";

const story: SourceStory = {
  issueId: "tldr",
  n: 2,
  publication: "TLDR AI",
  headline: "Anthropic's revenue tripled",
  summary: "Anthropic's revenue tripled in a year to $5 billion, its filing shows.",
  names: ["Anthropic"],
  link: "https://example.com/filing",
  text: "Intro.\n\nRates rose again.\n\nAnthropic's revenue tripled in a year, its IPO filing shows.\n\nChips sold out.",
};

const article =
  "Anthropic filed to go public on Monday. The filing shows revenue grew to $4.8 billion last " +
  "year, up from $1.6 billion. The company plans to list in the spring. ".repeat(3);

describe("passage", () => {
  it("is the whole text when it is short", () => {
    expect(passage("Short text.", story)).toBe("Short text.");
  });

  it("is the digest's paragraph about the story, with its neighbours", () => {
    const long = [
      "Intro paragraph.",
      ...Array.from({ length: 120 }, (_, k) => `Unrelated item ${k} about chips and rates.`),
      "Anthropic revenue tripled, the filing shows.",
      "Next item.",
      ...Array.from({ length: 120 }, (_, k) => `More unrelated ${k}.`),
    ].join("\n\n");
    const p = passage(long, story);
    expect(p).toContain("Anthropic revenue tripled");
    expect(p).toContain("Next item.");
    expect(p).not.toContain("Intro paragraph.");
  });
});

describe("pageText", () => {
  it("turns HTML into text and leaves plain text alone", () => {
    const html: Page = {
      url: "https://x.test",
      contentType: "text/html",
      body: "<html><body><h1>Title</h1><p>The body.</p><script>x()</script></body></html>",
    };
    expect(pageText(html)).toContain("The body.");
    expect(pageText(html)).not.toContain("x()");
    expect(pageText({ ...html, contentType: "text/plain", body: "Plain." })).toBe("Plain.");
  });
});

describe("sourceRequest", () => {
  it("sends the story, the newsletter's passage and the page", () => {
    const req = sourceRequest(story, article, "https://example.com/filing");
    expect(req.tool.name).toBe("check_source");
    expect(req.user).toContain("Headline: Anthropic's revenue tripled");
    expect(req.user).toContain("Anthropic's revenue tripled in a year, its IPO filing shows.");
    expect(req.user).toContain("The page (https://example.com/filing):");
    expect(req.system).toContain("copied exactly");
  });
});

describe("parseSource", () => {
  it("keeps a quote only when the page holds it, whatever its spacing and case", () => {
    const c = parseSource(
      {
        readable: true,
        verdict: "further",
        claims: [
          {
            claim: "Revenue tripled — to $5 billion.",
            source: "Revenue grew to $4.8 billion, up from $1.6 billion.",
            quote: "“the filing shows revenue grew to   $4.8 billion”",
            verdict: "further",
          },
          {
            claim: "It plans to list in spring.",
            source: "The company plans to list in the spring.",
            quote: "plans to list next week",
            verdict: "holds",
          },
          { claim: "Bad.", source: "Bad.", verdict: "maybe" },
        ],
        note: "The page is the company's filing.",
      },
      article,
    );
    expect(c).toEqual({
      verdict: "further",
      claims: [
        {
          claim: "Revenue tripled, to $5 billion.",
          source: "Revenue grew to $4.8 billion, up from $1.6 billion.",
          quote: "the filing shows revenue grew to $4.8 billion",
          verdict: "further",
        },
        {
          claim: "It plans to list in spring.",
          source: "The company plans to list in the spring.",
          verdict: "holds",
        },
      ],
      note: "The page is the company's filing.",
    });
  });

  it("works out the overall verdict when Claude gives none", () => {
    const claim = (verdict: string) => ({ claim: "C.", source: "S.", verdict });
    expect(
      parseSource({ readable: true, claims: [claim("holds"), claim("holds")] }, ""),
    ).toMatchObject({ verdict: "holds" });
    expect(
      parseSource({ readable: true, claims: [claim("holds"), claim("missing")] }, ""),
    ).toMatchObject({ verdict: "mixed" });
  });

  it("is nothing when the page is not an article, or no claim is left", () => {
    expect(
      parseSource({ readable: false, claims: [], verdict: "missing" }, article),
    ).toBeUndefined();
    expect(parseSource({ readable: true, claims: [{ claim: "" }] }, article)).toBeUndefined();
  });
});

describe("Sources", () => {
  function setup(opts: { story?: SourceStory | undefined; page?: Page | Error; answer?: unknown }) {
    const kept = new Map<string, SourceCheck>();
    const store: SourceStore = {
      sourceStory: vi.fn(async () => ("story" in opts ? opts.story : story)),
      getSource: vi.fn(async (id: string, n: number) => kept.get(`${id}#${n}`)),
      putSource: vi.fn(
        async (id: string, n: number, c: StoredSource) => void kept.set(`${id}#${n}`, c),
      ),
    };
    const calls: ToolRequest[] = [];
    const claude: ClaudePort = {
      callTool: vi.fn(async (req: ToolRequest) => {
        calls.push(req);
        return { input: opts.answer, inputTokens: 4000, outputTokens: 400 };
      }),
    };
    const read = vi.fn(async (link: string) => {
      const p = opts.page ?? { url: link, contentType: "text/plain", body: article };
      if (p instanceof Error) throw p;
      return p;
    });
    const sources = new Sources(store, claude, read, () => Date.parse("2026-10-27T10:00:00.000Z"));
    return { sources, store, calls, read };
  }

  it("reads the page, checks the claims, keeps the check and serves it back", async () => {
    const { sources, store, calls } = setup({
      answer: {
        readable: true,
        verdict: "holds",
        claims: [
          {
            claim: "It plans to list in the spring.",
            source: "It plans to list in the spring.",
            quote: "The company plans to list in the spring.",
            verdict: "holds",
          },
        ],
      },
    });
    expect(await sources.get("tldr", 2)).toEqual({});
    const r = await sources.run("tldr", 2);
    expect(calls).toHaveLength(1);
    expect(r.check).toMatchObject({
      url: "https://example.com/filing",
      verdict: "holds",
      claims: [{ quote: "The company plans to list in the spring." }],
      cents: 0.6,
    });
    expect(store.putSource).toHaveBeenCalledWith(
      "tldr",
      2,
      expect.objectContaining({ inputTokens: 4000 }),
    );
    expect((await sources.get("tldr", 2)).check?.verdict).toBe("holds");
  });

  it("says why when there is no link or the page cannot be read, without a call", async () => {
    const noLink = setup({ story: { ...story, link: undefined } });
    expect(await noLink.sources.run("tldr", 2)).toEqual({ none: NO_LINK });
    expect(noLink.read).not.toHaveBeenCalled();

    const blocked = setup({ page: new PageError("the address is not a public one") });
    expect(await blocked.sources.run("tldr", 2)).toEqual({
      none: "The source could not be read: the address is not a public one.",
    });
    expect(blocked.calls).toHaveLength(0);

    const thin = setup({
      page: { url: "https://x.test", contentType: "text/plain", body: "Subscribe." },
    });
    expect(await thin.sources.run("tldr", 2)).toEqual({ none: UNREADABLE });
  });

  it("keeps nothing when Claude says the page is not the article", async () => {
    const { sources, store } = setup({
      answer: { readable: false, claims: [], verdict: "missing" },
    });
    expect(await sources.run("tldr", 2)).toEqual({ none: UNREADABLE });
    expect(store.putSource).not.toHaveBeenCalled();
  });

  it("404s a story the issue does not have", async () => {
    const { sources } = setup({ story: undefined });
    await expect(sources.get("tldr", 9)).rejects.toBeInstanceOf(HttpError);
  });
});
