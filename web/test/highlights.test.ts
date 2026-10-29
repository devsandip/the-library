import { describe, expect, it } from "vitest";
import type { HighlightListItem, IssueListItem } from "@library/core/types";
import { exportFile, groups, newsletters, pick } from "../src/highlights.js";

const APP = "https://sandip.dev/nutgraf";

const issue = (id: string, publication: string): IssueListItem => ({
  id,
  senderId: "s0123456789ab",
  publication,
  subject: `Issue ${id}`,
  snippet: "",
  receivedAt: "2026-10-20T02:00:00.000Z",
  readMinutes: 5,
  state: "read",
});

let n = 0;
const hl = (
  i: IssueListItem,
  createdAt: string,
  exact: string,
  note?: string,
): HighlightListItem => ({
  id: `${i.id}.${String(n++).padStart(12, "0")}`,
  issueId: i.id,
  exact,
  prefix: "",
  suffix: "",
  ...(note ? { note } : {}),
  createdAt,
  issue: i,
});

const a = issue("a", "Platformer");
const b = issue("b", "Stratechery");
// Newest first, as the API lists them.
const items = [
  hl(b, "2026-10-29T05:00:00.000Z", "B2"),
  hl(a, "2026-10-28T20:00:00.000Z", "A2", "Mine."),
  hl(b, "2026-10-27T05:00:00.000Z", "B1"),
  hl(a, "2026-10-20T05:00:00.000Z", "A1"),
  hl(a, "2026-10-19T05:00:00.000Z", "A0"),
];

describe("the Highlights page", () => {
  it("offers the newsletters highlighted from, most highlights first", () => {
    expect(newsletters(items)).toEqual([
      { publication: "Platformer", count: 3 },
      { publication: "Stratechery", count: 2 },
    ]);
  });

  it("groups by issue, the one highlighted last first, passages in the order they were made", () => {
    const g = groups(items);
    expect(g.map((x) => x.issue.id)).toEqual(["b", "a"]);
    expect(g[1]!.highlights.map((h) => h.exact)).toEqual(["A0", "A1", "A2"]);
  });

  it("filters by newsletter, and by the day in India a highlight was made on", () => {
    expect(pick(items, { newsletter: "Stratechery" }).map((h) => h.exact)).toEqual(["B2", "B1"]);
    // 20:00 UTC on the 28th is the 29th in India.
    expect(pick(items, { since: "2026-10-29" }).map((h) => h.exact)).toEqual(["B2", "A2"]);
    expect(
      pick(items, { newsletter: "Platformer", since: "2026-10-20" }).map((h) => h.exact),
    ).toEqual(["A2", "A1"]);
    expect(pick(items, {})).toHaveLength(5);
  });

  it("exports the highlights shown as one Markdown file, saying since when", () => {
    const now = Date.parse("2026-10-29T08:00:00.000Z");
    const shown = pick(items, { since: "2026-10-27" });
    const file = exportFile(shown, { appUrl: APP, since: "2026-10-27", now });
    expect(file.name).toBe("nutgraf-highlights-2026-10-29.md");
    expect(file.markdown).toContain(
      "3 highlights from 2 issues since 27 October 2026, exported 29 October 2026.",
    );
    expect(file.markdown.indexOf("## Issue b")).toBeLessThan(file.markdown.indexOf("## Issue a"));
    expect(file.markdown).toContain("> A2\n\nMine.\n");
    const all = exportFile(items, { appUrl: APP, now });
    expect(all.markdown).toContain("5 highlights from 2 issues, exported 29 October 2026.");
  });
});
