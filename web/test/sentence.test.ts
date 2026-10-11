import { describe, expect, it } from "vitest";
import type { SenderListItem } from "@library/core/types";
import { countWord, senderIds, sendersPhrase, topicNames, topicsPhrase } from "../src/sentence.js";

describe("the filter sentence", () => {
  it("names the topics, then counts the rest", () => {
    expect(topicsPhrase([])).toBe("all topics");
    expect(topicsPhrase(["AI & LLMs"])).toBe("about AI & LLMs");
    expect(topicsPhrase(["AI & LLMs", "Startups & Business"])).toBe(
      "about AI & LLMs and Startups & Business",
    );
    expect(topicsPhrase(["AI & LLMs", "Startups & Business", "Tech Industry"])).toBe(
      "about AI & LLMs and 2 more",
    );
  });

  it("names the first sender, then counts the rest", () => {
    expect(sendersPhrase([])).toBe("all senders");
    expect(sendersPhrase(["The Ken"])).toBe("from The Ken");
    expect(sendersPhrase(["The Ken", "Platformer"])).toBe("from The Ken and 1 more");
  });

  it("counts what has loaded when the number is not known", () => {
    expect(countWord(23)).toBe("23");
    expect(countWord(30, true)).toBe("30+");
    expect(countWord(undefined)).toBe("…");
  });
});

describe("filters from the URL", () => {
  const topics = ["AI & LLMs", "Startups & Business", "Tech Industry"].map((name) => ({
    name,
    description: "",
  }));
  const sender = (senderId: string, publication: string) =>
    ({ senderId, publication }) as SenderListItem;
  const senders = [sender("s1", "The Ken"), sender("s2", "Platformer")];

  it("turns topic slugs into names, in Claude's order, dropping unknown ones", () => {
    expect(topicNames(["tech-industry", "ai-llms", "gone"], topics)).toEqual([
      "AI & LLMs",
      "Tech Industry",
    ]);
  });

  it("finds senders by slug or by id, once each", () => {
    expect(senderIds(["platformer", "s1", "the-ken", "nobody"], senders)).toEqual(["s2", "s1"]);
  });
});
