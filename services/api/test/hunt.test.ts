import { describe, expect, it, vi } from "vitest";
import type { ClaudePort, ToolRequest } from "../src/claude.js";
import {
  findRequest,
  hunt,
  HUNT_BUDGET_MS,
  MAX_PAGES,
  numberedPage,
  parseFinding,
  siteOf,
  followable,
} from "../src/hunt.js";
import { PageError, type Page } from "../src/page.js";
import type { SourceStory } from "../src/source.js";

const story: SourceStory & { link: string } = {
  issueId: "tldr",
  n: 2,
  publication: "TLDR AI",
  headline: "A lab's model beats GPT on maths",
  summary: "A new paper says the lab's model solves 80% of olympiad problems.",
  names: ["Lab"],
  link: "https://news.test/story",
};

const filler = " Background on the field, the people involved and what came before.".repeat(6);

/** A page of HTML whose links are `hrefs`, each with its text. */
const html = (url: string, links: [string, string][] = []): Page => ({
  url,
  contentType: "text/html",
  body: `<html><body><p>${filler}</p>${links
    .map(([href, text]) => `<p>See <a href="${href}">${text}</a>.</p>`)
    .join("")}<p>${filler}</p></body></html>`,
});

/** Claude answering each page by its address. */
function claudeBy(answers: Record<string, unknown>) {
  const calls: ToolRequest[] = [];
  const claude: ClaudePort = {
    callTool: vi.fn(async (req: ToolRequest) => {
      calls.push(req);
      const url = /The page \((.+?)\):/.exec(req.user)![1]!;
      return {
        input: answers[url] ?? { readable: true, original: false, next: [] },
        inputTokens: 3000,
        outputTokens: 100,
      };
    }),
  };
  return { claude, calls };
}

function reader(pages: Record<string, Page | Error>) {
  return vi.fn(async (link: string) => {
    const p = pages[link];
    if (!p) throw new PageError("the page answered 404");
    if (p instanceof Error) throw p;
    return p;
  });
}

describe("numberedPage", () => {
  it("numbers a page's links, relative ones made whole, and leaves plain text alone", () => {
    const p = numberedPage(
      html("https://news.test/a/story", [
        ["/paper", "the paper"],
        ["https://lab.test/post", "the post"],
      ]),
    );
    expect(p.links).toEqual(["https://news.test/paper", "https://lab.test/post"]);
    expect(p.text).toContain("the paper [1 news.test]");
    expect(
      numberedPage({ url: "https://x.test", contentType: "text/plain", body: " Plain. " }),
    ).toEqual({ url: "https://x.test", text: "Plain.", links: [] });
  });
});

describe("siteOf", () => {
  it("is a host's last two names, or three under a shared suffix", () => {
    expect(siteOf("https://newsletter.pragmaticengineer.com/p/x")).toBe("pragmaticengineer.com");
    expect(siteOf("https://www.fortune.com/2026/10/28/x")).toBe("fortune.com");
    expect(siteOf("https://www.bbc.co.uk/news/x")).toBe("bbc.co.uk");
    expect(siteOf("https://apple.github.io/x")).toBe("apple.github.io");
    expect(siteOf("https://lenny.substack.com/p/x")).toBe("lenny.substack.com");
  });
});

describe("followable", () => {
  it("is a link to a site not read yet that can be a source", () => {
    const read = new Set(["fortune.com"]);
    expect(followable("https://lab.test/post", read)).toBe(true);
    expect(followable("https://www.fortune.com/other", read)).toBe(false);
    expect(followable("https://www.instagram.com/fortune", read)).toBe(false);
    expect(followable("https://fortunecustomerservice.zendesk.com/hc", read)).toBe(false);
    expect(followable("https://apps.apple.com/app/x", read)).toBe(false);
  });
});

describe("findRequest and parseFinding", () => {
  const page = numberedPage(
    html("https://news.test/story", [["https://arxiv.test/abs/1", "the paper"]]),
  );

  it("sends the story and the page with numbered links, never addresses to choose from", () => {
    const req = findRequest(story, "The passage.", page);
    expect(req.tool.name).toBe("find_original");
    expect(req.user).toContain("Headline: A lab's model beats GPT on maths");
    // Each link's host, to judge it by; never its address, to choose it by.
    expect(req.user).toContain("the paper [1 arxiv.test]");
    expect(req.user).not.toContain("https://arxiv.test/abs/1");
  });

  it("turns link numbers back into the page's own links and drops any it does not have", () => {
    expect(
      parseFinding(
        {
          readable: true,
          original: false,
          next: [
            { link: 1, what: "the paper" },
            { link: 7, what: "made up" },
            { link: "x", what: "?" },
          ],
        },
        page,
      ),
    ).toEqual({
      readable: true,
      original: false,
      next: [{ url: "https://arxiv.test/abs/1", what: "the paper" }],
    });
  });

  it("follows nothing from the original or from a page that is not an article", () => {
    expect(
      parseFinding(
        {
          readable: true,
          original: true,
          what: "the paper on arXiv",
          next: [{ link: 1, what: "x" }],
        },
        page,
      ),
    ).toEqual({ readable: true, original: true, what: "the paper on arXiv", next: [] });
    expect(
      parseFinding({ readable: false, original: true, next: [{ link: 1, what: "x" }] }, page),
    ).toEqual({ readable: false, original: false, next: [] });
  });
});

describe("hunt", () => {
  const now = () => 0;

  it("follows a news report to the original in two steps", async () => {
    const read = reader({
      "https://news.test/story": html("https://news.test/story", [
        ["https://wire.test/report", "a report"],
      ]),
      "https://wire.test/report": html("https://wire.test/report", [
        ["https://arxiv.test/abs/1", "the paper"],
      ]),
      "https://arxiv.test/abs/1": html("https://arxiv.test/abs/1"),
    });
    const { claude } = claudeBy({
      "https://news.test/story": {
        readable: true,
        original: false,
        next: [{ link: 1, what: "a wire report" }],
      },
      "https://wire.test/report": {
        readable: true,
        original: false,
        next: [{ link: 1, what: "the paper" }],
      },
      "https://arxiv.test/abs/1": {
        readable: true,
        original: true,
        what: "the paper on arXiv",
        next: [],
      },
    });
    const progress = vi.fn(async () => {});
    const h = await hunt(story, undefined, { read, claude, now, progress });
    expect(h.original).toBe(true);
    expect(h.page?.url).toBe("https://arxiv.test/abs/1");
    expect(h.path).toEqual([
      { url: "https://news.test/story" },
      { url: "https://wire.test/report", why: "a wire report" },
      { url: "https://arxiv.test/abs/1", why: "the paper", what: "the paper on arXiv" },
    ]);
    expect(h.calls).toHaveLength(3);
    expect(progress).toHaveBeenCalledWith(
      [{ url: "https://news.test/story" }],
      "https://wire.test/report",
    );
  });

  it("takes the story's own page as the original when it is", async () => {
    const read = reader({ "https://news.test/story": html("https://news.test/story") });
    const { claude } = claudeBy({
      "https://news.test/story": {
        readable: true,
        original: true,
        what: "the lab's own post",
        next: [],
      },
    });
    const h = await hunt(story, undefined, { read, claude, now });
    expect(h).toMatchObject({
      original: true,
      path: [{ url: "https://news.test/story", what: "the lab's own post" }],
    });
  });

  it("reads one page per site, and never offers a link within a site already read", async () => {
    const read = reader({
      "https://news.test/story": html("https://news.test/story", [
        ["https://news.test/other", "another story"],
        ["https://docs.lab.test/a", "the docs"],
        ["https://lab.test/b", "the post"],
      ]),
      "https://docs.lab.test/a": html("https://docs.lab.test/a", [
        ["https://lab.test/c", "more docs"],
      ]),
    });
    const { claude, calls } = claudeBy({
      "https://news.test/story": {
        readable: true,
        original: false,
        next: [
          { link: 1, what: "the docs" },
          { link: 2, what: "the post" },
        ],
      },
    });
    const h = await hunt(story, undefined, { read, claude, now });
    // The story's own site is never numbered; lab.test is read once, as docs.lab.test.
    expect(calls[0]!.user).not.toContain("another story [");
    expect(calls[0]!.user).toContain("the docs [1 docs.lab.test]");
    expect(calls[1]!.user).not.toContain("more docs [");
    expect(h.path.map((p) => p.url)).toEqual([
      "https://news.test/story",
      "https://docs.lab.test/a",
    ]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(h.original).toBe(false);
  });

  it("passes over a dead link for the next, and never reads a page twice", async () => {
    const read = reader({
      "https://news.test/story": html("https://news.test/story", [
        ["https://gone.test/x", "the post"],
        ["https://news.test/story#top", "top"],
        ["https://lab.test/post", "the lab"],
      ]),
      "https://lab.test/post": html("https://lab.test/post"),
    });
    const { claude } = claudeBy({
      "https://news.test/story": {
        readable: true,
        original: false,
        next: [
          { link: 1, what: "the post" },
          { link: 2, what: "itself" },
          { link: 3, what: "the lab's post" },
        ],
      },
      "https://lab.test/post": { readable: true, original: true, what: "the lab's post", next: [] },
    });
    const h = await hunt(story, undefined, { read, claude, now });
    expect(h.path.map((p) => [p.url, p.failed])).toEqual([
      ["https://news.test/story", undefined],
      ["https://gone.test/x", "the page answered 404"],
      ["https://lab.test/post", undefined],
    ]);
    expect(read).toHaveBeenCalledTimes(3);
    expect(h.original).toBe(true);
  });

  it("stops at five pages and checks the story's own page when no original was found", async () => {
    const pages: Record<string, Page> = {};
    const answers: Record<string, unknown> = {};
    for (let k = 0; k < 8; k++) {
      const url = k === 0 ? story.link : `https://hop${k}.test/`;
      pages[url] = html(url, [[`https://hop${k + 1}.test/`, "more"]]);
      answers[url] = { readable: true, original: false, next: [{ link: 1, what: `hop ${k + 1}` }] };
    }
    const { claude } = claudeBy(answers);
    const h = await hunt(story, undefined, { read: reader(pages), claude, now });
    expect(h.path).toHaveLength(MAX_PAGES);
    expect(h.original).toBe(false);
    expect(h.page?.url).toBe(story.link);
  });

  it("starts no page once its time is up", async () => {
    let t = 0;
    const read = reader({
      "https://news.test/story": html("https://news.test/story", [
        ["https://lab.test/post", "the lab"],
      ]),
    });
    const { claude } = claudeBy({
      "https://news.test/story": {
        readable: true,
        original: false,
        next: [{ link: 1, what: "the lab" }],
      },
    });
    const h = await hunt(story, undefined, {
      read: vi.fn(async (l: string) => {
        t += HUNT_BUDGET_MS;
        return read(l);
      }),
      claude,
      now: () => t,
    });
    expect(h.path).toHaveLength(1);
  });

  it("says why when the story's own page cannot be read", async () => {
    const { claude, calls } = claudeBy({});
    const h = await hunt(story, undefined, {
      read: reader({ "https://news.test/story": new PageError("the page answered 403") }),
      claude,
      now,
    });
    expect(h).toMatchObject({ original: false, failed: "the page answered 403" });
    expect(h.page).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
