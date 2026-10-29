import { describe, expect, it } from "vitest";
import {
  byIssue,
  cleanNote,
  cleanQuote,
  escapeMarkdown,
  highlightsMarkdown,
  issueLink,
  issueMarkdown,
  newHighlightKey,
  sameQuote,
} from "../src/highlights.js";
import { HIGHLIGHT_ID, highlightIndexAttributes, highlightKeyFromId } from "../src/keys.js";
import type { HighlightListItem, IssueListItem } from "../src/types.js";

const APP = "https://sandip.dev/nutgraf";

const issue = (id: string, over: Partial<IssueListItem> = {}): IssueListItem => ({
  id,
  senderId: "s0123456789ab",
  publication: "Platformer",
  subject: `Issue ${id}`,
  snippet: "",
  receivedAt: "2026-10-28T02:00:00.000Z",
  readMinutes: 5,
  state: "read",
  ...over,
});

const hl = (
  issueId: string,
  createdAt: string,
  exact: string,
  over: Partial<HighlightListItem> = {},
): HighlightListItem => ({
  id: `${issueId}.${newHighlightKey(Date.parse(createdAt), () => 0)}`,
  issueId,
  exact,
  prefix: "",
  suffix: "",
  createdAt,
  issue: issue(issueId),
  ...over,
});

describe("quotes and notes", () => {
  it("collapses whitespace, trims the passage and keeps 32 characters of context", () => {
    const q = cleanQuote({
      exact: "\n  The model\n\tships  today. ",
      prefix: `${"a".repeat(40)} and then:\n`,
      suffix: "  It is small, and it runs on a phone without a server.",
    });
    expect(q.exact).toBe("The model ships today.");
    expect(q.prefix).toBe(`${"a".repeat(26)} and then: `.slice(-32));
    expect(q.prefix).toHaveLength(32);
    expect(q.suffix).toBe(" It is small, and it runs on a p");
    expect(cleanQuote({ exact: "x" })).toEqual({ exact: "x", prefix: "", suffix: "" });
  });

  it("tells the same passage in the same place from the same words elsewhere", () => {
    const a = { exact: "AI", prefix: "the ", suffix: " race" };
    expect(sameQuote(a, { ...a })).toBe(true);
    expect(sameQuote(a, { ...a, prefix: "an " })).toBe(false);
  });

  it("keeps a note trimmed, and none when it is blank", () => {
    expect(cleanNote("  Worth a post.\n")).toBe("Worth a post.");
    expect(cleanNote(" \n ")).toBeUndefined();
  });
});

describe("keys", () => {
  it("makes 12-character keys that sort by time and fit the id", () => {
    const a = newHighlightKey(Date.parse("2026-10-29T05:00:00.000Z"), () => 0.99);
    const b = newHighlightKey(Date.parse("2026-10-29T05:00:00.001Z"), () => 0);
    expect(a).toHaveLength(12);
    expect(a < b).toBe(true);
    expect(HIGHLIGHT_ID.test(`19a2b3c4d5e6f708.${a}`)).toBe(true);
    expect(highlightKeyFromId(`19a2b3c4d5e6f708.${a}`)).toEqual({
      pk: "ISSUE#19a2b3c4d5e6f708",
      sk: `HL#${a}`,
    });
    expect(highlightKeyFromId("19a2b3c4d5e6f708.2")).toBeUndefined();
    expect(highlightIndexAttributes("i1", a, "2026-10-29T05:00:00.000Z")).toEqual({
      gsi1pk: "HIGHLIGHTS",
      gsi1sk: `2026-10-29T05:00:00.000Z#i1#${a}`,
    });
  });
});

describe("Markdown", () => {
  it("escapes what Markdown or Obsidian would read as formatting", () => {
    expect(escapeMarkdown("From $5 to $10, #1 in *AI* [beta] == big %% <b>")).toBe(
      "From \\$5 to \\$10, \\#1 in \\*AI\\* \\[beta\\] \\=\\= big \\%\\% \\<b\\>",
    );
    expect(escapeMarkdown("1. First")).toBe("1\\. First");
    expect(escapeMarkdown("- a dash")).toBe("\\- a dash");
    expect(escapeMarkdown("snake_case \\ path")).toBe("snake\\_case \\\\ path");
  });

  it("links the issue in the app, at a highlight when given", () => {
    expect(issueLink(`${APP}/`, "i1")).toBe(`${APP}/issue/i1`);
    expect(issueLink(APP, "i1", "i1.mh0abcd1wxyz")).toBe(`${APP}/issue/i1?hl=i1.mh0abcd1wxyz`);
  });

  it("writes an issue's passages as quotes in the order they were made, notes as written", () => {
    const i = issue("i1", { viewOnlineUrl: "https://example.test/p/a post (1)" });
    const md = issueMarkdown(
      i,
      [
        { exact: "Second, *later*.", createdAt: "2026-10-29T06:00:00.000Z", note: "See [[AI]]." },
        { exact: "First.", createdAt: "2026-10-29T05:00:00.000Z" },
      ],
      APP,
    );
    expect(md).toBe(
      [
        "Platformer · 28 October 2026 · [View online](https://example.test/p/a%20post%20%281%29) · " +
          `[Nutgraf](${APP}/issue/i1)`,
        "",
        "> First.",
        "",
        "> Second, \\*later\\*.",
        "",
        "See [[AI]].",
        "",
      ].join("\n"),
    );
    expect(issueMarkdown(issue("i2"), [], APP)).toBe(
      `Platformer · 28 October 2026 · [Nutgraf](${APP}/issue/i2)\n`,
    );
  });

  it("dates the issue by the reader's day in India", () => {
    const late = issue("i3", { receivedAt: "2026-10-28T20:00:00.000Z" });
    expect(issueMarkdown(late, [], APP)).toContain("29 October 2026");
  });

  it("groups by issue, the one highlighted last first", () => {
    const items = [
      hl("b", "2026-10-29T07:00:00.000Z", "B2"),
      hl("a", "2026-10-29T06:00:00.000Z", "A2"),
      hl("b", "2026-10-29T05:00:00.000Z", "B1"),
      hl("a", "2026-10-29T04:00:00.000Z", "A1"),
    ];
    const groups = byIssue(items);
    expect(groups.map((g) => g.issue.id)).toEqual(["b", "a"]);
    expect(groups[0]!.highlights.map((h) => h.exact)).toEqual(["B2", "B1"]);
    expect(groups[0]!.highlights[0]).not.toHaveProperty("issue");
  });

  it("exports one document with a section per issue", () => {
    const items = [
      hl("b", "2026-10-29T07:00:00.000Z", "B1", { issue: issue("b", { subject: "Why #AI wins" }) }),
      hl("a", "2026-10-29T06:00:00.000Z", "A1", { note: "Mine." }),
    ];
    const md = highlightsMarkdown(items, {
      appUrl: APP,
      exportedAt: "2026-10-29T08:00:00.000Z",
      since: "2026-10-01T00:00:00.000+05:30",
    });
    expect(md).toBe(
      [
        "# Highlights from Nutgraf",
        "",
        "2 highlights from 2 issues since 1 October 2026, exported 29 October 2026.",
        "",
        "## Why \\#AI wins",
        "",
        `Platformer · 28 October 2026 · [Nutgraf](${APP}/issue/b)`,
        "",
        "> B1",
        "",
        "## Issue a",
        "",
        `Platformer · 28 October 2026 · [Nutgraf](${APP}/issue/a)`,
        "",
        "> A1",
        "",
        "Mine.",
        "",
      ].join("\n"),
    );
    expect(
      highlightsMarkdown([items[1]!], { appUrl: APP, exportedAt: items[1]!.createdAt }),
    ).toContain("1 highlight from 1 issue, exported 29 October 2026.");
  });
});
