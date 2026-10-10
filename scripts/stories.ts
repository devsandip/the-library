/**
 * The story index (#15): Claude splits stored issues into stories, Titan embeds them, and stories
 * about the same event are linked across newsletters.
 *   AWS_PROFILE=admin pnpm stories [--days 30]   issues without stories yet
 *   ... --force                                  split them all again (after a prompt change)
 *   ... --relink                                 recompute event links only (no Claude calls)
 *   ... --stage dev
 * New issues get their stories after every ingest run; this is for the backlog. A run stops
 * starting new issues after 8.5 minutes; run it again to continue.
 */
import type { StoryStats } from "@library/core/types";
import { invokeIngest, numberArg, stageArg } from "./ingest-lambda.js";

// Price per million tokens, for the cost line only (Haiku 4.5's Bedrock price; Titan V2).
const USD_PER_M = { input: 1, output: 5, embed: 0.02 };

const stage = stageArg();
if (process.argv.includes("--relink")) {
  const r = await invokeIngest<{
    stories: number;
    events: number;
    shared: number;
    changed: number;
  }>(stage, { stories: { relink: true } });
  console.log(
    `${stage}: ${r.stories} stories in ${r.events} events, ${r.shared} of them across ` +
      `newsletters. ${r.changed} links changed.`,
  );
} else {
  const s = await invokeIngest<StoryStats>(stage, {
    stories: { days: numberArg("--days", 30), force: process.argv.includes("--force") },
  });
  const cost =
    (s.inputTokens * USD_PER_M.input +
      s.outputTokens * USD_PER_M.output +
      s.embedTokens * USD_PER_M.embed) /
    1e6;
  console.log(
    `${stage}: ${s.checked} to do, ${s.storied} split into ${s.stories} stories, ` +
      `${s.linked} joined an event from another issue, ${s.errors} errors in ` +
      `${Math.round(s.durationMs / 1000)}s.`,
  );
  if (s.deferred) console.log(`${s.deferred} left for another run: rerun pnpm stories`);
  for (const e of s.errorSamples) console.log(`  error: ${e}`);
  console.log(
    `Tokens: ${s.inputTokens} in, ${s.outputTokens} out, ${s.embedTokens} embedded. ` +
      `About $${cost.toFixed(3)} at $1/$5 per million (Haiku) and $0.02 (Titan).`,
  );
}
