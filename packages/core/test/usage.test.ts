import { describe, expect, it } from "vitest";
import {
  claudeUse,
  dayUsageOf,
  limitMessage,
  titanUse,
  useAttribute,
  usesAttribute,
} from "../src/usage.js";

describe("usage (#208)", () => {
  it("prices Claude at $1 and $5 a million tokens, Titan at $0.02, unrounded", () => {
    expect(claudeUse(2000, 300)).toEqual({ inputTokens: 2000, outputTokens: 300, cents: 0.35 });
    expect(titanUse(50_000).cents).toBeCloseTo(0.1, 10);
  });

  it("names a feature's counters and reads a day's item back, skipping unused features", () => {
    expect(useAttribute("ask", "inputTokens")).toBe("ask_in");
    const day = dayUsageOf({
      pk: "USAGE",
      sk: "2026-10-29",
      ask_calls: 2,
      ask_in: 4000,
      ask_out: 600,
      ask_cents: 0.7,
      search_calls: 3,
      search_in: 30,
      search_cents: 0.00006,
    });
    expect(day.day).toBe("2026-10-29");
    expect(day.cents).toBeCloseTo(0.70006, 10);
    expect(day.features).toEqual({
      ask: { calls: 2, inputTokens: 4000, outputTokens: 600, cents: 0.7 },
      search: { calls: 3, inputTokens: 30, outputTokens: 0, cents: 0.00006 },
    });
  });

  it("tells a reader at the limit plainly, in the singular for one (#209)", () => {
    expect(limitMessage("ask", 50)).toBe("That's today's 50 questions. More tomorrow.");
    expect(limitMessage("source", 1)).toBe("That's today's 1 source check. More tomorrow.");
    expect(usesAttribute("takes")).toBe("takes_uses");
  });
});
