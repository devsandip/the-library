import { describe, expect, it, vi } from "vitest";
import type { StoredFollow } from "@library/core";
import type { Timeline } from "@library/core/types";
import { HttpError } from "../src/errors.js";
import { Following, storyPoint, type FollowStore } from "../src/following.js";
import type { TimelineStory } from "../src/timeline.js";

const NOW = Date.parse("2026-10-27T10:00:00.000Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const story: TimelineStory = {
  issueId: "tldr",
  n: 2,
  senderId: "s000000000001",
  receivedAt: "2026-10-26T06:00:00.000Z",
  vector: new Float32Array(0),
  headline: "Anthropic files to go public",
  summary: "Anthropic filed for an IPO on Monday.",
  names: ["Anthropic"],
  eventId: "wsj#01",
  publication: "TLDR AI",
  digest: true,
};

const timeline: Timeline = {
  gist: "Anthropic went from a leaked filing to a public one.",
  points: [
    {
      at: "2026-10-20T06:00:00.000Z",
      text: "A draft filing leaked.",
      sources: [{ issueId: "wsj", publication: "WSJ" }],
    },
    {
      at: "2026-10-26T06:00:00.000Z",
      text: "Anthropic filed to go public.",
      sources: [{ issueId: "tldr", publication: "TLDR AI", story: { n: 2, headline: "x" } }],
      current: true,
    },
  ],
  at: "2026-10-26T08:00:00.000Z",
  stories: 5,
  ms: 4000,
  cents: 0.4,
};

function follow(over: Partial<StoredFollow> = {}): StoredFollow {
  return {
    eventId: "e1",
    issueId: "a",
    n: 1,
    headline: "A",
    publication: "P",
    followedAt: iso(NOW - 5 * DAY),
    seenAt: iso(NOW - 5 * DAY),
    points: [
      { at: iso(NOW - 6 * DAY), text: "It began.", sources: [{ issueId: "a", publication: "P" }] },
    ],
    checked: [],
    ...over,
  };
}

function setup(
  opts: { follows?: StoredFollow[]; timeline?: Timeline; story?: TimelineStory | undefined } = {},
) {
  const kept = new Map((opts.follows ?? []).map((f) => [f.eventId, f]));
  const store: FollowStore = {
    timelineStory: vi.fn(async () => ("story" in opts ? opts.story : story)),
    getTimeline: vi.fn(async () => opts.timeline),
    listFollows: vi.fn(async () => [...kept.values()]),
    addFollow: vi.fn(async (f: StoredFollow) => {
      if (kept.has(f.eventId)) return false;
      kept.set(f.eventId, f);
      return true;
    }),
    deleteFollow: vi.fn(async (eventId: string) => void kept.delete(eventId)),
    seeFollow: vi.fn(async (eventId: string, at: string) => {
      const f = kept.get(eventId);
      if (f) kept.set(eventId, { ...f, seenAt: at });
    }),
  };
  return { following: new Following(store, () => NOW), store, kept };
}

describe("storyPoint", () => {
  it("is the story itself, opening at it inside a digest", () => {
    expect(storyPoint(story)).toEqual({
      at: story.receivedAt,
      text: "Anthropic filed for an IPO on Monday.",
      sources: [
        {
          issueId: "tldr",
          publication: "TLDR AI",
          story: { n: 2, headline: "Anthropic files to go public" },
        },
      ],
      current: true,
    });
    expect(storyPoint({ ...story, digest: false, summary: "" })).toMatchObject({
      text: "Anthropic files to go public",
      sources: [{ issueId: "tldr", publication: "TLDR AI" }],
    });
  });
});

describe("Following", () => {
  it("follows a story's event with its kept timeline, and lists it", async () => {
    const { following, kept } = setup({ timeline });
    const f = await following.follow("tldr", 2);
    expect(f).toMatchObject({
      eventId: "wsj#01",
      issueId: "tldr",
      n: 2,
      headline: "Anthropic files to go public",
      publication: "TLDR AI",
      followedAt: iso(NOW),
      points: timeline.points,
      unseen: 0,
      quiet: false,
    });
    expect(f.stories).toEqual(["tldr#02", "wsj#01"]);
    expect(kept.get("wsj#01")).toMatchObject({ seenAt: iso(NOW), checked: [] });
    expect((await following.list()).items).toEqual([f]);
  });

  it("follows with the story itself when its event has no timeline", async () => {
    const { following } = setup();
    expect((await following.follow("tldr", 2)).points).toEqual([storyPoint(story)]);
  });

  it("gives back the follow its event already has, from any of its stories", async () => {
    const existing = follow({ eventId: "wsj#01", issueId: "wsj", headline: "Earlier" });
    const { following, store } = setup({ follows: [existing] });
    expect(await following.follow("tldr", 2)).toMatchObject({
      issueId: "wsj",
      headline: "Earlier",
    });
    expect(store.addFollow).not.toHaveBeenCalled();
  });

  it("stops at 20 followed stories, and 404s a story the issue does not have", async () => {
    const many = Array.from({ length: 20 }, (_, k) => follow({ eventId: `e${k}` }));
    const full = setup({ follows: many });
    await expect(full.following.follow("tldr", 2)).rejects.toMatchObject({ status: 409 });
    const none = setup({ story: undefined });
    await expect(none.following.follow("tldr", 9)).rejects.toBeInstanceOf(HttpError);
    await expect(none.following.unfollow("tldr", 9)).rejects.toBeInstanceOf(HttpError);
  });

  it("lists moving stories first, latest movement first, and counts new points", async () => {
    const moved = follow({
      eventId: "moved",
      movedAt: iso(NOW - DAY),
      seenAt: iso(NOW - 2 * DAY),
      points: [
        ...follow().points,
        {
          at: iso(NOW - DAY),
          text: "It moved.",
          sources: [{ issueId: "b", publication: "Q" }],
          added: iso(NOW - DAY),
        },
      ],
    });
    const still = follow({ eventId: "still", followedAt: iso(NOW - 3 * DAY) });
    const quiet = follow({
      eventId: "quiet",
      followedAt: iso(NOW - 40 * DAY),
      movedAt: iso(NOW - 31 * DAY),
    });
    const { following } = setup({ follows: [quiet, still, moved] });
    const list = await following.list();
    expect(list.items.map((f) => [f.eventId, f.unseen, f.quiet])).toEqual([
      ["moved", 1, false],
      ["still", 0, false],
      ["quiet", 0, true],
    ]);
    expect(list.unseen).toBe(1);
    expect(list.items[0]!.stories).toEqual(["a#01", "b#01"]);
  });

  it("marks new points seen, touching only follows that have some", async () => {
    const moved = follow({
      eventId: "moved",
      points: [{ at: iso(NOW - DAY), text: "It moved.", sources: [], added: iso(NOW - DAY) }],
    });
    const { following, store } = setup({ follows: [moved, follow({ eventId: "still" })] });
    await following.seen();
    expect(store.seeFollow).toHaveBeenCalledTimes(1);
    expect(store.seeFollow).toHaveBeenCalledWith("moved", iso(NOW));
    expect((await following.list()).unseen).toBe(0);
  });

  it("unfollows the story's event, and a follow of the story a relink moved", async () => {
    const { following, kept } = setup({
      follows: [
        follow({ eventId: "wsj#01" }),
        follow({ eventId: "old-event", issueId: "tldr", n: 2 }),
        follow({ eventId: "other" }),
      ],
    });
    await following.unfollow("tldr", 2);
    expect([...kept.keys()]).toEqual(["other"]);
  });
});
