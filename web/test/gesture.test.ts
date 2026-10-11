import { describe, expect, it } from "vitest";
import type { IssueListItem } from "@library/core/types";
import {
  CARD_COMMIT_PX,
  cardTransform,
  directionLock,
  labelOpacity,
  ROW_COMMIT_PX,
  swipeChange,
  swipeDecision,
  undoOf,
} from "../src/gesture.js";

describe("swipeDecision", () => {
  it("commits a row past 90 px and a card past 100 px, either way", () => {
    expect(swipeDecision(90, ROW_COMMIT_PX, 0)).toBe("right");
    expect(swipeDecision(-90, ROW_COMMIT_PX, 0)).toBe("left");
    expect(swipeDecision(99, CARD_COMMIT_PX, 0)).toBeUndefined();
    expect(swipeDecision(-100, CARD_COMMIT_PX, 0)).toBe("left");
  });

  it("springs back from a slow, short drag", () => {
    expect(swipeDecision(60, ROW_COMMIT_PX, 0.1)).toBeUndefined();
    expect(swipeDecision(0, ROW_COMMIT_PX, 2)).toBeUndefined();
  });

  it("commits a quick flick the way it was dragged", () => {
    expect(swipeDecision(60, CARD_COMMIT_PX, 0.9)).toBe("right");
    expect(swipeDecision(-60, CARD_COMMIT_PX, -0.6)).toBe("left");
  });

  it("ignores a flick back toward the start, and a twitch", () => {
    expect(swipeDecision(60, CARD_COMMIT_PX, -0.9)).toBeUndefined();
    expect(swipeDecision(20, CARD_COMMIT_PX, 1.5)).toBeUndefined();
  });
});

describe("directionLock", () => {
  it("waits for 8 px, then picks the larger way", () => {
    expect(directionLock(5, 5)).toBeUndefined();
    expect(directionLock(9, 2)).toBe("x");
    expect(directionLock(-3, 12)).toBe("y");
    expect(directionLock(6, -6)).toBe("y");
  });
});

describe("the card under the finger", () => {
  it("turns as it moves and shows its label by the distance", () => {
    expect(cardTransform(44)).toBe("translateX(44px) rotate(2.00deg)");
    expect(labelOpacity(-50)).toBe(0.5);
    expect(labelOpacity(180)).toBe(1);
  });
});

describe("swipeChange", () => {
  it("right rates Relevant and leaves the state alone", () => {
    expect(swipeChange({ state: "unread" }, "right")).toEqual({ rating: 1 });
    expect(swipeChange({ state: "read", rating: -1 }, "right")).toEqual({ rating: 1 });
  });

  it("left rates Irrelevant and archives", () => {
    expect(swipeChange({ state: "unread" }, "left")).toEqual({ rating: -1, state: "archived" });
  });

  it("a second swipe the same way does nothing", () => {
    expect(swipeChange({ state: "unread", rating: 1 }, "right")).toBeUndefined();
    expect(swipeChange({ state: "archived", rating: -1 }, "left")).toBeUndefined();
  });

  it("left on a saved issue also takes it off the Saved list", () => {
    const savedAt = "2026-10-10T10:00:00.000Z";
    expect(swipeChange({ state: "read", savedAt }, "left")).toEqual({
      rating: -1,
      state: "archived",
      savedAt: undefined,
    });
  });

  it("only sends what changes", () => {
    expect(swipeChange({ state: "unread", rating: -1 }, "left")).toEqual({ state: "archived" });
    expect(swipeChange({ state: "archived" }, "left")).toEqual({ rating: -1 });
  });
});

describe("undoOf", () => {
  it("puts back the rating, the state and the saved state together (rule 4)", () => {
    const issue = {
      state: "read",
      savedAt: "2026-10-10T10:00:00.000Z",
    } as IssueListItem;
    const change = swipeChange(issue, "left")!;
    expect(undoOf(issue, change)).toEqual({
      rating: undefined,
      state: "read",
      savedAt: "2026-10-10T10:00:00.000Z",
    });
    expect(undoOf({ ...issue, rating: -1 }, { rating: 1 })).toEqual({ rating: -1 });
  });
});
