/**
 * Who called it (#139): settle the predictions that have come due, now, from later newsletters.
 *   AWS_PROFILE=admin pnpm settle [--limit 20]
 *   ... --stage dev
 * Prod does this every morning at 07:30 IST; this is for the first run and for trying it out.
 */
import type { SettleStats } from "@library/core/types";
import { invokeJobs, numberArg, stageArg } from "./ingest-lambda.js";

// Price per million tokens, for the cost line only (Haiku 4.5's Bedrock price).
const USD_PER_M = { input: 1, output: 5 };

const stage = stageArg();
const s = await invokeJobs<SettleStats>(stage, {
  kind: "settle",
  limit: numberArg("--limit", 20),
});
const cost = (s.inputTokens * USD_PER_M.input + s.outputTokens * USD_PER_M.output) / 1e6;
console.log(
  `${stage}: ${s.due} due, ${s.right} right, ${s.wrong} wrong, ${s.unclear} unclear ` +
    `(${s.nothingFound} with nothing since), ${s.later} left for later, ${s.errors} errors in ` +
    `${Math.round(s.ms / 1000)}s.`,
);
console.log(
  `Tokens: ${s.inputTokens} in, ${s.outputTokens} out. About $${cost.toFixed(3)} at $1/$5 per ` +
    `million (Haiku), plus a Titan embedding each.`,
);
