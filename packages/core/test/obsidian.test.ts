import { describe, expect, it } from "vitest";
import {
  BLOCK_END,
  BLOCK_START,
  emptiedNote,
  issueNote,
  NONE_LEFT,
  noteIssueId,
  noteName,
} from "../src/obsidian.js";
import type { IssueListItem } from "../src/types.js";

const APP = "https://sandip.dev/nutgraf";

const issue: IssueListItem = {
  id: "19a2b3c4d5e6f708",
  senderId: "s0123456789ab",
  publication: "Platformer",
  subject: "Why #AI wins: the [long] view",
  snippet: "",
  // 20:00 UTC on the 27th is the 28th in India.
  receivedAt: "2026-10-27T20:00:00.000Z",
  readMinutes: 5,
  state: "read",
  viewOnlineUrl: "https://example.test/p/ai",
};

const first = { exact: "The model ships.", createdAt: "2026-10-29T05:00:00.000Z" };
const second = {
  exact: "It runs on a phone.",
  note: "See [[Edge AI]].",
  createdAt: "2026-10-29T06:00:00.000Z",
};

describe("a note's file name", () => {
  it("is the day in India, the newsletter and the subject, without characters a file cannot hold", () => {
    expect(noteName(issue)).toBe("2026-10-28 Platformer - Why AI wins the long view.md");
  });

  it("is cut at a word under 120 characters", () => {
    const name = noteName({ ...issue, subject: "word ".repeat(40) });
    expect(name.length).toBeLessThanOrEqual(123);
    expect(name).toMatch(/ word\.md$/);
  });
});

describe("an issue's note", () => {
  it("is made with properties Obsidian reads and the passages in the script's block", () => {
    expect(issueNote(issue, [second, first], APP)).toBe(
      [
        "---",
        'newsletter: "Platformer"',
        "date: 2026-10-28",
        'link: "https://example.test/p/ai"',
        `nutgraf: "${APP}/issue/19a2b3c4d5e6f708"`,
        'nutgraf_id: "19a2b3c4d5e6f708"',
        "---",
        "",
        BLOCK_START,
        `Platformer · 28 October 2026 · [View online](https://example.test/p/ai) · [Nutgraf](${APP}/issue/19a2b3c4d5e6f708)`,
        "",
        "> The model ships.",
        "",
        "> It runs on a phone.",
        "",
        "See [[Edge AI]].",
        BLOCK_END,
        "",
      ].join("\n"),
    );
    expect(noteIssueId(issueNote(issue, [first], APP))).toBe("19a2b3c4d5e6f708");
    expect(noteIssueId("# A note of my own\n")).toBeUndefined();
  });

  it("keeps Sandip's own text and properties, adds new passages and drops deleted ones", () => {
    const made = issueNote(issue, [first], APP);
    const edited = made
      .replace("---\n\n", "tags: [ai, reading]\n---\n\nMy summary first.\n\n")
      .concat("\n## My thoughts\n\nThis matters for the post.\n");
    const next = issueNote(issue, [second], APP, edited);
    expect(next).toContain("tags: [ai, reading]");
    expect(next).toContain("My summary first.");
    expect(next).toContain("## My thoughts\n\nThis matters for the post.\n");
    expect(next).toContain("> It runs on a phone.");
    expect(next).not.toContain("> The model ships.");
    expect(next.split(BLOCK_START)).toHaveLength(2);
  });

  it("is unchanged when nothing has changed, so nothing is written", () => {
    const made = issueNote(issue, [first, second], APP);
    expect(issueNote(issue, [second, first], APP, made)).toBe(made);
  });

  it("says when every highlight is gone, keeping the note", () => {
    const made = issueNote(issue, [first], APP).concat("\nMine.\n");
    const none = issueNote(issue, [], APP, made);
    expect(none).toContain(`${BLOCK_START}\n${NONE_LEFT}\n${BLOCK_END}`);
    expect(none).toContain("Mine.");
    // A note whose issue is gone from the list: only the block changes, and only once.
    const emptied = emptiedNote(made);
    expect(emptied).toBe(none);
    expect(emptiedNote(emptied)).toBe(emptied);
  });

  it("puts a deleted block back under the properties, after a note with none gets them", () => {
    const made = issueNote(issue, [first], APP);
    const cut = made.slice(0, made.indexOf(BLOCK_START)) + "Only my words now.\n";
    const back = issueNote(issue, [first], APP, cut);
    expect(back.indexOf(BLOCK_START)).toBeLessThan(back.indexOf("Only my words now."));
    const bare = issueNote(issue, [first], APP, "Just text.\n");
    expect(bare.startsWith('---\nnewsletter: "Platformer"')).toBe(true);
    expect(bare).toContain("Just text.");
  });
});
