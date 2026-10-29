/**
 * Highlights (#71, #166): passages kept as text-quote anchors, and the Markdown they export as.
 * The web app imports this too (`@library/core/highlights`), and so does the Obsidian script, so
 * the page's export and the vault's notes are the same Markdown.
 */
import { READER_TIME_ZONE } from "./days.js";
import type { Highlight, HighlightListItem, HighlightQuote, IssueListItem } from "./types.js";

/** The longest passage and the longest note kept, in characters. */
export const HIGHLIGHT_MAX = 2000;
export const NOTE_MAX = 2000;
/** Characters kept either side of a passage, enough to tell a repeated one apart. */
export const QUOTE_CONTEXT = 32;

/** Whitespace collapsed to single spaces: how a passage and the page it is found in compare. */
export const squash = (s: string) => s.replace(/\s+/g, " ");

/** A quote as kept: the passage trimmed, and at most 32 characters of context either side. */
export function cleanQuote(q: { exact: string; prefix?: string; suffix?: string }): HighlightQuote {
  return {
    exact: squash(q.exact).trim(),
    prefix: squash(q.prefix ?? "").slice(-QUOTE_CONTEXT),
    suffix: squash(q.suffix ?? "").slice(0, QUOTE_CONTEXT),
  };
}

/** A note as kept: trimmed, and none at all when that leaves nothing. */
export function cleanNote(note: string): string | undefined {
  const t = note.trim();
  return t ? t : undefined;
}

/** The same passage in the same place: a second tap on Highlight keeps the first. */
export const sameQuote = (a: HighlightQuote, b: HighlightQuote) =>
  a.exact === b.exact && a.prefix === b.prefix && a.suffix === b.suffix;

/**
 * A new highlight's key: the time in base 36 (8 characters until 2059) and 4 random ones, so keys
 * sort by when they were made.
 */
export function newHighlightKey(now: number, random: () => number = Math.random): string {
  const rand = Array.from({ length: 4 }, () => Math.floor(random() * 36).toString(36)).join("");
  return now.toString(36).padStart(8, "0") + rand;
}

// ---------- Markdown ----------

/** "28 October 2026", in India like the reader's days. */
export function longDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: READER_TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(Date.parse(iso));
}

/**
 * Newsletter text as plain Markdown: everything Markdown, or Obsidian, would read as formatting is
 * escaped, so "$5 to $10" is not maths, "#1" is not a tag and "==" is not a highlight.
 */
export function escapeMarkdown(s: string): string {
  return s
    .replace(/[\\`*_[\]#<>|~$]/g, "\\$&")
    .replace(/==/g, "\\=\\=")
    .replace(/%%/g, "\\%\\%")
    .replace(/^(\d+)([.)])/, "$1\\$2")
    .replace(/^[-+]/, "\\$&");
}

/** A link target that survives Markdown: spaces and brackets encoded. */
const target = (url: string) =>
  url.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

/** The issue in the app, at a highlight when given: `<appUrl>/issue/<id>?hl=<id>`. */
export function issueLink(appUrl: string, issueId: string, highlightId?: string): string {
  const base = `${appUrl.replace(/\/$/, "")}/issue/${encodeURIComponent(issueId)}`;
  return highlightId ? `${base}?hl=${encodeURIComponent(highlightId)}` : base;
}

/**
 * One issue's highlights: a line naming the newsletter, the date and the links, then each passage
 * as a quote with Sandip's note under it, in the order he made them. Notes are his own Markdown
 * and are left as written.
 */
export function issueMarkdown(
  issue: Pick<IssueListItem, "id" | "publication" | "receivedAt" | "viewOnlineUrl">,
  highlights: Pick<Highlight, "exact" | "note" | "createdAt">[],
  appUrl: string,
): string {
  const links = [
    ...(issue.viewOnlineUrl ? [`[View online](${target(issue.viewOnlineUrl)})`] : []),
    `[Nutgraf](${target(issueLink(appUrl, issue.id))})`,
  ];
  const lines = [
    [escapeMarkdown(issue.publication), longDate(issue.receivedAt), ...links].join(" · "),
  ];
  for (const h of [...highlights].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    lines.push("", `> ${escapeMarkdown(h.exact)}`);
    if (h.note) lines.push("", h.note);
  }
  return lines.join("\n") + "\n";
}

/** Highlights grouped by issue, the issue with the newest highlight first. */
export function byIssue(
  items: HighlightListItem[],
): { issue: IssueListItem; highlights: Highlight[] }[] {
  const groups = new Map<
    string,
    { issue: IssueListItem; highlights: Highlight[]; latest: string }
  >();
  for (const { issue, ...h } of items) {
    const g = groups.get(issue.id) ?? { issue, highlights: [], latest: "" };
    g.highlights.push(h);
    if (h.createdAt > g.latest) g.latest = h.createdAt;
    groups.set(issue.id, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.latest.localeCompare(a.latest))
    .map(({ issue, highlights }) => ({ issue, highlights }));
}

/** Every highlight given, as one Markdown document for any notes app: a section per issue. */
export function highlightsMarkdown(
  items: HighlightListItem[],
  opts: { appUrl: string; exportedAt: string; since?: string },
): string {
  const groups = byIssue(items);
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const head = [
    "# Highlights from Nutgraf",
    "",
    `${count(items.length, "highlight")} from ${count(groups.length, "issue")}` +
      `${opts.since ? ` since ${longDate(opts.since)}` : ""}, exported ${longDate(opts.exportedAt)}.`,
  ];
  const sections = groups.map(
    (g) =>
      `## ${escapeMarkdown(g.issue.subject)}\n\n` +
      issueMarkdown(g.issue, g.highlights, opts.appUrl).trimEnd(),
  );
  return [head.join("\n"), ...sections].join("\n\n").trimEnd() + "\n";
}
