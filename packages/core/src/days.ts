/**
 * The reader's calendar. Days are YYYY-MM-DD in India, where the reader lives; India keeps one UTC
 * offset all year, so a day is always the same 24 hours of UTC. Imported by the web app too
 * (`@library/core/days`), so it stays free of dependencies.
 */

/** Days, the digest and the sender sample's seed all use the reader's time zone. */
export const READER_TIME_ZONE = "Asia/Kolkata";
/** The same zone as a UTC offset, for turning a day back into instants. */
const READER_UTC_OFFSET = "+05:30";

/** YYYY-MM-DD in the reader's time zone. */
export function readerDay(now: number, timeZone = READER_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The reader's last `n` calendar days, today first. IST has no daylight saving. */
export function recentDays(now: number, n: number, timeZone = READER_TIME_ZONE): string[] {
  return Array.from({ length: n }, (_, k) => readerDay(now - k * 86_400_000, timeZone));
}

const dayStart = (day: string) => Date.parse(`${day}T00:00:00.000${READER_UTC_OFFSET}`);

/** A real calendar day written YYYY-MM-DD (not 2026-02-30). */
export function isReaderDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const from = dayStart(day);
  return !Number.isNaN(from) && readerDay(from) === day;
}

/** A reader's day as UTC instants, its first and last millisecond, for range queries. */
export function readerDayBounds(day: string): { from: string; to: string } {
  if (!isReaderDay(day)) throw new Error(`not a day: ${day}`);
  const from = dayStart(day);
  return { from: new Date(from).toISOString(), to: new Date(from + 86_399_999).toISOString() };
}
