import { describe, expect, it, vi } from "vitest";
import type { TuneupStory } from "@library/core";
import { Tuneups, type TuneupStore } from "../src/tuneup.js";

const moved = (k: number, learning: number, shelf: "news" | "learning"): TuneupStory => ({
  id: `a${k}`,
  n: 1,
  senderId: "sA",
  receivedAt: `2026-10-${String(k + 1).padStart(2, "0")}T08:00:00.000Z`,
  headline: `Story ${k}`,
  learning,
  shelf,
  shelfSetBy: learning >= 0.5 === (shelf === "learning") ? "jev" : "sandip",
});

const store = (dismissed: Record<string, number> = {}): TuneupStore => ({
  readTuneup: vi.fn(async () => ({
    senders: [
      {
        senderId: "sA",
        senderKey: "a@example.test",
        publication: "Alpha",
        muted: false,
        mustRead: false,
        up: 0,
        down: 0,
        issueCount: 12,
        lastSeenAt: "2026-10-28T00:00:00.000Z",
      },
    ],
    issues: [],
    // Three moved to Learning against Jev, nine Jev put there.
    stories: [
      ...[0, 1, 2].map((k) => moved(k, 0.2, "learning")),
      ...[3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => moved(k, 0.8, "learning")),
    ],
    dismissed,
  })),
  dismissTuneup: vi.fn(async () => undefined),
});

describe("the tune-up service", () => {
  it("proposes from what is stored", async () => {
    const r = await new Tuneups(store()).tuneup();
    expect(r.proposals).toMatchObject([{ id: "sA.learning", fixes: 3, moves: 0 }]);
  });

  it("puts a proposal off with the moves it has now, and answers without it", async () => {
    const s = store();
    const r = await new Tuneups(s).dismiss("sA.learning");
    expect(s.dismissTuneup).toHaveBeenCalledWith("sA.learning", 3);
    expect(r).toMatchObject({ proposals: [], dismissed: 1 });
  });

  it("does not put off a proposal that is not there", async () => {
    const s = store({ "sA.learning": 3 });
    await expect(new Tuneups(s).dismiss("sA.learning")).rejects.toMatchObject({ status: 404 });
    await expect(new Tuneups(s).dismiss("sA.news")).rejects.toMatchObject({ status: 404 });
    expect(s.dismissTuneup).not.toHaveBeenCalled();
  });
});
