/**
 * Highlights as notes in Sandip's Obsidian vault (#169): one note per issue, made and kept up by
 * `pnpm highlights-obsidian`. The script owns the note's properties it writes and the block
 * between its markers; everything else in the note is Sandip's and is kept as he left it.
 */
import { readerDay } from "./days.js";
import { issueMarkdown } from "./highlights.js";
import type { Highlight, IssueListItem } from "./types.js";

/** The block the script rewrites: Obsidian comments, hidden in reading view and live preview. */
export const BLOCK_START = "%% nutgraf:start %%";
export const BLOCK_END = "%% nutgraf:end %%";

/** What the block says once an issue's highlights are all deleted in Nutgraf. */
export const NONE_LEFT = "No highlights left in Nutgraf.";

/** The longest file name made, before `.md`: short enough for every file system and sync. */
const NAME_MAX = 120;

type NoteIssue = Pick<
  IssueListItem,
  "id" | "publication" | "subject" | "receivedAt" | "viewOnlineUrl"
>;

/**
 * A new note's file name: "2026-10-28 Platformer - Why AI wins.md", without the characters a
 * file system or an Obsidian link cannot hold. A note keeps its name once made: it is found again
 * by its `nutgraf` property, so Sandip can rename it.
 */
export function noteName(issue: NoteIssue): string {
  const clean = (s: string) =>
    s
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  let name = `${readerDay(Date.parse(issue.receivedAt))} ${clean(issue.publication)} - ${clean(issue.subject)}`;
  if (name.length > NAME_MAX) name = name.slice(0, NAME_MAX).replace(/\s+\S*$/, "");
  return `${name.replace(/[ .]+$/, "")}.md`;
}

/** The properties the script writes, in order; other properties in the note are Sandip's. */
function properties(issue: NoteIssue, appUrl: string): [string, string][] {
  return [
    ["newsletter", JSON.stringify(issue.publication)],
    ["date", readerDay(Date.parse(issue.receivedAt))],
    ...(issue.viewOnlineUrl
      ? [["link", JSON.stringify(issue.viewOnlineUrl)] as [string, string]]
      : []),
    ["nutgraf", JSON.stringify(`${appUrl.replace(/\/$/, "")}/issue/${issue.id}`)],
    ["nutgraf_id", JSON.stringify(issue.id)],
  ];
}

/** The issue a note was made for: its `nutgraf_id` property, if it has one. */
export function noteIssueId(note: string): string | undefined {
  const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(note);
  const line = fm?.[1]!.split("\n").find((l) => l.startsWith("nutgraf_id:"));
  if (!line) return undefined;
  const v = line.slice("nutgraf_id:".length).trim();
  try {
    return v.startsWith('"') ? (JSON.parse(v) as string) : v || undefined;
  } catch {
    return undefined;
  }
}

/** The properties, with ours set and Sandip's kept; a note without any gets ours. */
function withProperties(note: string, ours: [string, string][]): string {
  const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(note);
  const lines = fm ? fm[1]!.split("\n") : [];
  for (const [k, v] of ours) {
    const at = lines.findIndex((l) => l.startsWith(`${k}:`));
    if (at === -1) lines.push(`${k}: ${v}`);
    else lines[at] = `${k}: ${v}`;
  }
  const body = fm ? note.slice(fm[0].length) : note;
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

/**
 * An issue's note: new, or `existing` brought up to date. The block holds the issue's line (its
 * newsletter, date and links) and each passage as a quote with its note, in the order made
 * (`issueMarkdown`, as the Highlights page exports them); with none left, says so. A note whose
 * block was deleted gets it back under its properties.
 */
export function issueNote(
  issue: NoteIssue,
  highlights: Pick<Highlight, "exact" | "note" | "createdAt">[],
  appUrl: string,
  existing?: string,
): string {
  const inner = highlights.length ? issueMarkdown(issue, highlights, appUrl).trimEnd() : NONE_LEFT;
  return withBlock(withProperties(existing ?? "", properties(issue, appUrl)), inner);
}

/**
 * A note whose issue has no highlights left in Nutgraf (deleted, or the issue filtered since):
 * its block says so; its properties and Sandip's text stay as they are.
 */
export const emptiedNote = (note: string) => withBlock(note, NONE_LEFT);

/** The note with the script's block holding `inner`: in its place, or else under the properties. */
function withBlock(note: string, inner: string): string {
  const block = `${BLOCK_START}\n${inner}\n${BLOCK_END}`;
  const start = note.indexOf(BLOCK_START);
  const end = note.indexOf(BLOCK_END, start);
  if (start !== -1 && end !== -1) {
    return note.slice(0, start) + block + note.slice(end + BLOCK_END.length);
  }
  const head = /^---\n[\s\S]*?\n---\n/.exec(note)?.[0] ?? "";
  const rest = note.slice(head.length).replace(/^\n+/, "");
  return `${head}${head ? "\n" : ""}${block}\n${rest ? `\n${rest}` : ""}`;
}
