/**
 * Re-key stored issues and rebuild sender items after changing the sender rules in
 * packages/core/src/sources.ts (aliases, split-by-name):
 *   AWS_PROFILE=admin pnpm rebuild-senders            dry run against prod: prints the plan
 *   AWS_PROFILE=admin pnpm rebuild-senders --apply    writes it
 *   ... --stage dev                                   same against the dev stack
 * Deploy first: the rebuild runs in the ingest Lambda with the deployed rules, one run at a time.
 * Read state, ratings and mutes are kept.
 */
import type { RebuildReport } from "../services/ingest/src/senders.js";
import { invokeIngest, stageArg } from "./ingest-lambda.js";

const apply = process.argv.includes("--apply");
const stage = stageArg();
const r = await invokeIngest<RebuildReport>(stage, { rebuildSenders: { apply } });
const list = (title: string, lines: string[]) => {
  if (!lines.length) return;
  console.log(`\n${title} (${lines.length}):`);
  for (const l of lines) console.log(`  ${l}`);
};
console.log(
  `${stage}: ${r.issues} issues, ${r.sendersBefore} senders -> ${r.sendersAfter}. ` +
    `${r.issuesRekeyed} issues re-keyed.`,
);
list("New senders (issues)", r.created);
list("Renamed", r.renamed);
list("Recounted", r.recounted);
list("Removed (no issues left)", r.deleted);
const changes =
  r.issuesRekeyed + r.created.length + r.renamed.length + r.recounted.length + r.deleted.length;
if (!changes) console.log("\nNothing to change.");
else if (!r.applied) console.log("\nDry run: nothing written. Rerun with --apply to write it.");
else console.log("\nApplied.");
