import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Follow, FollowingResponse } from "@library/core/types";
import type { LibraryApi } from "../src/api.js";
import {
  followingState,
  followOf,
  markSeen,
  newPoints,
  readFollowing,
  resetFollowing,
  toggleFollow,
  unfollow,
} from "../src/following.js";

function follow(over: Partial<Follow> = {}): Follow {
  return {
    eventId: "wsj#01",
    issueId: "wsj",
    n: 1,
    headline: "Starlink caps drones",
    publication: "WSJ",
    followedAt: "2026-10-20T08:00:00.000Z",
    points: [],
    unseen: 0,
    quiet: false,
    stories: ["wsj#01", "ft#03"],
    ...over,
  };
}

function fakeApi(list: FollowingResponse) {
  return {
    following: vi.fn(async () => list),
    follow: vi.fn(async (id: string, n: number) =>
      follow({ eventId: `${id}#0${n}`, issueId: id, n, stories: [`${id}#0${n}`] }),
    ),
    unfollow: vi.fn(async () => undefined),
    seenFollowing: vi.fn(async () => undefined),
  } as unknown as LibraryApi & Record<string, ReturnType<typeof vi.fn>>;
}

beforeEach(() => resetFollowing());

describe("following (#22)", () => {
  it("knows a story is followed from any story its points draw on", async () => {
    await readFollowing(fakeApi({ items: [follow()], unseen: 0 }));
    expect(followOf("ft", 3)?.eventId).toBe("wsj#01");
    expect(followOf("wsj", 1)?.eventId).toBe("wsj#01");
    expect(followOf("ft", 2)).toBeUndefined();
  });

  it("follows a story and unfollows it again, the list changing at once", async () => {
    const api = fakeApi({ items: [follow()], unseen: 0 });
    await readFollowing(api);
    expect(await toggleFollow(api, "tldr", 2)).toBe(true);
    expect(api.follow).toHaveBeenCalledWith("tldr", 2);
    expect(followOf("tldr", 2)?.eventId).toBe("tldr#02");
    expect(await toggleFollow(api, "tldr", 2)).toBe(false);
    expect(api.unfollow).toHaveBeenCalledWith("tldr", 2);
    expect(followOf("tldr", 2)).toBeUndefined();
    await unfollow(api, follow());
    const s = followingState();
    expect(s.status === "ok" && s.data.items).toEqual([]);
  });

  it("marks new points seen only when there are some, and clears the count", async () => {
    const quiet = fakeApi({ items: [follow()], unseen: 0 });
    await readFollowing(quiet);
    await markSeen(quiet);
    expect(quiet.seenFollowing).not.toHaveBeenCalled();

    resetFollowing();
    const moved = fakeApi({ items: [follow({ unseen: 2 })], unseen: 2 });
    await readFollowing(moved);
    await markSeen(moved);
    expect(moved.seenFollowing).toHaveBeenCalledTimes(1);
    const s = followingState();
    expect(s.status === "ok" && [s.data.unseen, s.data.items[0]!.unseen]).toEqual([0, 0]);
  });
});

describe("newPoints", () => {
  it("is the most recently added points, as many as are unseen", () => {
    const at = "2026-10-20T08:00:00.000Z";
    const f = follow({
      unseen: 2,
      points: [
        { at, text: "followed with", sources: [] },
        { at, text: "older move", sources: [], added: "2026-10-21T08:00:00.000Z" },
        { at, text: "newest", sources: [], added: "2026-10-23T08:00:00.000Z" },
        { at, text: "newer", sources: [], added: "2026-10-22T08:00:00.000Z" },
      ],
    });
    expect([...newPoints(f)].sort()).toEqual([2, 3]);
    expect(newPoints({ ...f, unseen: 0 }).size).toBe(0);
  });
});
