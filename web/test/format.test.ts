import { describe, expect, it } from "vitest";
import { digestLine, narrativeLine } from "../src/format.js";

describe("digestLine", () => {
  it("states the share rated Relevant against the aim", () => {
    expect(digestLine({ days: 4, shown: 20, relevant: 7, irrelevant: 3 })).toBe(
      "Boxed top 5s, last 14 days: 7 of 20 rated Relevant (35%), 3 Irrelevant. The aim is 60%.",
    );
  });
});

describe("narrativeLine", () => {
  it("says what the day in brief was written from, and when", () => {
    const now = Date.parse("2026-10-10T12:00:00.000Z");
    const n = { at: "2026-10-10T09:00:00.000Z", threads: [], stories: 39, newsletters: 5 };
    expect(narrativeLine(n, now)).toBe("From 39 stories in 5 newsletters, updated 3h ago.");
    expect(narrativeLine({ ...n, newsletters: 1 }, now)).toBe(
      "From 39 stories in 1 newsletter, updated 3h ago.",
    );
  });
});
