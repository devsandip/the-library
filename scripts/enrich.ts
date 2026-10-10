/**
 * Have Claude sort stored issues (summary, News or Learning, topic, promo) and embed them:
 *   AWS_PROFILE=admin pnpm enrich [--days 30]   issues not enriched yet
 *   ... --force                                 redo all of them (after a topic or prompt change)
 *   ... --stage dev
 * New issues are enriched after every ingest run; this is for the backlog. A run stops starting
 * new issues after 9 minutes; run it again to continue.
 */
import type { EnrichStats } from "@library/core/types";
import { invokeIngest, numberArg, stageArg } from "./ingest-lambda.js";

// Price per million tokens, for the cost line only (Haiku 5.5's Bedrock offer; Titan V2).
const USD_PER_M = { input: 1, output: 5, embed: 0.02 };

const stage = stageArg();
const s = await invokeIngest<EnrichStats>(stage, {
  enrich: { days: numberArg("--days", 30), force: process.argv.includes("--force") },
});
const cost =
  (s.inputTokens * USD_PER_M.input +
    s.outputTokens * USD_PER_M.output +
    s.embedTokens * USD_PER_M.embed) /
  1e6;
console.log(
  `${stage}: ${s.checked} to do, ${s.classified} sorted by Claude, ${s.embedded} embedded, ` +
    `${s.errors} errors in ${Math.round(s.durationMs / 1000)}s.`,
);
if (s.accountFiltered) console.log(`${s.accountFiltered} account mail filed as filtered (#50)`);
if (s.waitingForTopics)
  console.log(`${s.waitingForTopics} wait for a topic list: pnpm topics --apply`);
if (s.deferred) console.log(`${s.deferred} left for another run: rerun pnpm enrich`);
for (const e of s.errorSamples) console.log(`  error: ${e}`);
console.log(
  `Tokens: ${s.inputTokens} in, ${s.outputTokens} out, ${s.embedTokens} embedded. ` +
    `About $${cost.toFixed(3)} at $1/$5 per million (Haiku) and $0.02 (Titan).`,
);
