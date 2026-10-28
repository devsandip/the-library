/**
 * Who called it (#24): screen stored issues for dated, checkable predictions.
 *   AWS_PROFILE=admin pnpm predictions [--days 120]   issues not screened yet
 *   ... --stage dev
 * New issues are screened after every ingest run; this is for the archive. A run stops starting
 * new issues after 8.5 minutes; run it again to continue.
 */
import type { PredictionStats } from "@library/core/types";
import { invokeIngest, numberArg, stageArg } from "./ingest-lambda.js";

// Price per million tokens, for the cost line only (Haiku 4.5's Bedrock price).
const USD_PER_M = { input: 1, output: 5 };

const stage = stageArg();
const s = await invokeIngest<PredictionStats>(stage, {
  predictions: { days: numberArg("--days", 120) },
});
const cost = (s.inputTokens * USD_PER_M.input + s.outputTokens * USD_PER_M.output) / 1e6;
console.log(
  `${stage}: ${s.checked} to do, ${s.screened} screened, ${s.called} with forward-looking ` +
    `passages, ${s.predictions} predictions, ${s.errors} errors in ` +
    `${Math.round(s.durationMs / 1000)}s.`,
);
if (s.deferred) console.log(`${s.deferred} left for another run: rerun pnpm predictions`);
for (const e of s.errorSamples) console.log(`  error: ${e}`);
console.log(
  `Tokens: ${s.inputTokens} in, ${s.outputTokens} out. About $${cost.toFixed(3)} at $1/$5 per ` +
    `million (Haiku).`,
);
