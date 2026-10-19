import { describe, expect, it } from "vitest";
import { age, clock, narrativeLine, reasonCode, reasonLine, shortDate } from "../src/format.js";
import { digestLine } from "../src/pages/status.js";

describe("digestLine", () => {
  it("states the share found useful against the aim", () => {
    expect(digestLine({ days: 4, shown: 20, useful: 7, notUseful: 3 })).toBe(
      "Today's five, last 14 days: 7 of 20 useful (35%), 3 not useful. The aim is 60%.",
    );
  });
});

describe("narrativeLine", () => {
  it("says what the brief was written from, and when", () => {
    const now = Date.parse("2026-10-10T12:00:00.000Z");
    const n = { at: "2026-10-10T09:00:00.000Z", threads: [], stories: 39, newsletters: 5 };
    expect(narrativeLine(n, now)).toBe("39 stories from 5 newsletters, updated 3h ago.");
    expect(narrativeLine({ ...n, newsletters: 1 }, now)).toBe(
      "39 stories from 1 newsletter, updated 3h ago.",
    );
  });
});

describe("the mono meta lines", () => {
  const now = Date.parse("2026-10-11T07:00:00.000Z");

  it("says how old an issue is in a word", () => {
    expect(age("2026-10-11T06:59:40.000Z", now)).toBe("now");
    expect(age("2026-10-11T06:15:00.000Z", now)).toBe("45m");
    expect(age("2026-10-11T02:00:00.000Z", now)).toBe("5h");
    expect(age("2026-10-09T07:00:00.000Z", now)).toBe("2d");
    expect(age("2026-10-02T07:00:00.000Z", now)).toBe("2 Oct");
  });

  it("tells the time in India, on a 24-hour clock", () => {
    expect(clock("2026-10-11T00:44:00.000Z")).toBe("06:14");
    expect(clock("2026-10-11T07:00:00.000Z")).toBe("12:30");
  });

  it("dates a timeline point", () => {
    expect(shortDate("2026-10-11T02:00:00.000Z", now)).toBe("Today");
    expect(shortDate("2026-10-06T02:00:00.000Z", now)).toBe("6 Oct");
    expect(shortDate("2025-03-06T02:00:00.000Z", now)).toBe("Mar 2025");
  });
});

describe("ranking reasons", () => {
  it("names the newsletter on the card", () => {
    expect(reasonLine("You found this newsletter useful 4 times", "The Ken")).toBe(
      "You found The Ken useful 4 times",
    );
    expect(reasonLine("Close to your interest in AI", "The Ken")).toBe(
      "Close to your interest in AI",
    );
  });

  it("shortens to the Mac's codes", () => {
    expect(reasonCode("From a Must Read newsletter", "AI & LLMs")).toBe("Must Read · AI & LLMs");
    expect(reasonCode("You found this newsletter useful 4 times", "AI")).toBe("4× Useful");
    expect(reasonCode("You found this newsletter useful twice", undefined)).toBe("2× Useful");
    expect(reasonCode("Trying a newsletter you haven't rated yet", "AI")).toBe(
      "Exploring · not rated yet",
    );
    expect(reasonCode("Close to your interest in system design", "AI")).toBe(
      "Interest · system design",
    );
    expect(reasonCode('Like "Postgres at scale", which you found useful', "Tech")).toBe(
      "Matches · Tech",
    );
    expect(reasonCode("Just in", undefined)).toBe("Just in");
    expect(reasonCode(undefined, "Tech")).toBe("Tech");
  });
});
