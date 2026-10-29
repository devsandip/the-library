import { describe, expect, it } from "vitest";
import { cleanQuote, squash } from "@library/core/highlights";
import { locate, pieces, quoteAt, textIndex, type NodeLike } from "../src/anchor.js";

// A stand-in DOM: elements and text nodes, with only the fields the walk reads.
const text = (v: string): NodeLike => ({
  nodeType: 3,
  nodeName: "#text",
  nodeValue: v,
  childNodes: [],
});
const el = (name: string, ...kids: (NodeLike | string)[]): NodeLike => ({
  nodeType: 1,
  nodeName: name,
  nodeValue: null,
  childNodes: kids.map((k) => (typeof k === "string" ? text(k) : k)),
});
const comment = (v: string): NodeLike => ({
  nodeType: 8,
  nodeName: "#comment",
  nodeValue: v,
  childNodes: [],
});

/**
 * The quote a selection would keep: from the first `from` (after `skip` characters of the page's
 * text) to the end of the next `to`, as a drag across the page's elements would select it.
 */
function select(root: NodeLike, from: string, to = from, skip = 0) {
  const { text: t } = textIndex(root);
  const start = t.indexOf(from, skip);
  return quoteAt(t, start, t.indexOf(to, start) + to.length)!;
}

/** The page's text at a located passage, collapsed as quotes are. */
function found(root: NodeLike, q: ReturnType<typeof select>) {
  const { text: t } = textIndex(root);
  const at = locate(t, q);
  return at && squash(t.slice(at.start, at.end));
}

// An email as it arrives: a table, a cell, paragraphs with inline markup.
const page = el(
  "BODY",
  el("STYLE", "p { color: red }"),
  el(
    "TABLE",
    "\n  ",
    el(
      "TBODY",
      el(
        "TR",
        "\n    ",
        el(
          "TD",
          el("P", "The model ", el("B", "ships"), " today."),
          comment(" tracking "),
          el("P", "It is small, and it ", el("A", "runs on a phone"), "."),
        ),
        "\n    ",
        el("TD", "Sponsor"),
      ),
    ),
  ),
);

describe("the page's text", () => {
  it("breaks lines at blocks, runs inline markup together and leaves out styles and comments", () => {
    const { text: t } = textIndex(page);
    expect(squash(t).trim()).toBe(
      "The model ships today. It is small, and it runs on a phone. Sponsor",
    );
    expect(t).not.toContain("color");
    expect(t).not.toContain("tracking");
  });
});

describe("saving from a selection", () => {
  it("keeps the passage across elements, trimmed, with 32 characters of context either side", () => {
    const { text: t } = textIndex(page);
    // A selection that starts and ends in whitespace, across the bold, the paragraphs and a link.
    const start = t.indexOf(" ships");
    const end = t.indexOf("runs on") + "runs on".length + 1;
    const q = quoteAt(t, start, end)!;
    expect(q).toEqual({
      exact: "ships today. It is small, and it runs on",
      prefix: " The model ",
      suffix: " a phone. Sponsor ",
    });
    // What the API keeps is what was sent.
    expect(cleanQuote(q)).toEqual(q);
  });

  it("keeps nothing from a selection of whitespace", () => {
    const { text: t } = textIndex(page);
    const gap = t.indexOf("\n");
    expect(quoteAt(t, gap, gap + 2)).toBeUndefined();
  });

  it("cuts the context at 32 characters", () => {
    const long = el("P", `${"a".repeat(50)} middle ${"b".repeat(50)}`);
    const q = select(long, "middle");
    expect(q.prefix).toBe(`${"a".repeat(31)} `);
    expect(q.suffix).toBe(` ${"b".repeat(31)}`);
  });
});

describe("finding a highlight again", () => {
  it("finds a passage across element boundaries in a page whose markup and spacing changed", () => {
    const q = select(page, "ships", "It is small");
    const later = el(
      "BODY",
      el("DIV", "The model ", el("I", "ships"), "\n   today."),
      el("DIV", el("SPAN", "It is small,"), " and it runs on a phone."),
    );
    expect(found(later, q)).toBe("ships today. It is small");
  });

  it("tells repeated text apart by its context", () => {
    const repeated = el(
      "BODY",
      el("P", "Part 1. This is placeholder text."),
      el("P", "Part 2. This is placeholder text."),
      el("P", "Part 3. This is placeholder text."),
    );
    const second = select(repeated, "This", "text.", 20);
    const { text: t } = textIndex(repeated);
    const at = locate(t, second)!;
    expect(t.slice(0, at.start)).toContain("Part 2.");
    expect(t.slice(0, at.start)).not.toContain("Part 3.");
    // With its context gone, the first place the words appear.
    const bare = locate(t, { ...second, prefix: "", suffix: "" })!;
    expect(t.slice(0, bare.start)).not.toContain("Part 2.");
    // A context that has partly changed still points at the closest match.
    const third = select(repeated, "This", "text.", 50);
    const near = locate(t, { ...third, prefix: `XX${third.prefix.slice(2)}` })!;
    expect(t.slice(0, near.start)).toContain("Part 3.");
  });

  it("finds the first of repeats that share their context too, which the reader warns of", () => {
    const same = el("P", "Again and again. ".repeat(12));
    const { text: t } = textIndex(same);
    const sixth = t.indexOf("Again", 17 * 5);
    const q = quoteAt(t, sixth, sixth + 5)!;
    expect(locate(t, q)!.start).toBeLessThan(sixth);
  });

  it("finds nothing when the page no longer holds the passage", () => {
    const q = select(page, "ships", "today");
    const changed = el("BODY", el("P", "The model shipped yesterday."));
    expect(found(changed, q)).toBeUndefined();
    expect(locate("anything", { exact: "", prefix: "", suffix: "" })).toBeUndefined();
  });

  it("marks the text nodes a passage covers, never whitespace between table cells", () => {
    const index = textIndex(page);
    const at = locate(index.text, select(page, "today.", "Sponsor"))!;
    expect(pieces(index, at.start, at.end).map((p) => [p.node.nodeValue, p.from, p.to])).toEqual([
      [" today.", 1, 7],
      ["It is small, and it ", 0, 20],
      ["runs on a phone", 0, 15],
      [".", 0, 1],
      ["Sponsor", 0, 7],
    ]);
  });
});
