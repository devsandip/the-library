import { describe, expect, it } from "vitest";
import type { IssueListItem } from "@library/core/types";
import { patchIssue, topicSections, UNSORTED } from "../src/groups.js";

const issue = (id: string, topic?: string): IssueListItem => ({
  id,
  senderId: "s",
  publication: "P",
  subject: id,
  snippet: "",
  receivedAt: "2026-10-10T00:00:00Z",
  readMinutes: 1,
  state: "unread",
  topic,
});

describe("topicSections", () => {
  it("groups in Claude's topic order and keeps each section in list order", () => {
    const items = [issue("a", "Tech"), issue("b", "AI"), issue("c", "Tech"), issue("d", "AI")];
    const sections = topicSections(items, ["AI", "Tech"]);
    expect(sections.map((s) => s.name)).toEqual(["AI", "Tech"]);
    expect(sections[0]!.items.map((i) => i.id)).toEqual(["b", "d"]);
    expect(sections[1]!.items.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("puts topics off the list after the known ones, and unsorted issues last", () => {
    const items = [issue("a"), issue("b", "Old topic"), issue("c", "AI"), issue("d", "Retired")];
    const sections = topicSections(items, ["AI"]);
    expect(sections.map((s) => s.name)).toEqual(["AI", "Old topic", "Retired", UNSORTED]);
  });

  it("returns nothing for an empty list", () => {
    expect(topicSections([], ["AI"])).toEqual([]);
  });
});

describe("patchIssue", () => {
  it("changes only the matching issue", () => {
    const items = [issue("a"), issue("b")];
    const next = patchIssue(items, "b", { state: "read" });
    expect(next.map((i) => i.state)).toEqual(["unread", "read"]);
    expect(next[0]).toBe(items[0]);
  });
});
