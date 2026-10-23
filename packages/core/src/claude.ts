/**
 * Claude for the bounded calls: enrichment, the story split and the day in brief in ingest, and a
 * story's timeline (#19) in the API. One model for all of them, so a switch is one line here.
 *
 * Haiku 5.5 (us.anthropic.claude-haiku-5-5) answers "not available for this account" on this AWS
 * account as of 2026-10-09, so Haiku 4.5 runs instead (#85; Anthropic says 5.5 is about 75%
 * cheaper to run). Both roles allow both (infra/lib/ingest.ts, infra/lib/api.ts).
 */
export const CLAUDE_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

/** Its Bedrock price, dollars per million tokens, for cost lines only. */
export const CLAUDE_PRICE = { input: 1, output: 5 } as const;

/** What a call cost, in cents, to a tenth of a cent. */
export const claudeCents = (inputTokens: number, outputTokens: number) =>
  Math.round((inputTokens * CLAUDE_PRICE.input + outputTokens * CLAUDE_PRICE.output) / 1000) / 10;

/** Who every prompt is for. */
export const READER =
  "The reader is a senior product manager interested in the tech industry, startups, AI, " +
  "product management and system design, plus some general business news.";
