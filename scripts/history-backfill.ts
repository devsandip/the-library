/**
 * Read history (#42) lists opens by time. Opens logged before it existed lack the index
 * attributes; this adds them, once:
 *   AWS_PROFILE=admin pnpm history-backfill [--stage dev]
 * Safe to run again: it only touches opens that are not indexed yet.
 */
import { invokeIngest, stageArg } from "./ingest-lambda.js";

const stage = stageArg();
const r = await invokeIngest<{ indexed: number }>(stage, { historyBackfill: {} });
console.log(`${stage}: ${r.indexed} earlier opens added to read history.`);
