/**
 * Re-run the current classify/sanitize/extract code on stored prod issues from their raw MIME:
 *   AWS_PROFILE=admin pnpm reprocess [--days 30] [--stage dev]
 * Use after changing packages/core. Raw messages are kept 30 days, so older issues are skipped.
 * State, ratings and sender counts are never touched.
 */
import type { ReprocessStats } from "../services/ingest/src/reprocess.js";
import { invokeIngest, numberArg, stageArg } from "./ingest-lambda.js";

const s = await invokeIngest<ReprocessStats>(stageArg(), {
  reprocess: { days: numberArg("--days", 30) },
});
console.log(
  `Since ${s.since}: ${s.checked} checked, ${s.updated} updated, ${s.missingRaw} past raw retention, ` +
    `${s.nowFiltered} would now be filtered (left as is).`,
);
