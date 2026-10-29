/**
 * The reader's calendar. Days are YYYY-MM-DD in the reader's time zone (#185): their settings'
 * `timeZone`, India's for a reader without settings. A zone may change its offset (daylight
 * saving), so a day is not always 24 hours: days step by date, and a day's bounds are found from
 * the zone's offset on that day. Imported by the web app too (`@library/core/days`), so it stays
 * free of dependencies.
 */

/** India: the zone of a reader without settings, and of everything before readers had them. */
export const READER_TIME_ZONE = "Asia/Kolkata";

/** YYYY-MM-DD in the reader's time zone. */
export function readerDay(now: number, timeZone = READER_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const parts = (day: string) => day.split("-").map(Number) as [number, number, number];

/** The day `n` days after (or before) `day`, by date alone. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The reader's last `n` calendar days, today first. */
export function recentDays(now: number, n: number, timeZone = READER_TIME_ZONE): string[] {
  const today = readerDay(now, timeZone);
  return Array.from({ length: n }, (_, k) => addDays(today, -k));
}

/** A real calendar day written YYYY-MM-DD (not 2026-02-30). */
export function isReaderDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = parts(day);
  return addDays(day, 0) === day && m >= 1 && m <= 12 && d >= 1 && y >= 1970;
}

/** How far the zone's clocks are ahead of UTC at an instant, in milliseconds. */
function zoneOffset(at: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  const wall = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return wall - (at - (((at % 1000) + 1000) % 1000));
}

/** The first instant of a day in the zone: its midnight, or the first hour after a skipped one. */
function dayStart(day: string, timeZone: string): number {
  const [y, m, d] = parts(day);
  const midnight = Date.UTC(y, m - 1, d);
  // The offset at midnight UTC is a first guess; the offset at that guess is the zone's own.
  const t = midnight - zoneOffset(midnight - zoneOffset(midnight, timeZone), timeZone);
  return readerDay(t, timeZone) === day ? t : t + 3_600_000;
}

/** A reader's day as UTC instants, its first and last millisecond, for range queries. */
export function readerDayBounds(
  day: string,
  timeZone = READER_TIME_ZONE,
): { from: string; to: string } {
  if (!isReaderDay(day)) throw new Error(`not a day: ${day}`);
  const from = dayStart(day, timeZone);
  const to = dayStart(addDays(day, 1), timeZone) - 1;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}
