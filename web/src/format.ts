import type { DigestStats, Narrative } from "@library/core/types";

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

/** "Saturday 10 October", for the phone's header and the Summary. */
export function todayLine(now = new Date()): string {
  return now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

/**
 * The success measure in a line (#5): of the boxed top 5s over the last 14 days, how many were
 * rated Relevant. The PRD's aim is 3 in 5.
 */
export function digestLine(s: DigestStats): string {
  const pct = Math.round((100 * s.relevant) / s.shown);
  return (
    `Boxed top 5s, last 14 days: ${s.relevant} of ${s.shown} rated Relevant (${pct}%), ` +
    `${s.irrelevant} Irrelevant. The aim is 60%.`
  );
}

/** Under the narrative's heading (#18): what it was written from, and when. */
export function narrativeLine(n: Narrative, now = Date.now()): string {
  const papers = n.newsletters === 1 ? "1 newsletter" : `${n.newsletters} newsletters`;
  return `From ${n.stories} stories in ${papers}, updated ${relativeTime(n.at, now)}.`;
}
