import { readerZone } from "./zone.js";
import type { Narrative } from "@library/core/types";

/** "3h ago", "yesterday", "Oct 2". */
export function relativeTime(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  if (h < 48) return "yesterday";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * How old an issue is, for the mono meta lines: "now", "45m", "5h", "2d", then the date
 * ("2 Oct"). Labels are set in capitals by the stylesheet.
 */
export function age(iso: string, now = Date.now()): string {
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: readerZone(),
    day: "numeric",
    month: "short",
  });
}

/** "Today", "6 Oct", or "Mar 2025" from another year: the dates on a timeline. */
export function shortDate(iso: string, now = Date.now()): string {
  const day = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: readerZone() });
  if (day(Date.parse(iso)) === day(now)) return "Today";
  const d = new Date(iso);
  const sameYear = day(Date.parse(iso)).slice(0, 4) === day(now).slice(0, 4);
  return d.toLocaleDateString("en-GB", {
    timeZone: readerZone(),
    ...(sameYear ? { day: "numeric", month: "short" } : { month: "short", year: "numeric" }),
  });
}

/** "06:14", in the reader's time zone, 24-hour: the mono meta lines and "Checked 12:30". */
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: readerZone(),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** "Sun 11 Oct", for Browse's date line. */
export function dateShort(now = new Date()): string {
  return now
    .toLocaleDateString("en-GB", {
      timeZone: readerZone(),
      weekday: "short",
      day: "numeric",
      month: "short",
    })
    .replace(",", "");
}

/** Under the brief's heading (#18): what it was written from, and when. */
export function narrativeLine(n: Narrative, now = Date.now()): string {
  const papers = n.newsletters === 1 ? "1 newsletter" : `${n.newsletters} newsletters`;
  return `${n.stories} stories from ${papers}, updated ${relativeTime(n.at, now)}.`;
}

/** Noon UTC of a day, formatted in UTC: the day's own date, whatever the reader's zone. */
const noonOf = (day: string) => new Date(`${day}T12:00:00Z`);

/** "Friday 9 October", for read history's day (#42). */
export function dayLine(day: string): string {
  return noonOf(day).toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** "Thu 8 Oct", for read history's previous and next buttons. */
export function shortDay(day: string): string {
  return noonOf(day).toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** "6:42 PM" (or "18:42", by locale), when an issue was opened. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    timeZone: readerZone(),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Skimming one-line summaries runs at about 200 words a minute. */
export function skimMinutes(lines: string[]): number {
  const words = lines.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** A share read as a whole percentage: 0.35 -> 35. */
export const percent = (share: number) => Math.round(share * 100);

/**
 * Why an issue ranks where it does, in plain words with the newsletter named: the ranking says
 * "You found this newsletter useful 4 times"; the card says "You found The Ken useful 4 times".
 */
export function reasonLine(reason: string, publication: string): string {
  return reason.replace("this newsletter", publication);
}

/**
 * The Mac queue's short form of a ranking reason ("↳ Interest · AI"), set in capitals by the
 * stylesheet. Reasons the ranking does not tie to a topic get the issue's topic.
 */
export function reasonCode(reason: string | undefined, topic: string | undefined): string {
  const withTopic = (code: string) => (topic ? `${code} · ${topic}` : code);
  if (!reason) return topic ?? "";
  if (reason === "From a Must Read newsletter") return withTopic("Must Read");
  const rated = /^You found this newsletter useful (once|twice|(\d+) times)$/.exec(reason);
  if (rated) return `${rated[1] === "once" ? 1 : rated[1] === "twice" ? 2 : rated[2]}× Useful`;
  if (reason === "Trying a newsletter you haven't rated yet") return "Exploring · not rated yet";
  const interest = /^Close to your interest in (.+)$/.exec(reason);
  if (interest) return `Interest · ${interest[1]}`;
  if (/^Like ".*", which you found useful$/.test(reason)) return withTopic("Matches");
  if (reason === "Just in") return withTopic("Just in");
  if (reason === "Among the newest") return withTopic("Newest");
  return reason;
}
