/**
 * What a reader's model calls used (#208): per day, the reader's own, and per feature, so the
 * cost of a reader is measured rather than estimated, and daily limits (#209) can read it. One
 * item per reader and day (`USAGE` / `<day>`), its counters added to as each call returns.
 * Imported by the web app too, so it stays free of dependencies.
 */
import { CLAUDE_PRICE } from "./claude.js";

/** Everything that calls a model, by what the reader would call it. */
export const FEATURES = [
  "ask",
  "takes",
  "timeline",
  "source",
  "search",
  "interests",
  "settle",
  "enrich",
  "stories",
  "predictions",
  "narrative",
  "follow",
  "topics",
  "shelves",
] as const;
export type Feature = (typeof FEATURES)[number];

/** One feature's use in a day. */
export interface Use {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** What it cost, in cents, unrounded; Jev's calls count tokens and no cents. */
  cents: number;
}

export interface DayUsage {
  day: string;
  cents: number;
  features: Partial<Record<Feature, Use>>;
}

/** Claude (Haiku) per call, in cents, unrounded: $1 and $5 per million tokens in and out. */
export const claudeUse = (inputTokens: number, outputTokens: number): Omit<Use, "calls"> => ({
  inputTokens,
  outputTokens,
  cents: (inputTokens * CLAUDE_PRICE.input + outputTokens * CLAUDE_PRICE.output) / 10_000,
});

/** Titan V2 embeddings: $0.02 per million tokens. */
export const titanUse = (inputTokens: number): Omit<Use, "calls"> => ({
  inputTokens,
  outputTokens: 0,
  cents: (inputTokens * 0.02) / 10_000,
});

/** The day item's attribute for one of a feature's counters, e.g. `ask_in`. */
export const useAttribute = (f: Feature, counter: keyof Use) =>
  `${f}_${{ calls: "calls", inputTokens: "in", outputTokens: "out", cents: "cents" }[counter]}`;

/** A day's item read back. */
export function dayUsageOf(item: Record<string, unknown>): DayUsage {
  const features: DayUsage["features"] = {};
  let cents = 0;
  const num = (k: string) => (typeof item[k] === "number" ? (item[k] as number) : 0);
  for (const f of FEATURES) {
    const calls = num(useAttribute(f, "calls"));
    if (!calls) continue;
    const use: Use = {
      calls,
      inputTokens: num(useAttribute(f, "inputTokens")),
      outputTokens: num(useAttribute(f, "outputTokens")),
      cents: num(useAttribute(f, "cents")),
    };
    features[f] = use;
    cents += use.cents;
  }
  return { day: String(item.sk), cents, features };
}

/** Where calls are recorded: the reader's (or owner's) usage for their day. */
export interface Meter {
  record(feature: Feature, use: Omit<Use, "calls">): Promise<void>;
}

/** What the reader asks for that a daily limit counts (#209): one use per request. */
export const LIMITED = ["ask", "takes", "timeline", "source"] as const;
export type Limited = (typeof LIMITED)[number];

/** Uses a day, for every reader for now (an operator can set a reader's own in their settings). */
export const DAILY_LIMITS: Record<Limited, number> = {
  ask: 50,
  takes: 50,
  timeline: 50,
  source: 50,
};

const NOUNS: Record<Limited, string> = {
  ask: "questions",
  takes: "comparisons",
  timeline: "timelines",
  source: "source checks",
};

/** What a reader at the day's limit is told (#209). */
export const limitMessage = (f: Limited, limit: number) =>
  `That's today's ${limit} ${limit === 1 ? NOUNS[f].replace(/s$/, "") : NOUNS[f]}. More tomorrow.`;

/** The day item's count of a feature's uses. */
export const usesAttribute = (f: Limited) => `${f}_uses`;

/** The usage list the API answers (`GET /usage`), the newest day first. */
export interface UsageResponse {
  days: DayUsage[];
}
