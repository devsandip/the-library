import { describe, expect, it } from "vitest";
import { forwardPassages, looksForward, periodEnd, quoteIn } from "../src/predictions.js";

describe("looksForward", () => {
  it("is a sentence that looks forward and names a time", () => {
    expect(looksForward("OpenAI will ship GPT-6 by March, its chief executive said.")).toBe(true);
    expect(looksForward("The Fed is expected to cut rates in December.")).toBe(true);
    expect(looksForward("Analysts forecast the deal closes in Q3 2027.")).toBe(true);
    expect(looksForward("Waymo plans to reach ten cities within two years.")).toBe(true);
    expect(looksForward("Revenue should double by the end of the year.")).toBe(true);
  });

  it("is not one that only looks back, or has no time", () => {
    expect(looksForward("OpenAI shipped GPT-5 last March.")).toBe(false);
    expect(looksForward("AI will change everything about how we work.")).toBe(false);
    expect(looksForward("If rates fall, startups will raise again.")).toBe(false);
  });
});

describe("forwardPassages", () => {
  it("keeps each forward sentence with its neighbours, and nothing else", () => {
    const text = [
      "Intro about the week.",
      "Some background on the company and its products.",
      "The company will open its first store in Mumbai by June 2027.",
      "It already has stores in Delhi.",
      "An unrelated item about chips and memory prices.",
      "Another unrelated item that goes on for a while.",
      "A last line about something else entirely.",
    ].join(" ");
    const p = forwardPassages(text);
    expect(p).toBe(
      "Some background on the company and its products. The company will open its first store " +
        "in Mumbai by June 2027. It already has stores in Delhi.",
    );
    expect(forwardPassages("Nothing here looks ahead at all. Just facts about the past.")).toBe("");
  });
});

describe("periodEnd", () => {
  // Claude resolves "by March", "next year", "Q3" or "in two years" from the date sent into a
  // day, month, quarter or year; the code ends the period.
  it("is the last day of the period given", () => {
    expect(periodEnd("2027-03")).toBe("2027-03-31");
    expect(periodEnd("2028-02")).toBe("2028-02-29");
    expect(periodEnd("2027-Q3")).toBe("2027-09-30");
    expect(periodEnd("2027-q1")).toBe("2027-03-31");
    expect(periodEnd("2027")).toBe("2027-12-31");
    expect(periodEnd("2027-03-15")).toBe("2027-03-15");
  });

  it("is nothing for a period it cannot read", () => {
    expect(periodEnd("2027-13")).toBeUndefined();
    expect(periodEnd("2027-02-30")).toBeUndefined();
    expect(periodEnd("next year")).toBeUndefined();
    expect(periodEnd("")).toBeUndefined();
  });
});

describe("quoteIn", () => {
  it("finds the words whatever their case, spacing and curly quotes", () => {
    const text = "The CEO said: “We’ll ship  it by\nMarch.” Then he left.";
    expect(quoteIn(text, '"we\'ll ship it by march."')).toBe(true);
    expect(quoteIn(text, "We will ship it by March")).toBe(false);
    expect(quoteIn(text, "ship")).toBe(false);
  });
});
