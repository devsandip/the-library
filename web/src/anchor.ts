import { QUOTE_CONTEXT } from "@library/core/highlights";
import type { HighlightQuote } from "@library/core/types";

/**
 * Finding a highlight again (#167). A kept passage is a quote (the passage and a little context
 * either side, #166), never offsets, so it is found in whatever the frame renders. The page's
 * text is read as the reader sees it: the text of its text nodes, with a line break where a block
 * (a paragraph, a table cell) starts or ends, so words either side of one never run together.
 * Whitespace is compared collapsed, the way quotes are kept. Pure, so the tests run without a
 * DOM: the frame's document is walked through the few node fields used here.
 */

/** The parts of a DOM node the walk reads. */
export interface NodeLike {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<NodeLike>;
}

const ELEMENT = 1;
const TEXT = 3;

/** Elements whose text is not the newsletter's. */
const SKIP = new Set(["HEAD", "NOSCRIPT", "SCRIPT", "STYLE", "SVG", "TEMPLATE", "TITLE"]);

/** Elements that start a new line, tables' cells and rows among them: email is laid out in tables. */
const BLOCK = new Set(
  (
    "ADDRESS ARTICLE ASIDE BLOCKQUOTE BR CAPTION CENTER DD DIV DL DT FIELDSET FIGCAPTION FIGURE " +
    "FOOTER FORM H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P PRE SECTION TABLE TBODY TD TFOOT " +
    "TH THEAD TR UL"
  ).split(" "),
);

/** The page's text, and where each text node's text sits in it. */
export interface TextIndex<N> {
  text: string;
  runs: { node: N; start: number; end: number }[];
}

export function textIndex<N extends NodeLike>(root: N): TextIndex<N> {
  let text = "";
  const runs: TextIndex<N>["runs"] = [];
  const walk = (n: NodeLike) => {
    if (n.nodeType === TEXT) {
      const v = n.nodeValue ?? "";
      if (v) runs.push({ node: n as N, start: text.length, end: text.length + v.length });
      text += v;
      return;
    }
    if (n.nodeType !== ELEMENT) return;
    const name = n.nodeName.toUpperCase();
    if (SKIP.has(name)) return;
    const block = BLOCK.has(name);
    if (block) text += "\n";
    for (let i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]!);
    if (block) text += "\n";
  };
  walk(root);
  return { text, runs };
}

/** The text with whitespace collapsed, as `squash` does, and where each character came from. */
function squashed(text: string): { s: string; at: number[] } {
  let s = "";
  const at: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const blank = /\s/.test(c);
    if (blank && space) continue;
    s += blank ? " " : c;
    at.push(i);
    space = blank;
  }
  return { s, at };
}

/** The first collapsed character that came from at or after `raw`. */
function after(at: number[], raw: number): number {
  let lo = 0;
  let hi = at.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at[mid]! < raw) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The quote for the passage from `start` to `end` of the text (a selection): the passage trimmed,
 * and up to 32 characters of context either side. None when the passage is only whitespace.
 */
export function quoteAt(text: string, start: number, end: number): HighlightQuote | undefined {
  const { s, at } = squashed(text);
  let i = after(at, start);
  let j = after(at, end);
  while (i < j && s[i] === " ") i++;
  while (j > i && s[j - 1] === " ") j--;
  if (i >= j) return undefined;
  return {
    exact: s.slice(i, j),
    prefix: s.slice(Math.max(0, i - QUOTE_CONTEXT), i),
    suffix: s.slice(j, j + QUOTE_CONTEXT),
  };
}

/** How many characters `a` and `b` share from their ends, or from their starts. */
const sharedEnd = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};
const sharedStart = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/**
 * Where a kept quote is in the text, from `start` to `end`: of the places its passage appears, the
 * one whose context matches best (the first, on a tie). None when the text no longer holds it.
 */
export function locate(
  text: string,
  q: HighlightQuote,
): { start: number; end: number } | undefined {
  if (!q.exact) return undefined;
  const { s, at } = squashed(text);
  const whole = q.prefix.length + q.suffix.length;
  let best: { i: number; score: number } | undefined;
  for (let i = s.indexOf(q.exact); i !== -1; i = s.indexOf(q.exact, i + 1)) {
    const j = i + q.exact.length;
    const score =
      sharedEnd(s.slice(Math.max(0, i - q.prefix.length), i), q.prefix) +
      sharedStart(s.slice(j, j + q.suffix.length), q.suffix);
    if (!best || score > best.score) best = { i, score };
    if (score === whole) break;
  }
  if (!best) return undefined;
  return { start: at[best.i]!, end: at[best.i + q.exact.length - 1]! + 1 };
}

/**
 * The parts of text nodes a passage covers, to mark. Whitespace on its own is left out: a mark
 * between a table's cells would move them.
 */
export function pieces<N>(
  index: TextIndex<N>,
  start: number,
  end: number,
): { node: N; from: number; to: number }[] {
  const out: { node: N; from: number; to: number }[] = [];
  for (const r of index.runs) {
    if (r.end <= start) continue;
    if (r.start >= end) break;
    const from = Math.max(start, r.start);
    const to = Math.min(end, r.end);
    if (/\S/.test(index.text.slice(from, to))) {
      out.push({ node: r.node, from: from - r.start, to: to - r.start });
    }
  }
  return out;
}
