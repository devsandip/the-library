import { describe, expect, it } from "vitest";
import { followStories, followView, isQuiet, stillSince } from "../src/follow.js";

const NOW = Date.parse("2026-10-27T10:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe("follow rules", () => {
  it("is still since its newest move, or since it was followed", () => {
    expect(stillSince({ followedAt: daysAgo(5) })).toBe(daysAgo(5));
    expect(stillSince({ followedAt: daysAgo(5), movedAt: daysAgo(2) })).toBe(daysAgo(2));
    // A move from a story older than the follow does not reach back past it.
    expect(stillSince({ followedAt: daysAgo(1), movedAt: daysAgo(3) })).toBe(daysAgo(1));
  });

  it("goes quiet after 30 days without movement", () => {
    expect(isQuiet({ followedAt: daysAgo(29) }, NOW)).toBe(false);
    expect(isQuiet({ followedAt: daysAgo(31) }, NOW)).toBe(true);
    expect(isQuiet({ followedAt: daysAgo(60), movedAt: daysAgo(10) }, NOW)).toBe(false);
  });

  it("lists the story followed and every story its points draw on, once each", () => {
    expect(
      followStories({
        issueId: "a",
        n: 2,
        points: [
          {
            at: daysAgo(3),
            text: "x",
            sources: [
              { issueId: "a", publication: "A", story: { n: 2, headline: "h" } },
              { issueId: "b", publication: "B" },
            ],
          },
          { at: daysAgo(1), text: "y", sources: [{ issueId: "b", publication: "B" }] },
        ],
      }),
    ).toEqual(["a#02", "b#01"]);
  });

  it("shows points in date order, a late move among them, and counts the new ones", () => {
    const v = followView(
      {
        eventId: "e",
        issueId: "a",
        n: 1,
        headline: "A",
        publication: "P",
        followedAt: daysAgo(4),
        seenAt: daysAgo(2),
        points: [
          { at: daysAgo(5), text: "first", sources: [] },
          { at: daysAgo(1), text: "third", sources: [], added: daysAgo(1) },
          { at: daysAgo(3), text: "second", sources: [], added: daysAgo(1) },
        ],
        checked: [],
      },
      NOW,
    );
    expect(v.points.map((p) => p.text)).toEqual(["first", "second", "third"]);
    expect(v.unseen).toBe(2);
  });
});
