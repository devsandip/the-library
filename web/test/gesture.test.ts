import { describe, expect, it } from "vitest";
import {
  CARD_COMMIT_PX,
  cardTransform,
  deckStep,
  directionLock,
  labelOpacity,
  swipeDecision,
} from "../src/gesture.js";

describe("swipeDecision", () => {
  it("commits a card past 100 px, either way", () => {
    expect(swipeDecision(100, CARD_COMMIT_PX, 0)).toBe("right");
    expect(swipeDecision(99, CARD_COMMIT_PX, 0)).toBeUndefined();
    expect(swipeDecision(-100, CARD_COMMIT_PX, 0)).toBe("left");
  });

  it("springs back from a slow, short drag", () => {
    expect(swipeDecision(60, CARD_COMMIT_PX, 0.1)).toBeUndefined();
    expect(swipeDecision(0, CARD_COMMIT_PX, 2)).toBeUndefined();
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

describe("deckStep", () => {
  it("goes left to the next card and right to the one before", () => {
    expect(deckStep(3, "left", 20, false)).toBe(4);
    expect(deckStep(3, "right", 20, false)).toBe(2);
  });

  it("stops at the last card, and at the first unless there is a brief", () => {
    expect(deckStep(19, "left", 20, true)).toBeUndefined();
    expect(deckStep(0, "right", 20, false)).toBeUndefined();
    expect(deckStep(0, "right", 20, true)).toBe(-1);
  });
});
