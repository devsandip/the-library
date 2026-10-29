import { describe, expect, it } from "vitest";
import { checkSettingsPatch, DEFAULT_SETTINGS, isTimeZone } from "../src/settings.js";

describe("settings (#184)", () => {
  it("defaults to today's values: India, the five interests, the reader line", () => {
    expect(DEFAULT_SETTINGS.timeZone).toBe("Asia/Kolkata");
    expect(DEFAULT_SETTINGS.interests.map((i) => i.name)).toContain("system design");
    expect(DEFAULT_SETTINGS.about).toMatch(/^The reader is/);
  });

  it("knows time zones by name only", () => {
    for (const tz of ["America/New_York", "Europe/London", "UTC", "Asia/Kolkata"]) {
      expect(isTimeZone(tz)).toBe(true);
    }
    for (const tz of ["Mars/Olympus", "+05:30", "", "America/New York", 5]) {
      expect(isTimeZone(tz)).toBe(false);
    }
  });

  it("cleans what it keeps and names what is wrong", () => {
    expect(checkSettingsPatch({ about: "  Reads  widely. " })).toEqual({
      patch: { about: "Reads widely." },
    });
    expect(checkSettingsPatch({ interests: [{ name: "x".repeat(41), text: "t" }] })).toEqual({
      error: "each interest needs a name (40) and a text (300)",
    });
    expect(checkSettingsPatch({ colour: "red" })).toEqual({ error: "unknown setting: colour" });
  });
});
