import type { Shelf, SenderListItem, Topic } from "@library/core/types";
import { slug, type Show } from "./paths.js";

/**
 * Browse's filter bar is one sentence whose underlined words are the controls:
 *   {count} {show} in {kind}, {topics}, {senders}.
 * The Mac's queue line uses the short form: {count} {show} in {kind}, {order}, {topics}.
 */

export const SHOW_WORD: Record<Show, string> = {
  unread: "unread",
  all: "issues",
  archived: "archived",
};

export const SHOW_LABEL: Record<Show, string> = {
  unread: "Unread",
  all: "All",
  archived: "Archived",
};

export const KIND_WORD: Record<Shelf, string> = { news: "News", learning: "Learning" };

/** "all topics", "about AI & LLMs", "about AI & LLMs and Startups & Business", "... and 2 more". */
export function topicsPhrase(names: string[]): string {
  if (!names.length) return "all topics";
  if (names.length === 1) return `about ${names[0]}`;
  if (names.length === 2) return `about ${names[0]} and ${names[1]}`;
  return `about ${names[0]} and ${names.length - 1} more`;
}

/** "all senders", "from The Ken", "from The Ken and 1 more". */
export function sendersPhrase(names: string[]): string {
  if (!names.length) return "all senders";
  if (names.length === 1) return `from ${names[0]}`;
  return `from ${names[0]} and ${names.length - 1} more`;
}

/** The count in front: exact for Unread; for All and Archived, what has loaded so far. */
export function countWord(n: number | undefined, more = false): string {
  if (n === undefined) return "…";
  return more ? `${n}+` : String(n);
}

/** Topic slugs from the URL, as the names the API filters on, in Claude's order. */
export function topicNames(slugs: string[], topics: Topic[]): string[] {
  const want = new Set(slugs);
  return topics.filter((t) => want.has(slug(t.name))).map((t) => t.name);
}

/** A sender in the URL is its publication's slug, or (from older links) its id. */
export function senderIds(keys: string[], senders: SenderListItem[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const s =
      senders.find((x) => x.senderId === k) ?? senders.find((x) => slug(x.publication) === k);
    if (s && !out.includes(s.senderId)) out.push(s.senderId);
  }
  return out;
}

export const senderSlug = (s: SenderListItem) => slug(s.publication);
