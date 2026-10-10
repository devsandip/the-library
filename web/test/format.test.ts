import { describe, expect, it } from "vitest";
import { digestLine } from "../src/format.js";

describe("digestLine", () => {
  it("states the share rated Relevant against the aim", () => {
    expect(digestLine({ days: 4, shown: 20, relevant: 7, irrelevant: 3 })).toBe(
      "Boxed top 5s, last 14 days: 7 of 20 rated Relevant (35%), 3 Irrelevant. The aim is 60%.",
    );
  });
});
