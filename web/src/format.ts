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
