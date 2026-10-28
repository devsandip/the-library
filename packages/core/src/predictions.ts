/**
 * Who called it (#24): dated, checkable predictions in the newsletters. Before any Claude call, a
 * cheap screen keeps only sentences that look forward and name a time, so an issue without any
 * costs nothing. Claude gives each prediction's period as a date, month, quarter or year, and the
 * code turns it into the day it comes due: the period's end.
 */

/** Words that look forward: something will, or is expected to, happen. */
const FORWARD =
  /\b(will|won't|wont|shall|going to|expects?|expected to|forecasts?|predicts?|projects?|projected|anticipates?|plans? to|aims? to|sets? to|on track|likely to|unlikely to|poised to|bets?|targets?|could|should)\b/i;

/** A time a prediction can come due by: a year, a quarter, a month, or a span from now. */
const WHEN = [
  /\b20[2-9]\d\b/,
  /\b[QH][1-4]\b/,
  /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b/,
  /\b(next|this|coming|end of the|end of|by the end of|later this|early next|late next)\s+(week|month|quarter|year|decade|summer|spring|autumn|fall|winter|season|holiday)/i,
  /\b(in|within|over the next)\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|a few|several|\d+)\s+(weeks?|months?|quarters?|years?|decades?)\b/i,
];

/** The most passage text Claude reads per issue. */
export const PREDICTION_PASSAGE_CHARS = 8_000;

const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 600);

/** Whether a sentence looks forward and names a time. */
export function looksForward(sentence: string): boolean {
  return FORWARD.test(sentence) && WHEN.some((w) => w.test(sentence));
}

/**
 * The passages of an issue that may hold predictions: each sentence that looks forward and names
 * a time, with the sentences either side, runs joined. Empty when there are none.
 */
export function forwardPassages(text: string): string {
  const all = sentences(text);
  const keep = new Set<number>();
  all.forEach((s, k) => {
    if (!looksForward(s)) return;
    for (const j of [k - 1, k, k + 1]) if (j >= 0 && j < all.length) keep.add(j);
  });
  const runs: string[][] = [];
  let last = -2;
  for (const k of [...keep].sort((a, b) => a - b)) {
    if (k !== last + 1) runs.push([]);
    runs[runs.length - 1]!.push(all[k]!);
    last = k;
  }
  return runs
    .map((r) => r.join(" "))
    .join("\n\n")
    .slice(0, PREDICTION_PASSAGE_CHARS);
}

const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/**
 * The day a prediction comes due, from its period as Claude gives it: a day (2027-03-15), a month
 * (2027-03, its last day), a quarter (2027-Q3, 30 September) or a year (2027, 31 December).
 * Undefined for anything else.
 */
export function periodEnd(by: string): string | undefined {
  const s = by.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return mo >= 1 && mo <= 12 && d >= 1 && d <= lastDay(y, mo) ? s : undefined;
  }
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const [y, mo] = [Number(m[1]), Number(m[2])];
    return mo >= 1 && mo <= 12 ? iso(y, mo, lastDay(y, mo)) : undefined;
  }
  m = /^(\d{4})-Q([1-4])$/i.exec(s);
  if (m) {
    const [y, q] = [Number(m[1]), Number(m[2])];
    return iso(y, q * 3, lastDay(y, q * 3));
  }
  m = /^(\d{4})$/.exec(s);
  if (m) return iso(Number(m[1]), 12, 31);
  return undefined;
}

/** Text compared for a quote: case, spacing and curly quotes set aside. */
export const comparable = (s: string) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** Whether `text` holds `quote` word for word, case, spacing and curly quotes aside. */
export function quoteIn(text: string, quote: string): boolean {
  const q = comparable(quote);
  return q.length >= 8 && comparable(text).includes(q);
}
