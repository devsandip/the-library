import { describe, expect, it } from "vitest";
import { atEnd, placeIn, scrollFor } from "../src/place.js";

// A newsletter 4,000px tall whose frame starts 300px down the page, on a 800px screen.
const frame = { top: 300, height: 4000, viewport: 800 };

describe("placeIn", () => {
  it("is 0 until the newsletter reaches the top of the screen", () => {
    expect(placeIn({ ...frame, scrollY: 0 })).toBe(0);
    expect(placeIn({ ...frame, scrollY: 300 })).toBe(0);
  });

  it("is the share of the newsletter above the top of the screen, to 3 decimals", () => {
    expect(placeIn({ ...frame, scrollY: 1300 })).toBe(0.25);
    expect(placeIn({ ...frame, scrollY: 1301 })).toBe(0.25);
    expect(placeIn({ ...frame, scrollY: 2312 })).toBe(0.503);
  });

  it("stays below 1, which means finished", () => {
    expect(placeIn({ ...frame, scrollY: 4300 })).toBe(0.999);
    expect(placeIn({ ...frame, scrollY: 9000 })).toBe(0.999);
  });

  it("is 0 for a frame not sized yet", () => {
    expect(placeIn({ ...frame, height: 0, scrollY: 500 })).toBe(0);
  });
});

describe("atEnd", () => {
  it("is reached once the bottom of the screen is within the footer's slack of the end", () => {
    // The end is at 4300; 5% of 4000 is 200px of slack.
    expect(atEnd({ ...frame, scrollY: 3200 })).toBe(false);
    expect(atEnd({ ...frame, scrollY: 3300 })).toBe(true);
  });

  it("allows at most 600px of slack on a long newsletter", () => {
    const long = { top: 0, height: 40_000, viewport: 800 };
    expect(atEnd({ ...long, scrollY: 38_500 })).toBe(false);
    expect(atEnd({ ...long, scrollY: 38_600 })).toBe(true);
  });

  it("is not reached in a frame not sized yet", () => {
    expect(atEnd({ ...frame, height: 0, scrollY: 0 })).toBe(false);
  });
});

describe("scrollFor", () => {
  it("puts the place back at the top of the screen", () => {
    expect(scrollFor(0.25, frame)).toBe(1300);
    expect(placeIn({ ...frame, scrollY: scrollFor(0.503, frame) })).toBe(0.503);
  });

  it("lands near the same words when the newsletter reflows taller", () => {
    // The phone's narrower frame is taller; the same share is the same part of the text.
    const phone = { top: 260, height: 9000, viewport: 700 };
    expect(scrollFor(0.25, phone)).toBe(2510);
  });
});
