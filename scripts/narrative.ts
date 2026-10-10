/**
 * Today's news as a narrative (#18). The ingest run writes a new version when the day's News has
 * moved on (4 hours and 5 new stories since the last); this checks now:
 *   AWS_PROFILE=admin pnpm narrative [--force] [--stage dev]
 */
import type { NarrativeStats } from "@library/core/types";
import { invokeIngest, stageArg } from "./ingest-lambda.js";

// Price per million tokens, for the cost line only (Haiku 4.5's Bedrock price).
const USD_PER_M = { input: 1, output: 5 };

const stage = stageArg();
const s = await invokeIngest<NarrativeStats>(stage, {
  narrative: { force: process.argv.includes("--force") },
});
if (!s.written) {
  console.log(
    `${stage}: no new narrative (${s.skipped}); ${s.stories} News stories in the last day.`,
  );
} else {
  const cost = (s.inputTokens * USD_PER_M.input + s.outputTokens * USD_PER_M.output) / 1e6;
  console.log(`${stage}: ${s.threads} threads from ${s.stories} News stories:`);
  for (const t of s.titles ?? []) console.log(`  ${t}`);
  console.log(
    `Tokens: ${s.inputTokens} in, ${s.outputTokens} out. About $${cost.toFixed(3)} at $1/$5 per million.`,
  );
}
