import { describe, expect, it, vi } from "vitest";
import type { SourceCheck, SourceHop } from "@library/core/types";
import type { ClaudePort, ToolRequest } from "../src/claude.js";
import { HttpError } from "../src/errors.js";
import { PageError, type Page } from "../src/page.js";
import {
  NO_LINK,
  pageText,
  parseSource,
  passage,
  RUN_LIMIT_MS,
  SourceChecker,
  sourceRequest,
  Sources,
  STOPPED,
  UNREADABLE,
  type SourceRunItem,
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

/** A store in memory, with the run beside the check as DynamoRepo keeps them. */
function memoryStore(story: SourceStory | undefined) {
  const kept = new Map<string, SourceCheck>();
  const runs = new Map<string, SourceRunItem>();
  const store: SourceStore = {
    sourceStory: vi.fn(async () => story),
    getSource: vi.fn(async (id: string, n: number) => {
      const check = kept.get(`${id}#${n}`);
      const run = runs.get(`${id}#${n}`);
      return { ...(check ? { check } : {}), ...(run ? { run } : {}) };
    }),
    startRun: vi.fn(async (id: string, n: number, since: string, staleBefore: string) => {
      const run = runs.get(`${id}#${n}`);
      if (run?.status === "running" && run.since > staleBefore) return false;
      runs.set(`${id}#${n}`, { status: "running", since });
      return true;
    }),
    progressRun: vi.fn(async (id: string, n: number, pages: SourceHop[], reading?: string) => {
      const run = runs.get(`${id}#${n}`)!;
      runs.set(`${id}#${n}`, {
        status: run.status,
        since: run.since,
        pages,
        ...(reading ? { reading } : {}),
      });
    }),
    endRun: vi.fn(async (id: string, n: number, none?: string) => {
      const run = runs.get(`${id}#${n}`)!;
      runs.set(`${id}#${n}`, {
        since: run.since,
        ...(none ? { status: "none", none } : { status: "failed" }),
      });
    }),
    putSource: vi.fn(async (id: string, n: number, c: StoredSource) => {
      kept.set(`${id}#${n}`, c);
      runs.delete(`${id}#${n}`);
    }),
  };
  return { store, kept, runs };
}

const T0 = Date.parse("2026-10-27T10:00:00.000Z");

describe("Sources", () => {
  function setup(opts: { story?: SourceStory | undefined; startJob?: () => Promise<void> } = {}) {
    const mem = memoryStore("story" in opts ? opts.story : story);
    let now = T0;
    const startJob = vi.fn(opts.startJob ?? (async () => {}));
    const sources = new Sources(mem.store, startJob, () => now);
    return { ...mem, sources, startJob, later: (ms: number) => void (now += ms) };
  }

  it("starts a check in the background and says it is running until it is kept", async () => {
    const { sources, store, startJob, later } = setup();
    expect(await sources.get("tldr", 2)).toEqual({});
    const since = "2026-10-27T10:00:00.000Z";
    expect(await sources.run("tldr", 2)).toEqual({ running: { since } });
    expect(startJob).toHaveBeenCalledWith({ kind: "source", id: "tldr", n: 2 });
    // The API never reads the issue's text: the job does.
    expect(store.sourceStory).toHaveBeenCalledWith("tldr", 2, { text: false });
    later(5_000);
    expect(await sources.get("tldr", 2)).toEqual({ running: { since } });
    // Asking again while it runs answers the running one.
    expect(await sources.run("tldr", 2)).toEqual({ running: { since } });
    expect(startJob).toHaveBeenCalledTimes(1);

    const check = { url: "https://example.com/filing", verdict: "holds", claims: [] } as const;
    await store.putSource("tldr", 2, {
      ...check,
      claims: [],
      at: since,
      ms: 4000,
      cents: 0.6,
      model: "m",
      inputTokens: 1,
      outputTokens: 1,
    });
    expect((await sources.get("tldr", 2)).check?.url).toBe("https://example.com/filing");
  });

  it("says why the latest run kept nothing, and calls one that never finished stopped", async () => {
    const { sources, store, later } = setup();
    await sources.run("tldr", 2);
    await store.endRun("tldr", 2, "The source could not be read: the page answered 403.");
    expect(await sources.get("tldr", 2)).toEqual({
      none: "The source could not be read: the page answered 403.",
    });

    await sources.run("tldr", 2);
    await store.endRun("tldr", 2);
    expect(await sources.get("tldr", 2)).toEqual({ none: STOPPED });

    await sources.run("tldr", 2);
    later(RUN_LIMIT_MS);
    expect(await sources.get("tldr", 2)).toEqual({ none: STOPPED });
    // A stopped run can be started again.
    expect((await sources.run("tldr", 2)).running).toBeDefined();
  });

  it("answers at once when there is no link, and ends the run when the job cannot start", async () => {
    const noLink = setup({ story: { ...story, link: undefined } });
    expect(await noLink.sources.run("tldr", 2)).toEqual({ none: NO_LINK });
    expect(noLink.startJob).not.toHaveBeenCalled();

    const down = setup({
      startJob: async () => {
        throw new Error("lambda down");
      },
    });
    await expect(down.sources.run("tldr", 2)).rejects.toThrow("lambda down");
    expect(await down.sources.get("tldr", 2)).toEqual({ none: STOPPED });
  });

  it("404s a story the issue does not have", async () => {
    const { sources } = setup({ story: undefined });
    await expect(sources.get("tldr", 9)).rejects.toBeInstanceOf(HttpError);
    await expect(sources.run("tldr", 9)).rejects.toBeInstanceOf(HttpError);
  });
});

describe("SourceChecker", () => {
  function setup(opts: {
    story?: SourceStory | undefined;
    page?: Page | Error;
    pages?: Record<string, Page>;
    /** The hunt's answer for each page by address; the story's own page is the original. */
    find?: Record<string, unknown>;
    answer?: unknown;
  }) {
    const mem = memoryStore("story" in opts ? opts.story : story);
    // The API marked the run started.
    mem.runs.set("tldr#2", { status: "running", since: "2026-10-27T09:59:59.000Z" });
    const calls: ToolRequest[] = [];
    const claude: ClaudePort = {
      callTool: vi.fn(async (req: ToolRequest) => {
        calls.push(req);
        const url = /The page \((.+?)\):/.exec(req.user)?.[1] ?? "";
        const input =
          req.tool.name === "find_original"
            ? (opts.find?.[url] ?? { readable: true, original: true, what: "the filing", next: [] })
            : opts.answer;
        return { input, inputTokens: 4000, outputTokens: 400 };
      }),
    };
    const read = vi.fn(async (link: string) => {
      const p = opts.pages?.[link] ??
        opts.page ?? {
          url: link,
          contentType: "text/plain",
          body: article,
        };
      if (p instanceof Error) throw p;
      return p;
    });
    const checker = new SourceChecker(mem.store, claude, read, () => T0);
    const sources = new Sources(
      mem.store,
      async () => {},
      () => T0,
    );
    return { ...mem, checker, sources, calls, read };
  }

  it("reads the page, checks the claims, keeps the check and ends the run", async () => {
    const { checker, sources, store, calls, runs } = setup({
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
    const r = await checker.check("tldr", 2);
    expect(calls.map((c) => c.tool.name)).toEqual(["find_original", "check_source"]);
    expect(r.check).toMatchObject({
      url: "https://example.com/filing",
      original: true,
      path: [{ url: "https://example.com/filing", what: "the filing" }],
      verdict: "holds",
      claims: [{ quote: "The company plans to list in the spring." }],
      // Both calls: 8,000 tokens in and 800 out.
      cents: 1.2,
    });
    expect(store.sourceStory).toHaveBeenCalledWith("tldr", 2);
    expect(store.putSource).toHaveBeenCalledWith(
      "tldr",
      2,
      expect.objectContaining({ inputTokens: 8000, outputTokens: 800 }),
    );
    expect(runs.size).toBe(0);
    expect((await sources.get("tldr", 2)).check?.verdict).toBe("holds");
  });

  it("ends the run with why when there is no link or the page cannot be read, without a call", async () => {
    const noLink = setup({ story: { ...story, link: undefined } });
    expect(await noLink.checker.check("tldr", 2)).toEqual({ none: NO_LINK });
    expect(noLink.read).not.toHaveBeenCalled();
    expect(await noLink.sources.get("tldr", 2)).toEqual({ none: NO_LINK });

    const blocked = setup({ page: new PageError("the address is not a public one") });
    const none = "The source could not be read: the address is not a public one.";
    expect(await blocked.checker.check("tldr", 2)).toEqual({ none });
    expect(blocked.calls).toHaveLength(0);
    expect(await blocked.sources.get("tldr", 2)).toEqual({ none });

    const thin = setup({
      page: { url: "https://x.test", contentType: "text/plain", body: "Subscribe." },
    });
    expect(await thin.checker.check("tldr", 2)).toEqual({ none: UNREADABLE });
  });

  it("keeps nothing when Claude says the page is not the article", async () => {
    const { checker, store } = setup({
      answer: { readable: false, claims: [], verdict: "missing" },
    });
    expect(await checker.check("tldr", 2)).toEqual({ none: UNREADABLE });
    expect(store.putSource).not.toHaveBeenCalled();
  });

  it("follows the story's page to the original, checks that, and shows the pages while running", async () => {
    const report: Page = {
      url: "https://example.com/filing",
      contentType: "text/html",
      body: `<p>${article}</p><p>Read <a href="https://sec.test/s1">the S-1 filing</a>.</p>`,
    };
    const { checker, sources, calls, store } = setup({
      pages: { "https://example.com/filing": report },
      find: {
        "https://example.com/filing": {
          readable: true,
          original: false,
          next: [{ link: 1, what: "the S-1" }],
        },
        "https://sec.test/s1": { readable: true, original: true, what: "the filing", next: [] },
      },
      answer: {
        readable: true,
        verdict: "further",
        claims: [{ claim: "Revenue tripled.", source: "It grew threefold.", verdict: "further" }],
      },
    });
    vi.mocked(store.progressRun).mockImplementationOnce(async (id, n, pages, reading) => {
      // GET while the first page is read.
      expect({ pages, reading }).toEqual({ pages: [], reading: "https://example.com/filing" });
    });
    const r = await checker.check("tldr", 2);
    expect(r.check).toMatchObject({
      url: "https://sec.test/s1",
      original: true,
      path: [
        { url: "https://example.com/filing" },
        { url: "https://sec.test/s1", why: "the S-1", what: "the filing" },
      ],
    });
    // The check is told the story linked to a report of the original.
    expect(calls.at(-1)!.user).toContain(
      "The story links to https://example.com/filing, which reports it",
    );
    expect(store.progressRun).toHaveBeenCalledWith(
      "tldr",
      2,
      [{ url: "https://example.com/filing" }],
      "https://sec.test/s1",
    );
    expect((await sources.get("tldr", 2)).check?.url).toBe("https://sec.test/s1");
  });

  it("says which pages a running check has read", async () => {
    const { sources, store } = setup({});
    await store.progressRun(
      "tldr",
      2,
      [{ url: "https://example.com/filing" }],
      "https://sec.test/s1",
    );
    expect(await sources.get("tldr", 2)).toEqual({
      running: {
        since: "2026-10-27T09:59:59.000Z",
        pages: [{ url: "https://example.com/filing" }],
        reading: "https://sec.test/s1",
      },
    });
  });

  it("ends the run as failed and throws when something else goes wrong", async () => {
    const { checker, sources } = setup({ page: new Error("socket hang up") });
    await expect(checker.check("tldr", 2)).rejects.toThrow("socket hang up");
    expect(await sources.get("tldr", 2)).toEqual({ none: STOPPED });
  });
});
