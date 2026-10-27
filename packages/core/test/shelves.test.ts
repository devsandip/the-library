import { describe, expect, it } from "vitest";
import { issueShelf, shelfFor, storyIndexAttributes, storyShelf } from "../src/shelves.js";

describe("shelfFor", () => {
  it("puts 0.5 and up on Learning", () => {
    expect([0, 0.49, 0.5, 1].map(shelfFor)).toEqual(["news", "news", "learning", "learning"]);
  });
});

describe("storyShelf", () => {
  it("is Sandip's move, then the newsletter's setting, then Jev", () => {
    const moved = { shelf: "news" as const, shelfSetBy: "sandip" as const, learning: 0.9 };
    expect(storyShelf(moved, "learning")).toEqual({ shelf: "news", shelfSetBy: "sandip" });
    expect(storyShelf({ learning: 0.9 }, "news")).toEqual({ shelf: "news", shelfSetBy: "sender" });
    expect(storyShelf({ learning: 0.9 })).toEqual({ shelf: "learning", shelfSetBy: "jev" });
    expect(storyShelf({ learning: 0.2 })).toEqual({ shelf: "news", shelfSetBy: "jev" });
  });

  it("goes back to Jev's call when the newsletter's setting is cleared", () => {
    const stamped = { shelf: "learning" as const, shelfSetBy: "sender" as const, learning: 0.1 };
    expect(storyShelf(stamped)).toEqual({ shelf: "news", shelfSetBy: "jev" });
  });

  it("is empty until someone has decided", () => {
    expect(storyShelf({})).toEqual({});
  });
});

describe("issueShelf", () => {
  it("is Learning only when every story is Learning", () => {
    expect(issueShelf(["learning", "learning"])).toBe("learning");
    expect(issueShelf(["learning", "news"])).toBe("news");
    expect(issueShelf(["learning", undefined])).toBe("news");
  });

  it("leaves an issue with no stories alone", () => {
    expect(issueShelf([])).toBeUndefined();
  });
});

describe("storyIndexAttributes", () => {
  const story = { issueId: "abc", n: 3, receivedAt: "2026-10-27T08:00:00.000Z" };

  it("indexes an unread Learning story under LEARNING, by time", () => {
    expect(storyIndexAttributes({ ...story, shelf: "learning" })).toEqual({
      set: { gsi2pk: "LEARNING", gsi2sk: "2026-10-27T08:00:00.000Z#abc#03" },
      remove: [],
    });
    expect(storyIndexAttributes({ ...story, shelf: "learning", state: "unread" }).set.gsi2pk).toBe(
      "LEARNING",
    );
  });

  it("takes out a read, archived or News story", () => {
    for (const s of [
      { shelf: "learning" as const, state: "read" as const },
      { shelf: "learning" as const, state: "archived" as const },
      { shelf: "news" as const },
      {},
    ]) {
      expect(storyIndexAttributes({ ...story, ...s })).toEqual({
        set: {},
        remove: ["gsi2pk", "gsi2sk"],
      });
    }
  });
});
