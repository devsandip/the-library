import { describe, expect, it } from "vitest";
import type { UnreadCount } from "@library/core/types";
import { facets } from "../src/counts.js";

const counts: UnreadCount[] = [
  { senderId: "ken", shelf: "news", topic: "Business", n: 3 },
  { senderId: "ken", shelf: "news", topic: "AI", n: 1 },
  { senderId: "bbg", shelf: "learning", topic: "Systems", n: 4 },
  { senderId: "tldr", shelf: "news", topic: "AI", n: 2 },
  { senderId: "tldr", n: 5 }, // not sorted yet: News, no topic
  { senderId: "noisy", shelf: "news", topic: "AI", n: 7 }, // muted
];
const muted = new Set(["noisy"]);

describe("facets", () => {
  it("counts tabs, topics and senders, hiding muted senders", () => {
    const f = facets(counts, { shelf: "news", senders: [], topics: [] }, muted);
    expect(f.shelves).toEqual({ news: 11, learning: 4 });
    expect(Object.fromEntries(f.topics)).toEqual({ Business: 3, AI: 3 });
    expect(f.total).toBe(11);
    // The picker lists muted senders with their numbers.
    expect(f.senders.get("noisy")).toBe(7);
    expect(f.senders.get("bbg")).toBeUndefined();
  });

  it("several topics mean any of them, and unsorted issues drop out", () => {
    const f = facets(counts, { shelf: "news", senders: [], topics: ["AI", "Business"] }, muted);
    expect(f.total).toBe(6);
    expect(f.senders.get("tldr")).toBe(2);
    // Topic counts ignore the topic filter itself, so other chips keep their numbers.
    expect(f.topics.get("Business")).toBe(3);
  });

  it("picked senders narrow everything, and a picked muted sender counts", () => {
    const f = facets(counts, { shelf: "news", senders: ["ken", "noisy"], topics: [] }, muted);
    expect(f.shelves).toEqual({ news: 11, learning: 0 });
    expect(Object.fromEntries(f.topics)).toEqual({ Business: 3, AI: 8 });
    expect(f.total).toBe(11);
  });

  it("without tabs every shelf counts", () => {
    expect(facets(counts, { senders: [], topics: [] }, muted).total).toBe(15);
  });
});
