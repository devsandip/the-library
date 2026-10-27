import { describe, expect, it } from "vitest";
import { question } from "../src/pages/search.js";

describe("question: Search offers Ask for a question (#21)", () => {
  it("reads a question mark or a question word as a question", () => {
    expect(question("agent evals?")).toBe(true);
    expect(question("What did TLDR say about evals")).toBe(true);
    expect(question("  how do agents book travel")).toBe(true);
  });

  it("leaves words to find alone", () => {
    expect(question("agent evals")).toBe(false);
    expect(question("whatsapp")).toBe(false);
    expect(question("Discord messages")).toBe(false);
  });
});
