/**
 * Story shelves (#81): Jev reads stored stories and puts each on News or Learning.
 *   AWS_PROFILE=admin pnpm shelves [--days 30]   stories without a shelf yet
 *   ... --force                                  ask Jev again about all but Sandip's moves
 *   ... --derive                                 no Jev: shelves, states, the Learning index and
 *                                                every issue's shelf brought in line (all stories)
 *   ... --stage dev                              dev has no Jev key, so only --derive works there
 * New stories are shelved after every ingest run; this is for the backlog. A run stops starting
 * new stories after 9 minutes; run it again to continue.
 */
import type { ShelfDeriveStats, ShelfStats } from "@library/core/types";
import { invokeIngest, numberArg, stageArg } from "./ingest-lambda.js";

// TypeSafe's price per million input tokens, for the cost line only.
const USD_PER_M_INPUT = 0.042;

const stage = stageArg();
if (process.argv.includes("--derive")) {
  const d = await invokeIngest<ShelfDeriveStats>(stage, { shelves: { derive: true } });
  console.log(
    `${stage}: ${d.stories} stories, ${d.storiesChanged} rewritten, ${d.unreadLearning} unread on ` +
      `Learning; ${d.issues} issues with stories, ${d.issuesChanged} changed shelf, in ` +
      `${Math.round(d.durationMs / 1000)}s.`,
  );
  if (d.skipped) console.log(`${d.skipped} changed while this ran: rerun pnpm shelves --derive`);
  process.exit(0);
}
const s = await invokeIngest<ShelfStats>(stage, {
  shelves: { days: numberArg("--days", 30), force: process.argv.includes("--force") },
});
console.log(
  `${stage}: ${s.checked} to do, ${s.shelved} shelved (${s.learning} Learning, ` +
    `${s.shelved - s.learning} News; ${s.unsure} between 0.4 and 0.6), ${s.errors} errors in ` +
    `${Math.round(s.durationMs / 1000)}s.`,
);
if (s.deferred) console.log(`${s.deferred} left for another run: rerun pnpm shelves`);
for (const e of s.errorSamples) console.log(`  error: ${e}`);
console.log(
  `Tokens: ${s.inputTokens} in. About $${((s.inputTokens * USD_PER_M_INPUT) / 1e6).toFixed(3)} ` +
    `at $${USD_PER_M_INPUT} per million (Jev).`,
);
