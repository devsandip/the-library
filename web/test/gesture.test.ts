import { describe, expect, it } from "vitest";
import { swipeChange, swipeDecision } from "../src/gesture.js";

describe("swipeDecision", () => {
  const width = 360;

  it("commits past 40% of the row's width, either way", () => {
    expect(swipeDecision(150, width, 0)).toBe("right");
    expect(swipeDecision(-150, width, 0)).toBe("left");
  });

  it("springs back from a slow, short drag", () => {
    expect(swipeDecision(100, width, 0.1)).toBeUndefined();
    expect(swipeDecision(-100, width, -0.1)).toBeUndefined();
    expect(swipeDecision(0, width, 2)).toBeUndefined();
  });

  it("commits a quick flick the way it was dragged", () => {
    expect(swipeDecision(60, width, 0.9)).toBe("right");
    expect(swipeDecision(-60, width, -0.9)).toBe("left");
  });

  it("ignores a flick back toward the start, and a twitch", () => {
    expect(swipeDecision(100, width, -0.9)).toBeUndefined();
    expect(swipeDecision(20, width, 1.5)).toBeUndefined();
  });
});

describe("swipeChange", () => {
  it("right rates Relevant and leaves the state alone", () => {
    expect(swipeChange({ state: "unread" }, "right")).toEqual({ rating: 1 });
    expect(swipeChange({ state: "read", rating: -1 }, "right")).toEqual({ rating: 1 });
  });

  it("left rates Irrelevant and archives", () => {
    expect(swipeChange({ state: "unread" }, "left")).toEqual({ rating: -1, state: "archived" });
    expect(swipeChange({ state: "unread", rating: 1 }, "left")).toEqual({
      rating: -1,
      state: "archived",
    });
  });

  it("a second swipe the same way does nothing", () => {
    expect(swipeChange({ state: "unread", rating: 1 }, "right")).toBeUndefined();
    expect(swipeChange({ state: "archived", rating: -1 }, "left")).toBeUndefined();
  });

  it("only sends what changes", () => {
    expect(swipeChange({ state: "unread", rating: -1 }, "left")).toEqual({ state: "archived" });
    expect(swipeChange({ state: "archived" }, "left")).toEqual({ rating: -1 });
  });
});
