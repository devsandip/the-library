import { describe, expect, it } from "vitest";
import {
  askHref,
  followingHref,
  browseHref,
  DEFAULT_QUEUE,
  issueHref,
  parse,
  queueHref,
  readBrowse,
  redirect,
  searchHref,
  slug,
} from "../src/paths.js";

// Tests run with Vite's BASE_URL of "/", so BASE is "" here; in the app it is "/nutgraf".
const query = (href: string) => Object.fromEntries(new URL(href, "https://x.test").searchParams);
const at = (href: string) => {
  const u = new URL(href, "https://x.test");
  return parse(u.pathname, Object.fromEntries(u.searchParams));
};

describe("slug", () => {
  it("turns names into URL words", () => {
    expect(slug("AI & LLMs")).toBe("ai-llms");
    expect(slug("Startups & Business")).toBe("startups-business");
    expect(slug("The Ken")).toBe("the-ken");
    expect(slug("Lenny's Newsletter")).toBe("lenny-s-newsletter");
  });
});

describe("browse filters in the URL", () => {
  it("leaves the defaults out and reads every part back", () => {
    expect(browseHref({ kind: "news", show: "unread", topics: [], senders: [] })).toBe("/browse");
    const href = browseHref({
      kind: "learning",
      show: "archived",
      topics: ["ai-llms", "startups-business"],
      senders: ["the-ken"],
    });
    expect(href).toBe(
      "/browse?kind=learning&show=archived&topic=ai-llms,startups-business&sender=the-ken",
    );
    expect(readBrowse(query(href))).toEqual({
      kind: "learning",
      show: "archived",
      topics: ["ai-llms", "startups-business"],
      senders: ["the-ken"],
    });
  });

  it("reads anything unknown as the default", () => {
    expect(readBrowse({ kind: "podcasts", show: "saved" })).toEqual({
      kind: "news",
      show: "unread",
      topics: [],
      senders: [],
    });
  });
});

describe("parse", () => {
  it("knows every view", () => {
    expect(at("/today")).toEqual({ name: "today", mode: "deck" });
    expect(at("/today/list")).toEqual({ name: "today", mode: "list" });
    expect(at("/today/brief")).toEqual({ name: "today", mode: "brief" });
    expect(at("/saved")).toEqual({ name: "saved" });
    expect(at("/library")).toEqual({ name: "library" });
    expect(at(searchHref("rate cut & Fed", "newest"))).toEqual({
      name: "search",
      q: "rate cut & Fed",
      sort: "newest",
    });
    expect(at("/library/history?day=2026-10-10")).toEqual({ name: "history", day: "2026-10-10" });
    expect(at("/library/newsletters/the-ken")).toEqual({ name: "newsletter", slug: "the-ken" });
    expect(at("/library/status")).toEqual({ name: "status" });
    expect(at("/library/settings")).toEqual({ name: "settings" });
  });

  it("reads an issue, its story and the deep dive", () => {
    expect(at(issueHref("a b"))).toEqual({ name: "issue", id: "a b" });
    expect(at(issueHref("x", 3))).toEqual({ name: "issue", id: "x", story: 3, deep: undefined });
    expect(at(issueHref("x", 3, "backstory"))).toEqual({
      name: "issue",
      id: "x",
      story: 3,
      deep: "backstory",
    });
  });

  it("reads the Mac's queues", () => {
    const href = queueHref("learning", { ...DEFAULT_QUEUE, order: "newest" }, "x", 2);
    expect(href).toBe("/learning/x/story/2?order=newest");
    expect(at(href)).toEqual({
      name: "queue",
      tab: "learning",
      filters: { show: "unread", order: "newest", topics: [], senders: [] },
      id: "x",
      story: 2,
      deep: undefined,
    });
    expect(at("/news")).toMatchObject({ name: "queue", tab: "news" });
    expect(at("/saved/x")).toMatchObject({ name: "queue", tab: "saved", id: "x" });
  });

  it("finds nothing at a bad path", () => {
    for (const p of [
      "/nope",
      "/today/x",
      "/issue",
      "/issue/x/story/0",
      "/issue/x/story/2/maps",
      "/library/x/y",
    ]) {
      expect(at(p)).toEqual({ name: "not-found" });
    }
  });
});

describe("redirect", () => {
  it("sends the old Home to Today, Browse or the console", () => {
    expect(redirect("/", {}, false)).toBe("/today");
    expect(redirect("/", {}, true)).toBe("/news");
    expect(redirect("/", { shelf: "learning", topic: "AI & LLMs" }, false)).toBe(
      "/browse?kind=learning&topic=ai-llms",
    );
    expect(redirect("/", { view: "saved" }, false)).toBe("/saved");
    expect(redirect("/", { issue: "x" }, false)).toBe("/issue/x");
    expect(redirect("/", { issue: "x" }, true)).toBe("/news/x");
  });

  it("sends the old pages to Library's", () => {
    expect(redirect("/summary", {}, false)).toBe("/today");
    expect(redirect("/history", { day: "2026-10-10" }, false)).toBe(
      "/library/history?day=2026-10-10",
    );
    expect(redirect("/search", { q: "kafka" }, true)).toBe("/library/search?q=kafka");
    expect(redirect("/status", {}, false)).toBe("/library/status");
    expect(redirect("/senders", {}, false)).toBe("/library/newsletters");
    expect(redirect("/senders/abc", {}, false)).toBe("/library/newsletters/abc");
  });

  it("maps each device's views to the other's", () => {
    expect(redirect("/today", {}, true)).toBe("/news");
    expect(redirect("/library", {}, true)).toBe("/news");
    expect(redirect("/browse", { kind: "learning", topic: "ai-llms" }, true)).toBe(
      "/learning?topic=ai-llms",
    );
    expect(redirect("/issue/x/story/2", {}, true)).toBe("/news/x/story/2");
    expect(redirect("/news/x/story/2", {}, false)).toBe("/issue/x/story/2");
    expect(redirect("/news", {}, false)).toBe("/today");
    expect(redirect("/learning", { show: "all" }, false)).toBe("/browse?kind=learning&show=all");
  });

  it("leaves a view that is already right alone", () => {
    expect(redirect("/today", {}, false)).toBeUndefined();
    expect(redirect("/saved", {}, true)).toBeUndefined();
    expect(redirect("/library/status", {}, true)).toBeUndefined();
    expect(redirect("/news/x", {}, true)).toBeUndefined();
  });
});

describe("Ask (#21)", () => {
  it("lives under Library with its question in the URL", () => {
    expect(askHref()).toBe("/library/ask");
    expect(at(askHref("agent evals?"))).toEqual({ name: "ask", q: "agent evals?" });
  });
});

describe("Following (#22)", () => {
  it("lives under Library", () => {
    expect(followingHref()).toBe("/library/following");
    expect(at(followingHref())).toEqual({ name: "following" });
    expect(at("/library/following/x")).toEqual({ name: "not-found" });
  });
});
