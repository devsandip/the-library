import { describe, expect, it } from "vitest";
import { addDays, isReaderDay, readerDay, readerDayBounds, recentDays } from "../src/days.js";

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

  it("a reader in New York has New York days, 23 and 25 hours long across daylight saving (#185)", () => {
    const ny = "America/New_York";
    // 03:30 UTC on 9 March is still the 8th in New York.
    expect(readerDay(Date.parse("2026-03-09T03:30:00Z"), ny)).toBe("2026-03-08");
    expect(readerDayBounds("2026-03-08", ny)).toEqual({
      from: "2026-03-08T05:00:00.000Z",
      to: "2026-03-09T03:59:59.999Z",
    });
    expect(readerDayBounds("2026-11-01", ny)).toEqual({
      from: "2026-11-01T04:00:00.000Z",
      to: "2026-11-02T04:59:59.999Z",
    });
    expect(recentDays(Date.parse("2026-11-02T12:00:00Z"), 3, ny)).toEqual([
      "2026-11-02",
      "2026-11-01",
      "2026-10-31",
    ]);
  });

  it("days east of UTC and in UTC itself start at their own midnight", () => {
    expect(readerDayBounds("2026-10-04", "Australia/Sydney").from).toBe("2026-10-03T14:00:00.000Z");
    expect(readerDayBounds("2026-10-05", "Australia/Sydney").from).toBe("2026-10-04T13:00:00.000Z");
    expect(readerDayBounds("2026-10-29", "UTC")).toEqual({
      from: "2026-10-29T00:00:00.000Z",
      to: "2026-10-29T23:59:59.999Z",
    });
  });

  it("steps by date across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
