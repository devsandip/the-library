import { describe, expect, it } from "vitest";
import type { SenderListItem, UnreadCountsResponse } from "@library/core/types";
import { tally } from "../src/data.js";
import { changed, learningRowId } from "../src/learning.js";

describe("tally (#81)", () => {
  const counts: UnreadCountsResponse = {
    counts: [
      { senderId: "tldr", shelf: "news", topic: "AI", n: 3 },
      // An issue whose every story is Learning: it is counted as stories instead.
      { senderId: "bbg", shelf: "learning", topic: "Systems", n: 1 },
    ],
    saved: 0,
    learning: [
      { senderId: "tldr", shelf: "learning", topic: "AI", n: 2 },
      { senderId: "bbg", shelf: "learning", topic: "Systems", n: 4 },
    ],
  };
  const none: SenderListItem[] = [];

  it("counts News as issues and Learning as stories", () => {
    const f = tally(counts, none, { shelf: "learning", topics: [], senders: [] })!;
    expect(f.shelves).toEqual({ news: 3, learning: 6 });
    expect(f.total).toBe(6);
    expect(Object.fromEntries(f.senders)).toEqual({ tldr: 2, bbg: 4 });
    expect(tally(counts, none, { shelf: "news", topics: [], senders: [] })!.total).toBe(3);
  });

  it("filters Learning stories by their issue's topic and newsletter", () => {
    const f = tally(counts, none, { shelf: "learning", topics: ["AI"], senders: ["tldr"] })!;
    expect(f.total).toBe(2);
  });
});

describe("a story's change (#81)", () => {
  const story = {
    n: 2,
    headline: "How caches fail",
    summary: "A how-to.",
    shelf: "learning" as const,
  };

  it("reads unread as no state, and keeps what the change leaves alone", () => {
    expect(changed(story, { state: "read" })).toEqual({ ...story, state: "read" });
    expect(changed({ ...story, state: "archived" }, { state: "unread" })).toEqual(story);
    expect(changed({ ...story, state: "read" }, { shelf: "news" })).toEqual({
      ...story,
      shelf: "news",
      state: "read",
    });
  });

  it("names a row by its issue and story", () => {
    expect(learningRowId("abc", 3)).toBe("abc#3");
  });
});
