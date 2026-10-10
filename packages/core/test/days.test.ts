import { describe, expect, it } from "vitest";
import { isReaderDay, readerDay, readerDayBounds, recentDays } from "../src/days.js";

describe("reader days", () => {
  it("the reader's day is in IST", () => {
    // 20:00 UTC on the 9th is 01:30 on the 10th in India.
    expect(readerDay(Date.parse("2026-10-09T20:00:00.000Z"))).toBe("2026-10-10");
  });

  it("the last few days run back from today, across a month end", () => {
    expect(recentDays(Date.parse("2026-10-02T20:00:00.000Z"), 4)).toEqual([
      "2026-10-03",
      "2026-10-02",
      "2026-10-01",
      "2026-09-30",
    ]);
  });

  it("a day runs from midnight to midnight in India", () => {
    const { from, to } = readerDayBounds("2026-10-10");
    expect(from).toBe("2026-10-09T18:30:00.000Z");
    expect(to).toBe("2026-10-10T18:29:59.999Z");
    expect(readerDay(Date.parse(from))).toBe("2026-10-10");
    expect(readerDay(Date.parse(to))).toBe("2026-10-10");
    expect(readerDay(Date.parse(to) + 1)).toBe("2026-10-11");
  });

  it("only real days pass", () => {
    expect(isReaderDay("2026-10-10")).toBe(true);
    expect(isReaderDay("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "2026-1-5", "today", ""]) {
      expect(isReaderDay(bad)).toBe(false);
    }
    expect(() => readerDayBounds("2026-02-30")).toThrow("not a day");
  });
});
